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
	hasActiveReviewDraft,
	mapDraftComment,
	pickLatestDraft,
	threadCounts,
} from "../../lib/pr-review-threads";
import { observeReviewMapping, useReviewDraftBinding } from "../../lib/review-draft-binding";
import { reviewPathIdentityKey, useLiveReviewPath } from "../../lib/review-path-source";
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
	draftPending: boolean;
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

export function useReviewData(
	workspaceId: string,
	prCtx: PRContext,
	options: { manageFileOrder?: boolean } = {}
): ReviewData {
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
		refetchInterval: (query) => (hasActiveReviewDraft(query.state.data) ? 5_000 : false),
	});

	const identity = useMemo(
		() =>
			detailsQuery.data?.headCommitOid
				? {
						workspaceId,
						provider: prCtx.provider,
						owner: prCtx.owner,
						repo: prCtx.repo,
						prNumber: prCtx.number,
						headSha: detailsQuery.data.headCommitOid,
					}
				: undefined,
		[
			workspaceId,
			prCtx.provider,
			prCtx.owner,
			prCtx.repo,
			prCtx.number,
			detailsQuery.data?.headCommitOid,
		]
	);
	const { state: pathState } = useLiveReviewPath(identity, { observeOnly: true });
	const localBinding = useReviewDraftBinding(identity);
	const projection = trpc.reviewPath.status.useQuery(identity!, {
		enabled: !!identity,
		refetchInterval: 1500,
	});
	const mapping = pathState.snapshot?.runs
		.filter(
			(run) =>
				run.kind === "mapping" &&
				identity &&
				reviewPathIdentityKey(run.identity) === reviewPathIdentityKey(identity)
		)
		.sort((a, b) => b.version - a.version)[0];
	useEffect(() => {
		if (identity && pathState.snapshot) observeReviewMapping(identity, mapping?.id);
	}, [identity, mapping?.id, pathState.snapshot]);
	const projectedDraftId =
		identity &&
		projection.data?.identity &&
		reviewPathIdentityKey(projection.data.identity) === reviewPathIdentityKey(identity)
			? projection.data.reviewDraftId
			: undefined;
	const mappingBindingPending =
		mapping?.state === "running" &&
		mapping.alsoReview !== false &&
		!mapping.reviewDraftId &&
		!localBinding;
	// A completed/submitted binding is historical once a new manual draft exists.
	// Unknown rows remain authoritative while their direct detail query is loading.
	const usableBinding = (id: string | undefined) => {
		if (!id) return undefined;
		const row = reviewDraftsQuery.data?.find((draft) => draft.id === id);
		return row && !["ready", "queued", "in_progress"].includes(row.status) ? undefined : id;
	};
	const boundId =
		usableBinding(localBinding?.draftId) ??
		usableBinding(mapping?.reviewDraftId) ??
		(mappingBindingPending ? undefined : usableBinding(projectedDraftId));
	const matchingDraft = useMemo(() => {
		if (mappingBindingPending) return undefined;
		const candidates = reviewDraftsQuery.data?.filter(
			(draft) => draft.prProvider === prCtx.provider && draft.prIdentifier === prIdentifier
		);
		if (boundId)
			return candidates?.find(
				(draft) => draft.id === boundId && draft.commitSha === identity?.headSha
			);
		const current = candidates?.filter((draft) => draft.commitSha === identity?.headSha);
		return pickLatestDraft(current?.length ? current : candidates, prIdentifier);
	}, [
		reviewDraftsQuery.data,
		prCtx.provider,
		prIdentifier,
		boundId,
		identity?.headSha,
		mappingBindingPending,
	]);
	const draftActive =
		mapping?.state === "running" ||
		matchingDraft?.status === "queued" ||
		matchingDraft?.status === "in_progress";
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: boundId ?? matchingDraft?.id ?? "" },
		{ enabled: !!(boundId ?? matchingDraft?.id), refetchInterval: draftActive ? 5_000 : false }
	);

	const details = detailsQuery.data;
	const candidate = aiDraftQuery.data;
	const aiDraft =
		candidate &&
		candidate.id === (boundId ?? matchingDraft?.id) &&
		candidate.prProvider === prCtx.provider &&
		candidate.prIdentifier === prIdentifier &&
		(!boundId || candidate.commitSha === identity?.headSha)
			? candidate
			: undefined;
	const selectedDraft = aiDraft ?? matchingDraft;
	const activeDraft =
		selectedDraft?.status === "queued" || selectedDraft?.status === "in_progress"
			? selectedDraft
			: undefined;
	const roundNumber = aiDraft?.roundNumber ?? 1;

	const fileOrder = useMemo(() => details?.files.map((file) => file.path) ?? [], [details?.files]);

	useEffect(() => {
		if (options.manageFileOrder === false || fileOrder.length === 0) return;
		setFileOrder(sessionKey, fileOrder);
	}, [fileOrder, sessionKey, setFileOrder, options.manageFileOrder]);

	const draftThreads = useMemo<AIDraftThread[]>(
		() =>
			!aiDraft
				? []
				: aiDraft.comments
						.filter((comment) => DRAFT_THREAD_STATUSES.has(comment.status))
						.map((comment) =>
							mapDraftComment(toDraftCommentLike(comment), roundNumber, {
								draftId: aiDraft.id,
								commitSha: aiDraft.commitSha,
								currentHead: details?.headCommitOid,
							})
						),
		[aiDraft, roundNumber, details?.headCommitOid]
	);

	const allThreads = useMemo<UnifiedThread[]>(
		() => [...(details?.reviewThreads ?? []), ...draftThreads],
		[details?.reviewThreads, draftThreads]
	);

	const acceptedThreads = useMemo(
		() =>
			draftThreads.filter(
				(thread) =>
					!thread.isOutdated && (thread.status === "user-pending" || thread.status === "approved")
			),
		[draftThreads]
	);

	const counts = useMemo(() => threadCounts(allThreads), [allThreads]);

	return {
		details,
		isLoading: detailsQuery.isLoading,
		draftPending: mappingBindingPending || (!!(boundId ?? matchingDraft?.id) && !aiDraft),
		matchingDraft: selectedDraft,
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
