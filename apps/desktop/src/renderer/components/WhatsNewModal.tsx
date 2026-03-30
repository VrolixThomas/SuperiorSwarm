import { useCallback, useEffect } from "react";
import Markdown from "react-markdown";
import { useUpdateStore } from "../stores/update-store";
import { trpc } from "../trpc/client";

export function WhatsNewModal() {
	const show = useUpdateStore((s) => s.showWhatsNewModal);
	const version = useUpdateStore((s) => s.modalVersion);
	const releaseNotes = useUpdateStore((s) => s.modalReleaseNotes);
	const closeWhatsNew = useUpdateStore((s) => s.closeWhatsNew);

	const markSeen = trpc.updates.markVersionSeen.useMutation();

	const handleClose = useCallback(() => {
		if (version) markSeen.mutate({ version });
		closeWhatsNew();
	}, [version, closeWhatsNew, markSeen]);

	useEffect(() => {
		if (!show) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") handleClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [show, handleClose]);

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
							What's New in BranchFlux
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
					{releaseNotes ? (
						<div className="prose-invert prose-sm max-w-none text-[13px] leading-[1.6] text-[var(--text-secondary)] [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:text-[var(--text)] [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:text-[var(--text)] [&_h3]:mb-1.5 [&_h3]:mt-2 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-[var(--text)] [&_img]:my-3 [&_img]:rounded-[var(--radius-md)] [&_img]:border [&_img]:border-[var(--border)] [&_li]:mb-1 [&_p]:mb-2 [&_pre]:rounded-[var(--radius-sm)] [&_pre]:bg-[var(--bg-elevated)] [&_pre]:p-3 [&_code]:rounded-[3px] [&_code]:bg-[var(--bg-elevated)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5">
							<Markdown>{releaseNotes}</Markdown>
						</div>
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
