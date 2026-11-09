import { detectPluginPlatform, type PluginContext } from "@vetta-org/plugin-sdk";

/**
 * 面板与 Agent 工具共用的播放器操作层——全部走宿主通用原语，无本地脚本：
 *
 * - 查询/启动/结束进程：`ctx.processes`（`system.processes.manage` 权限）
 * - 打开数据目录：`ctx.ui.openPath`（`shell.openPath` 权限）
 * - 缓存统计与清理：`ctx.fs.managed`（`fs.managed` 权限 + `plugin.json#fs.scopes`
 *   声明的受管目录——宿主展开 %APPDATA% 后由 capability runtime 的 path-prefix
 *   约束校验路径，越界直接拒绝）
 * - 数据目录定位：`ctx.env.paths.appData()`（宿主供给）+ `hgplayer` 约定名
 *
 * 平台判定走 SDK 统一探测；SSH 远程会话里这些本机操作无意义——统一拒绝。
 */
export interface HongguoController {
	/** 插件安装根目录（bin/ 的父目录）；解析失败为 null（非 win32 或未就绪）。 */
	readonly pluginRoot: string | null;
	/** 播放器数据目录（%APPDATA%\hgplayer）；解析成功前为 null。 */
	readonly dataDir: string | null;
	refresh(): Promise<void>;
	/** 确保播放器已安装：缺失时从官方 release 下载（带进度回调）。 */
	ensureInstalled(onProgress?: (received: number, total: number) => void): Promise<void>;
	/** 已安装播放器的文件大小（字节）；未安装为 0。用于版本比对。 */
	playerInstalledBytes(): Promise<number>;
	/** 检查更新：远端清单版本 + 本地是否最新（未安装时 latest=false）。 */
	checkUpdate(): Promise<{
		remoteVersion: string;
		installed: boolean;
		localIsLatest: boolean;
	}>;
	isRunning(): Promise<boolean>;
	launch(onProgress?: (received: number, total: number) => void): Promise<{ launched: boolean; alreadyRunning: boolean }>;
	stop(): Promise<void>;
	cacheSizeBytes(): Promise<number>;
	cleanCache(deep: boolean): Promise<void>;
	openDataDir(): Promise<void>;
}

/** 面向模型/面板的错误类型：message 可直接展示。 */
export class HongguoError extends Error {}

/**
 * 播放器分发源：自建 R2（latest.json 版本清单 + 固定文件名，由
 * scripts/upload-player-r2.mjs 上传维护）。不走 GitHub API（免鉴权限额 60/h
 * 会 403）；清单 bytes 变化即触发重下——升级只需上传新文件与新清单。
 */
const R2_MANIFEST_URL = "https://r2.youth.huxiaojia.cloud/plugins/hongguo-player/player/latest.json";

export function createHongguoController(
	ctx: PluginContext,
	options: { platform?: string } = {},
): HongguoController {
	// 平台判定优先级：测试注入 > 宿主上报（ctx.env.platform）> 环境嗅探。
	// 真实宿主上后两者恒等；CI 在 linux 上跑 Windows 合同测试时以宿主上报为准。
	const platform = options.platform ?? ctx.env.platform ?? detectPluginPlatform();
	// null = 无法判定：放行，由原语调用失败兜底；仅显式非 Windows 平台才拒绝。
	const isWindows = platform === null || platform === "win32";
	let pluginRoot: string | null = null;
	let resolvedDataDir: string | null = null;

	const assertUsable = (_action: string): void => {
		if (!isWindows) throw new HongguoError("hongguo-player 目前仅支持 Windows");
	};

	async function resolveRoot(): Promise<string> {
		if (pluginRoot) return pluginRoot;
		// 优先用 ctx.plugin.rootPath（plugin API 2.13.0+，插件访问自己的安装目录）。
		// 旧宿主回落 official.plugins.list()——该 API 仅官方插件可用，市场插件会被
		// 门控拒绝（此前红果因此启动失败），故仅作为兼容路径并吞掉门控错误。
		pluginRoot = ctx.plugin.rootPath ?? null;
		if (!pluginRoot) {
			try {
				const plugins = await ctx.official.plugins.list();
				pluginRoot = plugins.find((entry) => entry.id === "hongguo-player")?.rootPath ?? null;
			} catch {
				pluginRoot = null;
			}
		}
		if (!pluginRoot) throw new HongguoError("未能解析插件安装目录，请重新安装插件后重试");
		return pluginRoot;
	}

	/** 播放器数据目录 = %APPDATA%\hgplayer（路径来自宿主 env.paths，一次解析后缓存）。 */
	async function resolveDataDir(): Promise<string> {
		if (resolvedDataDir) return resolvedDataDir;
		const { PLAYER_DATA_DIR_NAME } = await import("./hongguo.js");
		const appData = await ctx.env.paths?.appData();
		if (!appData) throw new HongguoError("未能定位用户数据目录（%APPDATA%）");
		resolvedDataDir = `${appData}\\${PLAYER_DATA_DIR_NAME}`;
		return resolvedDataDir;
	}

	/** 播放器程序目录：%APPDATA%\hongguo-player\bin（受管 scope，与插件版本目录解耦——升级/重装/卸载均不受影响）。 */
	async function playerProgramBinDir(): Promise<string> {
		const appData = await ctx.env.paths!.appData();
		return `${appData}\\hongguo-player\\bin`;
	}

	/** 读取 R2 版本清单（版本与文件 bytes；失败给可读错误）。 */
	async function fetchManifest(): Promise<{
		version: string;
		exe: { url: string; bytes: number };
		ffmpeg: { url: string; bytes: number };
	}> {
		if (!ctx.network) throw new HongguoError("宿主网络能力不可用，无法获取播放器");
		const response = await ctx.network.request<{
			version: string;
			exe: { url: string; bytes: number };
			ffmpeg: { url: string; bytes: number };
		}>({ url: R2_MANIFEST_URL, responseType: "json", timeoutMs: 15_000 });
		if (!response.ok) throw new HongguoError(`获取播放器版本清单失败（HTTP ${response.status}）`);
		const manifest = response.body;
		if (!manifest?.exe?.url || !manifest?.ffmpeg?.url) throw new HongguoError("播放器版本清单格式无效");
		return manifest;
	}

	/**
	 * 确保播放器已安装到程序目录：R2 清单 bytes 与本地 stat 不一致（或缺失）即下载。
	 * 升级 = 上传新文件 + 更新清单（version/bytes 变化自动触发重下）。
	 */
	async function ensureInstalled(onProgress?: (received: number, total: number) => void): Promise<void> {
		const { PLAYER_EXE } = await import("./hongguo.js");
		const binDir = await playerProgramBinDir();
		const manifest = await fetchManifest();
		const exe = `${binDir}\\${PLAYER_EXE}`;
		const exeStat = await ctx.fs.managed!.stat(exe).catch(() => null);
		const progress = onProgress
			? (event: { received: number; total: number }) => onProgress(event.received, event.total)
			: undefined;
		if (!exeStat || exeStat.size !== manifest.exe.bytes) {
			await ctx.fs.managed!.download(
				{ url: manifest.exe.url, directory: binDir, filename: PLAYER_EXE, extract: false },
				progress,
			);
		}
		const ffmpegStat = await ctx.fs.managed!.stat(`${binDir}\ffmpeg.exe`).catch(() => null);
		if (!ffmpegStat || ffmpegStat.size !== manifest.ffmpeg.bytes) {
			// ffmpeg 清单 bytes 是轻量 zip 的大小，本地解压后 ffmpeg.exe 尺寸不同——
			// 以存在性为准：缺失才重下（zip 覆盖式升级时删除本地 ffmpeg 再装）。
			if (!ffmpegStat) {
				await ctx.fs.managed!.download(
					{ url: manifest.ffmpeg.url, directory: binDir, filename: "ffmpeg-release.zip", extract: true },
					progress,
			);
			}
		}
	}

	async function checkUpdate(): Promise<{
		remoteVersion: string;
		/** 本地已安装播放器（exe 存在）。未安装时谈不上「是否最新」。 */
		installed: boolean;
		localIsLatest: boolean;
	}> {
		const { PLAYER_EXE } = await import("./hongguo.js");
		const manifest = await fetchManifest();
		const binDir = await playerProgramBinDir();
		const exeStat = await ctx.fs.managed!.stat(`${binDir}\\${PLAYER_EXE}`).catch(() => null);
		const installed = exeStat !== null;
		return {
			remoteVersion: manifest.version,
			installed,
			// 未安装时不判「最新」——由面板走「未安装」引导分支。
			localIsLatest: installed && exeStat!.size === manifest.exe.bytes,
		};
	}

	async function playerInstalledBytes(): Promise<number> {
		const { PLAYER_EXE } = await import("./hongguo.js");
		const binDir = await playerProgramBinDir();
		const info = await ctx.fs.managed!.stat(`${binDir}\\${PLAYER_EXE}`).catch(() => null);
		return info?.size ?? 0;
	}

	async function isRunning(): Promise<boolean> {
		assertUsable("查询状态");
		const { PLAYER_IMAGE_NAME } = await import("./hongguo.js");
		return (await ctx.processes.list(PLAYER_IMAGE_NAME)).length > 0;
	}

	async function launch(
		onProgress?: (received: number, total: number) => void,
	): Promise<{ launched: boolean; alreadyRunning: boolean }> {
		assertUsable("启动");
		await ensureInstalled(onProgress);
		if (await isRunning()) return { launched: false, alreadyRunning: true };
		const { PLAYER_EXE } = await import("./hongguo.js");
		const binDir = await playerProgramBinDir();
		try {
			await ctx.processes.launch(`${binDir}\\${PLAYER_EXE}`, { cwd: binDir });
		} catch (cause) {
			// 安装不完整（bin/ 被覆盖丢失）是最常见的启动失败原因，给出可操作指引。
			const message = cause instanceof Error ? cause.message : String(cause);
			if (/Executable not found/i.test(message)) {
				throw new HongguoError("播放器文件缺失（插件安装不完整）：请在插件详情页点「重载」，或重新安装插件包以恢复 bin/ 目录");
			}
			throw cause;
		}
		return { launched: true, alreadyRunning: false };
	}

	async function stop(): Promise<void> {
		assertUsable("停止");
		const { PLAYER_IMAGE_NAME } = await import("./hongguo.js");
		await ctx.processes.kill(PLAYER_IMAGE_NAME);
	}

	async function cacheSizeBytes(): Promise<number> {
		const { cacheSubdirPaths } = await import("./hongguo.js");
		const dir = await resolveDataDir();
		let total = 0;
		for (const subdir of cacheSubdirPaths(dir)) {
			total += await ctx.fs.managed!.directorySize(subdir);
		}
		return total;
	}

	async function cleanCache(deep: boolean): Promise<void> {
		assertUsable("清理数据");
		const { cacheSubdirPaths } = await import("./hongguo.js");
		const dir = await resolveDataDir();
		// 播放器运行中会锁住数据文件（删除抛 EPERM/EBUSY）——先自动停止并等待退出。
		if (await isRunning()) {
			await stop();
			for (let waited = 0; (await isRunning()) && waited < 8000; waited += 500) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}
		// 浅清理只删缓存子目录（保留登录/收藏/历史/设置）；深清理删整个数据目录，
		// 由调用方先向用户确认。越界路径会被宿主 path-prefix 约束拒绝。
		const targets = deep ? [dir] : cacheSubdirPaths(dir);
		for (const target of targets) {
			await ctx.fs.managed!.delete(target);
		}
	}

	async function openDataDir(): Promise<void> {
		assertUsable("打开数据目录");
		const dir = await resolveDataDir();
		await ctx.ui.openPath(dir);
	}

	return {
		get pluginRoot() {
			return pluginRoot;
		},
		get dataDir() {
			return resolvedDataDir;
		},
		refresh: async () => {
			if (!isWindows) return;
			try {
				await resolveRoot();
			} catch {
				// 首次解析失败不抛出：面板显示未就绪，动作触发时再报错。
			}
			try {
				// 面板要展示真实数据目录（而不是 %APPDATA% 字面量），这里一并解析。
				await resolveDataDir();
			} catch {
				// 同上：拿不到时面板显示通用文案。
			}
		},
		ensureInstalled,
		checkUpdate,
		playerInstalledBytes,
		isRunning,
		launch,
		stop,
		cacheSizeBytes,
		cleanCache,
		openDataDir,
	};
}
