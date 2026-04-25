import { memo } from "react";
import type { UnifiedThread } from "../../../shared/github-types";
import { basename } from "../../lib/format";

interface ToolbarAction {
	id: string;
	label: string;
	tone: "neutral" | "accept" | "decline" | "warn";
	onClick: () => void;
}

const TONE_CLASS: Record<ToolbarAction["tone"], string> = {
	accept: "bg-[var(--success-subtle)] text-[var(--color-success)] hover:opacity-80",
	decline: "bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:opacity-80",
	warn: "bg-[var(--warning-subtle)] text-[var(--color-warning)] hover:opacity-80",
	neutral: "bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:opacity-80",
};

interface ActiveThreadBarProps {
	thread: UnifiedThread;
	onAccept: () => void;
	onDecline: () => void;
	onEdit: () => void;
	onReply: () => void;
	onResolve: () => void;
	onCenter: () => void;
}

function _ActiveThreadBar({
	thread,
	onAccept,
	onDecline,
	onEdit,
	onReply,
	onResolve,
	onCenter,
}: ActiveThreadBarProps) {
	const filename = basename(thread.path);

	let badge: { label: string; className: string };
	let previewText: string;
	const actions: ToolbarAction[] = [];
	if (thread.isAIDraft) {
		badge = { label: "AI", className: "ai-badge" };
		previewText = thread.userEdit ?? thread.body;
		if (thread.status === "pending") {
			actions.push({ id: "accept", label: "Accept", tone: "accept", onClick: onAccept });
			actions.push({ id: "decline", label: "Decline", tone: "decline", onClick: onDecline });
			actions.push({ id: "edit", label: "Edit", tone: "neutral", onClick: onEdit });
		}
	} else {
		badge = {
			label: "💬",
			className:
				"rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[9px] text-[var(--text-tertiary)]",
		};
		previewText = thread.comments[0]?.body ?? "";
		if (!thread.isResolved) {
			actions.push({ id: "reply", label: "Reply", tone: "neutral", onClick: onReply });
			actions.push({ id: "resolve", label: "Resolve", tone: "warn", onClick: onResolve });
		}
	}

	return (
		<div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px]">
			<span className={badge.className}>{badge.label}</span>
			<button
				type="button"
				onClick={onCenter}
				className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)] transition-colors"
				title="Scroll to thread"
			>
				{filename}:{thread.line ?? "?"}
			</button>
			<span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={previewText}>
				{previewText}
			</span>
			<div className="flex shrink-0 items-center gap-1">
				{actions.map((a) => (
					<button
						key={a.id}
						type="button"
						onClick={a.onClick}
						className={`rounded-[4px] px-2 py-0.5 text-[10px] transition-colors ${TONE_CLASS[a.tone]}`}
					>
						{a.label}
					</button>
				))}
			</div>
		</div>
	);
}

/**
 * Memoize on the visible thread fields. Background tRPC refetches re-create
 * the thread object on every render — without this guard, the bar visibly
 * re-renders on every refetch tick. Callbacks are intentionally ignored:
 * they close over the same thread.id and stay behaviorally equivalent.
 */
export const ActiveThreadBar = memo(_ActiveThreadBar, (prev, next) => {
	const a = prev.thread;
	const b = next.thread;
	if (a.id !== b.id) return false;
	if (a.path !== b.path) return false;
	if (a.line !== b.line) return false;
	if (a.isAIDraft !== b.isAIDraft) return false;
	if (a.isAIDraft && b.isAIDraft) {
		return a.body === b.body && a.userEdit === b.userEdit && a.status === b.status;
	}
	if (!a.isAIDraft && !b.isAIDraft) {
		return a.isResolved === b.isResolved && a.comments[0]?.body === b.comments[0]?.body;
	}
	return false;
});
