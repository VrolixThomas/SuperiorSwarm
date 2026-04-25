import { useUpdateStore } from "../../stores/update-store";
import { trpc } from "../../trpc/client";
import { PageHeading } from "./SectionHeading";

export function AboutSettings() {
	const statusQuery = trpc.updates.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const systemQuery = trpc.system.getAgentNotifyPort.useQuery(undefined, {
		staleTime: 30_000,
	});
	const checkForUpdates = trpc.updates.checkForUpdates.useMutation({
		onSuccess: () => statusQuery.refetch(),
	});
	const installUpdate = trpc.updates.installUpdate.useMutation();

	const openWhatsNew = useUpdateStore((s) => s.openWhatsNew);

	const currentVersion = statusQuery.data?.currentVersion ?? "—";
	const updateDownloaded = statusQuery.data?.updateDownloaded ?? false;

	const checkResult = checkForUpdates.data;
	const updateAvailable =
		checkResult?.updateAvailable ?? statusQuery.data?.updateAvailable ?? false;
	const updateVersion = checkResult?.version ?? statusQuery.data?.updateVersion;
	const checkError = checkResult?.error ?? null;

	const handleCheckForUpdates = () => {
		checkForUpdates.mutate();
	};

	const handleUpdateNow = () => {
		if (updateDownloaded) {
			installUpdate.mutate();
		}
	};

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
							<div className="mt-0.5 text-[14px] font-semibold text-[var(--color-success)]">
								{currentVersion} ✓
							</div>
						)}
					</div>
				</div>

				{updateAvailable ? (
					<div className="flex items-center justify-between">
						<span className="text-[11px] text-[var(--accent)]">Update available</span>
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
									onClick={handleUpdateNow}
									className="rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
								>
									Update now
								</button>
							)}
						</div>
					</div>
				) : checkError ? (
					<div className="text-[11px] text-[var(--color-danger)]">
						Update check failed: {checkError}
					</div>
				) : (
					<div className="text-[11px] text-[var(--text-tertiary)]">You're up to date</div>
				)}
			</div>

			{/* Actions */}
			<div className="mt-4 flex gap-2">
				<button
					type="button"
					onClick={handleCheckForUpdates}
					disabled={checkForUpdates.isPending}
					className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-overlay)] disabled:opacity-50"
				>
					{checkForUpdates.isPending ? "Checking..." : "Check for updates"}
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
					{navigator.userAgentData?.platform ?? navigator.platform}
					<br />
					Agent notify port: {systemQuery.data?.port ?? "—"}
					<br />© {new Date().getFullYear()} SuperiorSwarm
				</div>
			</div>
		</div>
	);
}
