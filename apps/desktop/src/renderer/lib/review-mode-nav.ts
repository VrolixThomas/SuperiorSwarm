import type { PRContext } from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import { prReviewSessionKey, usePRReviewSessionStore } from "../stores/pr-review-session-store";
import { useReviewModeStore } from "../stores/review-mode-store";

/** Open a file, optionally focused on a thread, in the review-mode Changes view. */
export function openThreadInChanges(
	workspaceId: string,
	prCtx: PRContext,
	path: string,
	threadId?: string
): void {
	const sessionKey = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const session = usePRReviewSessionStore.getState();
	session.selectFile(sessionKey, path);
	if (threadId !== undefined) session.selectThread(sessionKey, threadId);
	useReviewModeStore.getState().setView("changes");
}
