import { useEffect, useRef } from "react";
import { useUpdateStore } from "../stores/update-store";
import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function WhatsNewModal() {
	const show = useUpdateStore((s) => s.showWhatsNewModal);
	const version = useUpdateStore((s) => s.modalVersion);
	const closeWhatsNew = useUpdateStore((s) => s.closeWhatsNew);

	const markSeen = trpc.updates.markVersionSeen.useMutation();

	const releaseNotesQuery = trpc.updates.getReleaseNotes.useQuery(
		{ version: version ?? undefined },
		{ enabled: show && !!version }
	);
	const markSeenRef = useRef(markSeen.mutate);
	markSeenRef.current = markSeen.mutate;

	const handleClose = () => {
		if (version) markSeenRef.current({ version });
		closeWhatsNew();
	};

	useEffect(() => {
		if (!show) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (version) markSeenRef.current({ version });
				closeWhatsNew();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [show, version, closeWhatsNew]);

	if (!show || !version) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) handleClose();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="flex max-h-[80vh] w-[480px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
				{/* Header */}
				<div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
					<div>
						<h2 className="text-[15px] font-semibold text-[var(--text)]">
							What's New in SuperiorSwarm
						</h2>
						<p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">Version {version}</p>
					</div>
					<button
						type="button"
						onClick={handleClose}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					>
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Scrollable content */}
				<div className="flex-1 overflow-y-auto px-5 py-4">
					{releaseNotesQuery.isLoading ? (
						<p className="text-center text-[13px] text-[var(--text-tertiary)]">
							Loading release notes...
						</p>
					) : releaseNotesQuery.data?.body ? (
						<MarkdownRenderer content={releaseNotesQuery.data.body} />
					) : (
						<p className="text-center text-[13px] text-[var(--text-tertiary)]">
							No release notes available for this version.
						</p>
					)}
				</div>

				{/* Footer */}
				<div className="flex shrink-0 justify-end border-t border-[var(--border)] px-5 py-3">
					<button
						type="button"
						onClick={handleClose}
						className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-[6px] text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
					>
						Got it
					</button>
				</div>
			</div>
		</div>
	);
}
