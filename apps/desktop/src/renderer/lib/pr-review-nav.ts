import { detectLanguage } from "../../shared/diff-types";
import type { PRContext } from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import { prReviewSessionKey, usePRReviewSessionStore } from "../stores/pr-review-session-store";
import { useTabStore } from "../stores/tab-store";

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
	const sessionKey = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const session = usePRReviewSessionStore.getState();
	session.selectFile(sessionKey, path);
	if (threadId !== undefined) session.selectThread(sessionKey, threadId);
	useTabStore.getState().swapPRReviewFile(workspaceId, prCtx, path, detectLanguage(path));
}
