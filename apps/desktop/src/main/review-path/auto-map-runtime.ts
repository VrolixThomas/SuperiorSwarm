import { and, eq } from "drizzle-orm";
import type { CachedPR } from "../../shared/review-types";
import type { AutoReviewLedger } from "../ai-review/auto-trigger";
import { getReviewDrafts, getSettings as getReviewSettings } from "../ai-review/orchestrator";
import { ensureReviewWorkspace } from "../ai-review/review-workspace";
import { getDb } from "../db";
import { workspaces } from "../db/schema";
import { createAutoMapper } from "./auto-map";
import { initializeReviewPathRuntime } from "./runtime";

let mapper: ReturnType<typeof createAutoMapper> | undefined;
export async function maybeAutoMap(pr: CachedPR, ledger: AutoReviewLedger): Promise<boolean> {
	const { getReviewPathApplication, getReviewPathStorage } = await import("./service");
	await initializeReviewPathRuntime();
	if (!mapper)
		mapper = createAutoMapper({
			getSettings: () => getReviewPathStorage().getSettings(),
			hasReview: (pr) =>
				getReviewDrafts().some(
					(draft) =>
						draft.prProvider === pr.provider &&
						draft.prIdentifier === pr.identifier &&
						(draft.status === "queued" || draft.status === "in_progress")
				),
			wasReviewed: (pr) => ledger.get(pr.provider, pr.identifier).firstTriggeredAt !== null,
			ensureWorkspace: async (pr) => {
				const db = getDb();
				const existing = db
					.select()
					.from(workspaces)
					.where(
						and(
							eq(workspaces.projectId, pr.projectId),
							eq(workspaces.prProvider, pr.provider),
							eq(workspaces.prIdentifier, pr.identifier)
						)
					)
					.get();
				// Never reset a worktree hosting an existing agent. Runtime checks immutable object availability.
				if (existing?.worktreeId) return existing.id;
				return (
					await ensureReviewWorkspace({
						projectId: pr.projectId,
						prProvider: pr.provider,
						prIdentifier: pr.identifier,
						prTitle: pr.title,
						sourceBranch: pr.sourceBranch,
						targetBranch: pr.targetBranch,
					})
				).workspaceId;
			},
			start: async (identity, alsoReview) => {
				const cli = getReviewSettings().cliPreset;
				const result = await getReviewPathApplication().start({
					identity,
					agent: { id: cli, label: cli === "codex" ? "Codex" : "Claude Code" },
					alsoReview,
					auto: true,
				});
				return { claimed: !!result.launch };
			},
			markReviewed: (pr) => ledger.markFirstTriggered(pr.provider, pr.identifier),
		});
	return mapper(pr);
}
