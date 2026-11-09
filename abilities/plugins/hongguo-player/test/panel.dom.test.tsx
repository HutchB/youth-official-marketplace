// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HongguoPanel } from "../src/panel.js";
import zh from "../locales/zh.json";

// 面板文案必须经 t() 解析为 catalog 文案——曾把 `%panel.dataTitle%` 占位符
// 直接写进 JSX（宿主只解析 manifest 字符串），线上渲染出裸键。此回归覆盖：
// t() 返回真实 zh 文案，断言界面出现的是文案而非 `%...%` 裸键。
vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		locale: "zh",
		t: (key: string, params?: Record<string, string | number>) => {
			const text = (zh as Record<string, string>)[key] ?? key;
			return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			);
		},
	}),
}));

import type { HongguoController } from "../src/controller.js";

function createController(overrides: Partial<HongguoController> = {}): HongguoController & {
	checkUpdate: ReturnType<typeof vi.fn>;
	launch: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	cleanCache: ReturnType<typeof vi.fn>;
	openDataDir: ReturnType<typeof vi.fn>;
} {
	return {
		pluginRoot: "C:\\plugins\\hongguo-player",
		dataDir: "C:\\Users\\u\\AppData\\Roaming\\hgplayer",
		refresh: vi.fn(async () => {}),
		isRunning: vi.fn(async () => false),
		launch: vi.fn(async () => ({ launched: true, alreadyRunning: false })),
		stop: vi.fn(async () => {}),
		cacheSizeBytes: vi.fn(async () => 1536 * 1024 * 1024),
		cleanCache: vi.fn(async () => {}),
		openDataDir: vi.fn(async () => {}),
		checkUpdate: vi.fn(async () => ({ remoteVersion: "1.2.24", installed: true, localIsLatest: true })),
		...overrides,
	} as unknown as HongguoController & {
		checkUpdate: ReturnType<typeof vi.fn>;
		launch: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
		cleanCache: ReturnType<typeof vi.fn>;
		openDataDir: ReturnType<typeof vi.fn>;
	};
}

afterEach(cleanup);

describe("HongguoPanel", () => {
	it("renders zh catalog text instead of bare %key% placeholders (i18n regression)", async () => {
		render(<HongguoPanel controller={createController()} />);
		expect(screen.getByText("红果短剧播放器")).toBeTruthy();
		expect(screen.getByText("数据与缓存")).toBeTruthy();
		expect(screen.getByText("使用说明")).toBeTruthy();
		// 裸键不许出现：任何 %panel.*% 字面量渲染出来即回归
		expect(document.body.textContent).not.toMatch(/%panel\./);
	});

	it("shows the installed player version from checkUpdate", async () => {
		render(<HongguoPanel controller={createController()} />);
		// stats 版本卡：label 与值分离元素
		expect(await screen.findByText("1.2.24")).toBeTruthy();
		expect(screen.getByText("播放器版本")).toBeTruthy();
	});

	it("shows the not-ready hint while the controller is still initializing", () => {
		render(<HongguoPanel controller={null} />);
		expect(screen.getByText("插件正在初始化，请稍候……")).toBeTruthy();
	});

	it("shows the polling failure inline with the permission guidance", async () => {
		const controller = createController({
			isRunning: vi.fn(async () => {
				throw new Error("权限 fs.managed 未授予");
			}),
			cacheSizeBytes: vi.fn(async () => {
				throw new Error("权限 fs.managed 未授予");
			}),
		});
		render(<HongguoPanel controller={controller} />);

		expect(await screen.findByText(/状态获取失败：权限 fs.managed 未授予/)).toBeTruthy();
		expect(screen.getByText(/开启 node 命令权限|文件权限/)).toBeTruthy();
	});

	it("requires explicit confirmation before deep-cleaning and cancel keeps data", async () => {
		const controller = createController();
		render(<HongguoPanel controller={controller} />);

		fireEvent.click(screen.getByRole("button", { name: "清除全部数据" }));
		expect(await screen.findByRole("dialog")).toBeTruthy();
		expect(screen.getByText(/此操作不可恢复/)).toBeTruthy();
		expect(controller.cleanCache).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(controller.cleanCache).not.toHaveBeenCalled();
	});

	it("shows the resolved data folder instead of the %APPDATA% literal", async () => {
		render(<HongguoPanel controller={createController()} />);

		// 文案曾写死「%APPDATA%/hgplayer」，用户看到的是占位符而不是真实目录。
		expect(await screen.findByText(/C:\\Users\\u\\AppData\\Roaming\\hgplayer/)).toBeTruthy();
		expect(document.body.textContent).not.toMatch(/%APPDATA%/);
	});

	it("deep-cleans only after the user confirms the dialog", async () => {
		const controller = createController();
		render(<HongguoPanel controller={controller} />);

		fireEvent.click(screen.getByRole("button", { name: "清除全部数据" }));
		fireEvent.click(await screen.findByRole("button", { name: "全部清除" }));
		await waitFor(() => expect(controller.cleanCache).toHaveBeenCalledWith(true));
	});
});
