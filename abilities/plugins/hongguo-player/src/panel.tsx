import { useTranslation, type PluginWorkspaceViewProps } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import type { HongguoController } from "./controller.js";

export function HongguoPanel({
	controller,
	initError,
	iconUrl,
}: PluginWorkspaceViewProps & {
	controller: HongguoController | null;
	initError?: string | null;
	iconUrl?: string | null;
}): JSX.Element {
	const { t } = useTranslation();
	const [running, setRunning] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);
	const [cacheBytes, setCacheBytes] = useState<number | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** 轮询失败原因就地显示在缓存行（曾只在页底显示，用户只看到「…」不知道为什么）。 */
	const [refreshError, setRefreshError] = useState<string | null>(null);
	const [confirmDeep, setConfirmDeep] = useState(false);
	/** 首次下载播放器的进度（主按钮显示 MB；下载中禁用）。 */
	const [downloadProgress, setDownloadProgress] = useState<{ received: number; total: number } | null>(null);
	/** 播放器版本信息（null=未安装；undefined=未查询）。 */
	const [playerVersion, setPlayerVersion] = useState<string | null | undefined>(undefined);
	/** 真实数据目录；解析前为 null，面板显示通用文案而不是 %APPDATA% 字面量。 */
	const [dataDir, setDataDir] = useState<string | null>(null);

	const refreshState = useCallback(async () => {
		if (!controller) return;
		try {
			await controller.refresh();
			const [isRunning, size] = await Promise.all([controller.isRunning(), controller.cacheSizeBytes()]);
			setRunning(isRunning);
			setCacheBytes(size);
			setDataDir(controller.dataDir);
			setRefreshError(null);
		} catch (cause) {
			setRefreshError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [controller]);

	useEffect(() => {
		void refreshState();
		const timer = window.setInterval(() => void refreshState(), 5000);
		return () => window.clearInterval(timer);
	}, [refreshState]);

	// 版本信息独立拉取（不进 5s 轮询——检查更新是显式动作，初始展示一次）。
	const refreshVersion = useCallback(() => {
		if (!controller) return;
		void controller
			.checkUpdate()
			.then((info) => {
				setPlayerVersion(info.installed ? info.remoteVersion : null);
			})
			.catch(() => setPlayerVersion(null));
	}, [controller]);
	useEffect(() => {
		refreshVersion();
	}, [refreshVersion]);

	const act = useCallback(
		async (action: () => Promise<string>) => {
			setBusy(true);
			setError(null);
			setMessage(null);
			try {
				setMessage(await action());
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				setBusy(false);
				setDownloadProgress(null);
				void refreshState();
				refreshVersion();
			}
		},
		[refreshState, refreshVersion],
	);

	if (!controller) {
		return (
			<section className="p-6 text-sm text-neutral-500">
				<p>{initError ?? t("panel.notReady")}</p>
			</section>
		);
	}

	const fmtMb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;

	return (
		<section className="flex flex-col gap-4 p-6">
			{/* 品牌横幅：官方渐变底 + 圆角 logo + 运行状态 + 主操作。 */}
			<div
				className="relative overflow-hidden rounded-2xl px-7 py-6 text-white"
				style={{ background: "linear-gradient(120deg, #fa5028 0%, #ff8a4c 38%, #46e1c3 100%)" }}
			>
				<div className="pointer-events-none absolute -right-16 -top-24 h-[340px] w-[340px] rounded-full bg-white/10" />
				<div className="pointer-events-none absolute -bottom-36 right-24 h-[260px] w-[260px] rounded-full bg-white/10" />
				<div className="relative z-10 flex items-center gap-6">
					{/* 官方图标：宿主解析的 iconUrl（vetta-plugin://，与侧栏同源）；无 URL 时渐变兜底。 */}
					{iconUrl ? (
						<img
							src={iconUrl}
							alt="红果短剧官方图标"
							className="h-[84px] w-[84px] shrink-0 rounded-[22px] object-cover shadow-lg"
							style={{ boxShadow: "0 5px 18px rgba(0,0,0,.25)" }}
						/>
					) : (
						<div
							className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[22px] shadow-lg"
							style={{ background: "linear-gradient(135deg, #ff8a4c 0%, #ffd08a 50%, #46e1c3 100%)" }}
						>
							<svg viewBox="0 0 24 24" className="h-[52px] w-[52px]" fill="none" aria-hidden="true">
								<path
									d="M9.6 18.6c-.5 0-.9-.4-.9-.9V6.3c0-.5.4-.9.9-.9.2 0 .3 0 .5.1l9 5.7c.3.2.5.5.5.8s-.2.6-.5.8l-9 5.7c-.2.1-.3.1-.5.1z"
									fill="#fff"
								/>
							</svg>
						</div>
					)}
					<div className="min-w-0 flex-1">
						<h1 className="text-[22px] font-bold tracking-wide">红果短剧播放器</h1>
						<p className="mt-1 text-[13px] text-white/90">{t("panel.heroTagline")}</p>
					</div>
					<div className="flex shrink-0 items-center gap-4 rounded-2xl bg-black/15 px-5 py-3 backdrop-blur-sm">
						<span
							className={`h-2.5 w-2.5 rounded-full ${
								running ? "animate-pulse bg-green-400" : running === null ? "bg-neutral-300" : "bg-neutral-300"
							}`}
						/>
						<span className="text-sm font-semibold">
							{running === null ? t("panel.checking") : running ? t("panel.stateRunning") : t("panel.stateStopped")}
						</span>
						{running && (
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									void act(async () => {
										await controller.stop();
										return t("panel.stopped");
									})
								}
								className="rounded-lg border border-white/40 px-3 py-1.5 text-xs text-white hover:bg-white/15 disabled:opacity-50"
							>
								{t("panel.stop")}
							</button>
						)}
					</div>
					<button
						type="button"
						disabled={busy || Boolean(downloadProgress)}
						onClick={() =>
							void act(async () => {
								setDownloadProgress({ received: 0, total: 0 });
								const result = await controller.launch((received, total) =>
									setDownloadProgress({ received, total }),
								);
								return result.alreadyRunning ? t("panel.alreadyRunning") : t("panel.launched");
							})
						}
						className="rounded-xl bg-white px-6 py-3 text-[15px] font-bold shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-default disabled:opacity-60"
						style={{ color: "#fa5028" }}
					>
						{downloadProgress
							? t("panel.downloading", {
									received: fmtMb(downloadProgress.received),
									total: downloadProgress.total ? fmtMb(downloadProgress.total) : "?",
								})
							: running
								? t("panel.open")
								: t("panel.launch")}
					</button>
				</div>
			</div>

			{/* 动作反馈就地显示。 */}
			{message && <p className="text-sm" style={{ color: "#16a34a" }}>{message}</p>}
			{error && <p className="text-sm" style={{ color: "#dc2626" }}>{error}</p>}

			{/* 下载进度条（首启自动获取播放器）。 */}
			{downloadProgress && (
				<div className="rounded-xl border border-neutral-200 bg-white p-4">
					<div className="mb-2 flex justify-between text-xs text-neutral-500">
						<span>{t("panel.preparing")}</span>
						<span>
							{fmtMb(downloadProgress.received)} /{" "}
							{downloadProgress.total ? fmtMb(downloadProgress.total) : "?"}
						</span>
					</div>
					<div className="h-2 overflow-hidden rounded-full bg-neutral-100">
						<div
							className="h-full rounded-full transition-[width] duration-300"
							style={{
								width: downloadProgress.total
									? `${Math.min(100, Math.round((downloadProgress.received / downloadProgress.total) * 100))}%`
									: "50%",
								background: "linear-gradient(90deg, #fa5028, #46e1c3)",
							}}
						/>
					</div>
				</div>
			)}

			{/* 信息网格：状态 / 版本 / 缓存占用。 */}
			<div className="grid grid-cols-3 gap-3">
				<div className="flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-white p-4">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-lg text-[#fa5028]">▶</div>
					<div>
						<div className="text-[11px] text-neutral-400">{t("panel.statState")}</div>
						<div className="mt-0.5 text-base font-bold tabular-nums">
							{running === null ? t("panel.checking") : running ? t("panel.stateRunning") : t("panel.stateStopped")}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-white p-4">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-lg text-teal-600">✦</div>
					<div>
						<div className="text-[11px] text-neutral-400">{t("panel.statVersion")}</div>
						<div className="mt-0.5 text-base font-bold tabular-nums">
							{playerVersion === undefined || playerVersion === null ? "—" : playerVersion}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-white p-4">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-lg">▦</div>
					<div>
						<div className="text-[11px] text-neutral-400">{t("panel.statCache")}</div>
						<div className="mt-0.5 text-base font-bold tabular-nums">
							{cacheBytes === null ? "…" : `${(cacheBytes / 1024 / 1024).toFixed(1)} MB`}
						</div>
					</div>
				</div>
			</div>

			{/* 数据与缓存：清理操作 + Popconfirm 气泡确认（挂深清按钮上方）。 */}
			<div className="rounded-xl border border-neutral-200 bg-white p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-semibold">{t("panel.dataTitle")}</h2>
					{refreshError ? (
						<p className="text-xs" style={{ color: "#dc2626" }}>
							{t("panel.refreshError", { message: refreshError })}
							{commandPermissionHint(refreshError) ? (
								<span className="mt-1 block">{t("panel.cmdPermissionHint")}</span>
							) : null}
						</p>
					) : (
						<p className="text-xs text-neutral-500">
							{dataDir ? t("panel.dataDirHint", { path: dataDir }) : t("panel.dataDirHintUnknown")}
						</p>
					)}
				</div>
				<div className="flex flex-wrap items-start gap-2.5">
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							void act(async () => {
								await controller.cleanCache(false);
								return t("panel.cacheCleaned");
							})
						}
						className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
					>
						{t("panel.cleanCache")}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							void act(async () => {
								await controller.openDataDir();
								return t("panel.dataDirOpened");
							})
						}
						className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
					>
						{t("panel.openDataDir")}
					</button>
					{/* Popconfirm 气泡确认框：挂在深清按钮上方，点气泡外/取消关闭。 */}
					<div className="relative">
						<button
							type="button"
							disabled={busy}
							onClick={() => setConfirmDeep((value) => !value)}
							className="rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-50"
							style={{ borderColor: "#fecaca", color: "#dc2626" }}
						>
							{t("panel.deepClean")}
						</button>
						{confirmDeep && (
							<>
								{/* 透明遮罩：点气泡外任意处关闭（低于气泡层级）。 */}
								<div className="fixed inset-0 z-40" onClick={() => setConfirmDeep(false)} />
								<div
									role="dialog"
									className="absolute bottom-full right-0 z-50 mb-2 w-80 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl"
								>
									<h3 className="mb-1.5 text-sm font-semibold">{t("panel.deepConfirmTitle")}</h3>
									<p className="mb-3 text-xs leading-relaxed text-neutral-600">{t("panel.deepConfirmBody")}</p>
									<div className="flex justify-end gap-2">
										<button
											type="button"
											onClick={() => setConfirmDeep(false)}
											className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
										>
											{t("panel.cancel")}
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={() => {
												setConfirmDeep(false);
												void act(async () => {
													await controller.cleanCache(true);
													return t("panel.deepCleaned");
												});
											}}
											className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
											style={{ background: "#dc2626", color: "#fff" }}
										>
											{t("panel.deepCleanConfirm")}
										</button>
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</div>

			{/* 使用说明：编号四条双列。 */}
			<div className="rounded-xl border border-neutral-200 bg-white p-4">
				<h2 className="mb-3 text-sm font-semibold text-neutral-700">{t("panel.notesTitle")}</h2>
				<div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
					{(["note1", "note2", "note3", "note4"] as const).map((noteKey) => (
						<div key={noteKey} className="flex gap-2.5 text-[12.5px] leading-relaxed text-neutral-600">
							<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-500">
								{noteKey.slice(-1)}
							</span>
							{t(`panel.${noteKey}`)}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/** 权限类错误关键词：命中即在错误下方给出开启文件权限的引导。 */
function commandPermissionHint(message: string): boolean {
	const lowered = message.toLowerCase();
	return lowered.includes("permission") || lowered.includes("权限") || lowered.includes("command") || lowered.includes("命令");
}
