import { useState } from "react";
import { useUpdateStore } from "../stores/update-store";
import { trpc } from "../trpc/client";

export function AboutSection() {
	const statusQuery = trpc.updates.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const checkForUpdates = trpc.updates.checkForUpdates.useMutation({
		onSuccess: () => statusQuery.refetch(),
	});
	const [showNotes, setShowNotes] = useState(false);
	const releaseNotesQuery = trpc.updates.getReleaseNotes.useQuery(
		{ version: statusQuery.data?.currentVersion },
		{ enabled: showNotes && !!statusQuery.data?.currentVersion }
	);
	const installUpdate = trpc.updates.installUpdate.useMutation();

	const openWhatsNew = useUpdateStore((s) => s.openWhatsNew);

	const currentVersion = statusQuery.data?.currentVersion ?? "—";
	const updateAvailable = statusQuery.data?.updateAvailable ?? false;
	const updateVersion = statusQuery.data?.updateVersion;
	const updateDownloaded = statusQuery.data?.updateDownloaded ?? false;

	const handleViewReleaseNotes = () => {
		setShowNotes(true);
		openWhatsNew(currentVersion, releaseNotesQuery.data?.body ?? null);
	};

	const handleCheckForUpdates = () => {
		checkForUpdates.mutate();
	};

	const handleUpdateNow = () => {
		if (updateDownloaded) {
			installUpdate.mutate();
		}
	};

	return (
		<div className="mt-4 border-t border-[var(--border)] pt-4">
			<div className="px-3 pb-2">
				<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
					About
				</span>
			</div>

			{/* Version info card */}
			<div
				className={`mx-2 rounded-[var(--radius-md)] p-3.5 ${
					updateAvailable
						? "border border-[rgba(10,132,255,0.2)] bg-[var(--bg-elevated)]"
						: "bg-[var(--bg-elevated)]"
				}`}
			>
				<div className="mb-2.5 flex items-center justify-between">
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
							<div className="mt-0.5 text-[14px] font-semibold text-[#30d158]">
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
								onClick={handleViewReleaseNotes}
								className="rounded-[5px] border border-[rgba(10,132,255,0.3)] px-2.5 py-1 text-[11px] text-[var(--accent)] transition-colors hover:bg-[rgba(10,132,255,0.1)]"
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
				) : (
					<div className="text-[11px] text-[var(--text-tertiary)]">You're up to date</div>
				)}
			</div>

			{/* Actions */}
			<div className="mt-2 flex gap-2 px-2">
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
					onClick={handleViewReleaseNotes}
					className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-overlay)]"
				>
					View release notes
				</button>
			</div>

			{/* Footer info */}
			<div className="mt-4 border-t border-[var(--border)] px-3 pt-3">
				<div className="text-[10px] leading-[1.6] text-[var(--text-quaternary)]">
					SuperiorSwarm v{currentVersion} · {navigator.platform}
					<br />© {new Date().getFullYear()} SuperiorSwarm
				</div>
			</div>
		</div>
	);
}
