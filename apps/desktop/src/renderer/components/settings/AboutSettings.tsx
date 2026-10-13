import { SIGNED_DOWNLOAD_URL, canCheckForUpdates } from "../../../shared/updater";
import { useUpdateActions, useUpdaterStatus } from "../../hooks/use-updater";
import { useUpdateStore } from "../../stores/update-store";
import { trpc } from "../../trpc/client";
import { PageHeading } from "./SectionHeading";

export function AboutSettings() {
	const statusQuery = useUpdaterStatus();
	const systemQuery = trpc.system.getAgentNotifyPort.useQuery(undefined, {
		staleTime: 30_000,
	});
	const actions = useUpdateActions();
	const lifecycle = useUpdateStore((s) => s.lifecycle);
	const installRequested = useUpdateStore((s) => s.installRequested);
	const requestError = useUpdateStore((s) => s.requestError);
	const openWhatsNew = useUpdateStore((s) => s.openWhatsNew);
	const currentVersion = statusQuery.data?.currentVersion ?? "—";
	const { updateAvailable, updateVersion } = lifecycle;
	const updateDownloaded = lifecycle.phase === "downloaded" && !installRequested;
	const busy =
		installRequested || lifecycle.phase === "validating" || lifecycle.phase === "installing";
	const checkError = requestError ?? lifecycle.message;

	return (
		<div>
			<PageHeading title="About" subtitle="SuperiorSwarm" />

			{/* Version info card */}
			<div
				className={`overflow-hidden rounded-[10px] border bg-[var(--bg-surface)] p-4 ${
					updateAvailable ? "border-[rgba(10,132,255,0.2)]" : "border-[var(--border)]"
				}`}
			>
				<div className="mb-3 flex items-center justify-between">
					<div>
						<div className="text-[10px] uppercase tracking-[0.05em] text-[var(--text-tertiary)]">
							Current Version
						</div>
						<div className="mt-0.5 text-[14px] font-semibold text-[var(--text)]">
							{currentVersion}
						</div>
					</div>
					<div className="text-right">
						<div className="text-[10px] uppercase tracking-[0.05em] text-[var(--text-tertiary)]">
							Latest Version
						</div>
						{updateAvailable && updateVersion ? (
							<div className="mt-0.5 text-[14px] font-semibold text-[var(--accent)]">
								{updateVersion}
							</div>
						) : (
							<div className="mt-0.5 text-[14px] font-semibold text-[var(--text-tertiary)]">—</div>
						)}
					</div>
				</div>

				{checkError ? (
					<p role="alert" className="text-[11px] text-[var(--color-danger)]">
						{checkError}
					</p>
				) : updateAvailable ? (
					<div className="flex items-center justify-between">
						<span className="text-[11px] text-[var(--accent)]">
							{busy
								? "Validating / restarting…"
								: lifecycle.phase === "downloaded"
									? "Downloaded; validation pending"
									: "Update available"}
						</span>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => {
									if (updateVersion) openWhatsNew(updateVersion);
								}}
								className="rounded-[5px] border border-[rgba(10,132,255,0.3)] px-2.5 py-1 text-[11px] text-[var(--accent)] transition-colors hover:bg-[var(--accent-subtle)]"
							>
								What's new
							</button>
							{updateDownloaded && (
								<button
									type="button"
									onClick={actions.install}
									className="rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
								>
									Restart to validate and install
								</button>
							)}
						</div>
					</div>
				) : (
					<div className="text-[11px] text-[var(--text-tertiary)]">
						{lifecycle.phase === "checking" ? "Checking for updates…" : "No pending update"}
					</div>
				)}
			</div>

			{(lifecycle.recovery === "reinstall" || lifecycle.recovery === "restart-app") && (
				<a
					className="mt-3 inline-block text-[12px] text-[var(--accent)]"
					href={SIGNED_DOWNLOAD_URL}
					target="_blank"
					rel="noreferrer"
				>
					Get signed download
				</a>
			)}

			{/* Actions */}
			<div className="mt-4 flex gap-2">
				<button
					type="button"
					onClick={actions.check}
					disabled={actions.checking || !canCheckForUpdates(lifecycle)}
					className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-overlay)] disabled:opacity-50"
				>
					{lifecycle.phase === "checking" ? "Checking..." : "Check for updates"}
				</button>
				<button
					type="button"
					onClick={() => {
						if (statusQuery.data?.currentVersion) {
							openWhatsNew(statusQuery.data.currentVersion);
						}
					}}
					className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-overlay)]"
				>
					View release notes
				</button>
			</div>

			{/* Footer info */}
			<div className="mt-6 border-t border-[var(--border)] pt-4">
				<div className="text-[10px] leading-[1.6] text-[var(--text-quaternary)]">
					SuperiorSwarm v{currentVersion} ·{" "}
					{(navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData
						?.platform ?? navigator.platform}
					<br />
					Agent notify port: {systemQuery.data?.port ?? "—"}
					<br />© {new Date().getFullYear()} SuperiorSwarm
				</div>
			</div>
		</div>
	);
}
