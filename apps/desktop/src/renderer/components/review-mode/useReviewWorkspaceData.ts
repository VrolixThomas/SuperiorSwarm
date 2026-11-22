import { useCallback, useMemo, useState } from "react";
import type { PRContext } from "../../../shared/github-types";
import {
	type ThreadFilter,
	draftStatusAfterEdit,
	fileCommentCounts,
	matchesReviewFilter,
} from "../../lib/pr-review-threads";
import { openThreadInChanges, openThreadInComments } from "../../lib/review-mode-nav";
import { resetReviewSnapshotAcquisition } from "../../lib/snapshot-acquisition";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { useReviewUIApi, useReviewUIStore } from "./ReviewUIContext";
import type { ThreadCallbacks } from "./thread/ThreadCard";
import { useReviewAgentActions } from "./useReviewAgentActions";
import { useReviewData } from "./useReviewData";

export function useReviewWorkspaceData(
	workspaceId: string,
	prCtx: PRContext,
	options: { manageFileOrder?: boolean } = {}
) {
	const ui = useReviewUIApi();
	const setView = useReviewUIStore((s) => s.setView);
	const setCommentFilter = useReviewUIStore((s) => s.setCommentFilter);
	const closeReview = useReviewUIStore((s) => s.close);
	const [submitOpen, setSubmitOpen] = useState(false);
	const utils = trpc.useUtils();
	const {
		details,
		isLoading,
		draftPending,
		matchingDraft,
		activeDraft,
		aiDraft,
		allThreads,
		acceptedThreads,
		pendingCount,
		counts,
		sessionKey,
		fileOrder,
	} = useReviewData(workspaceId, prCtx, options);
	const isOpen = details?.state === "OPEN";
	const canSubmitReview =
		isOpen &&
		!draftPending &&
		(!aiDraft || (!!aiDraft.commitSha && aiDraft.commitSha === details?.headCommitOid));
	const commentCount = (counts.pending ?? 0) + (counts.open ?? 0);
	const commentCountByFile = useMemo(() => fileCommentCounts(allThreads), [allThreads]);
	const reviewChainId =
		activeDraft?.reviewChainId ??
		aiDraft?.reviewChainId ??
		matchingDraft?.reviewChainId ??
		matchingDraft?.id ??
		null;
	const agentActions = useReviewAgentActions({
		prCtx,
		matchingDraft: activeDraft ?? matchingDraft,
		reviewChainId,
		enabled: isOpen,
	});

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
	const refreshDetails = useCallback(() => {
		resetReviewSnapshotAcquisition(workspaceId);
		invalidateDetails();
		void utils.reviewExplanation.resolveSnapshot.invalidate({ workspaceId });
	}, [workspaceId, invalidateDetails, utils]);

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
	const cleanupReviewWorkspace = trpc.workspaces.cleanupReviewWorkspace.useMutation({
		onSuccess: () => useTabStore.getState().cleanupWorkspace(workspaceId),
	});

	const handleClose = useCallback(() => {
		closeReview();
		if (details && details.state !== "OPEN") {
			cleanupReviewWorkspace.mutate({ workspaceId });
		}
	}, [cleanupReviewWorkspace, closeReview, details, workspaceId]);

	const callbacks = useMemo<ThreadCallbacks>(() => {
		const navigation: ThreadCallbacks = {
			onOpenInChanges: (path, threadId) => openThreadInChanges(workspaceId, prCtx, path, threadId),
			onOpenInComments: (path, threadId) => {
				const thread = allThreads.find((candidate) => candidate.id === threadId);
				const filter = ui.getState().commentFilter;
				if (thread && !matchesReviewFilter(thread, filter)) setCommentFilter("all");
				openThreadInComments(workspaceId, prCtx, path, threadId);
			},
		};
		if (!isOpen) return navigation;

		return {
			...navigation,
			onAccept: (commentId) => {
				if (allThreads.some((t) => t.isAIDraft && t.draftCommentId === commentId && !t.isOutdated))
					updateDraftComment({ commentId, status: "user-pending" });
			},
			onDecline: (commentId) => updateDraftComment({ commentId, status: "rejected" }),
			onDelete: (commentId) => deleteDraftComment({ commentId }),
			onSaveEdit: (commentId, body, status) => {
				if (!allThreads.some((t) => t.isAIDraft && t.draftCommentId === commentId && !t.isOutdated))
					return;
				updateDraftComment({
					commentId,
					status: draftStatusAfterEdit(status),
					userEdit: body,
				});
			},
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
		};
	}, [
		ui,
		addReviewComment,
		allThreads,
		deleteDraftComment,
		isOpen,
		prCtx,
		replyToPRComment,
		resolvePRComment,
		resolveThread,
		setCommentFilter,
		updateDraftComment,
		workspaceId,
	]);

	const jumpToComments = useCallback(
		(filter: ThreadFilter) => {
			setCommentFilter(filter);
			setView("comments");
		},
		[setCommentFilter, setView]
	);

	const handleSubmitted = useCallback(() => {
		setSubmitOpen(false);
		invalidateDrafts();
		invalidateDetails();
		void utils.github.getMyPRs.invalidate();
		void utils.atlassian.getReviewRequests.invalidate();
	}, [invalidateDetails, invalidateDrafts, utils]);

	return {
		details,
		isLoading,
		draftPending,
		matchingDraft,
		activeDraft,
		aiDraft,
		allThreads,
		acceptedThreads,
		pendingCount,
		counts,
		sessionKey,
		fileOrder,
		isOpen,
		canSubmitReview,
		commentCount,
		commentCountByFile,
		reviewChainId,
		agentActions,
		callbacks,
		handleClose,
		handleSubmitted,
		refreshDetails,
		submitOpen,
		setSubmitOpen,
		jumpToComments,
	};
}
