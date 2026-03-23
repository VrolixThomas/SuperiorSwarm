import { create } from "zustand";
import type { DiffContext } from "../../shared/diff-types";
import type { PRContext } from "../../shared/github-types";
import type { Pane } from "../../shared/pane-types";
import type { SidebarSegment } from "../../shared/types";
import { createDefaultPane, getAllPanes, usePaneStore } from "./pane-store";

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
			prCtx: PRContext;
			filePath: string;
			title: string;
			language: string;
	  }
	| {
			kind: "pr-overview";
			id: string;
			workspaceId: string;
			title: string;
			prCtx: PRContext;
	  };
export type PanelMode = "diff" | "explorer" | "pr-review" | "comment-solve";

export type RightPanelState =
	| { open: false }
	| {
			open: true;
			mode: PanelMode;
			diffCtx: DiffContext | null;
			prCtx?: PRContext;
	  };

export const PANEL_CLOSED: RightPanelState = { open: false };

// ─── Workspace metadata ───────────────────────────────────────────────────────

export interface WorkspaceMetadata {
	type: string;
	prProvider?: string;
	prIdentifier?: string;
	prTitle?: string;
	sourceBranch?: string;
	targetBranch?: string;
}

// ─── Store interface ─────────────────────────────────────────────────────────

interface TabStore {
	// UI-level state (not pane-level)
	activeWorkspaceId: string | null;
	activeWorkspaceCwd: string;
	diffMode: "split" | "inline";
	rightPanel: RightPanelState;
	baseBranchByWorkspace: Record<string, string>;
	workspaceMetadata: Record<string, WorkspaceMetadata>;
	/** @internal Bumped when pane-store changes so derived selectors re-evaluate. */
	_paneVersion: number;
	sidebarSegment: SidebarSegment;
	activeWorkspaceBySegment: Record<SidebarSegment, { id: string; cwd: string } | null>;

	// Derived — reads from pane-store for backwards compat
	getAllTabs: () => TabItem[];
	getActiveTabId: () => string | null;

	// Queries
	getVisibleTabs: () => TabItem[];
	getTabsByWorkspace: (workspaceId: string) => TabItem[];

	// Tab management (delegates to pane-store)
	addTab: (tab: TabItem) => string;
	removeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
	updateTabTitle: (id: string, title: string) => void;

	// Workspace
	setWorkspaceMetadata: (id: string, meta: WorkspaceMetadata) => void;
	cleanupWorkspace: (workspaceId: string) => void;
	setSidebarSegment: (segment: SidebarSegment) => void;
	setActiveWorkspace: (
		workspaceId: string,
		cwd: string,
		options?: { rightPanel?: RightPanelState }
	) => void;

	// Terminal convenience
	addTerminalTab: (workspaceId: string, cwd: string, title?: string) => string;

	// PR review
	openPRReviewPanel: (workspaceId: string, prCtx: PRContext) => void;
	openCommentSolvePanel: (workspaceId: string) => void;
	openPRReviewFile: (
		workspaceId: string,
		prCtx: PRContext,
		filePath: string,
		language: string
	) => string;
	openPROverview: (workspaceId: string, prCtx: PRContext) => string;

	// Diff convenience
	toggleDiffPanel: (diffCtx: DiffContext) => void;
	closeDiffPanel: () => void;
	openRightPanel: () => void;
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

let terminalDisplayCounter = 0;
let fileTabCounter = 0;

function nextTerminalId(): string {
	return `terminal-${crypto.randomUUID()}`;
}
function nextTerminalTitle(): string {
	return `Terminal ${++terminalDisplayCounter}`;
}
function nextFileTabId(): string {
	return `file-tab-${++fileTabCounter}`;
}

export function resetFileTabCounter(max: number): void {
	fileTabCounter = max;
}

// ─── Dedup key helpers ───────────────────────────────────────────────────────

function diffFileKey(diffCtx: DiffContext, filePath: string): string {
	return `diff-file:${diffCtx.repoPath}:${filePath}`;
}

function fileKey(repoPath: string, filePath: string): string {
	return `file:${repoPath}:${filePath}`;
}

function prReviewFileKey(prCtx: PRContext, filePath: string): string {
	return `pr-review-file:${prCtx.owner}/${prCtx.repo}#${prCtx.number}:${filePath}`;
}

function defaultPanelForCwd(cwd: string): RightPanelState {
	return cwd
		? { open: true, mode: "diff", diffCtx: { type: "working-tree", repoPath: cwd } }
		: { open: true, mode: "diff", diffCtx: null };
}

/** Derive the correct right panel state from workspace metadata. */
function panelForWorkspace(cwd: string, meta: WorkspaceMetadata | undefined): RightPanelState {
	if (meta?.type === "review" && meta.prProvider && meta.prIdentifier) {
		const [ownerRepo, numStr] = meta.prIdentifier.split("#");
		const [owner, repo] = (ownerRepo ?? "").split("/");
		const prCtx: PRContext = {
			provider: meta.prProvider as "github" | "bitbucket",
			owner: owner ?? "",
			repo: repo ?? "",
			number: Number.parseInt(numStr ?? "0", 10),
			title: meta.prTitle ?? "",
			sourceBranch: meta.sourceBranch ?? "",
			targetBranch: meta.targetBranch ?? "",
			repoPath: cwd,
		};
		return { open: true, mode: "pr-review", diffCtx: null, prCtx };
	}
	if (meta?.type !== "review" && meta?.prProvider && meta.prIdentifier) {
		return { open: true, mode: "comment-solve", diffCtx: null };
	}
	return defaultPanelForCwd(cwd);
}

/** Determine which sidebar segment a workspace belongs to. */
function segmentForWorkspace(meta: WorkspaceMetadata | undefined): SidebarSegment {
	return meta?.type === "review" ? "prs" : "repos";
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

// ─── Pane-store access helpers ───────────────────────────────────────────────

/** Get pane-store state (shorthand). */
function ps() {
	return usePaneStore.getState();
}

/** Get all panes from a layout node (shorthand). */
function getAll(node: import("../../shared/pane-types").LayoutNode) {
	return getAllPanes(node);
}

/** Collect all tabs across every pane for a given workspace layout. */
function allTabsForWorkspace(workspaceId: string): TabItem[] {
	const root = ps().layouts[workspaceId];
	if (!root) return [];
	return getAll(root).flatMap((p) => p.tabs);
}

/** Get the focused pane for a workspace, falling back to the first pane. */
function resolveFocusedPane(workspaceId: string): Pane | null {
	const state = ps();
	const layout = state.ensureLayout(workspaceId);
	const focused = state.getFocusedPane(workspaceId);
	if (focused) return focused;
	const panes = getAll(layout);
	const first = panes[0] ?? null;
	if (first) state.setFocusedPane(first.id);
	return first;
}

/** Search all panes in a workspace for a tab matching a predicate. */
function findTabInWorkspace(
	workspaceId: string,
	predicate: (tab: TabItem) => boolean
): { tab: TabItem; pane: Pane } | null {
	const root = ps().layouts[workspaceId];
	if (!root) return null;
	for (const p of getAll(root)) {
		const tab = p.tabs.find(predicate);
		if (tab) return { tab, pane: p };
	}
	return null;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTabStore = create<TabStore>()((set, get) => ({
	// UI-level state
	activeWorkspaceId: null,
	activeWorkspaceCwd: "",
	diffMode: "split",
	rightPanel: defaultPanelForCwd(""),
	baseBranchByWorkspace: {},
	workspaceMetadata: {},
	_paneVersion: 0,
	sidebarSegment: "repos" as SidebarSegment,
	activeWorkspaceBySegment: { repos: null, tickets: null, prs: null },

	// ── Derived properties ──────────────────────────────────────────────

	getAllTabs: () => {
		const state = ps();
		return Object.values(state.layouts).flatMap((root) => getAll(root).flatMap((p) => p.tabs));
	},

	getActiveTabId: () => {
		const wsId = get().activeWorkspaceId;
		if (!wsId) return null;
		const focused = ps().getFocusedPane(wsId);
		return focused?.activeTabId ?? null;
	},

	// ── Queries ─────────────────────────────────────────────────────────

	getVisibleTabs: () => {
		const { activeWorkspaceId } = get();
		if (!activeWorkspaceId) return [];
		return allTabsForWorkspace(activeWorkspaceId);
	},

	getTabsByWorkspace: (workspaceId) => {
		return allTabsForWorkspace(workspaceId);
	},

	// ── Tab management (delegates to pane-store) ────────────────────────

	addTab: (tab) => {
		ps().ensureLayout(tab.workspaceId);
		const focused = resolveFocusedPane(tab.workspaceId);
		if (focused) {
			ps().addTabToPane(tab.workspaceId, focused.id, tab);
		}
		return tab.id;
	},

	removeTab: (id) => {
		const wsId = get().activeWorkspaceId;
		if (!wsId) return;
		const found = ps().findPaneForTab(wsId, id);
		if (found) {
			ps().removeTabFromPane(wsId, found.id, id);
		}
	},

	setActiveTab: (id) => {
		const wsId = get().activeWorkspaceId;
		if (!wsId) return;
		const found = ps().findPaneForTab(wsId, id);
		if (found) {
			ps().setActiveTabInPane(wsId, found.id, id);
			ps().setFocusedPane(found.id);
		}
	},

	updateTabTitle: (id, title) => {
		ps().updateTabTitleInPane(id, title);
	},

	setWorkspaceMetadata: (id, meta) => {
		set((s) => ({ workspaceMetadata: { ...s.workspaceMetadata, [id]: meta } }));
	},

	cleanupWorkspace: (workspaceId) => {
		const state = get();
		const { [workspaceId]: _, ...rest } = state.workspaceMetadata;

		const updatedBySegment = { ...state.activeWorkspaceBySegment };
		for (const seg of ["repos", "tickets", "prs"] as SidebarSegment[]) {
			if (updatedBySegment[seg]?.id === workspaceId) {
				updatedBySegment[seg] = null;
			}
		}

		set({
			workspaceMetadata: rest,
			activeWorkspaceBySegment: updatedBySegment,
		});
		if (state.activeWorkspaceId === workspaceId) {
			set({ activeWorkspaceId: null, activeWorkspaceCwd: "" });
		}
	},

	setSidebarSegment: (segment) => {
		set({ sidebarSegment: segment });
		const entry = get().activeWorkspaceBySegment[segment];
		if (entry) {
			get().setActiveWorkspace(entry.id, entry.cwd);
		} else {
			set({
				activeWorkspaceId: null,
				activeWorkspaceCwd: "",
				rightPanel: PANEL_CLOSED,
			});
		}
	},

	setActiveWorkspace: (workspaceId, cwd, options) => {
		ps().ensureLayout(workspaceId);
		const focused = ps().getFocusedPane(workspaceId);
		if (!focused) {
			const root = ps().layouts[workspaceId];
			if (root) {
				const first = getAll(root)[0];
				if (first) ps().setFocusedPane(first.id);
			}
		}

		const meta = get().workspaceMetadata[workspaceId];
		const segment = segmentForWorkspace(meta);

		// Update per-segment tracking
		set((s) => ({
			activeWorkspaceBySegment: {
				...s.activeWorkspaceBySegment,
				[segment]: { id: workspaceId, cwd },
			},
		}));

		// If a rightPanel override is supplied, honour it and skip type detection
		if (options?.rightPanel) {
			set({
				activeWorkspaceId: workspaceId,
				activeWorkspaceCwd: cwd,
				rightPanel: options.rightPanel,
			});
			return;
		}

		const panel = panelForWorkspace(cwd, meta);
		set({
			activeWorkspaceId: workspaceId,
			activeWorkspaceCwd: cwd,
			rightPanel: panel,
		});

		// Only open PR overview on first activation (no existing tabs yet)
		if (meta?.type === "review" && meta.prProvider && meta.prIdentifier) {
			const existingTabs = findTabInWorkspace(workspaceId, () => true);
			if (!existingTabs && panel.open && panel.mode === "pr-review" && panel.prCtx) {
				const prCtx = panel.prCtx;
				queueMicrotask(() => get().openPROverview(workspaceId, prCtx));
			}
		}
	},

	addTerminalTab: (workspaceId, cwd, title) => {
		const id = nextTerminalId();
		const tabTitle = title ?? nextTerminalTitle();
		const tab: TabItem = { kind: "terminal", id, workspaceId, title: tabTitle, cwd };
		ps().ensureLayout(workspaceId);
		const focused = resolveFocusedPane(workspaceId);
		if (focused) {
			ps().addTabToPane(workspaceId, focused.id, tab);
		}
		return id;
	},

	openPRReviewPanel: (workspaceId, prCtx) => {
		set({ rightPanel: { open: true, mode: "pr-review", diffCtx: null, prCtx } });
		// Defer tab creation to next microtask — opening the tab mutates pane-store,
		// which fires the cross-store bridge (bumps _paneVersion), which would cause
		// an infinite setState cascade if done synchronously in the same commit.
		queueMicrotask(() => get().openPROverview(workspaceId, prCtx));
	},
	openCommentSolvePanel: (_workspaceId) => {
		set({ rightPanel: { open: true, mode: "comment-solve", diffCtx: null } });
	},
	openPRReviewFile: (workspaceId, prCtx, filePath, language) => {
		const key = prReviewFileKey(prCtx, filePath);
		const found = findTabInWorkspace(
			workspaceId,
			(t) =>
				t.kind === "pr-review-file" &&
				t.workspaceId === workspaceId &&
				prReviewFileKey(t.prCtx, t.filePath) === key
		);
		if (found) {
			ps().setActiveTabInPane(workspaceId, found.pane.id, found.tab.id);
			ps().setFocusedPane(found.pane.id);
			return found.tab.id;
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
		ps().ensureLayout(workspaceId);
		const focused = resolveFocusedPane(workspaceId);
		if (focused) {
			ps().addTabToPane(workspaceId, focused.id, tab);
		}
		return id;
	},

	openPROverview: (workspaceId, prCtx) => {
		const found = findTabInWorkspace(
			workspaceId,
			(t) =>
				t.kind === "pr-overview" &&
				t.prCtx.owner === prCtx.owner &&
				t.prCtx.repo === prCtx.repo &&
				t.prCtx.number === prCtx.number
		);
		if (found) {
			ps().setActiveTabInPane(workspaceId, found.pane.id, found.tab.id);
			ps().setFocusedPane(found.pane.id);
			return found.tab.id;
		}
		const id = nextFileTabId();
		const tab: TabItem = {
			kind: "pr-overview",
			id,
			workspaceId,
			title: `PR: ${prCtx.title}`,
			prCtx,
		};
		ps().ensureLayout(workspaceId);
		const focused = resolveFocusedPane(workspaceId);
		if (focused) {
			ps().addTabToPane(workspaceId, focused.id, tab);
		}
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

	openRightPanel: () => {
		const { rightPanel, activeWorkspaceCwd } = get();
		if (rightPanel.open) return;
		set({ rightPanel: defaultPanelForCwd(activeWorkspaceCwd) });
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
			if (rightPanel.diffCtx) {
				set({ rightPanel: { ...rightPanel, mode: "diff" } });
			}
		} else {
			set({ rightPanel: { ...rightPanel, mode: "explorer" } });
		}
	},

	openDiffFile: (workspaceId, diffCtx, filePath, language) => {
		const key = diffFileKey(diffCtx, filePath);
		const found = findTabInWorkspace(
			workspaceId,
			(t) =>
				t.kind === "diff-file" &&
				t.workspaceId === workspaceId &&
				diffFileKey(t.diffCtx, t.filePath) === key
		);
		if (found) {
			ps().setActiveTabInPane(workspaceId, found.pane.id, found.tab.id);
			ps().setFocusedPane(found.pane.id);
			return found.tab.id;
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
		ps().ensureLayout(workspaceId);
		const focused = resolveFocusedPane(workspaceId);
		if (focused) {
			ps().addTabToPane(workspaceId, focused.id, tab);
		}
		return id;
	},

	closeDiff: (workspaceId, repoPath) => {
		const { rightPanel } = get();
		const closePanel = rightPanel.open && rightPanel.diffCtx?.repoPath === repoPath;

		const root = ps().layouts[workspaceId];
		if (root) {
			// Iterate all panes and remove matching diff-file tabs
			for (const p of getAll(root)) {
				const matchingTabs = p.tabs.filter(
					(t) =>
						t.workspaceId === workspaceId &&
						t.kind === "diff-file" &&
						t.diffCtx.repoPath === repoPath
				);
				for (const tab of matchingTabs) {
					ps().removeTabFromPane(workspaceId, p.id, tab.id);
				}
			}
		}

		if (closePanel) {
			set({ rightPanel: PANEL_CLOSED });
		}
	},

	openFile: (workspaceId, repoPath, filePath, language, initialPosition) => {
		const key = fileKey(repoPath, filePath);
		const found = findTabInWorkspace(
			workspaceId,
			(t) =>
				t.kind === "file" &&
				t.workspaceId === workspaceId &&
				fileKey(t.repoPath, t.filePath) === key
		);
		if (found) {
			if (initialPosition && found.tab.kind === "file") {
				// Update the tab's initialPosition in the pane-store
				ps().updateTabInPanes(found.tab.id, (t) =>
					t.kind === "file" ? { ...t, initialPosition } : t
				);
			}
			ps().setActiveTabInPane(workspaceId, found.pane.id, found.tab.id);
			ps().setFocusedPane(found.pane.id);
			return found.tab.id;
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
		ps().ensureLayout(workspaceId);
		const focused = resolveFocusedPane(workspaceId);
		if (focused) {
			ps().addTabToPane(workspaceId, focused.id, tab);
		}
		return id;
	},

	clearInitialPosition: (tabId) => {
		ps().updateTabInPanes(tabId, (t) =>
			t.kind === "file" ? { ...t, initialPosition: undefined } : t
		);
	},

	setDiffMode: (mode) => set({ diffMode: mode }),

	setBaseBranch: (workspaceId, branch) =>
		set((s) => ({
			baseBranchByWorkspace: { ...s.baseBranchByWorkspace, [workspaceId]: branch },
		})),

	getBaseBranch: (workspaceId) => get().baseBranchByWorkspace[workspaceId],

	hydrate: (sessions, activeTab, activeWs, activeCwd, extraState) => {
		let baseBranchByWorkspace: Record<string, string> = {};
		if (extraState?.["baseBranchByWorkspace"]) {
			try {
				baseBranchByWorkspace = JSON.parse(extraState["baseBranchByWorkspace"]);
			} catch {
				// ignore malformed data
			}
		}

		// Restore workspace metadata
		let workspaceMetadata: Record<string, WorkspaceMetadata> = {};
		if (extraState?.["workspaceMetadata"]) {
			try {
				workspaceMetadata = JSON.parse(extraState["workspaceMetadata"]);
			} catch {
				// ignore malformed data
			}
		}

		// Restore sidebar segment (validate against known values)
		const validSegments = new Set<string>(["repos", "tickets", "prs"]);
		let sidebarSegment: SidebarSegment = validSegments.has(extraState?.["sidebarSegment"] ?? "")
			? (extraState!["sidebarSegment"] as SidebarSegment)
			: "repos";

		// Restore per-segment active workspace
		let activeWorkspaceBySegment: Record<SidebarSegment, { id: string; cwd: string } | null> = {
			repos: null,
			tickets: null,
			prs: null,
		};
		if (extraState?.["activeWorkspaceBySegment"]) {
			try {
				activeWorkspaceBySegment = {
					...activeWorkspaceBySegment,
					...JSON.parse(extraState["activeWorkspaceBySegment"]),
				};
			} catch {
				// ignore malformed data
			}
		} else if (activeWs) {
			// Backwards compat: migrate single activeWorkspaceId to per-segment
			const meta = workspaceMetadata[activeWs];
			const segment = segmentForWorkspace(meta);
			activeWorkspaceBySegment[segment] = { id: activeWs, cwd: activeCwd };
			if (!extraState?.["sidebarSegment"]) {
				sidebarSegment = segment;
			}
		}

		const tabs: TabItem[] = sessions.map((s) => ({
			kind: "terminal" as const,
			id: s.id,
			workspaceId: s.workspaceId,
			title: s.title,
			cwd: s.cwd,
		}));

		const tabsByWorkspace = new Map<string, TabItem[]>();
		for (const tab of tabs) {
			const existing = tabsByWorkspace.get(tab.workspaceId) ?? [];
			existing.push(tab);
			tabsByWorkspace.set(tab.workspaceId, existing);
		}

		for (const [wsId, wsTabs] of tabsByWorkspace) {
			const newPane = createDefaultPane(wsTabs);
			if (activeTab && wsTabs.some((t) => t.id === activeTab)) {
				newPane.activeTabId = activeTab;
			}
			ps().hydrateLayout(wsId, newPane);
			if (wsId === activeWs) {
				ps().setFocusedPane(newPane.id);
			}
		}

		// Derive right panel from the active workspace for the restored segment
		const activeEntry = activeWorkspaceBySegment[sidebarSegment];
		const activeId = activeEntry?.id ?? activeWs;
		const activeMeta = activeId ? workspaceMetadata[activeId] : undefined;
		const activeCwdResolved = activeEntry?.cwd ?? activeCwd;
		const rightPanel = panelForWorkspace(activeCwdResolved, activeMeta);

		set({
			activeWorkspaceId: activeId ?? null,
			activeWorkspaceCwd: activeCwdResolved,
			rightPanel,
			baseBranchByWorkspace,
			workspaceMetadata,
			sidebarSegment,
			activeWorkspaceBySegment,
		});
	},
}));

// ─── Cross-store subscription bridge ─────────────────────────────────────────
// Tab-store's derived methods (getVisibleTabs, getActiveTabId) read from
// pane-store. Components subscribed to tab-store won't see pane-store changes
// unless we notify them. Bumping _paneVersion triggers Zustand's raw state
// comparison, so cached selector results are re-evaluated.
usePaneStore.subscribe(() => {
	useTabStore.setState((s) => ({ _paneVersion: s._paneVersion + 1 }));
});
