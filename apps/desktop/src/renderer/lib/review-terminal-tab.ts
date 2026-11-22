import { type ReviewTerminal, useReviewModeStore } from "../stores/review-mode-store";
import { useTabStore } from "../stores/tab-store";

/** Reveal the existing agent session in the workspace; never launch a second PTY. */
export function openReviewTerminalTab(terminal: ReviewTerminal): boolean {
	const review = useReviewModeStore.getState();
	const tabs = useTabStore.getState();
	const recorded = review.terminals[terminal.workspaceId];
	if (
		review.active?.workspaceId !== terminal.workspaceId ||
		tabs.activeWorkspaceId !== terminal.workspaceId ||
		tabs.sidebarSegment !== "prs" ||
		recorded?.tabId !== terminal.tabId ||
		recorded.cwd !== terminal.cwd ||
		recorded.reviewScopeKey !== terminal.reviewScopeKey
	)
		return false;
	const existing = tabs.getAllTabs().find((tab) => tab.id === terminal.tabId);
	if (
		existing &&
		(existing.kind !== "terminal" ||
			existing.workspaceId !== terminal.workspaceId ||
			existing.cwd !== terminal.cwd)
	)
		return false;
	tabs.addTerminalTab(
		terminal.workspaceId,
		terminal.cwd,
		`PR agent #${review.active.prCtx.number}`,
		terminal.tabId
	);
	review.setDrawerOpen(false);
	review.setView("terminal");
	return true;
}
