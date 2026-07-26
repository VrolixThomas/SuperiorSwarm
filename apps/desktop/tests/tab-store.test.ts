import { beforeEach, describe, expect, mock, test } from "bun:test";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import { shouldShowReviewMode, useReviewModeStore } from "../src/renderer/stores/review-mode-store";
import {
	PANEL_CLOSED,
	type RightPanelState,
	diffContextsEqual,
	useTabStore,
} from "../src/renderer/stores/tab-store";
import type { DiffContext } from "../src/shared/diff-types";

mock.module("monaco-editor", () => ({
	languages: {
		registerCompletionItemProvider: () => ({ dispose: () => {} }),
		registerHoverProvider: () => ({ dispose: () => {} }),
		registerDefinitionProvider: () => ({ dispose: () => {} }),
		registerReferenceProvider: () => ({ dispose: () => {} }),
	},
	editor: {
		registerEditorOpener: () => ({ dispose: () => {} }),
		getModel: () => null,
		setModelMarkers: () => {},
	},
	Uri: {
		parse: (value: string) => value,
	},
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const workingTreeCtx: DiffContext = { type: "working-tree", repoPath: "/repo" };

const branchCtxA: DiffContext = {
	type: "branch",
	repoPath: "/repo",
	baseBranch: "main",
	headBranch: "feature-a",
};

const branchCtxB: DiffContext = {
	type: "branch",
	repoPath: "/repo",
	baseBranch: "main",
	headBranch: "feature-b",
};

const prCtxA: DiffContext = {
	type: "pr",
	repoPath: "",
	prId: 1,
	workspaceSlug: "ws",
	repoSlug: "repo",
	title: "PR 1",
	sourceBranch: "feat",
	targetBranch: "main",
};

const prCtxB: DiffContext = {
	type: "pr",
	repoPath: "",
	prId: 2,
	workspaceSlug: "ws",
	repoSlug: "repo",
	title: "PR 2",
	sourceBranch: "fix",
	targetBranch: "main",
};

function assertPanelOpen(
	panel: RightPanelState
): asserts panel is Extract<RightPanelState, { open: true }> {
	expect(panel.open).toBe(true);
}

function resetStore() {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useReviewModeStore.setState({
		active: null,
		view: "overview",
		navigatorCollapsed: false,
		drawerOpen: false,
		drawerHeight: 300,
		terminals: {},
		commentFilter: "all",
		intent: null,
	});
	useTabStore.setState({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		diffMode: "split",
		markdownPreviewMode: "off",
		rightPanel: PANEL_CLOSED,
		workspaceMetadata: {},
		workspaceBackStack: [],
		workspaceForwardStack: [],
		pendingWorkspaceHistoryEntry: null,
		sidebarSegment: "repos",
		activeWorkspaceBySegment: { repos: null, tickets: null, prs: null },
		activeTicketProject: "all",
		selectedTicketId: null,
		ticketDetailOpen: false,
	});
}

/** Get all tabs for a workspace from pane-store. */
function getTabsForWorkspace(workspaceId: string) {
	return useTabStore.getState().getTabsByWorkspace(workspaceId);
}

/** Get the active tab ID (from pane-store via tab-store). */
function getActiveTabId() {
	return useTabStore.getState().getActiveTabId();
}

// ── diffContextsEqual ────────────────────────────────────────────────────────

describe("diffContextsEqual", () => {
	test("working-tree contexts with same repoPath are equal", () => {
		const a: DiffContext = { type: "working-tree", repoPath: "/repo" };
		const b: DiffContext = { type: "working-tree", repoPath: "/repo" };
		expect(diffContextsEqual(a, b)).toBe(true);
	});

	test("working-tree contexts with different repoPath are not equal", () => {
		const a: DiffContext = { type: "working-tree", repoPath: "/repo-a" };
		const b: DiffContext = { type: "working-tree", repoPath: "/repo-b" };
		expect(diffContextsEqual(a, b)).toBe(false);
	});

	test("different types are not equal", () => {
		expect(diffContextsEqual(workingTreeCtx, branchCtxA)).toBe(false);
	});

	test("branch contexts with same branches are equal", () => {
		expect(diffContextsEqual(branchCtxA, { ...branchCtxA })).toBe(true);
	});

	test("branch contexts with different headBranch are not equal", () => {
		expect(diffContextsEqual(branchCtxA, branchCtxB)).toBe(false);
	});

	test("pr contexts with same prId are equal", () => {
		expect(diffContextsEqual(prCtxA, { ...prCtxA })).toBe(true);
	});

	test("pr contexts with different prId are not equal", () => {
		expect(diffContextsEqual(prCtxA, prCtxB)).toBe(false);
	});

	test("commit: true when same commitHash and repoPath", () => {
		const a: DiffContext = { type: "commit", repoPath: "/repo", commitHash: "aaaaaaa" };
		const b: DiffContext = { type: "commit", repoPath: "/repo", commitHash: "aaaaaaa" };
		expect(diffContextsEqual(a, b)).toBe(true);
	});

	test("commit: false when commitHash differs", () => {
		const a: DiffContext = { type: "commit", repoPath: "/repo", commitHash: "aaaaaaa" };
		const b: DiffContext = { type: "commit", repoPath: "/repo", commitHash: "bbbbbbb" };
		expect(diffContextsEqual(a, b)).toBe(false);
	});
});

// ── toggleDiffPanel ──────────────────────────────────────────────────────────

describe("toggleDiffPanel", () => {
	beforeEach(resetStore);

	test("opens panel when closed", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("diff");
		expect(rightPanel.diffCtx).toEqual(workingTreeCtx);
	});

	test("closes panel when toggling same context", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		const { rightPanel } = useTabStore.getState();
		expect(rightPanel.open).toBe(false);
	});

	test("switches context when toggling different context", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().toggleDiffPanel(branchCtxA);
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.diffCtx).toEqual(branchCtxA);
	});

	test("switches to different PR instead of closing", () => {
		useTabStore.getState().toggleDiffPanel(prCtxA);
		useTabStore.getState().toggleDiffPanel(prCtxB);
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.diffCtx).toEqual(prCtxB);
	});

	test("closes same PR when toggling again", () => {
		useTabStore.getState().toggleDiffPanel(prCtxA);
		useTabStore.getState().toggleDiffPanel(prCtxA);
		const { rightPanel } = useTabStore.getState();
		expect(rightPanel.open).toBe(false);
	});

	test("switches to different branch instead of closing", () => {
		useTabStore.getState().toggleDiffPanel(branchCtxA);
		useTabStore.getState().toggleDiffPanel(branchCtxB);
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.diffCtx).toEqual(branchCtxB);
	});

	test("switches from explorer mode to diff when toggling diff panel", () => {
		useTabStore.getState().openExplorer();
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("diff");
		expect(rightPanel.diffCtx).toEqual(workingTreeCtx);
	});
});

// ── closeDiffPanel ───────────────────────────────────────────────────────────

describe("closeDiffPanel", () => {
	beforeEach(resetStore);

	test("closes an open panel", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().closeDiffPanel();
		const { rightPanel } = useTabStore.getState();
		expect(rightPanel).toEqual(PANEL_CLOSED);
	});

	test("is a no-op when already closed", () => {
		useTabStore.getState().closeDiffPanel();
		const { rightPanel } = useTabStore.getState();
		expect(rightPanel).toEqual(PANEL_CLOSED);
	});
});

// ── setActiveWorkspace opens panel for new cwd ──────────────────────────────

describe("setActiveWorkspace", () => {
	beforeEach(resetStore);

	test("opens the diff panel with working-tree context for the new cwd", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().setActiveWorkspace("ws-1", "/path");
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("diff");
		expect(rightPanel.diffCtx).toEqual({ type: "working-tree", repoPath: "/path" });
	});

	test("opens the diff panel with null diffCtx when cwd is empty", () => {
		useTabStore.getState().setActiveWorkspace("ws-1", "");
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("diff");
		expect(rightPanel.diffCtx).toBeNull();
	});
});

// ── workspace history ───────────────────────────────────────────────────────

describe("workspace history", () => {
	beforeEach(resetStore);

	test("goes back and forward through previously active workspaces", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-a", "/repo/a");
		store.setActiveWorkspace("ws-b", "/repo/b");
		store.setActiveWorkspace("ws-c", "/repo/c");

		expect(useTabStore.getState().canGoBackWorkspace()).toBe(true);
		expect(useTabStore.getState().canGoForwardWorkspace()).toBe(false);

		expect(useTabStore.getState().goBackWorkspace()).toBe(true);
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-b");
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("/repo/b");

		expect(useTabStore.getState().goBackWorkspace()).toBe(true);
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-a");
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("/repo/a");
		expect(useTabStore.getState().canGoBackWorkspace()).toBe(false);
		expect(useTabStore.getState().canGoForwardWorkspace()).toBe(true);

		expect(useTabStore.getState().goForwardWorkspace()).toBe(true);
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-b");
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("/repo/b");
	});

	test("clears forward history after a new manual workspace selection", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-a", "/repo/a");
		store.setActiveWorkspace("ws-b", "/repo/b");
		store.setActiveWorkspace("ws-c", "/repo/c");

		expect(useTabStore.getState().goBackWorkspace()).toBe(true);
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-b");
		expect(useTabStore.getState().canGoForwardWorkspace()).toBe(true);

		useTabStore.getState().setActiveWorkspace("ws-d", "/repo/d");

		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-d");
		expect(useTabStore.getState().canGoForwardWorkspace()).toBe(false);
		expect(useTabStore.getState().goBackWorkspace()).toBe(true);
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-b");
	});

	test("removes cleaned up workspaces from back and forward history", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-a", "/repo/a");
		store.setActiveWorkspace("ws-b", "/repo/b");
		store.setActiveWorkspace("ws-c", "/repo/c");
		store.goBackWorkspace();

		useTabStore.getState().cleanupWorkspace("ws-a");
		useTabStore.getState().cleanupWorkspace("ws-c");

		expect(useTabStore.getState().canGoBackWorkspace()).toBe(false);
		expect(useTabStore.getState().canGoForwardWorkspace()).toBe(false);
	});

	test("preserves back history when navigating through an empty sidebar segment", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-a", "/repo/a");

		store.setSidebarSegment("prs");
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();

		useTabStore.getState().setActiveWorkspace("ws-b", "/repo/b");

		expect(useTabStore.getState().canGoBackWorkspace()).toBe(true);
		expect(useTabStore.getState().goBackWorkspace()).toBe(true);
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-a");
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("/repo/a");
	});
});

// ── closeDiff closes panel when repoPath matches ─────────────────────────────

describe("closeDiff", () => {
	beforeEach(resetStore);

	test("closes panel when repoPath matches", () => {
		const { toggleDiffPanel, addTerminalTab, closeDiff } = useTabStore.getState();
		useTabStore.getState().setActiveWorkspace("ws-1", "/repo");
		addTerminalTab("ws-1", "/repo");
		toggleDiffPanel(workingTreeCtx);
		closeDiff("ws-1", "/repo");
		const { rightPanel } = useTabStore.getState();
		expect(rightPanel).toEqual(PANEL_CLOSED);
	});

	test("does not close panel when repoPath differs", () => {
		const { toggleDiffPanel, closeDiff } = useTabStore.getState();
		toggleDiffPanel(workingTreeCtx);
		closeDiff("ws-1", "/other-repo");
		const { rightPanel } = useTabStore.getState();
		expect(rightPanel.open).toBe(true);
	});

	test("removes diff-file tabs for matching workspace and repoPath", () => {
		const { openDiffFile, closeDiff, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");
		openDiffFile("ws-1", workingTreeCtx, "src/main.ts", "typescript");
		openDiffFile("ws-1", workingTreeCtx, "src/util.ts", "typescript");

		expect(getTabsForWorkspace("ws-1")).toHaveLength(2);

		closeDiff("ws-1", "/repo");
		expect(getTabsForWorkspace("ws-1")).toHaveLength(0);
	});

	test("does not remove diff-file tabs for non-matching workspace", () => {
		const { openDiffFile, closeDiff, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");
		openDiffFile("ws-1", workingTreeCtx, "src/main.ts", "typescript");

		closeDiff("ws-2", "/repo");
		expect(getTabsForWorkspace("ws-1")).toHaveLength(1);
	});
});

// ── openExplorer ─────────────────────────────────────────────────────────────

describe("openExplorer", () => {
	beforeEach(resetStore);

	test("opens panel in explorer mode", () => {
		useTabStore.getState().openExplorer();
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("explorer");
		expect(rightPanel.diffCtx).toBeNull();
	});

	test("toggles closed when already in explorer mode", () => {
		useTabStore.getState().openExplorer();
		useTabStore.getState().openExplorer();
		const { rightPanel } = useTabStore.getState();
		expect(rightPanel.open).toBe(false);
	});

	test("preserves diffCtx when switching from diff to explorer", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().openExplorer();
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("explorer");
		expect(rightPanel.diffCtx).toEqual(workingTreeCtx);
	});
});

// ── togglePanelMode ──────────────────────────────────────────────────────────

describe("togglePanelMode", () => {
	beforeEach(resetStore);

	test("switches from explorer to diff when diffCtx exists", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().openExplorer();
		useTabStore.getState().togglePanelMode();
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("diff");
	});

	test("does not switch to diff when no diffCtx", () => {
		useTabStore.getState().openExplorer();
		useTabStore.getState().togglePanelMode();
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("explorer");
	});

	test("switches from diff to explorer", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().togglePanelMode();
		const { rightPanel } = useTabStore.getState();
		assertPanelOpen(rightPanel);
		expect(rightPanel.mode).toBe("explorer");
	});
});

// ── openFile ─────────────────────────────────────────────────────────────────

describe("openFile", () => {
	beforeEach(resetStore);

	test("opens a new file tab", () => {
		const { openFile, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");
		const id = openFile("ws-1", "/repo", "src/main.ts", "typescript");
		const tabs = getTabsForWorkspace("ws-1");
		const activeTabId = getActiveTabId();
		expect(tabs).toHaveLength(1);
		expect(activeTabId).toBe(id);
		const tab = tabs[0];
		expect(tab?.kind).toBe("file");
		if (tab?.kind === "file") {
			expect(tab.filePath).toBe("src/main.ts");
			expect(tab.repoPath).toBe("/repo");
		}
	});

	test("deduplicates by repoPath + filePath", () => {
		const { openFile, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");
		const id1 = openFile("ws-1", "/repo", "src/main.ts", "typescript");
		const id2 = openFile("ws-1", "/repo", "src/main.ts", "typescript");
		expect(id1).toBe(id2);
		expect(getTabsForWorkspace("ws-1")).toHaveLength(1);
	});

	test("opens different files as separate tabs", () => {
		const { openFile, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");
		openFile("ws-1", "/repo", "src/main.ts", "typescript");
		openFile("ws-1", "/repo", "src/util.ts", "typescript");
		expect(getTabsForWorkspace("ws-1")).toHaveLength(2);
	});

	test("updates initialPosition on existing tab", () => {
		const { openFile, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");
		openFile("ws-1", "/repo", "src/main.ts", "typescript");
		openFile("ws-1", "/repo", "src/main.ts", "typescript", { lineNumber: 10, column: 5 });
		const tabs = getTabsForWorkspace("ws-1");
		const tab = tabs[0];
		if (tab?.kind === "file") {
			expect(tab.initialPosition).toEqual({ lineNumber: 10, column: 5 });
		}
	});
});

// ── addTerminalTab ───────────────────────────────────────────────────────────

describe("addTerminalTab", () => {
	beforeEach(resetStore);

	test("adds a terminal tab to the focused pane", () => {
		useTabStore.getState().setActiveWorkspace("ws-1", "/repo");
		const id = useTabStore.getState().addTerminalTab("ws-1", "/repo");
		const tabs = getTabsForWorkspace("ws-1");
		expect(tabs).toHaveLength(1);
		expect(tabs[0]?.kind).toBe("terminal");
		expect(tabs[0]?.id).toBe(id);
	});

	test("sets the new tab as active", () => {
		useTabStore.getState().setActiveWorkspace("ws-1", "/repo");
		const id = useTabStore.getState().addTerminalTab("ws-1", "/repo");
		expect(getActiveTabId()).toBe(id);
	});

	test("uses a main-process terminal ID and deduplicates a replayed dispatch", () => {
		useTabStore.getState().setActiveWorkspace("ws-1", "/repo");
		const first = useTabStore
			.getState()
			.addTerminalTab("ws-1", "/repo", "Agent session", "agent-terminal-1");
		const second = useTabStore
			.getState()
			.addTerminalTab("ws-1", "/repo", "Agent session", "agent-terminal-1");

		expect(first).toBe("agent-terminal-1");
		expect(second).toBe(first);
		expect(getTabsForWorkspace("ws-1")).toHaveLength(1);
		expect(getActiveTabId()).toBe(first);
	});
});

// ── review workspace activation ──────────────────────────────────────────────

describe("review workspace activation", () => {
	beforeEach(resetStore);

	test("setActiveWorkspace with review type opens Review Mode in the main panel", () => {
		const store = useTabStore.getState();
		// Store workspace metadata first
		store.setWorkspaceMetadata("ws-review-1", {
			type: "review",
			prProvider: "github",
			prIdentifier: "owner/repo#16",
			prTitle: "Create Claude.md",
			sourceBranch: "patch-testreview",
			targetBranch: "main",
		});

		store.setActiveWorkspace("ws-review-1", "/path/to/worktree");

		const state = useTabStore.getState();
		expect(state.rightPanel).toEqual(PANEL_CLOSED);
		expect(useReviewModeStore.getState().active).toEqual({
			workspaceId: "ws-review-1",
			prCtx: {
				provider: "github",
				owner: "owner",
				repo: "repo",
				number: 16,
				title: "Create Claude.md",
				sourceBranch: "patch-testreview",
				targetBranch: "main",
				repoPath: "/path/to/worktree",
			},
		});
	});

	test("activateReviewWorkspace registers metadata before selecting the PR segment", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-project", "/path/to/project");

		store.activateReviewWorkspace("ws-review-1", "/path/to/review", {
			provider: "github",
			owner: "owner",
			repo: "repo",
			number: 16,
			title: "Create Claude.md",
			sourceBranch: "patch-testreview",
			targetBranch: "main",
			repoPath: "/path/to/project",
		});

		const state = useTabStore.getState();
		expect(state.sidebarSegment).toBe("prs");
		expect(state.activeWorkspaceId).toBe("ws-review-1");
		expect(state.activeWorkspaceBySegment.repos).toEqual({
			id: "ws-project",
			cwd: "/path/to/project",
		});
		expect(state.activeWorkspaceBySegment.prs).toEqual({
			id: "ws-review-1",
			cwd: "/path/to/review",
		});
		expect(state.workspaceMetadata["ws-review-1"]?.type).toBe("review");
		expect(state.rightPanel).toEqual(PANEL_CLOSED);
		expect(
			shouldShowReviewMode(
				state.sidebarSegment,
				state.activeWorkspaceId,
				useReviewModeStore.getState().active
			)
		).toBe(true);
	});

	test("legacy PR panel opener uses the same PR-segment activation transition", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-project", "/path/to/project");

		store.openPRReviewPanel("ws-review-legacy", {
			provider: "github",
			owner: "owner",
			repo: "repo",
			number: 17,
			title: "Legacy opener",
			sourceBranch: "legacy-review",
			targetBranch: "main",
			repoPath: "/path/to/legacy-review",
		});

		const state = useTabStore.getState();
		expect(state.sidebarSegment).toBe("prs");
		expect(state.activeWorkspaceId).toBe("ws-review-legacy");
		expect(state.activeWorkspaceBySegment.prs).toEqual({
			id: "ws-review-legacy",
			cwd: "/path/to/legacy-review",
		});
		expect(state.workspaceMetadata["ws-review-legacy"]?.type).toBe("review");
		expect(useReviewModeStore.getState().active?.prCtx.number).toBe(17);
	});

	test("setActiveWorkspace with non-review type uses default diff panel", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-branch-1", "/path/to/repo");

		const state = useTabStore.getState();
		assertPanelOpen(state.rightPanel);
		expect(state.rightPanel.mode).not.toBe("pr-review");
	});

	test("switching Projects, Tickets, and PRs restores each segment without leaking Review Mode", () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("ws-project", "/path/to/project");
		store.setWorkspaceMetadata("ws-review-1", {
			type: "review",
			prProvider: "github",
			prIdentifier: "owner/repo#16",
			prTitle: "Create Claude.md",
			sourceBranch: "patch-testreview",
			targetBranch: "main",
		});
		store.setSidebarSegment("prs");
		store.setActiveWorkspace("ws-review-1", "/path/to/review");

		let state = useTabStore.getState();
		expect(
			shouldShowReviewMode(
				state.sidebarSegment,
				state.activeWorkspaceId,
				useReviewModeStore.getState().active
			)
		).toBe(true);

		store.setSidebarSegment("tickets");
		state = useTabStore.getState();
		expect(state.activeWorkspaceId).toBeNull();
		expect(
			shouldShowReviewMode(
				state.sidebarSegment,
				state.activeWorkspaceId,
				useReviewModeStore.getState().active
			)
		).toBe(false);

		store.setSidebarSegment("repos");
		state = useTabStore.getState();
		expect(state.activeWorkspaceId).toBe("ws-project");
		expect(
			shouldShowReviewMode(
				state.sidebarSegment,
				state.activeWorkspaceId,
				useReviewModeStore.getState().active
			)
		).toBe(false);

		store.setSidebarSegment("prs");
		state = useTabStore.getState();
		expect(state.activeWorkspaceId).toBe("ws-review-1");
		expect(
			shouldShowReviewMode(
				state.sidebarSegment,
				state.activeWorkspaceId,
				useReviewModeStore.getState().active
			)
		).toBe(true);
	});
});

// ── hydrate ──────────────────────────────────────────────────────────────────

describe("hydrate", () => {
	beforeEach(resetStore);

	test("restores sessions into pane-store", () => {
		useTabStore.getState().hydrate(
			[
				{ id: "terminal-1", workspaceId: "ws-1", title: "T1", cwd: "/repo" },
				{ id: "terminal-2", workspaceId: "ws-1", title: "T2", cwd: "/repo" },
			],
			"terminal-1",
			"ws-1",
			"/repo"
		);
		const tabs = getTabsForWorkspace("ws-1");
		expect(tabs).toHaveLength(2);
		expect(getActiveTabId()).toBe("terminal-1");
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-1");
	});

	test("reopens Review Mode for a persisted active PR workspace", () => {
		const workspaceMetadata = {
			"ws-review-1": {
				type: "review",
				prProvider: "github",
				prIdentifier: "owner/repo#16",
				prTitle: "Create Claude.md",
				sourceBranch: "patch-testreview",
				targetBranch: "main",
			},
		};
		const activeWorkspaceBySegment = {
			repos: null,
			tickets: null,
			prs: { id: "ws-review-1", cwd: "/path/to/review" },
		};

		useTabStore.getState().hydrate(
			[
				{
					id: "terminal-review",
					workspaceId: "ws-review-1",
					title: "Review",
					cwd: "/path/to/review",
				},
			],
			"terminal-review",
			"ws-review-1",
			"/path/to/review",
			{
				sidebarSegment: "prs",
				workspaceMetadata: JSON.stringify(workspaceMetadata),
				activeWorkspaceBySegment: JSON.stringify(activeWorkspaceBySegment),
			}
		);

		const state = useTabStore.getState();
		expect(state.rightPanel).toEqual(PANEL_CLOSED);
		expect(useReviewModeStore.getState().active).toEqual({
			workspaceId: "ws-review-1",
			prCtx: {
				provider: "github",
				owner: "owner",
				repo: "repo",
				number: 16,
				title: "Create Claude.md",
				sourceBranch: "patch-testreview",
				targetBranch: "main",
				repoPath: "/path/to/review",
			},
		});
		expect(
			shouldShowReviewMode(
				state.sidebarSegment,
				state.activeWorkspaceId,
				useReviewModeStore.getState().active
			)
		).toBe(true);
	});
});

// ── ticket canvas state ───────────────────────────────────────────────────────

describe("ticket canvas state", () => {
	beforeEach(resetStore);

	test("initial state has activeTicketProject 'all'", () => {
		const state = useTabStore.getState();
		expect(state.activeTicketProject).toBe("all");
		expect(state.selectedTicketId).toBe(null);
		expect(state.ticketDetailOpen).toBe(false);
	});

	test("setActiveTicketProject changes project and resets detail", () => {
		const store = useTabStore.getState();
		store.setSelectedTicket("issue-1");
		expect(useTabStore.getState().ticketDetailOpen).toBe(true);

		store.setActiveTicketProject({ id: "PI", provider: "jira" });
		const state = useTabStore.getState();
		expect(state.activeTicketProject).toEqual({ id: "PI", provider: "jira" });
		expect(state.selectedTicketId).toBe(null);
		expect(state.ticketDetailOpen).toBe(false);
	});

	test("setSelectedTicket opens detail panel", () => {
		useTabStore.getState().setSelectedTicket("issue-abc");
		const state = useTabStore.getState();
		expect(state.selectedTicketId).toBe("issue-abc");
		expect(state.ticketDetailOpen).toBe(true);
	});

	test("setSelectedTicket(null) closes detail panel", () => {
		useTabStore.getState().setSelectedTicket("issue-abc");
		useTabStore.getState().setSelectedTicket(null);
		const state = useTabStore.getState();
		expect(state.selectedTicketId).toBe(null);
		expect(state.ticketDetailOpen).toBe(false);
	});

	test("closeTicketDetail clears selection", () => {
		useTabStore.getState().setSelectedTicket("issue-abc");
		useTabStore.getState().closeTicketDetail();
		const state = useTabStore.getState();
		expect(state.selectedTicketId).toBe(null);
		expect(state.ticketDetailOpen).toBe(false);
	});
});

// ── markdownPreviewMode ──────────────────────────────────────────────────────

describe("markdownPreviewMode", () => {
	beforeEach(resetStore);

	test("defaults to 'off'", () => {
		expect(useTabStore.getState().markdownPreviewMode).toBe("off");
	});

	test("setMarkdownPreviewMode sets 'split'", () => {
		useTabStore.getState().setMarkdownPreviewMode("split");
		expect(useTabStore.getState().markdownPreviewMode).toBe("split");
	});

	test("setMarkdownPreviewMode sets 'rendered'", () => {
		useTabStore.getState().setMarkdownPreviewMode("rendered");
		expect(useTabStore.getState().markdownPreviewMode).toBe("rendered");
	});

	test("setMarkdownPreviewMode resets to 'off'", () => {
		useTabStore.getState().setMarkdownPreviewMode("rendered");
		useTabStore.getState().setMarkdownPreviewMode("off");
		expect(useTabStore.getState().markdownPreviewMode).toBe("off");
	});
});

describe("openDiffFile with commit contexts", () => {
	beforeEach(resetStore);

	test("same file from two different commits opens two tabs", () => {
		const { openDiffFile, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");

		const ctxA: DiffContext = { type: "commit", repoPath: "/repo", commitHash: "aaaaaaa" };
		const ctxB: DiffContext = { type: "commit", repoPath: "/repo", commitHash: "bbbbbbb" };

		openDiffFile("ws-1", ctxA, "src/main.ts", "typescript");
		openDiffFile("ws-1", ctxB, "src/main.ts", "typescript");

		expect(getTabsForWorkspace("ws-1")).toHaveLength(2);
	});

	test("same file, same commit dedups to a single tab", () => {
		const { openDiffFile, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");

		const ctx: DiffContext = { type: "commit", repoPath: "/repo", commitHash: "aaaaaaa" };

		openDiffFile("ws-1", ctx, "src/main.ts", "typescript");
		openDiffFile("ws-1", ctx, "src/main.ts", "typescript");

		expect(getTabsForWorkspace("ws-1")).toHaveLength(1);
	});

	test("commit tab is distinct from working-tree tab for same file", () => {
		const { openDiffFile, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");

		const wt: DiffContext = { type: "working-tree", repoPath: "/repo" };
		const commit: DiffContext = {
			type: "commit",
			repoPath: "/repo",
			commitHash: "aaaaaaa",
		};

		openDiffFile("ws-1", wt, "src/main.ts", "typescript");
		openDiffFile("ws-1", commit, "src/main.ts", "typescript");

		expect(getTabsForWorkspace("ws-1")).toHaveLength(2);
	});
});
