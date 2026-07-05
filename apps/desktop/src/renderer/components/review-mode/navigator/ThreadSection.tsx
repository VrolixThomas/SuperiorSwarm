import { useCallback, useMemo } from "react";
import type { PRContext, UnifiedThread } from "../../../../shared/github-types";
import { formatPrIdentifier } from "../../../../shared/pr-identifier";
import {
	type ThreadBucket,
	type ThreadFilter,
	matchesFilter,
	threadBucket,
	threadExcerpt,
} from "../../../lib/pr-review-threads";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";

interface ThreadSectionProps {
	workspaceId: string;
	prCtx: PRContext;
	threads: UnifiedThread[];
}

const FILTERS: Array<{ label: string; value: ThreadFilter }> = [
	{ label: "All", value: "all" },
	{ label: "Attention", value: "pending" },
	{ label: "Done", value: "resolved" },
];

const DOT_CLASSES: Record<ThreadBucket, string> = {
	pending: "bg-[var(--color-purple)]",
	accepted: "bg-[var(--accent)]",
	declined: "bg-[var(--text-quaternary)]",
	open: "bg-[var(--color-warning)]",
	resolved: "bg-[var(--color-success)]",
};

const BUCKET_LABELS: Record<ThreadBucket, string> = {
	pending: "Pending",
	accepted: "Accepted",
	declined: "Declined",
	open: "Open",
	resolved: "Resolved",
};

function basename(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? path : path.slice(idx + 1);
}

export function ThreadSection({ workspaceId, prCtx, threads }: ThreadSectionProps) {
	const sessionKey = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const activeThreadId = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeThreadId ?? null
	);
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const filter = useReviewModeStore((s) => s.commentFilter);
	const setCommentFilter = useReviewModeStore((s) => s.setCommentFilter);
	const setView = useReviewModeStore((s) => s.setView);

	const visibleThreads = useMemo(
		() => threads.filter((thread) => matchesFilter(thread, filter)),
		[threads, filter]
	);

	const onSelectThread = useCallback(
		(threadId: string) => {
			selectThread(sessionKey, threadId);
			setView("comments");
		},
		[selectThread, sessionKey, setView]
	);

	return (
		<section className="min-h-0 border-t border-[var(--border)]">
			<div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
				<h2 className="text-[12px] font-medium text-[var(--text-secondary)]">Comments</h2>
				<div className="flex shrink-0 items-center rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
					{FILTERS.map((item) => {
						const active = filter === item.value;
						return (
							<button
								key={item.value}
								type="button"
								aria-pressed={active}
								onClick={() => setCommentFilter(item.value)}
								className={[
									"rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-[120ms]",
									active
										? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-sm)]"
										: "text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]",
								].join(" ")}
							>
								{item.label}
							</button>
						);
					})}
				</div>
			</div>

			<div className="pb-2">
				{visibleThreads.length === 0 && (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No comments</div>
				)}

				{visibleThreads.map((thread) => {
					const active = activeThreadId === thread.id;
					const bucket = threadBucket(thread);
					const line = thread.line == null ? null : `:${thread.line}`;
					const excerpt = threadExcerpt(thread) || "No comment body";

					return (
						<button
							key={thread.id}
							type="button"
							aria-current={active ? "true" : undefined}
							aria-label={`${BUCKET_LABELS[bucket]} comment in ${thread.path}${
								line ?? ""
							}: ${excerpt}`}
							title={thread.path}
							onClick={() => onSelectThread(thread.id)}
							className={[
								"group flex w-full min-w-0 items-start gap-2 border-l-2 border-transparent px-2 py-1.5 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]",
								active
									? "border-[var(--accent)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]"
									: "",
							].join(" ")}
						>
							<span
								className={`mt-1 size-1.5 shrink-0 rounded-full ${
									DOT_CLASSES[bucket] ?? "bg-[var(--text-quaternary)]"
								}`}
							/>
							<span className="min-w-0 flex-1">
								<span className="flex min-w-0 items-center gap-0.5 font-mono text-[11px] text-[var(--text-quaternary)]">
									<span className="min-w-0 truncate text-[var(--text-secondary)]">
										{basename(thread.path)}
									</span>
									{line && <span className="shrink-0">{line}</span>}
								</span>
								<span className="mt-0.5 block truncate text-[12px] leading-4 text-[var(--text-tertiary)]">
									{excerpt}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}
