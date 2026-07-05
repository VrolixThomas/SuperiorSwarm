import { useCallback, useMemo } from "react";
import { openThreadInChanges } from "../../lib/review-mode-nav";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { trpc } from "../../trpc/client";
import { ReviewHeader } from "./ReviewHeader";
import { ReviewNavigator } from "./navigator/ReviewNavigator";
import type { ThreadCallbacks } from "./thread/ThreadCard";
import { useReviewData } from "./useReviewData";
import { ChangesView } from "./views/ChangesView";
import { CommentsView } from "./views/CommentsView";

const VIEW_LABELS = {
	overview: "Overview",
	changes: "Changes",
	comments: "Comments",
} as const;

type ActiveReview = NonNullable<ReturnType<typeof useReviewModeStore.getState>["active"]>;

export function ReviewModeShell() {
	const active = useReviewModeStore((s) => s.active);

	if (!active) return null;

	return <ActiveReviewModeShell active={active} />;
}

function ActiveReviewModeShell({ active }: { active: ActiveReview }) {
	const { workspaceId, prCtx } = active;
	const view = useReviewModeStore((s) => s.view);
	const navigatorCollapsed = useReviewModeStore((s) => s.navigatorCollapsed);
	const utils = trpc.useUtils();
	const { details, isLoading, allThreads, counts, sessionKey, fileOrder } = useReviewData(
		workspaceId,
		prCtx
	);
	const commentCount = (counts.pending ?? 0) + (counts.open ?? 0);

	const invalidateDrafts = useCallback(() => {
		void utils.aiReview.getReviewDrafts.invalidate();
		void utils.aiReview.getReviewDraft.invalidate();
	}, [utils]);

	const invalidateDetails = useCallback(() => {
		void utils.projects.getPRDetails.invalidate({
			provider: prCtx.provider,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
		});
	}, [prCtx.number, prCtx.owner, prCtx.provider, prCtx.repo, utils]);

	const { mutate: updateDraftComment } = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});
	const { mutate: deleteDraftComment } = trpc.aiReview.deleteDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});
	const { mutate: addReviewComment } = trpc.github.addReviewComment.useMutation({
		onSuccess: invalidateDetails,
	});
	const { mutate: resolveThread } = trpc.github.resolveThread.useMutation({
		onSuccess: invalidateDetails,
	});
	const { mutate: replyToPRComment } = trpc.atlassian.replyToPRComment.useMutation({
		onSuccess: invalidateDetails,
	});
	const { mutate: resolvePRComment } = trpc.atlassian.resolvePRComment.useMutation({
		onSuccess: invalidateDetails,
	});

	const callbacks = useMemo<ThreadCallbacks>(
		() => ({
			onAccept: (commentId) => updateDraftComment({ commentId, status: "user-pending" }),
			onDecline: (commentId) => updateDraftComment({ commentId, status: "rejected" }),
			onDelete: (commentId) => deleteDraftComment({ commentId }),
			onSaveEdit: (commentId, body) =>
				updateDraftComment({ commentId, status: "edited", userEdit: body }),
			onReply: (threadId, body) => {
				if (prCtx.provider === "github") {
					addReviewComment({ threadId, body });
					return;
				}

				replyToPRComment({
					workspace: prCtx.owner,
					repoSlug: prCtx.repo,
					prId: prCtx.number,
					parentCommentId: Number.parseInt(threadId, 10),
					body,
				});
			},
			onResolve: (threadId) => {
				if (prCtx.provider === "github") {
					resolveThread({ threadId });
					return;
				}

				resolvePRComment({
					workspace: prCtx.owner,
					repoSlug: prCtx.repo,
					prId: prCtx.number,
					commentId: Number.parseInt(threadId, 10),
					resolved: true,
				});
			},
			onOpenInChanges: (path, threadId) => openThreadInChanges(workspaceId, prCtx, path, threadId),
		}),
		[
			addReviewComment,
			deleteDraftComment,
			prCtx,
			replyToPRComment,
			resolvePRComment,
			resolveThread,
			updateDraftComment,
			workspaceId,
		]
	);

	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg-base)]">
			<ReviewHeader prCtx={prCtx} commentCount={commentCount} />
			<div className="flex min-h-0 flex-1">
				{!navigatorCollapsed && (
					<aside className="w-[280px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-surface)]">
						{details ? (
							<ReviewNavigator
								workspaceId={workspaceId}
								prCtx={prCtx}
								details={details}
								threads={allThreads}
							/>
						) : (
							<div className="p-4 text-[13px] text-[var(--text-tertiary)]">
								{isLoading ? "Loading review details..." : "Review details unavailable"}
							</div>
						)}
					</aside>
				)}
				<main
					className={`min-w-0 flex-1 ${view === "changes" ? "overflow-hidden" : "overflow-y-auto"}`}
				>
					{view === "comments" && details ? (
						<CommentsView
							prCtx={prCtx}
							allThreads={allThreads}
							counts={counts}
							fileOrder={fileOrder}
							sessionKey={sessionKey}
							callbacks={callbacks}
						/>
					) : view === "changes" && details ? (
						<ChangesView
							workspaceId={workspaceId}
							prCtx={prCtx}
							details={details}
							allThreads={allThreads}
							fileOrder={fileOrder}
							sessionKey={sessionKey}
							callbacks={callbacks}
						/>
					) : (
						<div className="p-8 text-[13px] text-[var(--text-tertiary)]">{VIEW_LABELS[view]}</div>
					)}
				</main>
			</div>
		</div>
	);
}
