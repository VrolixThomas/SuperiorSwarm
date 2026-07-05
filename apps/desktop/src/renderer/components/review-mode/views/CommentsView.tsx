import { useEffect, useMemo, useRef } from "react";
import type { PRContext, UnifiedThread } from "../../../../shared/github-types";
import {
	type ThreadFilter,
	groupThreadsByFile,
	matchesFilter,
} from "../../../lib/pr-review-threads";
import { openThreadInChanges } from "../../../lib/review-mode-nav";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { trpc } from "../../../trpc/client";
import { DiffContextSnippet } from "../thread/DiffContextSnippet";
import { type ThreadCallbacks, ThreadCard } from "../thread/ThreadCard";

interface CommentsViewProps {
	workspaceId: string;
	prCtx: PRContext;
	allThreads: UnifiedThread[];
	counts: Record<ThreadFilter, number>;
	fileOrder: string[];
	sessionKey: string;
}

const FILTERS: Array<{ label: string; value: ThreadFilter }> = [
	{ label: "All", value: "all" },
	{ label: "Pending", value: "pending" },
	{ label: "Accepted", value: "accepted" },
	{ label: "Declined", value: "declined" },
	{ label: "Open", value: "open" },
	{ label: "Resolved", value: "resolved" },
];

function escapeThreadIdForSelector(threadId: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(threadId);
	}

	return threadId
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\a ")
		.replace(/\r/g, "\\d ")
		.replace(/\f/g, "\\c ");
}

export function CommentsView({
	workspaceId,
	prCtx,
	allThreads,
	counts,
	fileOrder,
	sessionKey,
}: CommentsViewProps) {
	const utils = trpc.useUtils();
	const commentFilter = useReviewModeStore((s) => s.commentFilter);
	const setCommentFilter = useReviewModeStore((s) => s.setCommentFilter);
	const activeThreadId = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeThreadId ?? null
	);
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const setThreadOrder = usePRReviewSessionStore((s) => s.setThreadOrder);
	const skipNextScrollRef = useRef(false);

	const visibleThreads = useMemo(
		() => allThreads.filter((thread) => matchesFilter(thread, commentFilter)),
		[allThreads, commentFilter]
	);
	const groupedThreads = useMemo(
		() => groupThreadsByFile(visibleThreads, fileOrder),
		[visibleThreads, fileOrder]
	);
	const visibleThreadRefs = useMemo(
		() =>
			groupedThreads.flatMap((group) =>
				group.threads.map((thread) => ({ id: thread.id, path: thread.path }))
			),
		[groupedThreads]
	);

	useEffect(() => {
		setThreadOrder(sessionKey, visibleThreadRefs);
	}, [sessionKey, setThreadOrder, visibleThreadRefs]);

	useEffect(() => {
		if (activeThreadId === null) return;
		if (!visibleThreadRefs.some((thread) => thread.id === activeThreadId)) return;
		if (skipNextScrollRef.current) {
			skipNextScrollRef.current = false;
			return;
		}

		const escapedId = escapeThreadIdForSelector(activeThreadId);
		document.querySelector(`[data-thread-id="${escapedId}"]`)?.scrollIntoView({ block: "center" });
	}, [activeThreadId, visibleThreadRefs]);

	const selectThreadWithoutScroll = (threadId: string) => {
		if (threadId !== activeThreadId) skipNextScrollRef.current = true;
		selectThread(sessionKey, threadId);
	};

	const invalidateDrafts = () => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
	};
	const invalidateDetails = () =>
		utils.projects.getPRDetails.invalidate({
			provider: prCtx.provider,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
		});

	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});
	const deleteDraftComment = trpc.aiReview.deleteDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});
	const addComment = trpc.github.addReviewComment.useMutation({
		onSuccess: invalidateDetails,
	});
	const resolveThread = trpc.github.resolveThread.useMutation({
		onSuccess: invalidateDetails,
	});
	const bitbucketReplyComment = trpc.atlassian.replyToPRComment.useMutation({
		onSuccess: invalidateDetails,
	});
	const bitbucketResolveComment = trpc.atlassian.resolvePRComment.useMutation({
		onSuccess: invalidateDetails,
	});

	const callbacks: ThreadCallbacks = {
		onAccept: (commentId) => updateDraftComment.mutate({ commentId, status: "user-pending" }),
		onDecline: (commentId) => updateDraftComment.mutate({ commentId, status: "rejected" }),
		onDelete: (commentId) => deleteDraftComment.mutate({ commentId }),
		onSaveEdit: (commentId, body) =>
			updateDraftComment.mutate({ commentId, status: "edited", userEdit: body }),
		onReply: (threadId, body) => {
			if (prCtx.provider === "github") {
				addComment.mutate({ threadId, body });
				return;
			}

			bitbucketReplyComment.mutate({
				workspace: prCtx.owner,
				repoSlug: prCtx.repo,
				prId: prCtx.number,
				parentCommentId: Number.parseInt(threadId, 10),
				body,
			});
		},
		onResolve: (threadId) => {
			if (prCtx.provider === "github") {
				resolveThread.mutate({ threadId });
				return;
			}

			bitbucketResolveComment.mutate({
				workspace: prCtx.owner,
				repoSlug: prCtx.repo,
				prId: prCtx.number,
				commentId: Number.parseInt(threadId, 10),
				resolved: true,
			});
		},
		onOpenInChanges: (path, threadId) => openThreadInChanges(workspaceId, prCtx, path, threadId),
	};

	return (
		<div className="mx-auto max-w-[760px] px-6 py-6">
			<div className="mb-5 flex flex-wrap items-center gap-1.5">
				{FILTERS.map((filter) => {
					const active = commentFilter === filter.value;
					return (
						<button
							key={filter.value}
							type="button"
							aria-pressed={active}
							onClick={() => setCommentFilter(filter.value)}
							className={[
								"rounded-[var(--radius-sm)] px-2.5 py-1 text-[12px] font-medium transition-colors duration-[120ms]",
								active
									? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]",
							].join(" ")}
						>
							{filter.label}
							<span className="ml-1 tabular-nums">{counts[filter.value] ?? 0}</span>
						</button>
					);
				})}
			</div>

			{visibleThreadRefs.length === 0 ? (
				<div className="flex min-h-[240px] items-center justify-center text-[13px] text-[var(--text-tertiary)]">
					No comments match this filter
				</div>
			) : (
				<div className="space-y-5">
					{groupedThreads.map((group) => (
						<section key={group.path} className="space-y-3">
							<div className="sticky top-0 z-10 bg-[var(--bg-base)] py-2 font-mono text-[12px] text-[var(--text-tertiary)]">
								<span className="break-all">{group.path}</span>
								<span className="ml-2 tabular-nums">{group.threads.length}</span>
							</div>
							<div className="flex flex-col gap-3">
								{group.threads.map((thread) => (
									<div
										key={thread.id}
										onPointerDownCapture={() => selectThreadWithoutScroll(thread.id)}
										onFocusCapture={() => selectThreadWithoutScroll(thread.id)}
									>
										<ThreadCard
											thread={thread}
											variant="full"
											active={thread.id === activeThreadId}
											callbacks={callbacks}
											contextSlot={
												thread.line != null ? (
													<DiffContextSnippet
														prCtx={prCtx}
														path={thread.path}
														line={thread.line}
														side={thread.diffSide}
													/>
												) : undefined
											}
										/>
									</div>
								))}
							</div>
						</section>
					))}
				</div>
			)}
		</div>
	);
}
