import type { AIDraftThread, GitHubReviewThread, UnifiedThread } from "../../../shared/github-types";

interface Action {
	key: string;
	label: string;
	tone: "neutral" | "accept" | "decline" | "warn";
	onClick: () => void;
}

export function ActiveThreadBar({
	thread,
	onAccept,
	onDecline,
	onEdit,
	onReply,
	onResolve,
	onCenter,
}: {
	thread: UnifiedThread;
	onAccept: () => void;
	onDecline: () => void;
	onEdit: () => void;
	onReply: () => void;
	onResolve: () => void;
	onCenter: () => void;
}) {
	const isAI = !!thread.isAIDraft;
	const ai = isAI ? (thread as AIDraftThread) : null;
	const gh = !isAI ? (thread as GitHubReviewThread) : null;
	const filename = thread.path.split("/").pop() ?? thread.path;
	const previewText = isAI ? (ai!.userEdit ?? ai!.body) : (gh!.comments[0]?.body ?? "");

	const actions: Action[] = [];
	if (isAI && ai!.status === "pending") {
		actions.push({ key: "a", label: "Accept", tone: "accept", onClick: onAccept });
		actions.push({ key: "d", label: "Decline", tone: "decline", onClick: onDecline });
		actions.push({ key: "e", label: "Edit", tone: "neutral", onClick: onEdit });
	} else if (!isAI && !gh!.isResolved) {
		actions.push({ key: "r", label: "Reply", tone: "neutral", onClick: onReply });
		actions.push({ key: "R", label: "Resolve", tone: "warn", onClick: onResolve });
	}

	return (
		<div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px]">
			<span
				className={
					isAI
						? "ai-badge"
						: "rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[9px] text-[var(--text-tertiary)]"
				}
			>
				{isAI ? "AI" : "💬"}
			</span>
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
						key={a.key}
						type="button"
						onClick={a.onClick}
						className={[
							"flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[10px] transition-colors",
							a.tone === "accept"
								? "bg-[var(--success-subtle)] text-[var(--color-success)] hover:opacity-80"
								: a.tone === "decline"
									? "bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:opacity-80"
									: a.tone === "warn"
										? "bg-[var(--warning-subtle)] text-[var(--color-warning)] hover:opacity-80"
										: "bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:opacity-80",
						].join(" ")}
					>
						<kbd className="rounded bg-[var(--bg-base)] px-1 text-[9px] text-[var(--text-quaternary)]">
							{a.key}
						</kbd>
						{a.label}
					</button>
				))}
			</div>
		</div>
	);
}
