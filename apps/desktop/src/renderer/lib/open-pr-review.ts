import type { PRContext } from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import { useTabStore } from "../stores/tab-store";

export interface OpenPRReviewInput {
	projectId: string;
	prCtx: PRContext;
}
interface ReviewWorkspaceRequest {
	projectId: string;
	prProvider: PRContext["provider"];
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
}

/** Shared sidebar/queue flow: create or reuse the review worktree before activating it. */
export async function openPRReview(
	{ projectId, prCtx }: OpenPRReviewInput,
	getOrCreateReview: (
		input: ReviewWorkspaceRequest
	) => Promise<{ id: string; worktreePath: string | null }>
) {
	const workspace = await getOrCreateReview({
		projectId,
		prProvider: prCtx.provider,
		prIdentifier: formatPrIdentifier(prCtx),
		prTitle: prCtx.title,
		sourceBranch: prCtx.sourceBranch,
		targetBranch: prCtx.targetBranch,
	});
	const cwd = workspace.worktreePath ?? prCtx.repoPath;
	useTabStore.getState().activateReviewWorkspace(workspace.id, cwd, { ...prCtx, repoPath: cwd });
	return workspace;
}
