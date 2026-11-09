#!/usr/bin/env node
// 红果播放器 R2 上传：把播放器 exe 与 ffmpeg 推到 R2，生成 latest.json 版本清单——
// 插件的唯一下载源（不依赖 GitHub API，避开限流）。
//
// 用法：node scripts/upload-player-r2.mjs --src <官方zip或解压目录> [--version 1.2.24]
//   --src 支持 guo-vX.Y.Z-windows-amd64.zip 或其解压目录（含 红果短剧.exe / ffmpeg.exe）
// 密钥读 open-vetta apps/desktop/.env（VETTA_R2_ACCESS_KEY_ID / VETTA_R2_SECRET_ACCESS_KEY）。
// 后续更新流程：跑本脚本上传新版本 → latest.json 的 version/bytes 变化即触发插件重下。

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import AdmZip from "adm-zip";

const R2_ENDPOINT = "https://f65f77e68cece2debf836521f4f92204.r2.cloudflarestorage.com";
const R2_BUCKET = "youth-releases";
const PUBLIC_BASE = "https://r2.youth.huxiaojia.cloud";
const KEY_PREFIX = "plugins/hongguo-player/player";

const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i !== -1 ? process.argv[i + 1] : undefined;
};

function loadEnv() {
	const envPath = arg("--env") ?? "D:/codeSpace/source/CodeSource/study/open-vetta/apps/desktop/.env";
	if (!existsSync(envPath)) throw new Error(`缺少 ${envPath}`);
	for (const line of readFileSync(envPath, "utf8").split("\n")) {
		const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
	}
	if (!process.env.VETTA_R2_ACCESS_KEY_ID || !process.env.VETTA_R2_SECRET_ACCESS_KEY) {
		throw new Error(".env 缺少 VETTA_R2_ACCESS_KEY_ID / VETTA_R2_SECRET_ACCESS_KEY");
	}
}

const sha256 = (file) =>
	new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(file).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
	});

async function upload(client, key, file, contentType) {
	const size = statSync(file).size;
	await new Upload({
		client,
		params: { Bucket: R2_BUCKET, Key: key, Body: createReadStream(file), ContentType: contentType, ContentLength: size },
	}).done();
	console.log(`[r2] uploaded ${key} (${(size / 1024 / 1024).toFixed(1)} MB)`);
	return size;
}

/** 从官方 zip 或解压目录取 exe 与 ffmpeg；ffmpeg 重打为仅含它的轻量 zip。 */
function prepareArtifacts(src) {
	const work = mkdtempSync(join(tmpdir(), "hongguo-r2-"));
	const exePath = join(work, "player.exe");
	const ffmpegZipPath = join(work, "ffmpeg-windows-amd64.zip");
	let version = arg("--version") ?? basename(src).match(/v(\d+\.\d+\.\d+)/)?.[1] ?? "";

	const pickFromZip = (zip) => {
		const entries = new AdmZip(zip).getEntries();
		const find = (re) => entries.find((e) => !e.isDirectory && re.test(e.entryName.split(/[\\/]/).pop() ?? ""));
		return { exe: find(/^红果短剧\.exe$/i), ffmpeg: find(/^ffmpeg\.exe$/i) };
	};

	if (statSync(src).isFile() && /\.zip$/i.test(src)) {
		const { exe, ffmpeg } = pickFromZip(src);
		if (!exe) throw new Error(`官方 zip 内未找到 红果短剧.exe：${src}`);
		writeFileSync(exePath, exe.getData());
		const z = new AdmZip();
		z.addFile("ffmpeg.exe", (ffmpeg ?? exe).getData().length >= 0 && ffmpeg ? ffmpeg.getData() : Buffer.alloc(0));
		if (!ffmpeg) throw new Error(`官方 zip 内未找到 ffmpeg.exe：${src}`);
		z.writeZip(ffmpegZipPath);
	} else {
		const dirExe = join(src, "红果短剧.exe");
		const dirFfmpeg = join(src, "ffmpeg.exe");
		if (!existsSync(dirExe) || !existsSync(dirFfmpeg)) throw new Error(`目录缺少 红果短剧.exe 或 ffmpeg.exe：${src}`);
		writeFileSync(exePath, readFileSync(dirExe));
		const z = new AdmZip();
		z.addLocalFile(dirFfmpeg);
		z.writeZip(ffmpegZipPath);
		version ||= "";
	}
	return { exePath, ffmpegZipPath, version };
}

async function main() {
	loadEnv();
	const src = arg("--src");
	if (!src || !existsSync(src)) throw new Error(`--src 不存在：${src}`);
	const { exePath, ffmpegZipPath, version } = prepareArtifacts(src);
	if (!version) throw new Error("无法推导版本，请传 --version 1.2.24");

	const client = new S3Client({
		region: "auto",
		endpoint: R2_ENDPOINT,
		credentials: {
			accessKeyId: process.env.VETTA_R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.VETTA_R2_SECRET_ACCESS_KEY,
		},
	});

	const exeKey = `${KEY_PREFIX}/windows-amd64.exe`;
	const ffmpegKey = `${KEY_PREFIX}/ffmpeg-windows-amd64.zip`;
	const exeBytes = await upload(client, exeKey, exePath, "application/octet-stream");
	const ffmpegBytes = await upload(client, ffmpegKey, ffmpegZipPath, "application/zip");

	const manifest = {
		version,
		exe: { url: `${PUBLIC_BASE}/${exeKey}`, bytes: exeBytes, sha256: await sha256(exePath) },
		ffmpeg: { url: `${PUBLIC_BASE}/${ffmpegKey}`, bytes: ffmpegBytes, sha256: await sha256(ffmpegZipPath) },
		updatedAt: new Date().toISOString(),
	};
	const manifestPath = join(workDirSafe(), "hongguo-latest.json");
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	await upload(client, `${KEY_PREFIX}/latest.json`, manifestPath, "application/json");
	console.log("[r2] latest.json =", JSON.stringify(manifest));
}

function workDirSafe() {
	return tmpdir();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
