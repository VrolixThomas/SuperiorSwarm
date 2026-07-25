import type { PRContext } from "../../../shared/github-types";
import { formatPrIdentifier } from "../../../shared/pr-identifier";
import { launchReviewTerminal } from "../../lib/review-launch";
import { trpc } from "../../trpc/client";

interface ReviewDraftSummary {
	id: string;
	status: string;
	reviewChainId?: string | null;
	createdAt?: string | Date;
}

interface UseReviewAgentActionsOptions {
	prCtx: PRContext;
	matchingDraft: ReviewDraftSummary | undefined;
	reviewChainId: string | null;
	enabled?: boolean;
}

export function useReviewAgentActions({
	prCtx,
	matchingDraft,
	reviewChainId,
	enabled = true,
}: UseReviewAgentActionsOptions) {
	const utils = trpc.useUtils();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const projectsQuery = trpc.projects.getByRepo.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo },
		{ staleTime: 60_000 }
	);

	const handleLaunch = (launchInfo: {
		reviewWorkspaceId?: string | null;
		worktreePath?: string | null;
		launchScript?: string | null;
	}) => {
		void utils.aiReview.getReviewDrafts.invalidate();
		void utils.aiReview.getReviewDraft.invalidate();
		launchReviewTerminal(launchInfo, prCtx, {
			attachTerminal: (input) => attachTerminal.mutate(input),
			writeTerminal: (tabId, data) => window.electron.terminal.write(tabId, data),
		});
	};

	const triggerReview = trpc.aiReview.triggerReview.useMutation({ onSuccess: handleLaunch });
	const triggerFollowUp = trpc.aiReview.triggerFollowUp.useMutation({ onSuccess: handleLaunch });
	const cancelReview = trpc.aiReview.cancelReview.useMutation({
		onSuccess: () => {
			void utils.aiReview.getReviewDrafts.invalidate();
			void utils.aiReview.getReviewDraft.invalidate();
		},
	});

	const isReviewActive =
		matchingDraft?.status === "queued" || matchingDraft?.status === "in_progress";
	const hasExistingReview = Boolean(matchingDraft);
	const label = !hasExistingReview
		? "Start Review"
		: isReviewActive
			? "Restart Review"
			: "Re-review";
	const isPending =
		!enabled ||
		triggerReview.isPending ||
		triggerFollowUp.isPending ||
		cancelReview.isPending ||
		projectsQuery.isFetching;

	const startFreshReview = () => {
		if (!enabled) return;
		const project = projectsQuery.data?.[0];
		if (!project) {
			console.error("[ai-review] Cannot start review: project not found", prCtx.owner, prCtx.repo);
			return;
		}
		triggerReview.mutate({
			provider: prCtx.provider,
			identifier: formatPrIdentifier(prCtx),
			title: prCtx.title,
			author: "",
			sourceBranch: prCtx.sourceBranch,
			targetBranch: prCtx.targetBranch,
			repoPath: project.repoPath,
			projectId: project.id,
		});
	};

	const trigger = async () => {
		if (!enabled) return;
		if (isReviewActive && matchingDraft) {
			await cancelReview.mutateAsync({ draftId: matchingDraft.id });
			startFreshReview();
			return;
		}

		if (hasExistingReview && reviewChainId) {
			triggerFollowUp.mutate({ reviewChainId });
			return;
		}

		startFreshReview();
	};

	return {
		label,
		isReviewActive,
		isPending,
		startedAt: matchingDraft?.createdAt,
		trigger,
		cancel: matchingDraft ? () => cancelReview.mutate({ draftId: matchingDraft.id }) : null,
	};
}
