import type { HermesComposerAttachment } from "../../hermes/hermes-view-model";

function attachmentSize(size: number): string {
	if (size < 1_024) return `${size} B`;
	if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`;
	return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

function attachmentStatus(attachment: HermesComposerAttachment): string {
	if (attachment.status === "attaching") return "Attaching…";
	if (attachment.status === "error") return "Retry on send";
	return "Ready";
}

export function HermesComposerAttachments({
	attachments,
	onRemove,
	removalDisabled,
}: {
	attachments: HermesComposerAttachment[];
	onRemove: (handle: string) => void;
	removalDisabled: boolean;
}) {
	if (attachments.length === 0) return null;
	return (
		<div className="flex min-w-0 flex-wrap gap-1.5" aria-label="Pending attachments">
			{attachments.map((attachment) => (
				<div
					key={attachment.handle}
					className="flex max-w-full min-w-0 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[10px] [overflow-wrap:anywhere]"
					title={attachment.error ?? undefined}
				>
					<div className="min-w-0">
						<div className="max-w-[240px] truncate font-medium text-[var(--text-secondary)]">
							{attachment.name}
						</div>
						<div className="text-[9px] text-[var(--text-quaternary)]">
							{attachment.kind.toUpperCase()} · {attachmentSize(attachment.size)} ·{" "}
							<span className={attachment.status === "error" ? "text-[var(--danger)]" : undefined}>
								{attachmentStatus(attachment)}
							</span>
						</div>
					</div>
					<button
						type="button"
						onClick={() => onRemove(attachment.handle)}
						disabled={removalDisabled}
						aria-label={`Remove ${attachment.name}`}
						className="flex size-5 shrink-0 items-center justify-center rounded-full text-[13px] text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 disabled:pointer-events-none disabled:opacity-35"
					>
						×
					</button>
				</div>
			))}
		</div>
	);
}
