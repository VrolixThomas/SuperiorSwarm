import { isReviewAgentJobActive } from "../../shared/review-agent-job";
import type { CachedPR } from "../../shared/review-types";
import type { AutoReviewLedger } from "../ai-review/auto-trigger";
import {
	getReviewDraft,
	getReviewDrafts,
	getSettings as getReviewSettings,
} from "../ai-review/orchestrator";
import { getOrCreateReviewRecord } from "../ai-review/review-workspace-preparation";
import { createAutoMapper } from "./auto-map";
import { initializeReviewPathRuntime } from "./runtime";

let mapper: ReturnType<typeof createAutoMapper> | undefined;
export async function maybeAutoMap(pr: CachedPR, ledger: AutoReviewLedger): Promise<boolean> {
	const { getReviewPathApplication, getReviewPathStorage } = await import("./service");
	await initializeReviewPathRuntime();
	if (!mapper)
		mapper = createAutoMapper({
			getSettings: () => getReviewPathStorage().getSettings(),
			resolveHead: async (pr) => {
				const { resolveCapturedPRHeadOid } = await import("../atlassian/bitbucket");
				return resolveCapturedPRHeadOid(pr.repoOwner, pr.repoName, pr.number, pr.headCommitSha);
			},
			hasReview: (pr) =>
				getReviewDrafts().some(
					(draft) =>
						draft.prProvider === pr.provider &&
						draft.prIdentifier === pr.identifier &&
						(draft.status === "queued" || draft.status === "in_progress")
				),
			wasReviewed: (pr) => ledger.get(pr.provider, pr.identifier).firstTriggeredAt !== null,
			ensureWorkspace: async (pr) =>
				getOrCreateReviewRecord({
					projectId: pr.projectId,
					prProvider: pr.provider,
					prIdentifier: pr.identifier,
					prTitle: pr.title,
					sourceBranch: pr.sourceBranch,
					targetBranch: pr.targetBranch,
				}).id,
			start: async (identity, alsoReview) => {
				const cli = getReviewSettings().cliPreset;
				const application = getReviewPathApplication();
				const previous = application
					.jobs(identity.workspaceId)
					.filter((job) => job.kind === "mapping" && job.identity.headSha === identity.headSha)
					.at(-1);
				const job =
					previous ??
					application.startJob({
						identity,
						agent: { id: cli, label: cli === "codex" ? "Codex" : "Claude Code" },
						alsoReview,
						trigger: "auto",
						requestId: `auto:${identity.headSha}`,
					});
				const draft = job.runId ? getReviewDraft(`reading-path-${job.runId}`) : undefined;
				const reviewIncluded =
					!!draft &&
					draft.prProvider === identity.provider &&
					draft.prIdentifier === `${identity.owner}/${identity.repo}#${identity.prNumber}` &&
					draft.commitSha === identity.headSha &&
					["in_progress", "ready", "submitted"].includes(draft.status);
				return {
					claimed: !previous,
					reviewIncluded,
					// Suppress the legacy launcher while the accepted job prepares. Only
					// an actual scoped draft above marks the review ledger as triggered.
					reviewQueued: Boolean(job.alsoReview && isReviewAgentJobActive(job)),
				};
			},
			markReviewed: (pr) => ledger.markFirstTriggered(pr.provider, pr.identifier),
		});
	return mapper(pr);
}
