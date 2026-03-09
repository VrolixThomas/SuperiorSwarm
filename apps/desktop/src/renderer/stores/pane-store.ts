import { create } from "zustand";
import type { LayoutNode, Pane, SplitNode } from "../../shared/pane-types";
import type { TabItem } from "./tab-store";

// ─── ID generation ───────────────────────────────────────────────────────────

let paneCounter = 0;
let splitCounter = 0;

export function nextPaneId(): string {
	return `pane-${++paneCounter}`;
}

export function nextSplitId(): string {
	return `split-${++splitCounter}`;
}

// ─── Tree helpers ────────────────────────────────────────────────────────────

export function createDefaultPane(tabs: TabItem[] = []): Pane {
	return {
		type: "pane",
		id: nextPaneId(),
		tabs,
		activeTabId: tabs[0]?.id ?? null,
	};
}

export function findPaneById(node: LayoutNode, paneId: string): Pane | null {
	if (node.type === "pane") {
		return node.id === paneId ? node : null;
	}
	return findPaneById(node.children[0], paneId) ?? findPaneById(node.children[1], paneId);
}

export function findSplitById(node: LayoutNode, splitId: string): SplitNode | null {
	if (node.type === "pane") return null;
	if (node.id === splitId) return node;
	return findSplitById(node.children[0], splitId) ?? findSplitById(node.children[1], splitId);
}

export function findParentSplit(node: LayoutNode, childId: string): SplitNode | null {
	if (node.type === "pane") return null;
	if (node.children[0].id === childId || node.children[1].id === childId) {
		return node;
	}
	return findParentSplit(node.children[0], childId) ?? findParentSplit(node.children[1], childId);
}

export function getAllPanes(node: LayoutNode): Pane[] {
	if (node.type === "pane") return [node];
	return [...getAllPanes(node.children[0]), ...getAllPanes(node.children[1])];
}

// ─── Immutable tree replacement ──────────────────────────────────────────────

function replaceNodeInTree(
	root: LayoutNode,
	targetId: string,
	replacement: LayoutNode
): LayoutNode {
	if (root.id === targetId) return replacement;
	if (root.type === "pane") return root;
	const left = replaceNodeInTree(root.children[0], targetId, replacement);
	const right = replaceNodeInTree(root.children[1], targetId, replacement);
	if (left === root.children[0] && right === root.children[1]) return root;
	return { ...root, children: [left, right] };
}

/** Update a specific pane in the tree, returning a new tree. */
function updatePaneInTree(
	root: LayoutNode,
	paneId: string,
	updater: (pane: Pane) => Pane
): LayoutNode {
	if (root.type === "pane") {
		return root.id === paneId ? updater(root) : root;
	}
	const left = updatePaneInTree(root.children[0], paneId, updater);
	const right = updatePaneInTree(root.children[1], paneId, updater);
	if (left === root.children[0] && right === root.children[1]) return root;
	return { ...root, children: [left, right] };
}

/** Update all panes in the tree, returning a new tree. */
function updateAllPanesInTree(root: LayoutNode, updater: (pane: Pane) => Pane): LayoutNode {
	if (root.type === "pane") return updater(root);
	const left = updateAllPanesInTree(root.children[0], updater);
	const right = updateAllPanesInTree(root.children[1], updater);
	if (left === root.children[0] && right === root.children[1]) return root;
	return { ...root, children: [left, right] };
}

// ─── Next-neighbor selection (same logic as tab-store) ───────────────────────

function pickNextActiveTab(tabs: TabItem[], removedId: string): string | null {
	const idx = tabs.findIndex((t) => t.id === removedId);
	const remaining = tabs.filter((t) => t.id !== removedId);
	return remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
}

// ─── Store interface ─────────────────────────────────────────────────────────

interface PaneStore {
	layouts: Record<string, LayoutNode>;
	focusedPaneId: string | null;

	// Layout operations
	getLayout(workspaceId: string): LayoutNode | undefined;
	ensureLayout(workspaceId: string): LayoutNode;
	splitPane(
		workspaceId: string,
		paneId: string,
		direction: "horizontal" | "vertical",
		tabToMove?: TabItem
	): string;
	closePane(workspaceId: string, paneId: string): void;
	setPaneRatio(workspaceId: string, splitId: string, ratio: number): void;
	swapSplitChildren(workspaceId: string, splitId: string): void;

	// Focus
	setFocusedPane(paneId: string): void;
	focusPaneByIndex(workspaceId: string, index: number): void;
	getFocusedPane(workspaceId: string): Pane | null;

	// Tab operations
	addTabToPane(workspaceId: string, paneId: string, tab: TabItem): void;
	removeTabFromPane(workspaceId: string, paneId: string, tabId: string): void;
	moveTabBetweenPanes(
		workspaceId: string,
		sourcePaneId: string,
		targetPaneId: string,
		tabId: string
	): void;
	setActiveTabInPane(workspaceId: string, paneId: string, tabId: string): void;
	updateTabTitleInPane(tabId: string, title: string): void;
	updateTabInPanes(tabId: string, updater: (tab: TabItem) => TabItem): void;

	// Edge-drop: split + optional swap + move tab, all in one set()
	dropTabOnEdge(
		workspaceId: string,
		sourcePaneId: string,
		targetPaneId: string,
		tabId: string,
		zone: "left" | "right" | "top" | "bottom"
	): void;

	// Find which pane contains a given tab
	findPaneForTab(workspaceId: string, tabId: string): Pane | null;

	// Persistence
	hydrateLayout(workspaceId: string, layout: LayoutNode): void;
	clearLayout(workspaceId: string): void;
	resetCounters(maxPaneId: number, maxSplitId: number): void;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const usePaneStore = create<PaneStore>((set, get) => ({
	layouts: {},
	focusedPaneId: null,

	// ── Layout operations ────────────────────────────────────────────────

	getLayout: (workspaceId) => {
		return get().layouts[workspaceId];
	},

	ensureLayout: (workspaceId) => {
		const existing = get().layouts[workspaceId];
		if (existing) return existing;
		const pane = createDefaultPane();
		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: pane } }));
		return pane;
	},

	splitPane: (workspaceId, paneId, direction, tabToMove) => {
		const root = get().layouts[workspaceId];
		if (!root) return "";

		const newPane = createDefaultPane(tabToMove ? [tabToMove] : []);
		const newPaneId = newPane.id;

		const splitNode: SplitNode = {
			type: "split",
			id: nextSplitId(),
			direction,
			ratio: 0.5,
			children: [
				// The original pane (with tab removed if tabToMove)
				tabToMove
					? (() => {
							const originalPane = findPaneById(root, paneId);
							if (!originalPane)
								return { type: "pane" as const, id: paneId, tabs: [], activeTabId: null };
							const filteredTabs = originalPane.tabs.filter((t) => t.id !== tabToMove.id);
							return {
								...originalPane,
								tabs: filteredTabs,
								activeTabId:
									originalPane.activeTabId === tabToMove.id
										? pickNextActiveTab(originalPane.tabs, tabToMove.id)
										: originalPane.activeTabId,
							};
						})()
					: (findPaneById(root, paneId) ?? {
							type: "pane" as const,
							id: paneId,
							tabs: [],
							activeTabId: null,
						}),
				newPane,
			],
		};

		const newRoot = replaceNodeInTree(root, paneId, splitNode);
		set((s) => ({
			layouts: { ...s.layouts, [workspaceId]: newRoot },
			focusedPaneId: newPaneId,
		}));
		return newPaneId;
	},

	closePane: (workspaceId, paneId) => {
		const root = get().layouts[workspaceId];
		if (!root) return;

		// If it's the root pane, do nothing
		if (root.id === paneId) return;

		const parent = findParentSplit(root, paneId);
		if (!parent) return;

		// Sibling is the other child
		const sibling = parent.children[0].id === paneId ? parent.children[1] : parent.children[0];

		const newRoot = replaceNodeInTree(root, parent.id, sibling);

		// Update focus if the closed pane was focused
		const focusedPaneId = get().focusedPaneId;
		const newFocus =
			focusedPaneId === paneId ? (getAllPanes(newRoot)[0]?.id ?? null) : focusedPaneId;

		set((s) => ({
			layouts: { ...s.layouts, [workspaceId]: newRoot },
			focusedPaneId: newFocus,
		}));
	},

	setPaneRatio: (workspaceId, splitId, ratio) => {
		const root = get().layouts[workspaceId];
		if (!root) return;

		const split = findSplitById(root, splitId);
		if (!split) return;

		const updated: SplitNode = { ...split, ratio };
		const newRoot = replaceNodeInTree(root, splitId, updated);
		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: newRoot } }));
	},

	swapSplitChildren: (workspaceId, splitId) => {
		const root = get().layouts[workspaceId];
		if (!root) return;

		const split = findSplitById(root, splitId);
		if (!split) return;

		const swapped: SplitNode = {
			...split,
			children: [split.children[1], split.children[0]],
			ratio: 1 - split.ratio,
		};
		const newRoot = replaceNodeInTree(root, splitId, swapped);
		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: newRoot } }));
	},

	// ── Focus ────────────────────────────────────────────────────────────

	setFocusedPane: (paneId) => {
		set({ focusedPaneId: paneId });
	},

	focusPaneByIndex: (workspaceId, index) => {
		const root = get().layouts[workspaceId];
		if (!root) return;
		const panes = getAllPanes(root);
		const pane = panes[index];
		if (pane) {
			set({ focusedPaneId: pane.id });
		}
	},

	getFocusedPane: (workspaceId) => {
		const { focusedPaneId, layouts } = get();
		if (!focusedPaneId) return null;
		const root = layouts[workspaceId];
		if (!root) return null;
		return findPaneById(root, focusedPaneId);
	},

	// ── Tab operations ───────────────────────────────────────────────────

	addTabToPane: (workspaceId, paneId, tab) => {
		const root = get().layouts[workspaceId];
		if (!root) return;

		const newRoot = updatePaneInTree(root, paneId, (pane) => ({
			...pane,
			tabs: [...pane.tabs, tab],
			activeTabId: tab.id,
		}));
		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: newRoot } }));
	},

	removeTabFromPane: (workspaceId, paneId, tabId) => {
		const root = get().layouts[workspaceId];
		if (!root) return;

		const pane = findPaneById(root, paneId);
		if (!pane) return;

		const filteredTabs = pane.tabs.filter((t) => t.id !== tabId);

		// If pane becomes empty after removal, auto-close it
		if (filteredTabs.length === 0) {
			// First update the pane to remove the tab
			const newRoot = updatePaneInTree(root, paneId, (p) => ({
				...p,
				tabs: [],
				activeTabId: null,
			}));
			set((s) => ({ layouts: { ...s.layouts, [workspaceId]: newRoot } }));
			// Then close the pane
			get().closePane(workspaceId, paneId);
			return;
		}

		const nextActive =
			pane.activeTabId === tabId ? pickNextActiveTab(pane.tabs, tabId) : pane.activeTabId;

		const newRoot = updatePaneInTree(root, paneId, (p) => ({
			...p,
			tabs: filteredTabs,
			activeTabId: nextActive,
		}));
		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: newRoot } }));
	},

	moveTabBetweenPanes: (workspaceId, sourcePaneId, targetPaneId, tabId) => {
		const root = get().layouts[workspaceId];
		if (!root) return;

		const sourcePane = findPaneById(root, sourcePaneId);
		if (!sourcePane) return;

		const tab = sourcePane.tabs.find((t) => t.id === tabId);
		if (!tab) return;

		// Remove from source
		const sourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
		const sourceNextActive =
			sourcePane.activeTabId === tabId
				? pickNextActiveTab(sourcePane.tabs, tabId)
				: sourcePane.activeTabId;

		// Update source pane
		let newRoot = updatePaneInTree(root, sourcePaneId, (p) => ({
			...p,
			tabs: sourceTabs,
			activeTabId: sourceNextActive,
		}));

		// Add to target pane
		newRoot = updatePaneInTree(newRoot, targetPaneId, (p) => ({
			...p,
			tabs: [...p.tabs, tab],
			activeTabId: tab.id,
		}));

		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: newRoot } }));

		// Auto-close source if empty
		if (sourceTabs.length === 0) {
			get().closePane(workspaceId, sourcePaneId);
		}
	},

	dropTabOnEdge: (workspaceId, sourcePaneId, targetPaneId, tabId, zone) => {
		let root = get().layouts[workspaceId];
		if (!root) return;

		const sourcePane = findPaneById(root, sourcePaneId);
		if (!sourcePane) return;

		const tab = sourcePane.tabs.find((t) => t.id === tabId);
		if (!tab) return;

		// 1. Split the target pane
		const direction: "horizontal" | "vertical" =
			zone === "left" || zone === "right" ? "horizontal" : "vertical";

		const newPane = createDefaultPane();
		const newPaneId = newPane.id;

		const originalPane = findPaneById(root, targetPaneId);
		if (!originalPane) return;

		// When source and target are the same pane, the split should use tabs
		// with the dragged tab already removed from the original.
		const isSamePane = sourcePaneId === targetPaneId;

		const splitChildren: [LayoutNode, LayoutNode] = [
			isSamePane
				? (() => {
						const filteredTabs = originalPane.tabs.filter((t) => t.id !== tabId);
						return {
							...originalPane,
							tabs: filteredTabs,
							activeTabId:
								originalPane.activeTabId === tabId
									? pickNextActiveTab(originalPane.tabs, tabId)
									: originalPane.activeTabId,
						};
					})()
				: originalPane,
			newPane,
		];

		const splitNode: SplitNode = {
			type: "split",
			id: nextSplitId(),
			direction,
			ratio: 0.5,
			children: splitChildren,
		};

		root = replaceNodeInTree(root, targetPaneId, splitNode);

		// 2. If zone is left/top, swap children so new pane is on the correct side
		if (zone === "left" || zone === "top") {
			const split = findSplitById(root, splitNode.id);
			if (split) {
				const swapped: SplitNode = {
					...split,
					children: [split.children[1], split.children[0]],
					ratio: 1 - split.ratio,
				};
				root = replaceNodeInTree(root, splitNode.id, swapped);
			}
		}

		// 3. Move the tab to the new pane
		root = updatePaneInTree(root, newPaneId, (p) => ({
			...p,
			tabs: [tab],
			activeTabId: tab.id,
		}));

		// 4. Remove tab from source pane (if source != target; same-pane handled above)
		let sourceEmpty = false;
		if (!isSamePane) {
			const srcPane = findPaneById(root, sourcePaneId);
			if (srcPane) {
				const filteredTabs = srcPane.tabs.filter((t) => t.id !== tabId);
				sourceEmpty = filteredTabs.length === 0;
				root = updatePaneInTree(root, sourcePaneId, (p) => ({
					...p,
					tabs: filteredTabs,
					activeTabId: p.activeTabId === tabId ? pickNextActiveTab(p.tabs, tabId) : p.activeTabId,
				}));
			}
		} else {
			// For same-pane drops, check if the original pane (now first child) is empty
			const origChild = findPaneById(root, targetPaneId);
			if (origChild && origChild.tabs.length === 0) {
				sourceEmpty = true;
			}
		}

		set((s) => ({
			layouts: { ...s.layouts, [workspaceId]: root },
			focusedPaneId: newPaneId,
		}));

		// 5. Auto-close the source pane if empty
		if (sourceEmpty) {
			if (isSamePane) {
				get().closePane(workspaceId, targetPaneId);
			} else {
				get().closePane(workspaceId, sourcePaneId);
			}
		}
	},

	setActiveTabInPane: (workspaceId, paneId, tabId) => {
		const root = get().layouts[workspaceId];
		if (!root) return;

		const newRoot = updatePaneInTree(root, paneId, (pane) => ({
			...pane,
			activeTabId: tabId,
		}));
		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: newRoot } }));
	},

	updateTabTitleInPane: (tabId, title) => {
		const { layouts } = get();
		const newLayouts: Record<string, LayoutNode> = {};
		let changed = false;

		for (const [wsId, root] of Object.entries(layouts)) {
			const newRoot = updateAllPanesInTree(root, (pane) => {
				const hasTab = pane.tabs.some((t) => t.id === tabId);
				if (!hasTab) return pane;
				return {
					...pane,
					tabs: pane.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
				};
			});
			newLayouts[wsId] = newRoot;
			if (newRoot !== root) changed = true;
		}

		if (changed) {
			set({ layouts: newLayouts });
		}
	},

	updateTabInPanes: (tabId, updater) => {
		const { layouts } = get();
		const newLayouts: Record<string, LayoutNode> = {};
		let changed = false;

		for (const [wsId, root] of Object.entries(layouts)) {
			const newRoot = updateAllPanesInTree(root, (pane) => {
				const hasTab = pane.tabs.some((t) => t.id === tabId);
				if (!hasTab) return pane;
				return {
					...pane,
					tabs: pane.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
				};
			});
			newLayouts[wsId] = newRoot;
			if (newRoot !== root) changed = true;
		}

		if (changed) {
			set({ layouts: newLayouts });
		}
	},

	// ── Find pane for tab ────────────────────────────────────────────────

	findPaneForTab: (workspaceId, tabId) => {
		const root = get().layouts[workspaceId];
		if (!root) return null;
		const panes = getAllPanes(root);
		return panes.find((p) => p.tabs.some((t) => t.id === tabId)) ?? null;
	},

	// ── Persistence ──────────────────────────────────────────────────────

	hydrateLayout: (workspaceId, layout) => {
		set((s) => ({ layouts: { ...s.layouts, [workspaceId]: layout } }));
	},

	clearLayout: (workspaceId) => {
		set((s) => {
			const { [workspaceId]: _, ...rest } = s.layouts;
			return { layouts: rest };
		});
	},

	resetCounters: (maxPaneId, maxSplitId) => {
		paneCounter = maxPaneId;
		splitCounter = maxSplitId;
	},
}));
