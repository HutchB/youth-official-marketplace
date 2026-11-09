import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@vetta-org/plugin-sdk";

// definePlugin 换成恒等：直接拿到 definition 手动 activate（chinese-chess 先例）。
vi.mock("@vetta-org/plugin-sdk", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@vetta-org/plugin-sdk");
	return { ...actual, definePlugin: (definition: unknown) => definition };
});

import plugin from "../src/index";

interface RegisteredTool {
	id: string;
	handler: (input: { session: { cwd: string } }) => Promise<Record<string, unknown>>;
}

const PLUGIN_ROOT = "C:\\fake\\plugins\\hongguo-player";
const APP_DATA = "C:\\Users\\u\\AppData\\Roaming";

/**
 * 全原语合同（plugin API 2.11.0+）：helper.mjs 已退役——启动/状态/停止走
 * ctx.processes、打开目录走 ctx.ui.openPath、缓存统计/清理走 ctx.fs.managed、
 * 数据目录定位走 ctx.env.paths.appData。controller 同步构造，activate 返回即
 * 工具可用（「尚未就绪」的回归）。
 */
function fakeContext() {
	const tools: RegisteredTool[] = [];
	const launched: Array<{ exePath: string; cwd?: string }> = [];
	const killedImages: string[] = [];
	const openedPaths: string[] = [];
	const deletedPaths: string[] = [];
	const managedSizes = new Map<string, number>();
	let runningImage: string | null = null;
	const ctx = {
		processes: {
			list: async (image: string) => (runningImage === image ? [{ pid: 7, image }] : []),
			kill: async (image: string) => {
				killedImages.push(image);
				runningImage = null;
			},
			launch: async (exePath: string, options?: { args?: string[]; cwd?: string }) => {
				launched.push({ exePath, cwd: options?.cwd });
				runningImage = exePath.split("\\").pop() ?? exePath;
				return { pid: 8 };
			},
		},
		ui: {
			openPath: async (path: string) => {
				openedPaths.push(path);
			},
			registerWorkspaceView: () => ({ dispose: () => {} }),
		},
		env: {
			platform: "win32" as const,
			paths: {
				appData: async () => APP_DATA,
				home: async () => "C:\\Users\\u",
			},
		},
		fs: {
			managed: {
				directorySize: async (path: string) => managedSizes.get(path) ?? 0,
				delete: async (path: string) => {
					deletedPaths.push(path);
					managedSizes.delete(path);
				},
				stat: async (path: string) => (managedSizes.has(path) ? { size: 1, modifiedAt: 0, isDirectory: false } : null),
				list: async () => [],
				download: async (input: { url: string; directory: string; filename?: string }) => {
					// 模拟下载落地：记录并让后续 stat 命中。
					managedSizes.set(`${input.directory}\\${input.filename ?? ""}`, 1);
					return { filePath: `${input.directory}\\${input.filename ?? ""}`, bytes: 1 };
				},
			},
		},
		network: {
			request: async () => ({
				ok: true,
				status: 200,
				statusText: "",
				headers: {},
				body: {
					// R2 latest.json 清单（唯一下载源；GitHub API 曾 403 限流）。
					version: "1.2.24",
					exe: { url: "https://r2.youth.huxiaojia.cloud/plugins/hongguo-player/player/windows-amd64.exe", bytes: 27335680 },
					ffmpeg: { url: "https://r2.youth.huxiaojia.cloud/plugins/hongguo-player/player/ffmpeg-windows-amd64.zip", bytes: 1998973 },
				},
			}),
		},
		plugin: { id: "hongguo-player", version: "0.1.0", rootPath: PLUGIN_ROOT },
		// 新宿主走 ctx.plugin.rootPath；official 保留为空实现，验证不再依赖官方 API。
		official: {
			plugins: {
				list: async () => {
					throw new Error("Plugin official renderer capability access denied");
				},
			},
		},
		agent: {
			registerTool: (tool: RegisteredTool) => {
				tools.push(tool);
				return { dispose: () => {} };
			},
		},
	} as unknown as PluginContext;
	return {
		ctx,
		tools,
		launched,
		killedImages,
		openedPaths,
		deletedPaths,
		managedSizes,
		setRunning: (image: string | null) => {
			runningImage = image;
		},
	};
}

const DATA_DIR = `${APP_DATA}\\hgplayer`;

describe("hongguo-player activation", () => {
	it("tools are usable immediately after activate (controller ready, no 'not ready' purgatory)", async () => {
		const { ctx, tools } = fakeContext();
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);

		const status = tools.find((tool) => tool.id === "hongguo-status");
		expect(status).toBeTruthy();
		const result = await status.handler({ session: { cwd: "C:\\proj" } });
		expect(result).toEqual({ ok: true, message: "stopped" });
	});

	it("launch prefers the ctx.processes primitive with the packaged player", async () => {
		const { ctx, tools, launched } = fakeContext();
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);

		const launch = tools.find((tool) => tool.id === "hongguo-launch");
		expect(launch).toBeTruthy();
		const result = await launch.handler({ session: { cwd: "C:\\proj" } });
		expect(result).toEqual({ ok: true, message: "已启动红果短剧播放器" });

		// 程序原语：exe 指向受管程序目录（%APPDATA%/hongguo-player/bin），工作目录即 bin。
		expect(launched).toHaveLength(1);
		expect(launched[0].exePath).toContain("bin\\红果短剧.exe");
		expect(launched[0].cwd?.endsWith("\\bin")).toBe(true);
	});

	it("stop kills by image name through ctx.processes", async () => {
		const { ctx, tools, killedImages } = fakeContext();
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);

		const stop = tools.find((tool) => tool.id === "hongguo-stop");
		const result = await stop.handler({ session: { cwd: "C:\\proj" } });
		expect(result).toEqual({ ok: true, message: "已停止红果短剧播放器" });
		expect(killedImages).toEqual(["红果短剧.exe"]);
	});

	it("reports the already-running state without spawning a second player", async () => {
		const { ctx, tools, launched, setRunning } = fakeContext();
		setRunning("红果短剧.exe");
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);

		const launch = tools.find((tool) => tool.id === "hongguo-launch");
		const result = await launch.handler({ session: { cwd: "C:\\proj" } });
		expect(result).toEqual({ ok: true, message: "红果短剧已在运行中" });
		expect(launched).toHaveLength(0);
	});

	it("shallow clean deletes only cache subdirs under the managed scope", async () => {
		const { ctx, tools, deletedPaths } = fakeContext();
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);

		const clean = tools.find((tool) => tool.id === "hongguo-clean-cache");
		const result = await clean.handler({ session: { cwd: "C:\\proj" }, trigger: { input: { deep: false } } });
		expect(result).toEqual({ ok: true, message: "已清理红果短剧缓存" });
		expect(deletedPaths).toEqual([`${DATA_DIR}\\webview`, `${DATA_DIR}\\update`]);
	});

	it("open-data-dir resolves %APPDATA% via ctx.env.paths and opens via ui.openPath", async () => {
		const { ctx, tools, openedPaths } = fakeContext();
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);

		const open = tools.find((tool) => tool.id === "hongguo-open-data-dir");
		const result = await open.handler({ session: { cwd: "C:\\proj" } });
		expect(result).toEqual({ ok: true, message: "已打开数据目录" });
		expect(openedPaths).toEqual([DATA_DIR]);
	});

	it("still operates in SSH-project sessions (player runs on this machine)", async () => {
		const { ctx, tools, killedImages } = fakeContext();
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);

		// 远程项目会话里打开本机播放器是合理需求：操作走本机 capability 引擎。
		const stop = tools.find((tool) => tool.id === "hongguo-stop");
		const result = await stop.handler({ session: { cwd: "ssh://host/path" } });
		expect(result).toMatchObject({ ok: true });
		expect(killedImages).toEqual(["红果短剧.exe"]);
	});
});
