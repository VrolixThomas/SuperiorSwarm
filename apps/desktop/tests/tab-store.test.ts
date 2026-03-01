import { beforeEach, describe, expect, test } from "bun:test";
import { PANEL_CLOSED, diffContextsEqual, useTabStore } from "../src/renderer/stores/tab-store";
import type { DiffContext } from "../src/shared/diff-types";

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

function resetStore() {
	useTabStore.setState({
		tabs: [],
		activeTabId: null,
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		diffMode: "split",
		diffPanel: PANEL_CLOSED,
	});
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
});

// ── toggleDiffPanel ──────────────────────────────────────────────────────────

describe("toggleDiffPanel", () => {
	beforeEach(resetStore);

	test("opens panel when closed", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel.open).toBe(true);
		expect(diffPanel.diffCtx).toEqual(workingTreeCtx);
	});

	test("closes panel when toggling same context", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel.open).toBe(false);
		expect(diffPanel.diffCtx).toBeNull();
	});

	test("switches context when toggling different context", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().toggleDiffPanel(branchCtxA);
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel.open).toBe(true);
		expect(diffPanel.diffCtx).toEqual(branchCtxA);
	});

	test("switches to different PR instead of closing", () => {
		useTabStore.getState().toggleDiffPanel(prCtxA);
		useTabStore.getState().toggleDiffPanel(prCtxB);
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel.open).toBe(true);
		expect(diffPanel.diffCtx).toEqual(prCtxB);
	});

	test("closes same PR when toggling again", () => {
		useTabStore.getState().toggleDiffPanel(prCtxA);
		useTabStore.getState().toggleDiffPanel(prCtxA);
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel.open).toBe(false);
	});

	test("switches to different branch instead of closing", () => {
		useTabStore.getState().toggleDiffPanel(branchCtxA);
		useTabStore.getState().toggleDiffPanel(branchCtxB);
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel.open).toBe(true);
		expect(diffPanel.diffCtx).toEqual(branchCtxB);
	});
});

// ── closeDiffPanel ───────────────────────────────────────────────────────────

describe("closeDiffPanel", () => {
	beforeEach(resetStore);

	test("closes an open panel", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().closeDiffPanel();
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel).toEqual(PANEL_CLOSED);
	});

	test("is a no-op when already closed", () => {
		useTabStore.getState().closeDiffPanel();
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel).toEqual(PANEL_CLOSED);
	});
});

// ── setActiveWorkspace clears panel ──────────────────────────────────────────

describe("setActiveWorkspace", () => {
	beforeEach(resetStore);

	test("clears the diff panel when switching workspaces", () => {
		useTabStore.getState().toggleDiffPanel(workingTreeCtx);
		useTabStore.getState().setActiveWorkspace("ws-1", "/path");
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel).toEqual(PANEL_CLOSED);
	});
});

// ── closeDiff closes panel when repoPath matches ─────────────────────────────

describe("closeDiff", () => {
	beforeEach(resetStore);

	test("closes panel when repoPath matches", () => {
		const { toggleDiffPanel, addTerminalTab, closeDiff } = useTabStore.getState();
		addTerminalTab("ws-1", "/repo");
		toggleDiffPanel(workingTreeCtx);
		closeDiff("ws-1", "/repo");
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel).toEqual(PANEL_CLOSED);
	});

	test("does not close panel when repoPath differs", () => {
		const { toggleDiffPanel, closeDiff } = useTabStore.getState();
		toggleDiffPanel(workingTreeCtx);
		closeDiff("ws-1", "/other-repo");
		const { diffPanel } = useTabStore.getState();
		expect(diffPanel.open).toBe(true);
	});

	test("removes diff-file tabs for matching workspace and repoPath", () => {
		const { openDiffFile, closeDiff, setActiveWorkspace } = useTabStore.getState();
		setActiveWorkspace("ws-1", "/repo");
		openDiffFile("ws-1", workingTreeCtx, "src/main.ts", "typescript");
		openDiffFile("ws-1", workingTreeCtx, "src/util.ts", "typescript");

		expect(useTabStore.getState().tabs).toHaveLength(2);

		closeDiff("ws-1", "/repo");
		expect(useTabStore.getState().tabs).toHaveLength(0);
	});

	test("does not remove diff-file tabs for non-matching workspace", () => {
		const { openDiffFile, closeDiff } = useTabStore.getState();
		openDiffFile("ws-1", workingTreeCtx, "src/main.ts", "typescript");

		closeDiff("ws-2", "/repo");
		expect(useTabStore.getState().tabs).toHaveLength(1);
	});
});
