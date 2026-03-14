import { beforeEach, describe, expect, test } from "bun:test";
import {
	createDefaultPane,
	findPaneById,
	findParentSplit,
	findSplitById,
	getAllPanes,
	nextPaneId,
	nextSplitId,
	usePaneStore,
} from "../src/renderer/stores/pane-store";
import type { TabItem } from "../src/renderer/stores/tab-store";
import type { LayoutNode, Pane, SplitNode } from "../src/shared/pane-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLayoutOrThrow(wsId: string): LayoutNode {
	const layout = usePaneStore.getState().getLayout(wsId);
	if (!layout) throw new Error(`Expected layout for ${wsId} to exist`);
	return layout;
}

function makeTab(id: string, wsId = "ws-1"): TabItem {
	return { kind: "terminal", id, workspaceId: wsId, title: `Tab ${id}`, cwd: "/tmp" };
}

function resetStore() {
	usePaneStore.setState({
		layouts: {},
		focusedPaneId: null,
	});
	// Reset ID counters so tests are deterministic
	usePaneStore.getState().resetCounters(0, 0);
}

// ── Helper functions ─────────────────────────────────────────────────────────

describe("helper functions", () => {
	test("nextPaneId returns incrementing IDs", () => {
		resetStore();
		expect(nextPaneId()).toBe("pane-1");
		expect(nextPaneId()).toBe("pane-2");
		expect(nextPaneId()).toBe("pane-3");
	});

	test("nextSplitId returns incrementing IDs", () => {
		resetStore();
		expect(nextSplitId()).toBe("split-1");
		expect(nextSplitId()).toBe("split-2");
	});

	test("createDefaultPane creates a pane with no tabs", () => {
		resetStore();
		const pane = createDefaultPane();
		expect(pane.type).toBe("pane");
		expect(pane.id).toMatch(/^pane-\d+$/);
		expect(pane.tabs).toEqual([]);
		expect(pane.activeTabId).toBeNull();
	});

	test("createDefaultPane creates a pane with provided tabs", () => {
		resetStore();
		const tabs = [makeTab("t1"), makeTab("t2")];
		const pane = createDefaultPane(tabs);
		expect(pane.tabs).toHaveLength(2);
		expect(pane.activeTabId).toBe("t1");
	});

	test("getAllPanes returns panes in DFS order (left-to-right)", () => {
		// Build a tree:
		//        split-root
		//       /          \
		//   pane-a       split-inner
		//               /          \
		//           pane-b        pane-c
		const paneA: Pane = {
			type: "pane",
			id: "pane-a",
			tabs: [],
			activeTabId: null,
		};
		const paneB: Pane = {
			type: "pane",
			id: "pane-b",
			tabs: [],
			activeTabId: null,
		};
		const paneC: Pane = {
			type: "pane",
			id: "pane-c",
			tabs: [],
			activeTabId: null,
		};
		const inner: SplitNode = {
			type: "split",
			id: "split-inner",
			direction: "horizontal",
			ratio: 0.5,
			children: [paneB, paneC],
		};
		const root: SplitNode = {
			type: "split",
			id: "split-root",
			direction: "vertical",
			ratio: 0.5,
			children: [paneA, inner],
		};

		const panes = getAllPanes(root);
		expect(panes.map((p) => p.id)).toEqual(["pane-a", "pane-b", "pane-c"]);
	});

	test("getAllPanes returns single pane for leaf node", () => {
		const pane: Pane = { type: "pane", id: "p1", tabs: [], activeTabId: null };
		expect(getAllPanes(pane)).toEqual([pane]);
	});

	test("findPaneById finds a pane deep in a tree", () => {
		const paneA: Pane = { type: "pane", id: "pane-a", tabs: [], activeTabId: null };
		const paneB: Pane = { type: "pane", id: "pane-b", tabs: [], activeTabId: null };
		const root: SplitNode = {
			type: "split",
			id: "split-1",
			direction: "horizontal",
			ratio: 0.5,
			children: [paneA, paneB],
		};
		expect(findPaneById(root, "pane-b")).toEqual(paneB);
		expect(findPaneById(root, "pane-z")).toBeNull();
	});

	test("findSplitById finds a split node", () => {
		const paneA: Pane = { type: "pane", id: "pane-a", tabs: [], activeTabId: null };
		const paneB: Pane = { type: "pane", id: "pane-b", tabs: [], activeTabId: null };
		const root: SplitNode = {
			type: "split",
			id: "split-1",
			direction: "horizontal",
			ratio: 0.5,
			children: [paneA, paneB],
		};
		expect(findSplitById(root, "split-1")).toEqual(root);
		expect(findSplitById(root, "split-z")).toBeNull();
	});

	test("findParentSplit returns the parent split of a node", () => {
		const paneA: Pane = { type: "pane", id: "pane-a", tabs: [], activeTabId: null };
		const paneB: Pane = { type: "pane", id: "pane-b", tabs: [], activeTabId: null };
		const root: SplitNode = {
			type: "split",
			id: "split-1",
			direction: "horizontal",
			ratio: 0.5,
			children: [paneA, paneB],
		};
		expect(findParentSplit(root, "pane-a")).toEqual(root);
		expect(findParentSplit(root, "pane-b")).toEqual(root);
		expect(findParentSplit(root, "split-1")).toBeNull(); // root has no parent
	});
});

// ── ensureLayout ─────────────────────────────────────────────────────────────

describe("ensureLayout", () => {
	beforeEach(resetStore);

	test("returns a default single pane for new workspace", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1");
		expect(layout.type).toBe("pane");
		expect((layout as Pane).tabs).toEqual([]);
		expect((layout as Pane).activeTabId).toBeNull();
	});

	test("returns existing layout for known workspace", () => {
		const layout1 = usePaneStore.getState().ensureLayout("ws-1");
		const layout2 = usePaneStore.getState().ensureLayout("ws-1");
		expect(layout1.id).toBe(layout2.id);
	});

	test("getLayout returns undefined for unknown workspace", () => {
		expect(usePaneStore.getState().getLayout("unknown")).toBeUndefined();
	});
});

// ── splitPane ────────────────────────────────────────────────────────────────

describe("splitPane", () => {
	beforeEach(resetStore);

	test("creates a SplitNode with original pane + new pane as children", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;

		const newPaneId = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");

		const updated = getLayoutOrThrow("ws-1");
		expect(updated.type).toBe("split");
		const split = updated as SplitNode;
		expect(split.direction).toBe("horizontal");
		expect(split.ratio).toBe(0.5);
		expect(split.children[0].type).toBe("pane");
		expect(split.children[0].id).toBe(originalId);
		expect(split.children[1].type).toBe("pane");
		expect(split.children[1].id).toBe(newPaneId);
	});

	test("respects direction parameter", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().splitPane("ws-1", layout.id, "vertical");

		const updated = getLayoutOrThrow("ws-1") as SplitNode;
		expect(updated.direction).toBe("vertical");
	});

	test("moves specified tab to new pane when tabToMove is provided", () => {
		const tab1 = makeTab("t1");
		const tab2 = makeTab("t2");
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().addTabToPane("ws-1", layout.id, tab1);
		usePaneStore.getState().addTabToPane("ws-1", layout.id, tab2);

		const newPaneId = usePaneStore.getState().splitPane("ws-1", layout.id, "horizontal", tab2);

		const updated = getLayoutOrThrow("ws-1") as SplitNode;
		const originalPane = updated.children[0] as Pane;
		const newPane = updated.children[1] as Pane;

		expect(originalPane.tabs.map((t) => t.id)).toEqual(["t1"]);
		expect(newPane.tabs.map((t) => t.id)).toEqual(["t2"]);
		expect(newPane.id).toBe(newPaneId);
		expect(newPane.activeTabId).toBe("t2");
	});

	test("returns the new pane ID", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const newPaneId = usePaneStore.getState().splitPane("ws-1", layout.id, "horizontal");
		expect(newPaneId).toMatch(/^pane-\d+$/);
	});

	test("works on nested panes (splits within splits)", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;

		// First split: creates split-root with [original, pane-new1]
		const newPaneId1 = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");

		// Second split: split the NEW pane vertically
		const newPaneId2 = usePaneStore.getState().splitPane("ws-1", newPaneId1, "vertical");

		const root = getLayoutOrThrow("ws-1") as SplitNode;
		expect(root.type).toBe("split");
		expect(root.children[0].id).toBe(originalId);

		const innerSplit = root.children[1] as SplitNode;
		expect(innerSplit.type).toBe("split");
		expect(innerSplit.direction).toBe("vertical");
		expect(innerSplit.children[0].id).toBe(newPaneId1);
		expect(innerSplit.children[1].id).toBe(newPaneId2);
	});
});

// ── closePane ────────────────────────────────────────────────────────────────

describe("closePane", () => {
	beforeEach(resetStore);

	test("does nothing on root pane (can't close last pane)", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().closePane("ws-1", layout.id);

		const afterClose = getLayoutOrThrow("ws-1");
		expect(afterClose.type).toBe("pane");
		expect(afterClose.id).toBe(layout.id);
	});

	test("promotes sibling when closing a non-root pane", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;
		const newPaneId = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");

		// Close the new pane — original should become root again
		usePaneStore.getState().closePane("ws-1", newPaneId);

		const afterClose = getLayoutOrThrow("ws-1");
		expect(afterClose.type).toBe("pane");
		expect(afterClose.id).toBe(originalId);
	});

	test("works in nested trees (closing inner pane)", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;

		// Create: split-root -> [original, split-inner -> [pane2, pane3]]
		const pane2Id = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");
		const pane3Id = usePaneStore.getState().splitPane("ws-1", pane2Id, "vertical");

		// Close pane3 — pane2 should replace the inner split
		usePaneStore.getState().closePane("ws-1", pane3Id);

		const root = getLayoutOrThrow("ws-1") as SplitNode;
		expect(root.type).toBe("split");
		expect(root.children[0].id).toBe(originalId);
		expect(root.children[1].type).toBe("pane");
		expect(root.children[1].id).toBe(pane2Id);
	});
});

// ── Tab operations ───────────────────────────────────────────────────────────

describe("tab operations", () => {
	beforeEach(resetStore);

	test("addTabToPane adds tab and makes it active", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const tab = makeTab("t1");
		usePaneStore.getState().addTabToPane("ws-1", layout.id, tab);

		const pane = getLayoutOrThrow("ws-1") as Pane;
		expect(pane.tabs).toHaveLength(1);
		expect(pane.tabs[0]?.id).toBe("t1");
		expect(pane.activeTabId).toBe("t1");
	});

	test("removeTabFromPane removes tab and selects neighbor", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t1"));
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t2"));
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t3"));

		// Remove the middle tab
		usePaneStore.getState().removeTabFromPane("ws-1", layout.id, "t2");

		const pane = getLayoutOrThrow("ws-1") as Pane;
		expect(pane.tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
		// Should select neighbor at same index (t3) or fallback to previous
		expect(pane.activeTabId).toBe("t3");
	});

	test("removeTabFromPane selects previous when removing last tab", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t1"));
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t2"));

		// Active is t2 (last added). Remove t2 — should select t1.
		usePaneStore.getState().removeTabFromPane("ws-1", layout.id, "t2");

		const pane = getLayoutOrThrow("ws-1") as Pane;
		expect(pane.activeTabId).toBe("t1");
	});

	test("removeTabFromPane auto-closes empty pane", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;
		usePaneStore.getState().addTabToPane("ws-1", originalId, makeTab("t1"));

		// Split and add a tab to the new pane
		const newPaneId = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");
		usePaneStore.getState().addTabToPane("ws-1", newPaneId, makeTab("t2"));

		// Remove the only tab from the new pane — should auto-close it
		usePaneStore.getState().removeTabFromPane("ws-1", newPaneId, "t2");

		const afterRemove = getLayoutOrThrow("ws-1");
		expect(afterRemove.type).toBe("pane");
		expect(afterRemove.id).toBe(originalId);
	});

	test("moveTabBetweenPanes moves tab and auto-closes empty source", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;
		usePaneStore.getState().addTabToPane("ws-1", originalId, makeTab("t1"));

		const newPaneId = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");
		usePaneStore.getState().addTabToPane("ws-1", newPaneId, makeTab("t2"));

		// Move t2 from new pane to original — new pane becomes empty and auto-closes
		usePaneStore.getState().moveTabBetweenPanes("ws-1", newPaneId, originalId, "t2");

		const afterMove = getLayoutOrThrow("ws-1");
		expect(afterMove.type).toBe("pane");
		expect(afterMove.id).toBe(originalId);
		expect((afterMove as Pane).tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
	});

	test("moveTabBetweenPanes does not close source if it still has tabs", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;
		usePaneStore.getState().addTabToPane("ws-1", originalId, makeTab("t1"));
		usePaneStore.getState().addTabToPane("ws-1", originalId, makeTab("t2"));

		const newPaneId = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");

		// Move t2 from original to new — original still has t1
		usePaneStore.getState().moveTabBetweenPanes("ws-1", originalId, newPaneId, "t2");

		const root = getLayoutOrThrow("ws-1") as SplitNode;
		expect(root.type).toBe("split");
		const origPane = root.children[0] as Pane;
		const newPane = root.children[1] as Pane;
		expect(origPane.tabs.map((t) => t.id)).toEqual(["t1"]);
		expect(newPane.tabs.map((t) => t.id)).toEqual(["t2"]);
	});

	test("setActiveTabInPane sets active tab", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t1"));
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t2"));

		usePaneStore.getState().setActiveTabInPane("ws-1", layout.id, "t1");

		const pane = getLayoutOrThrow("ws-1") as Pane;
		expect(pane.activeTabId).toBe("t1");
	});

	test("updateTabTitleInPane updates tab title across all panes", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t1"));

		usePaneStore.getState().updateTabTitleInPane("t1", "New Title");

		const pane = getLayoutOrThrow("ws-1") as Pane;
		expect(pane.tabs[0]?.title).toBe("New Title");
	});

	test("findPaneForTab finds the pane containing a tab", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().addTabToPane("ws-1", layout.id, makeTab("t1"));

		const pane = usePaneStore.getState().findPaneForTab("ws-1", "t1");
		expect(pane).not.toBeNull();
		expect(pane?.id).toBe(layout.id);
	});

	test("findPaneForTab returns null for unknown tab", () => {
		usePaneStore.getState().ensureLayout("ws-1");
		expect(usePaneStore.getState().findPaneForTab("ws-1", "unknown")).toBeNull();
	});
});

// ── Focus ────────────────────────────────────────────────────────────────────

describe("focus", () => {
	beforeEach(resetStore);

	test("setFocusedPane updates focusedPaneId", () => {
		usePaneStore.getState().setFocusedPane("pane-42");
		expect(usePaneStore.getState().focusedPaneId).toBe("pane-42");
	});

	test("focusPaneByIndex focuses correct pane by DFS order", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;
		const pane2Id = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");
		const pane3Id = usePaneStore.getState().splitPane("ws-1", pane2Id, "vertical");

		// DFS order: [originalId, pane2Id, pane3Id]
		usePaneStore.getState().focusPaneByIndex("ws-1", 0);
		expect(usePaneStore.getState().focusedPaneId).toBe(originalId);

		usePaneStore.getState().focusPaneByIndex("ws-1", 1);
		expect(usePaneStore.getState().focusedPaneId).toBe(pane2Id);

		usePaneStore.getState().focusPaneByIndex("ws-1", 2);
		expect(usePaneStore.getState().focusedPaneId).toBe(pane3Id);
	});

	test("focusPaneByIndex does nothing for out-of-range index", () => {
		usePaneStore.getState().ensureLayout("ws-1");
		usePaneStore.getState().setFocusedPane("original");

		usePaneStore.getState().focusPaneByIndex("ws-1", 5);
		expect(usePaneStore.getState().focusedPaneId).toBe("original");
	});

	test("getFocusedPane returns the focused pane object", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().setFocusedPane(layout.id);

		const focused = usePaneStore.getState().getFocusedPane("ws-1");
		expect(focused).not.toBeNull();
		expect(focused?.id).toBe(layout.id);
	});

	test("getFocusedPane returns null when no pane is focused", () => {
		usePaneStore.getState().ensureLayout("ws-1");
		expect(usePaneStore.getState().getFocusedPane("ws-1")).toBeNull();
	});
});

// ── setPaneRatio ─────────────────────────────────────────────────────────────

describe("setPaneRatio", () => {
	beforeEach(resetStore);

	test("updates ratio on a split node", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().splitPane("ws-1", layout.id, "horizontal");

		const split = getLayoutOrThrow("ws-1") as SplitNode;
		expect(split.ratio).toBe(0.5);

		usePaneStore.getState().setPaneRatio("ws-1", split.id, 0.7);

		const updated = getLayoutOrThrow("ws-1") as SplitNode;
		expect(updated.ratio).toBe(0.7);
	});
});

// ── swapSplitChildren ────────────────────────────────────────────────────────

describe("swapSplitChildren", () => {
	beforeEach(resetStore);

	test("reverses the order of children", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		const originalId = layout.id;
		const newPaneId = usePaneStore.getState().splitPane("ws-1", originalId, "horizontal");

		const before = getLayoutOrThrow("ws-1") as SplitNode;
		expect(before.children[0].id).toBe(originalId);
		expect(before.children[1].id).toBe(newPaneId);

		usePaneStore.getState().swapSplitChildren("ws-1", before.id);

		const after = getLayoutOrThrow("ws-1") as SplitNode;
		expect(after.children[0].id).toBe(newPaneId);
		expect(after.children[1].id).toBe(originalId);
	});

	test("inverts ratio (0.3 becomes 0.7)", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().splitPane("ws-1", layout.id, "horizontal");

		const split = getLayoutOrThrow("ws-1") as SplitNode;
		usePaneStore.getState().setPaneRatio("ws-1", split.id, 0.3);

		usePaneStore.getState().swapSplitChildren("ws-1", split.id);

		const after = getLayoutOrThrow("ws-1") as SplitNode;
		expect(after.ratio).toBeCloseTo(0.7);
	});

	test("keeps ratio at 0.5 when swapped", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().splitPane("ws-1", layout.id, "horizontal");

		const split = getLayoutOrThrow("ws-1") as SplitNode;
		expect(split.ratio).toBe(0.5);

		usePaneStore.getState().swapSplitChildren("ws-1", split.id);

		const after = getLayoutOrThrow("ws-1") as SplitNode;
		expect(after.ratio).toBe(0.5);
	});

	test("no-op on invalid splitId", () => {
		const layout = usePaneStore.getState().ensureLayout("ws-1") as Pane;
		usePaneStore.getState().splitPane("ws-1", layout.id, "horizontal");

		const before = getLayoutOrThrow("ws-1") as SplitNode;
		const beforeChildren = [before.children[0].id, before.children[1].id];

		usePaneStore.getState().swapSplitChildren("ws-1", "nonexistent-split");

		const after = getLayoutOrThrow("ws-1") as SplitNode;
		expect(after.children[0].id).toBe(beforeChildren[0]);
		expect(after.children[1].id).toBe(beforeChildren[1]);
		expect(after.ratio).toBe(before.ratio);
	});
});

// ── Persistence ──────────────────────────────────────────────────────────────

describe("persistence", () => {
	beforeEach(resetStore);

	test("hydrateLayout sets layout for workspace", () => {
		const pane: Pane = { type: "pane", id: "pane-99", tabs: [], activeTabId: null };
		usePaneStore.getState().hydrateLayout("ws-1", pane);

		const layout = usePaneStore.getState().getLayout("ws-1");
		expect(layout).toEqual(pane);
	});

	test("clearLayout removes layout for workspace", () => {
		usePaneStore.getState().ensureLayout("ws-1");
		usePaneStore.getState().clearLayout("ws-1");
		expect(usePaneStore.getState().getLayout("ws-1")).toBeUndefined();
	});
});
