#!/usr/bin/env node
// hongguo-player 打包薄壳：调用仓库通用打包工具 packages/plugins/tools/pack-plugin.mjs。
// 播放器二进制不打包——插件首次运行时从官方 GitHub release 下载安装（见 controller）。
// --src 兼容保留：值会被忽略（旧脚本签名），不再有任何资产从本机目录打包。

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const pluginDir = resolve(import.meta.dirname, "..");

const tooling = resolve(pluginDir, "..", "..", "tools", "pack-plugin.mjs");
const result = spawnSync(process.execPath, [tooling, "--dir", pluginDir, ...process.argv.slice(2)], {
	stdio: "inherit",
	shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
