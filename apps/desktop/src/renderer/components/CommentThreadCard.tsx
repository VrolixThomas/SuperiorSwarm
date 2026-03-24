import { useEffect, useRef, useState } from "react";
import type {
	AIDraftThread,
	GitHubReviewThread,
	PRContext,
	UnifiedThread,
} from "../../shared/github-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

export function threadAuthor(t: UnifiedThread): string {
	if (t.isAIDraft) return "BranchFlux AI";
	return (t as GitHubReviewThread).comments[0]?.author ?? "Unknown";
}

export function threadDate(t: UnifiedThread): string {
	if (t.isAIDraft) return t.createdAt;
	return (t as GitHubReviewThread).comments[0]?.createdAt ?? "";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SortMode = "by-file" | "by-reviewer" | "latest-first";

// ── CommentThreadCard ─────────────────────────────────────────────────────────

export function CommentThreadCard({
	thread,
	prCtx,
	onAccept,
	onDecline,
	onDelete,
	onReply,
	onResolve,
	onNavigate,
}: {
	thread: UnifiedThread;
	prCtx: PRContext;
	onAccept?: (id: string) => void;
	onDecline?: (id: string) => void;
	onDelete?: (id: string) => void;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
	onNavigate: (path: string) => void;
}) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyBody, setReplyBody] = useState("");
	const replyRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (replyOpen) replyRef.current?.focus();
	}, [replyOpen]);

	const filename = thread.path.split("/").pop() ?? thread.path;
	const isAI = !!thread.isAIDraft;

	if (isAI) {
		const ai = thread as AIDraftThread;
		return (
			<div className="mx-2 mb-1.5 overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
				<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
					<span className="ai-badge">AI</span>
					<button
						type="button"
						onClick={() => onNavigate(thread.path)}
						className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)]"
					>
						{filename}
						{ai.line != null && `:${ai.line}`}
					</button>
					<div className="flex-1" />
					{ai.roundNumber != null && ai.roundNumber > 1 && (
						<span className="text-[10px] text-[var(--text-quaternary)]">
							Round {ai.roundNumber}
						</span>
					)}
					{ai.resolution === "resolved-by-code" && (
						<span className="flex items-center gap-1 text-[11px] text-[#32d74b]">
							<span>&#10003;</span> Resolved
						</span>
					)}
					{ai.resolution === "incorrectly-resolved" && (
						<span className="flex items-center gap-1 text-[11px] text-[#ff9f0a]">
							<span>&#9888;</span> Flagged
						</span>
					)}
					{ai.status === "user-pending" && (
						<span className="rounded-[3px] border border-[var(--border-active)] bg-[var(--bg-overlay)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
							Pending
						</span>
					)}
					{ai.status === "error" && (
						<span className="rounded-[3px] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.12)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[#ff453a]">
							Failed
						</span>
					)}
				</div>
				<div className="px-3 py-2 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap">
					{ai.userEdit ?? ai.body}
				</div>
				{ai.status === "pending" && onAccept && onDecline && (
					<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
						<button
							type="button"
							onClick={() => onAccept(ai.draftCommentId)}
							className="rounded-[4px] px-2 py-0.5 text-[10px] font-medium bg-[rgba(48,209,88,0.15)] text-[#30d158] hover:opacity-80"
						>
							Accept
						</button>
						<button
							type="button"
							onClick={() => onDecline(ai.draftCommentId)}
							className="rounded-[4px] px-2 py-0.5 text-[10px] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:opacity-80"
						>
							Decline
						</button>
					</div>
				)}
				{ai.status === "error" && onDelete && (
					<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
						<button
							type="button"
							onClick={() => onDelete(ai.draftCommentId)}
							className="rounded-[4px] px-2 py-0.5 text-[10px] font-medium bg-[rgba(255,69,58,0.15)] text-[#ff453a] hover:opacity-80"
						>
							Remove
						</button>
					</div>
				)}
			</div>
		);
	}

	// GitHub thread
	const gh = thread as GitHubReviewThread;
	return (
		<div className="mx-2 mb-1.5 overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
				<button
					type="button"
					onClick={() => onNavigate(thread.path)}
					className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)]"
				>
					{filename}
					{gh.line != null && `:${gh.line}`}
				</button>
				<div className="flex-1" />
				{gh.isResolved ? (
					<span className="text-[10px] text-green-400">Resolved</span>
				) : (
					onResolve && (
						<button
							type="button"
							onClick={() => onResolve(gh.id)}
							className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
						>
							Resolve
						</button>
					)
				)}
			</div>

			{gh.comments.map((c) => (
				<div
					key={c.id}
					className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
				>
					<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
						<span className="font-medium text-[var(--text-secondary)]">{c.author}</span>
						<span className="text-[var(--text-quaternary)]">
							{new Date(c.createdAt).toLocaleDateString()}
						</span>
					</div>
					<p className="text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap">{c.body}</p>
				</div>
			))}

			{!gh.isResolved && onReply && (
				<div className="border-t border-[var(--border-subtle)]">
					{!replyOpen ? (
						<button
							type="button"
							onClick={() => setReplyOpen(true)}
							className="w-full px-3 py-1.5 text-left text-[10px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)] transition-colors"
						>
							Reply…
						</button>
					) : (
						<div className="flex flex-col gap-1.5 p-2">
							<textarea
								ref={replyRef}
								value={replyBody}
								onChange={(e) => setReplyBody(e.target.value)}
								rows={2}
								placeholder="Write a reply…"
								className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
							/>
							<div className="flex gap-1.5">
								<button
									type="button"
									onClick={() => {
										if (replyBody.trim()) {
											onReply(gh.id, replyBody.trim());
											setReplyBody("");
											setReplyOpen(false);
										}
									}}
									className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-80"
								>
									Reply
								</button>
								<button
									type="button"
									onClick={() => {
										setReplyOpen(false);
										setReplyBody("");
									}}
									className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
								>
									Cancel
								</button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
