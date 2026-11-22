import type { ReviewFetchProgress } from "../../shared/review-fetch-progress";
import { reviewWorkspacePreparer } from "./review-workspace-preparation";

/** Reuse existing review files; prepare missing worktrees from verified immutable commits. */
export async function ensureReviewWorkspace(opts: {
	projectId: string;
	prProvider: string;
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	signal?: AbortSignal;
	expectedHeadOid?: string;
	onPhase?: (phase: "metadata" | "fetching" | "worktree") => void;
	onFetchProgress?: (progress: ReviewFetchProgress) => void;
}): Promise<{ workspaceId: string; worktreePath: string }> {
	if (opts.prProvider !== "github" && opts.prProvider !== "bitbucket")
		throw new Error("Review provider is unsupported");
	const workspace = await reviewWorkspacePreparer.open(
		{ ...opts, prProvider: opts.prProvider },
		{
			signal: opts.signal,
			expectedHeadOid: opts.expectedHeadOid,
			onPhase: opts.onPhase,
			onFetchProgress: opts.onFetchProgress,
		}
	);
	return { workspaceId: workspace.id, worktreePath: workspace.worktreePath };
}
