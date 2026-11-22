import { useEffect, useMemo, useState } from "react";
import type { GitHubPRDetails, PRContext } from "../../../../shared/github-types";
import { isReviewAgentJobActive } from "../../../../shared/review-agent-job";
import type { ReviewPathIdentity } from "../../../../shared/review-path-runtime";
import { observeReviewAgentJob, selectReviewAgentJob } from "../../../lib/review-agent-jobs";
import { useLiveReviewPath, useReviewPath } from "../../../lib/review-path-source";
import { rememberReviewPath } from "../../../lib/review-path-status-cache";
import { useTabStore } from "../../../stores/tab-store";
import { trpc, trpcVanilla } from "../../../trpc/client";
import { useAskAgent } from "../panel/useAskAgent";
import { useReviewAgentJobs } from "../useReviewAgentJob";
import { useCurrentReviewer } from "./useCurrentReviewer";

export function useReviewConnections(
	workspaceId: string,
	prCtx: PRContext,
	details: GitHubPRDetails | undefined,
	fixture: boolean
) {
	const [attachmentError, setAttachmentError] = useState<string>();
	const utils = trpc.useUtils();
	const identity = useMemo<ReviewPathIdentity | undefined>(
		() =>
			details?.headCommitOid && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(details.headCommitOid)
				? {
						workspaceId,
						provider: prCtx.provider,
						owner: prCtx.owner,
						repo: prCtx.repo,
						prNumber: prCtx.number,
						headSha: details.headCommitOid,
					}
				: undefined,
		[workspaceId, prCtx.provider, prCtx.owner, prCtx.repo, prCtx.number, details?.headCommitOid]
	);
	const live = useLiveReviewPath(fixture ? undefined : identity);
	const jobs = useReviewAgentJobs(workspaceId, !fixture);
	const matching = jobs.data?.filter((job) => job.identity.headSha === identity?.headSha) ?? [];
	const job = matching.filter((job) => job.kind === "mapping").at(-1);
	const latestJob = selectReviewAgentJob(matching);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new revision clears errors from the previous action scope.
	useEffect(() => {
		setAttachmentError(undefined);
	}, [identity]);
	useEffect(() => {
		if (live.state.snapshot) rememberReviewPath(live.state.snapshot);
	}, [live.state.snapshot]);
	const terminalId = latestJob?.terminalId;
	useEffect(() => {
		if (terminalId) void utils.reviewExplanation.resolveSnapshot.invalidate({ workspaceId });
	}, [terminalId, workspaceId, utils]);
	const pathSource = useReviewPath(prCtx, details, { fixture, identity });
	const source =
		!fixture && !identity
			? {
					...pathSource,
					unavailableReason: !details
						? "Loading pull request details…"
						: "The provider could not resolve the full PR revision. Refresh this PR or check its connection.",
				}
			: pathSource;
	const jobSource =
		!fixture && job
			? {
					...source,
					starting: job.state === "queued" || job.state === "preparing",
					agentSessionStarted: !!job.terminalId,
					status: isReviewAgentJobActive(job)
						? ("mapping" as const)
						: job.state === "failed"
							? ("failed" as const)
							: source.status,
					unavailableReason: job.error ?? source.unavailableReason,
					stop: () => {
						void trpcVanilla.reviewPath.cancelJob
							.mutate({ workspaceId, jobId: job.id })
							.then(() => jobs.refetch())
							.catch((error) => setAttachmentError(error.message));
					},
					retry: () => {
						void trpcVanilla.reviewPath.startJob
							.mutate({
								identity: job.identity,
								agent: job.agent,
								alsoReview: job.alsoReview ?? false,
								requestId: crypto.randomUUID(),
								retryJobId: job.id,
							})
							.then((next) => {
								observeReviewAgentJob(next, true);
								return jobs.refetch();
							})
							.catch((error) => setAttachmentError(error.message));
					},
				}
			: source;
	const askAgent = useAskAgent(prCtx, { fixture, identity });
	const reviewer = useCurrentReviewer(prCtx, !fixture);
	const openTerminal = latestJob
		? async () => {
				observeReviewAgentJob(latestJob, true);
				useTabStore.getState().revealReviewAgentTab(workspaceId, { jobId: latestJob.id });
			}
		: undefined;
	const terminal = latestJob?.terminalId
		? { workspaceId, tabId: latestJob.terminalId, cwd: latestJob.cwd ?? "" }
		: undefined;
	return {
		source: jobSource,
		askAgent,
		reviewer,
		attachmentError,
		openTerminal,
		terminal,
		job,
	};
}
