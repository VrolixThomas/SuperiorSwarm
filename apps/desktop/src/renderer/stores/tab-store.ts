import { create } from "zustand";
import type { DiffContext } from "../../shared/diff-types";

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
	  };
export type DiffPanelState = { open: false; diffCtx: null } | { open: true; diffCtx: DiffContext };

export const PANEL_CLOSED: DiffPanelState = { open: false, diffCtx: null };

// ─── Store interface ─────────────────────────────────────────────────────────

interface TabStore {
	tabs: TabItem[];
	activeTabId: string | null;
	activeWorkspaceId: string | null;
	activeWorkspaceCwd: string;
	diffMode: "split" | "inline";
	diffPanel: DiffPanelState;

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

	// Diff convenience
	toggleDiffPanel: (diffCtx: DiffContext) => void;
	closeDiffPanel: () => void;
	openDiffFile: (
		workspaceId: string,
		diffCtx: DiffContext,
		filePath: string,
		language: string
	) => string;
	closeDiff: (workspaceId: string, repoPath: string) => void;
	setDiffMode: (mode: "split" | "inline") => void;

	// Session restore
	hydrate: (
		sessions: Array<{ id: string; workspaceId: string; title: string; cwd: string }>,
		activeTabId: string | null,
		activeWorkspaceId: string | null,
		activeWorkspaceCwd: string
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
	diffPanel: PANEL_CLOSED,

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
			diffPanel: PANEL_CLOSED,
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

	toggleDiffPanel: (diffCtx) => {
		const { diffPanel } = get();
		if (diffPanel.open && diffContextsEqual(diffPanel.diffCtx, diffCtx)) {
			set({ diffPanel: PANEL_CLOSED });
		} else {
			set({ diffPanel: { open: true, diffCtx } });
		}
	},

	closeDiffPanel: () => {
		set({ diffPanel: PANEL_CLOSED });
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
		const { diffPanel } = get();
		const closePanel = diffPanel.open && diffPanel.diffCtx.repoPath === repoPath;

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
				...(closePanel ? { diffPanel: PANEL_CLOSED } : {}),
			};
		});
	},

	setDiffMode: (mode) => set({ diffMode: mode }),

	hydrate: (sessions, activeTab, activeWs, activeCwd) => {
		const maxId = sessions.reduce((max, s) => {
			const match = s.id.match(/^terminal-(\d+)$/);
			return match ? Math.max(max, Number(match[1])) : max;
		}, 0);
		terminalCounter = maxId;

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
		});
	},
}));
