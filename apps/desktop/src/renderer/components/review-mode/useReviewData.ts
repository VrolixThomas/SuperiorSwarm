import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useMemo } from "react";
import type { AppRouter } from "../../../main/trpc/routers";
import type {
	AIDraftThread,
	GitHubPRDetails,
	PRContext,
	UnifiedThread,
} from "../../../shared/github-types";
import { formatPrIdentifier } from "../../../shared/pr-identifier";
import {
	type DraftCommentLike,
	type ThreadFilter,
	mapDraftComment,
	pickActiveDraft,
	pickLatestDraft,
	threadCounts,
} from "../../lib/pr-review-threads";
import { prReviewSessionKey, usePRReviewSessionStore } from "../../stores/pr-review-session-store";
import { trpc } from "../../trpc/client";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ReviewDrafts = RouterOutputs["aiReview"]["getReviewDrafts"];
type ReviewDraft = ReviewDrafts[number];
type ReviewDraftWithComments = NonNullable<RouterOutputs["aiReview"]["getReviewDraft"]>;
type ReviewDraftComment = ReviewDraftWithComments["comments"][number];

interface ReviewData {
	details: GitHubPRDetails | undefined;
	isLoading: boolean;
	matchingDraft: ReviewDraft | undefined;
	activeDraft: ReviewDraft | undefined;
	aiDraft: ReviewDraftWithComments | undefined;
	allThreads: UnifiedThread[];
	acceptedThreads: AIDraftThread[];
	pendingCount: number;
	counts: Record<ThreadFilter, number>;
	sessionKey: string;
	fileOrder: string[];
}

const DRAFT_THREAD_STATUSES = new Set([
	"pending",
	"approved",
	"rejected",
	"edited",
	"submitted",
	"user-pending",
	"error",
]);

function toDraftCommentLike(comment: ReviewDraftComment): DraftCommentLike {
	return {
		id: comment.id,
		filePath: comment.filePath,
		lineNumber: comment.lineNumber,
		side: comment.side,
		body: comment.body,
		status: comment.status,
		userEdit: comment.userEdit,
		createdAt: comment.createdAt,
		resolution: comment.resolution,
	};
}

export function useReviewData(workspaceId: string, prCtx: PRContext): ReviewData {
	const setFileOrder = usePRReviewSessionStore((s) => s.setFileOrder);
	const prIdentifier = formatPrIdentifier(prCtx);
	const sessionKey = prReviewSessionKey(workspaceId, prIdentifier);

	const detailsQuery = trpc.projects.getPRDetails.useQuery(
		{
			provider: prCtx.provider,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
		},
		{ staleTime: 30_000 }
	);

	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 5_000,
		refetchInterval: 5_000,
	});

	const matchingDraft = useMemo(
		() => pickLatestDraft(reviewDraftsQuery.data, prIdentifier),
		[reviewDraftsQuery.data, prIdentifier]
	);
	const activeDraft = useMemo(
		() => pickActiveDraft(reviewDraftsQuery.data, prIdentifier),
		[reviewDraftsQuery.data, prIdentifier]
	);

	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id, refetchInterval: 5_000 }
	);

	const details = detailsQuery.data;
	const aiDraft = aiDraftQuery.data ?? undefined;
	const roundNumber = aiDraft?.roundNumber ?? 1;

	const fileOrder = useMemo(() => details?.files.map((file) => file.path) ?? [], [details?.files]);

	useEffect(() => {
		if (fileOrder.length === 0) return;
		setFileOrder(sessionKey, fileOrder);
	}, [fileOrder, sessionKey, setFileOrder]);

	const draftThreads = useMemo<AIDraftThread[]>(
		() =>
			(aiDraft?.comments ?? [])
				.filter((comment) => DRAFT_THREAD_STATUSES.has(comment.status))
				.map((comment) => mapDraftComment(toDraftCommentLike(comment), roundNumber)),
		[aiDraft?.comments, roundNumber]
	);

	const allThreads = useMemo<UnifiedThread[]>(
		() => [...(details?.reviewThreads ?? []), ...draftThreads],
		[details?.reviewThreads, draftThreads]
	);

	const acceptedThreads = useMemo(
		() =>
			draftThreads.filter(
				(thread) => thread.status === "user-pending" || thread.status === "approved"
			),
		[draftThreads]
	);

	const counts = useMemo(() => threadCounts(allThreads), [allThreads]);

	return {
		details,
		isLoading: detailsQuery.isLoading,
		matchingDraft,
		activeDraft,
		aiDraft,
		allThreads,
		acceptedThreads,
		pendingCount: counts.pending,
		counts,
		sessionKey,
		fileOrder,
	};
}
