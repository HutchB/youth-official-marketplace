/**
 * 红果短剧播放器的进程与数据操作核心（纯函数，便于单测）。
 *
 * 本机操作全部走宿主通用原语（plugin API 2.11.0+）：`ctx.processes`（进程
 * 查询/启动/结束）、`ctx.ui.openPath`（打开目录）、`ctx.fs.managed`（受管目录
 * 统计与清理，路径由宿主 path-prefix 约束校验）、`ctx.env.paths.appData()`
 * （数据目录定位）。曾经的 PowerShell 拼接与随包 helper.mjs 已完全退役——
 * 零本地脚本、零 node 命令授权。
 *
 * 实测事实（2026-11-06，guo v1.2.18-windows-amd64）：
 * - 进程名 `红果短剧.exe`（tasklist/taskkill 按映像名过滤）；
 * - 数据目录 `%APPDATA%\hgplayer`：`hgplayer.db(+wal/shm)`=收藏/历史/设置、
 *   `device.json`/`install_id`=设备身份、`window.json`=窗口位置、
 *   `webview/`=WebView2 缓存、`update/`=自动更新缓存；
 * - 本地服务为动态端口的内部流服务（根路径 404），无对外 UI，不可嵌入。
 */

/** 播放器主程序文件名（bin 目录内，保留原名以兼容其自动更新按名替换）。 */
export const PLAYER_EXE = "红果短剧.exe";
/** tasklist/taskkill 使用的映像名（含扩展名）。 */
export const PLAYER_IMAGE_NAME = "红果短剧.exe";
/** 播放器数据目录名（相对 %APPDATA%）。 */
export const PLAYER_DATA_DIR_NAME = "hgplayer";
/** 浅清理目标：缓存性质目录（不动登录/收藏/历史/设置）。 */
export const CACHE_SUBDIRS = ["webview", "update"] as const;
/** 播放器数据目录（%APPDATA%\hgplayer）。非 Windows 返回 null（本期仅支持 win32）。 */
export function playerDataDir(platform: string, appData: string | undefined): string | null {
	if (platform !== "win32" || !appData) return null;
	return `${appData}\\${PLAYER_DATA_DIR_NAME}`;
}

/** bin 目录内播放器 exe 的绝对路径。 */
export function playerExePath(pluginRoot: string): string {
	return `${pluginRoot.replace(/[\\/]+$/, "")}\\bin\\${PLAYER_EXE}`;
}

/** bin 目录绝对路径（launch 的工作目录，播放器按 cwd 定位 ffmpeg 等伴生文件）。 */
export function playerBinDir(pluginRoot: string): string {
	return `${pluginRoot.replace(/[\\/]+$/, "")}\\bin`;
}

/** 浅清理的目标目录列表（数据目录下的缓存子目录绝对路径）。 */
export function cacheSubdirPaths(dataDir: string): string[] {
	return CACHE_SUBDIRS.map((name) => `${dataDir}\\${name}`);
}

