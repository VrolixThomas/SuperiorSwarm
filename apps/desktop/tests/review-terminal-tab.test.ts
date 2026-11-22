import { beforeEach, expect, test } from "bun:test";
import { openReviewTerminalTab } from "../src/renderer/lib/review-terminal-tab";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import { shouldShowReviewMode, useReviewModeStore } from "../src/renderer/stores/review-mode-store";
import { useTabStore } from "../src/renderer/stores/tab-store";

const prCtx = {
	provider: "github" as const,
	owner: "team",
	repo: "repo",
	number: 42,
	title: "Change",
	sourceBranch: "feature",
	targetBranch: "main",
	repoPath: "/review",
};
const terminal = {
	workspaceId: "review-ws",
	tabId: "review-path:run:1",
	cwd: "/review",
	reviewScopeKey: "current-head",
};
beforeEach(() => {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useTabStore.setState({ activeWorkspaceId: null, workspaceMetadata: {}, sidebarSegment: "repos" });
	useReviewModeStore.setState({
		active: null,
		lastWorkspaceId: null,
		terminals: {},
		view: "changes",
	});
	useTabStore.getState().activateReviewWorkspace("review-ws", "/review", prCtx);
	useReviewModeStore.setState({
		view: "changes",
		overviewOpen: false,
		panel: "threads",
		drawerOpen: true,
	});
	useReviewModeStore.getState().setTerminal(terminal);
});

test("opens the existing agent in one real workspace tab and preserves review state on return", () => {
	expect(openReviewTerminalTab(terminal)).toBe(true);
	expect(openReviewTerminalTab(terminal)).toBe(true);
	const tabs = useTabStore.getState().getTabsByWorkspace("review-ws");
	expect(tabs.filter((tab) => tab.id === terminal.tabId)).toEqual([
		{
			kind: "terminal",
			id: terminal.tabId,
			workspaceId: "review-ws",
			cwd: "/review",
			title: "PR agent #42",
		},
	]);
	const review = useReviewModeStore.getState();
	expect(review.drawerOpen).toBe(false);
	expect(review.view).toBe("terminal");
	expect(review.panel).toBe("threads");
	expect(review.overviewOpen).toBe(false);
	expect(shouldShowReviewMode("prs", "review-ws", review.active, review.view)).toBe(false);
	review.setView("changes");
	expect(shouldShowReviewMode("prs", "review-ws", review.active, "changes")).toBe(true);
	expect(
		useTabStore
			.getState()
			.getTabsByWorkspace("review-ws")
			.some((tab) => tab.id === terminal.tabId)
	).toBe(true);
});

test("rejects stale terminal ownership and late navigation after switching workspaces", () => {
	expect(openReviewTerminalTab({ ...terminal, reviewScopeKey: "old-head" })).toBe(false);
	expect(openReviewTerminalTab({ ...terminal, tabId: "other-terminal" })).toBe(false);
	useTabStore.setState({ activeWorkspaceId: "another-ws" });
	expect(openReviewTerminalTab(terminal)).toBe(false);
	expect(useTabStore.getState().getTabsByWorkspace("review-ws")).toEqual([]);
});
