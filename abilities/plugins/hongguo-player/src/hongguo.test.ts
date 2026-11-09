import { describe, expect, it } from "vitest";
import {
	cacheSubdirPaths,
	playerBinDir,
	playerDataDir,
	playerExePath,
	PLAYER_DATA_DIR_NAME,
	PLAYER_EXE,
	PLAYER_IMAGE_NAME,
} from "./hongguo.js";

describe("path builders", () => {
	it("win32 resolves the data dir under APPDATA; other platforms null", () => {
		expect(playerDataDir("win32", "C:\\Users\\u\\AppData\\Roaming")).toBe(
			`C:\\Users\\u\\AppData\\Roaming\\${PLAYER_DATA_DIR_NAME}`,
		);
		expect(playerDataDir("win32", undefined)).toBeNull();
		expect(playerDataDir("darwin", "/Users/u")).toBeNull();
	});

	it("exe path lands in bin with trailing-root tolerance", () => {
		expect(playerExePath("C:\\plugins\\hongguo-player")).toBe(`C:\\plugins\\hongguo-player\\bin\\${PLAYER_EXE}`);
		expect(playerExePath("C:\\plugins\\hongguo-player\\")).toBe(`C:\\plugins\\hongguo-player\\bin\\${PLAYER_EXE}`);
	});

	it("bin dir keeps trailing-root tolerance too", () => {
		expect(playerBinDir("C:\\p\\")).toBe("C:\\p\\bin");
	});

	it("cache subdirs stay under the data dir", () => {
		expect(cacheSubdirPaths("C:\\d")).toEqual(["C:\\d\\webview", "C:\\d\\update"]);
	});

	it("image name matches the exe file name (ctx.processes 按映像名过滤)", () => {
		expect(PLAYER_IMAGE_NAME).toBe(PLAYER_EXE);
	});
});
