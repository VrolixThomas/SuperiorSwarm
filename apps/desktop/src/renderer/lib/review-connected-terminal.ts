import type { ReviewPathLaunchResult } from "../../shared/review-path-runtime";
import { type ReviewTerminal, useReviewModeStore } from "../stores/review-mode-store";
import { useTabStore } from "../stores/tab-store";

/** A validated launch may have just prepared the formerly logical workspace. */
export function registerReviewTerminal(terminal: ReviewTerminal): void {
	const review = useReviewModeStore.getState();
	review.setTerminal(terminal);
	const tabs = useTabStore.getState();
	if (
		tabs.activeWorkspaceId === terminal.workspaceId &&
		tabs.sidebarSegment === "prs" &&
		review.active?.workspaceId === terminal.workspaceId &&
		tabs.activeWorkspaceCwd !== terminal.cwd
	) {
		tabs.activateReviewWorkspace(terminal.workspaceId, terminal.cwd, review.active.prCtx);
	}
}

/** Main has already launched the owned PTY. Register it without writing another prompt. */
export async function attachReadingPathTerminal(
	workspaceId: string,
	launch: ReviewPathLaunchResult,
	attach: (input: { workspaceId: string; terminalId: string }) => Promise<unknown>,
	isCurrent: () => boolean = () => true,
	reviewScopeKey?: string
): Promise<boolean> {
	if (
		!isCurrent() ||
		launch.reviewWorkspaceId !== workspaceId ||
		!launch.worktreePath ||
		!launch.terminalId?.startsWith("review-path:")
	)
		return false;
	await attach({ workspaceId, terminalId: launch.terminalId });
	if (!isCurrent()) return false;
	registerReviewTerminal({
		workspaceId,
		tabId: launch.terminalId,
		cwd: launch.worktreePath,
		...(reviewScopeKey ? { reviewScopeKey } : {}),
	});
	return true;
}
