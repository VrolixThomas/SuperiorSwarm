import { useState } from "react";
import type { HermesSessionSummary } from "../../../shared/hermes";
import { OverflowPopover } from "./OverflowPopover";

export interface HermesSessionRowProps {
	session: HermesSessionSummary;
	selected: boolean;
	linkedBranch: string | null;
	actionPending: boolean;
	onSelect: () => void;
	onSetArchived: (profileId: string, durableSessionId: string, archived: boolean) => void;
	onDelete: (profileId: string, durableSessionId: string) => void;
	deleteDisabledReason: string | null;
	confirmDelete?: (message: string) => boolean;
}

function relativeTime(timestamp: number): string {
	if (!timestamp) return "Unknown";
	const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
	const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000));
	if (minutes < 1) return "Now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

function sourceBadge(source: string): string {
	switch (source.toLowerCase()) {
		case "slack":
			return "◫";
		case "telegram":
			return "✈";
		case "desktop":
			return "▣";
		case "tui":
			return ">_";
		case "superiorswarm":
			return "A";
		default:
			return "◇";
	}
}

export function confirmHermesSessionDeletion(
	title: string,
	confirm: (message: string) => boolean = (message) => window.confirm(message)
): boolean {
	return confirm(
		`Permanently delete “${title}”? This deletes the Hermes session and transcript. This cannot be undone.`
	);
}

export function HermesSessionRow({
	session,
	selected,
	linkedBranch,
	actionPending,
	onSelect,
	onSetArchived,
	onDelete,
	deleteDisabledReason,
	confirmDelete,
}: HermesSessionRowProps) {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<div
			className={`group relative mb-0.5 min-h-[56px] min-w-0 rounded-[8px] border-l-2 transition-colors motion-reduce:transition-none ${
				selected
					? "border-l-[var(--accent)] bg-[var(--bg-elevated)]"
					: session.waitingForUser
						? "border-l-[var(--warning)] hover:bg-[var(--bg-overlay)]"
						: "border-l-transparent hover:bg-[var(--bg-overlay)]"
			}`}
		>
			<button
				type="button"
				aria-label={`Open ${session.title}`}
				onClick={onSelect}
				className="min-h-[56px] w-full min-w-0 rounded-[8px] px-2.5 py-2 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/50"
			>
				<div className="flex items-center gap-1.5">
					<span className="text-[10px]" aria-hidden="true">
						{sourceBadge(session.source)}
					</span>
					<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-secondary)]">
						{session.title}
					</span>
					<span className="text-[9px] text-[var(--text-quaternary)]">
						{relativeTime(session.updatedAt)}
					</span>
				</div>
				<div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-quaternary)]">
					{session.waitingForUser ? (
						<span className="shrink-0 text-[var(--warning)]">Needs input</span>
					) : session.running || session.busy ? (
						<span className="shrink-0 text-[var(--success)]">Active</span>
					) : null}
					<span className="truncate">
						{session.preview || session.origin?.displayLabel || session.source}
						{linkedBranch ? ` · ${linkedBranch}` : ""}
					</span>
				</div>
			</button>
			<div
				data-session-actions-trigger
				className={`absolute right-1 top-1 z-10 transition-opacity motion-reduce:transition-none ${
					selected || menuOpen
						? "opacity-100"
						: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
				}`}
			>
				<OverflowPopover
					label={`Actions for ${session.title}`}
					open={menuOpen}
					onOpenChange={setMenuOpen}
					panelClassName="flex flex-col gap-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-lg)]"
				>
					<button
						type="button"
						data-popover-close
						disabled={actionPending}
						onClick={() => onSetArchived(session.profileId, session.id, !session.archived)}
						className="rounded-[6px] px-2.5 py-2 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 disabled:opacity-40"
					>
						{session.archived ? "Unarchive" : "Archive"}
					</button>
					<button
						type="button"
						data-popover-close
						disabled={actionPending || deleteDisabledReason !== null}
						title={deleteDisabledReason ?? undefined}
						onClick={() => {
							if (!confirmHermesSessionDeletion(session.title, confirmDelete)) return;
							onDelete(session.profileId, session.id);
						}}
						className="rounded-[6px] px-2.5 py-2 text-left text-[11px] text-[var(--danger)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50 disabled:opacity-40"
					>
						Delete permanently…
					</button>
					{deleteDisabledReason && (
						<div className="max-w-56 px-2.5 py-1 text-[9px] leading-4 text-[var(--text-quaternary)]">
							{deleteDisabledReason}
						</div>
					)}
				</OverflowPopover>
			</div>
		</div>
	);
}
