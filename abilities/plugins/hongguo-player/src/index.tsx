import { definePlugin, type PluginContext } from "@vetta-org/plugin-sdk";
import "./styles.css";
import type { JSX } from "react";
import { HongguoPanel } from "./panel.js";
import { createHongguoController, HongguoError, type HongguoController } from "./controller.js";

const VIEW_ID = "console";
/** 与 computer-use 相同的激活场景面：本地对话/项目/Claw/CLI 都允许触发。 */
const SCENARIOS = ["conversation", "project", "im-claw", "cli"] as const;

	let controller: HongguoController | null = null;
	/** 宿主解析好的插件图标 URL（vetta-plugin:// 协议），传给面板展示官方 logo。 */
	let pluginIconUrl: string | null = null;
/** activate 时构造失败的真实原因；工具触发时优先呈现它而不是笼统的「尚未就绪」。 */
let controllerInitError: string | null = null;

export default definePlugin({
	activate(ctx) {
		// createHongguoController 无异步初始化（路径/状态都懒解析），同步构造：
		// activate 返回即工具可用。曾用 promise.then 赋值——一旦静默 reject
		//（void 掉没有 catch），controller 永远为 null，所有工具只会报
		//「尚未就绪」，真实原因被吞掉。
		try {
			pluginIconUrl = ctx.plugin.iconUrl ?? null;
			controller = createHongguoController(ctx, {
				// 会话 cwd 由宿主在工具调用时给出；activate 时机拿不到，SSH 守卫在 handler 内做。
			});
			void controller.refresh();
		} catch (cause) {
			controllerInitError = cause instanceof Error ? cause.message : String(cause);
		}

		ctx.ui.registerWorkspaceView({
			id: VIEW_ID,
			label: "%view.console.label%",
			description: "%view.console.description%",
			// 继承 plugin.json 的品牌图标；图片默认被主题前景色 mask 成单色剪影
			//（红果橙绿渐变 logo 会变成黑块），iconTint:false 保留全彩。
			iconTint: false,
			component: function HongguoWorkspaceView(props: { viewId: string; pluginId: string }): JSX.Element {
				return (
					<HongguoPanel
						{...props}
						controller={controller}
						initError={controllerInitError}
						iconUrl={pluginIconUrl}
					/>
				);
			},
		});

		registerAgentTools(ctx);
	},
	deactivate() {
		// 播放器是用户桌面应用，不随插件停用强杀；由用户或工具按需停止。
		controller = null;
	},
});

/** 面板与 Agent 共用同一 controller；工具 Schema 面向模型用中文描述。 */
	function registerAgentTools(ctx: PluginContext): void {
		const requireController = (): HongguoController => {
			if (controller) return controller;
			throw new HongguoError(
				controllerInitError ?? "hongguo-player 初始化失败，请重启 Youth 或重新启用插件",
			);
		};

	// handler 的异常统一折成 { ok:false, retryable } 由宿主呈现给模型。
	// 不按会话 cwd 做 SSH 拒绝：播放器操作走本机 capability 引擎（进程/下载都在
	// 本机执行），远程会话里打开本机播放器是合理需求（曾误拒 SSH 项目会话）。
	const guard = async (
		_cwd: string | undefined,
		action: () => Promise<string>,
	): Promise<Record<string, unknown>> => {
		try {
			return { ok: true, message: await action() };
		} catch (error) {
			if (error instanceof HongguoError) return { ok: false, error: error.message, retryable: false };
			return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: true };
		}
	};

	ctx.agent.registerTool({
		id: "hongguo-launch",
		name: "hongguo_launch",
		label: "%tool.launch.label%",
		description:
			"启动红果短剧播放器（本机桌面程序，独立窗口）。用户想看短剧/刷剧时使用；已在运行则不会重复启动（此时应改用 uiAutomation 把已有窗口带到前台并继续操作）。首次启动可能自动安装 WebView2/HEVC 组件（需联网）。播放器内的搜索/选剧/登录等界面操作用 ctx.uiAutomation（精准且不打扰用户），不要用截屏坐标点击。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCENARIOS,
		timeoutMs: 30_000,
		handler: async ({ session }) =>
			guard(session.cwd, async () => {
				const result = await requireController().launch();
				return result.alreadyRunning ? "红果短剧已在运行中" : "已启动红果短剧播放器";
			}),
	});

	ctx.agent.registerTool({
		id: "hongguo-stop",
		name: "hongguo_stop",
		label: "%tool.stop.label%",
		description: "关闭红果短剧播放器进程。用户表示看完、关闭红果时使用。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCENARIOS,
		timeoutMs: 30_000,
		handler: async ({ session }) =>
			guard(session.cwd, async () => {
				await requireController().stop();
				return "已停止红果短剧播放器";
			}),
	});

	ctx.agent.registerTool({
		id: "hongguo-status",
		name: "hongguo_status",
		label: "%tool.status.label%",
		description: "查询红果短剧播放器是否在运行（返回 running 或 stopped）。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCENARIOS,
		timeoutMs: 15_000,
		handler: async ({ session }) =>
			guard(session.cwd, async () => {
				const running = await requireController().isRunning();
				return running ? "running" : "stopped";
			}),
	});

	ctx.agent.registerTool<{ deep?: boolean }>({
		id: "hongguo-clean-cache",
		name: "hongguo_clean_cache",
		label: "%tool.clean.label%",
		description:
			"清理红果短剧播放器缓存（WebView 缓存与更新包缓存，释放磁盘空间；不影响登录、收藏、观看记录）。deep=true 为深度清理：删除全部本地数据（登出账号、清空收藏与观看历史），必须先向用户明确确认后才可使用。",
		parameters: {
			type: "object",
			properties: {
				deep: { type: "boolean", description: "深度清理（删除全部数据，含登录与收藏/历史），默认 false" },
			},
			additionalProperties: false,
		},
		scope_use: SCENARIOS,
		timeoutMs: 60_000,
		handler: async ({ session, trigger }) =>
			guard(session.cwd, async () => {
				const deep = trigger.input?.deep === true;
				await requireController().cleanCache(deep);
				return deep ? "已深度清理红果短剧全部本地数据" : "已清理红果短剧缓存";
			}),
	});

	ctx.agent.registerTool({
		id: "hongguo-open-data-dir",
		name: "hongguo_open_data_dir",
		label: "%tool.openData.label%",
		description: "在资源管理器中打开红果短剧播放器的数据目录（查看或备份数据）。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCENARIOS,
		timeoutMs: 15_000,
		handler: async ({ session }) =>
			guard(session.cwd, async () => {
				await requireController().openDataDir();
				return "已打开数据目录";
			}),
	});
}
