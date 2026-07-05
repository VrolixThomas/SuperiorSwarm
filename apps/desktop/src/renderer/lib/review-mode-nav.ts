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
	const reviewMode = useReviewModeStore.getState();
	session.selectFile(sessionKey, path);
	session.selectThread(sessionKey, threadId ?? null);
	if (
		!reviewMode.active ||
		reviewMode.active.workspaceId !== workspaceId ||
		formatPrIdentifier(reviewMode.active.prCtx) !== formatPrIdentifier(prCtx)
	) {
		reviewMode.open(workspaceId, prCtx);
	}
	useReviewModeStore.getState().setView("changes");
}
