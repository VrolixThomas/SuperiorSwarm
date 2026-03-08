import { create } from "zustand";
import type { DiffContext } from "../../shared/diff-types";
import type { GitHubPRContext } from "../../shared/github-types";

// ─── Tab types ───────────────────────────────────────────────────────────────

export type TabItem =
	| { kind: "terminal"; id: string; workspaceId: string; title: string; cwd: string }
	| {
			kind: "diff-file";
			id: string;
			workspaceId: string;
			diffCtx: DiffContext;
			filePath: string;
			title: string;
			language: string;
	  }
	| {
			kind: "file";
			id: string;
			workspaceId: string;
			repoPath: string;
			filePath: string;
			title: string;
			language: string;
			initialPosition?: { lineNumber: number; column: number };
	  }
	| {
			kind: "pr-review-file";
			id: string;
			workspaceId: string;
			prCtx: GitHubPRContext;
			filePath: string;
			title: string;
			language: string;
	  };
export type PanelMode = "diff" | "explorer" | "pr-review";

export type RightPanelState =
	| { open: false }
	| { open: true; mode: PanelMode; diffCtx: DiffContext | null; prCtx?: GitHubPRContext };

export const PANEL_CLOSED: RightPanelState = { open: false };

// ─── Store interface ─────────────────────────────────────────────────────────

interface TabStore {
	tabs: TabItem[];
	activeTabId: string | null;
	activeWorkspaceId: string | null;
	activeWorkspaceCwd: string;
	diffMode: "split" | "inline";
	rightPanel: RightPanelState;
	baseBranchByWorkspace: Record<string, string>;

	// Queries
	getVisibleTabs: () => TabItem[];
	getTabsByWorkspace: (workspaceId: string) => TabItem[];

	// Tab management
	addTab: (tab: TabItem) => string;
	removeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
	updateTabTitle: (id: string, title: string) => void;

	// Workspace
	setActiveWorkspace: (workspaceId: string, cwd: string) => void;

	// Terminal convenience — matches old API signature used by WorkspaceItem/CreateWorktreeModal
	addTerminalTab: (workspaceId: string, cwd: string, title?: string) => string;

	// PR review
	openPRReviewPanel: (workspaceId: string, prCtx: GitHubPRContext) => void;
	openPRReviewFile: (
		workspaceId: string,
		prCtx: GitHubPRContext,
		filePath: string,
		language: string
	) => string;

	// Diff convenience
	toggleDiffPanel: (diffCtx: DiffContext) => void;
	closeDiffPanel: () => void;
	openExplorer: () => void;
	togglePanelMode: () => void;
	openDiffFile: (
		workspaceId: string,
		diffCtx: DiffContext,
		filePath: string,
		language: string
	) => string;
	closeDiff: (workspaceId: string, repoPath: string) => void;
	openFile: (
		workspaceId: string,
		repoPath: string,
		filePath: string,
		language: string,
		initialPosition?: { lineNumber: number; column: number }
	) => string;
	clearInitialPosition: (tabId: string) => void;
	setDiffMode: (mode: "split" | "inline") => void;

	// Base branch per workspace
	setBaseBranch: (workspaceId: string, branch: string) => void;
	getBaseBranch: (workspaceId: string) => string | undefined;

	// Session restore
	hydrate: (
		sessions: Array<{ id: string; workspaceId: string; title: string; cwd: string }>,
		activeTabId: string | null,
		activeWorkspaceId: string | null,
		activeWorkspaceCwd: string,
		extraState?: Record<string, string>
	) => void;
}

// ─── ID generation ───────────────────────────────────────────────────────────

let terminalCounter = 0;
let fileTabCounter = 0;

function nextTerminalId(): string {
	return `terminal-${++terminalCounter}`;
}
function nextFileTabId(): string {
	return `file-tab-${++fileTabCounter}`;
}

// ─── Dedup key for diff-file tabs ────────────────────────────────────────────

function diffFileKey(diffCtx: DiffContext, filePath: string): string {
	return `diff-file:${diffCtx.repoPath}:${filePath}`;
}

function fileKey(repoPath: string, filePath: string): string {
	return `file:${repoPath}:${filePath}`;
}

function prReviewFileKey(prCtx: GitHubPRContext, filePath: string): string {
	return `pr-review-file:${prCtx.owner}/${prCtx.repo}#${prCtx.number}:${filePath}`;
}

function defaultPanelForCwd(cwd: string): RightPanelState {
	return cwd
		? { open: true, mode: "diff", diffCtx: { type: "working-tree", repoPath: cwd } }
		: { open: true, mode: "diff", diffCtx: null };
}

// ─── DiffContext identity comparison ─────────────────────────────────────────

export function diffContextsEqual(a: DiffContext, b: DiffContext): boolean {
	if (a.type !== b.type || a.repoPath !== b.repoPath) return false;
	switch (a.type) {
		case "working-tree":
			return true;
		case "branch":
			return (
				a.baseBranch === (b as typeof a).baseBranch && a.headBranch === (b as typeof a).headBranch
			);
		case "pr":
			return a.prId === (b as typeof a).prId;
	}
}

// ─── Next-neighbor selection ─────────────────────────────────────────────────

function pickNextTab(
	tabs: TabItem[],
	removedId: string,
	workspaceId: string | null
): string | null {
	const wsTabs = workspaceId ? tabs.filter((t) => t.workspaceId === workspaceId) : tabs;
	const idx = wsTabs.findIndex((t) => t.id === removedId);
	const remaining = wsTabs.filter((t) => t.id !== removedId);
	return remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTabStore = create<TabStore>((set, get) => ({
	tabs: [],
	activeTabId: null,
	activeWorkspaceId: null,
	activeWorkspaceCwd: "",
	diffMode: "split",
	rightPanel: defaultPanelForCwd(""),
	baseBranchByWorkspace: {},

	getVisibleTabs: () => {
		const { tabs, activeWorkspaceId } = get();
		if (!activeWorkspaceId) return [];
		return tabs.filter((t) => t.workspaceId === activeWorkspaceId);
	},

	getTabsByWorkspace: (workspaceId) => {
		return get().tabs.filter((t) => t.workspaceId === workspaceId);
	},

	addTab: (tab) => {
		set((s) => ({
			tabs: [...s.tabs, tab],
			activeTabId: tab.id,
		}));
		return tab.id;
	},

	removeTab: (id) => {
		set((s) => {
			const tab = s.tabs.find((t) => t.id === id);
			const filtered = s.tabs.filter((t) => t.id !== id);
			let nextActive = s.activeTabId;
			if (s.activeTabId === id) {
				nextActive = pickNextTab(s.tabs, id, tab?.workspaceId ?? s.activeWorkspaceId);
			}
			return { tabs: filtered, activeTabId: nextActive };
		});
	},

	setActiveTab: (id) => set({ activeTabId: id }),

	updateTabTitle: (id, title) =>
		set((s) => ({
			tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
		})),

	setActiveWorkspace: (workspaceId, cwd) => {
		const { tabs, activeTabId } = get();
		const wsTabs = tabs.filter((t) => t.workspaceId === workspaceId);
		const currentStillVisible = wsTabs.find((t) => t.id === activeTabId);
		set({
			activeWorkspaceId: workspaceId,
			activeWorkspaceCwd: cwd,
			activeTabId: currentStillVisible?.id ?? wsTabs[0]?.id ?? null,
			rightPanel: defaultPanelForCwd(cwd),
		});
	},

	addTerminalTab: (workspaceId, cwd, title) => {
		const id = nextTerminalId();
		const tabTitle = title ?? `Terminal ${terminalCounter}`;
		const tab: TabItem = { kind: "terminal", id, workspaceId, title: tabTitle, cwd };
		set((s) => ({
			tabs: [...s.tabs, tab],
			activeTabId: id,
		}));
		return id;
	},

	openPRReviewPanel: (_workspaceId, prCtx) => {
		set({ rightPanel: { open: true, mode: "pr-review", diffCtx: null, prCtx } });
	},

	openPRReviewFile: (workspaceId, prCtx, filePath, language) => {
		const { tabs } = get();
		const key = prReviewFileKey(prCtx, filePath);
		const existing = tabs.find(
			(t) =>
				t.kind === "pr-review-file" &&
				t.workspaceId === workspaceId &&
				prReviewFileKey(t.prCtx, t.filePath) === key
		);
		if (existing) {
			set({ activeTabId: existing.id });
			return existing.id;
		}
		const id = nextFileTabId();
		const title = filePath.split("/").pop() ?? filePath;
		const tab: TabItem = {
			kind: "pr-review-file",
			id,
			workspaceId,
			prCtx,
			filePath,
			title,
			language,
		};
		set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
		return id;
	},

	toggleDiffPanel: (diffCtx) => {
		const { rightPanel } = get();
		if (
			rightPanel.open &&
			rightPanel.mode === "diff" &&
			rightPanel.diffCtx &&
			diffContextsEqual(rightPanel.diffCtx, diffCtx)
		) {
			set({ rightPanel: PANEL_CLOSED });
		} else {
			set({ rightPanel: { open: true, mode: "diff", diffCtx } });
		}
	},

	closeDiffPanel: () => {
		set({ rightPanel: PANEL_CLOSED });
	},

	openExplorer: () => {
		const { rightPanel } = get();
		if (rightPanel.open && rightPanel.mode === "explorer") {
			set({ rightPanel: PANEL_CLOSED });
		} else {
			set({
				rightPanel: {
					open: true,
					mode: "explorer",
					diffCtx: rightPanel.open ? rightPanel.diffCtx : null,
				},
			});
		}
	},

	togglePanelMode: () => {
		const { rightPanel } = get();
		if (!rightPanel.open) return;
		if (rightPanel.mode === "explorer") {
			// Only switch to diff if we have a diffCtx
			if (rightPanel.diffCtx) {
				set({ rightPanel: { ...rightPanel, mode: "diff" } });
			}
		} else {
			set({ rightPanel: { ...rightPanel, mode: "explorer" } });
		}
	},

	openDiffFile: (workspaceId, diffCtx, filePath, language) => {
		const { tabs } = get();
		const key = diffFileKey(diffCtx, filePath);
		const existing = tabs.find(
			(t) =>
				t.kind === "diff-file" &&
				t.workspaceId === workspaceId &&
				diffFileKey(t.diffCtx, t.filePath) === key
		);
		if (existing) {
			set({ activeTabId: existing.id });
			return existing.id;
		}

		const id = nextFileTabId();
		const title = filePath.split("/").pop() ?? filePath;
		const tab: TabItem = {
			kind: "diff-file",
			id,
			workspaceId,
			diffCtx,
			filePath,
			title,
			language,
		};
		set((s) => ({
			tabs: [...s.tabs, tab],
			activeTabId: id,
		}));
		return id;
	},

	closeDiff: (workspaceId, repoPath) => {
		const { rightPanel } = get();
		const closePanel = rightPanel.open && rightPanel.diffCtx?.repoPath === repoPath;

		set((s) => {
			const filtered = s.tabs.filter(
				(t) =>
					!(
						t.workspaceId === workspaceId &&
						t.kind === "diff-file" &&
						t.diffCtx.repoPath === repoPath
					)
			);
			let nextActive = s.activeTabId;
			if (s.activeTabId && !filtered.find((t) => t.id === s.activeTabId)) {
				const wsTabs = filtered.filter((t) => t.workspaceId === workspaceId);
				nextActive = wsTabs[0]?.id ?? null;
			}
			return {
				tabs: filtered,
				activeTabId: nextActive,
				...(closePanel ? { rightPanel: PANEL_CLOSED } : {}),
			};
		});
	},

	openFile: (workspaceId, repoPath, filePath, language, initialPosition) => {
		const { tabs } = get();
		const key = fileKey(repoPath, filePath);
		const existing = tabs.find(
			(t) =>
				t.kind === "file" &&
				t.workspaceId === workspaceId &&
				fileKey(t.repoPath, t.filePath) === key
		);
		if (existing) {
			// If reopening with a new position, update the tab
			if (initialPosition && existing.kind === "file") {
				set((s) => ({
					tabs: s.tabs.map((t) =>
						t.id === existing.id && t.kind === "file" ? { ...t, initialPosition } : t
					),
					activeTabId: existing.id,
				}));
			} else {
				set({ activeTabId: existing.id });
			}
			return existing.id;
		}

		const id = nextFileTabId();
		const title = filePath.split("/").pop() ?? filePath;
		const tab: TabItem = {
			kind: "file",
			id,
			workspaceId,
			repoPath,
			filePath,
			title,
			language,
			initialPosition,
		};
		set((s) => ({
			tabs: [...s.tabs, tab],
			activeTabId: id,
		}));
		return id;
	},

	clearInitialPosition: (tabId) => {
		set((s) => ({
			tabs: s.tabs.map((t) =>
				t.id === tabId && t.kind === "file" ? { ...t, initialPosition: undefined } : t
			),
		}));
	},

	setDiffMode: (mode) => set({ diffMode: mode }),

	setBaseBranch: (workspaceId, branch) =>
		set((s) => ({
			baseBranchByWorkspace: { ...s.baseBranchByWorkspace, [workspaceId]: branch },
		})),

	getBaseBranch: (workspaceId) => get().baseBranchByWorkspace[workspaceId],

	hydrate: (sessions, activeTab, activeWs, activeCwd, extraState) => {
		const maxId = sessions.reduce((max, s) => {
			const match = s.id.match(/^terminal-(\d+)$/);
			return match ? Math.max(max, Number(match[1])) : max;
		}, 0);
		terminalCounter = maxId;

		let baseBranchByWorkspace: Record<string, string> = {};
		if (extraState?.["baseBranchByWorkspace"]) {
			try {
				baseBranchByWorkspace = JSON.parse(extraState["baseBranchByWorkspace"]);
			} catch {
				// ignore malformed data
			}
		}

		set({
			tabs: sessions.map((s) => ({
				kind: "terminal" as const,
				id: s.id,
				workspaceId: s.workspaceId,
				title: s.title,
				cwd: s.cwd,
			})),
			activeTabId: activeTab,
			activeWorkspaceId: activeWs,
			activeWorkspaceCwd: activeCwd,
			rightPanel: defaultPanelForCwd(activeCwd),
			baseBranchByWorkspace,
		});
	},
}));
