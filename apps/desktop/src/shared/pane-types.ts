import type { TabItem } from "../renderer/stores/tab-store";

// ─── Runtime layout types ────────────────────────────────────────────────────

/** Leaf node — a single pane with its own tab list. */
export interface Pane {
	type: "pane";
	id: string;
	tabs: TabItem[];
	activeTabId: string | null;
}

/** Interior node — divides space between two children. */
export interface SplitNode {
	type: "split";
	id: string;
	/** horizontal = side-by-side, vertical = stacked */
	direction: "horizontal" | "vertical";
	/** 0-1, fraction of space allocated to the first child (default 0.5) */
	ratio: number;
	children: [LayoutNode, LayoutNode];
}

/** A node in the binary split tree. */
export type LayoutNode = Pane | SplitNode;

// ─── Serialized types (for DB persistence) ───────────────────────────────────

/** Serialized leaf — stores full tab objects for persistence. */
export interface SerializedPane {
	type: "pane";
	id: string;
	tabs: TabItem[];
	activeTabId: string | null;
}

/** Serialized interior node. */
export interface SerializedSplitNode {
	type: "split";
	id: string;
	direction: "horizontal" | "vertical";
	ratio: number;
	children: [SerializedLayoutNode, SerializedLayoutNode];
}

/** Serialized layout tree node. */
export type SerializedLayoutNode = SerializedPane | SerializedSplitNode;
