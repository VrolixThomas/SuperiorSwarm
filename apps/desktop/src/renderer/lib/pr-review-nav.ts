import type { PRContext } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { openThreadInChanges } from "./review-mode-nav";

/**
 * Select a file (and optionally a thread) in the PR review session, then swap
 * the shared pr-review-file tab to that file. The single helper used by every
 * "open this file in review" affordance (sidebar rows, comment cards, etc).
 */
export function navigateToReviewFile(
	workspaceId: string,
	prCtx: PRContext,
	path: string,
	threadId?: string
): void {
	useTabStore.getState().activateReviewWorkspace(workspaceId, prCtx.repoPath, prCtx);
	openThreadInChanges(workspaceId, prCtx, path, threadId);
}
