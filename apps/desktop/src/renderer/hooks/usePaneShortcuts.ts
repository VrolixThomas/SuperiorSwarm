import { useEffect } from "react";
import type { LayoutNode } from "../../shared/pane-types";
import { findParentSplit, getAllPanes, usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";

// ─── Directional helpers ─────────────────────────────────────────────────────

type Direction = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Walk up the tree from `targetId` to find the first ancestor split whose
 * direction matches the arrow key pressed, and where `targetId` is on the
 * side that can move in that direction. Then return the appropriate leaf pane
 * from the sibling subtree.
 */
function findDirectionalNeighbor(root: LayoutNode, paneId: string, dir: Direction): string | null {
	// Build ancestor chain from pane up to root
	const chain: { splitId: string; childId: string }[] = [];
	let currentId = paneId;

	for (;;) {
		const parent = findParentSplit(root, currentId);
		if (!parent) break;
		chain.push({ splitId: parent.id, childId: currentId });
		currentId = parent.id;
	}

	const isHorizontal = dir === "ArrowLeft" || dir === "ArrowRight";
	const wantsFirst = dir === "ArrowLeft" || dir === "ArrowUp";

	for (const { splitId, childId } of chain) {
		const split = findSplitNodeById(root, splitId);
		if (!split) continue;

		const splitIsHorizontal = split.direction === "horizontal";
		if (isHorizontal !== splitIsHorizontal) continue;

		const isFirstChild = split.children[0].id === childId;

		// "Left" from the right child → go to left sibling's rightmost pane
		// "Right" from the left child → go to right sibling's leftmost pane
		// "Up" from the bottom child → go to top sibling's bottommost pane
		// "Down" from the top child → go to bottom sibling's topmost pane
		if (wantsFirst && !isFirstChild) {
			const panes = getAllPanes(split.children[0]);
			return panes[panes.length - 1]?.id ?? null;
		}
		if (!wantsFirst && isFirstChild) {
			const panes = getAllPanes(split.children[1]);
			return panes[0]?.id ?? null;
		}
	}

	return null;
}

/** Re-find a split node by ID (type-safe variant of findSplitById). */
function findSplitNodeById(
	node: LayoutNode,
	splitId: string
): Extract<LayoutNode, { type: "split" }> | null {
	if (node.type === "pane") return null;
	if (node.id === splitId) return node;
	return (
		findSplitNodeById(node.children[0], splitId) ?? findSplitNodeById(node.children[1], splitId)
	);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePaneShortcuts() {
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const meta = e.metaKey || e.ctrlKey;
			if (!meta) return;

			const wsId = useTabStore.getState().activeWorkspaceId;
			if (!wsId) return;

			const paneState = usePaneStore.getState();

			// ── Cmd+\ — split right ─────────────────────────────────────────
			if (!e.shiftKey && e.key === "\\") {
				e.preventDefault();
				const focused = paneState.getFocusedPane(wsId);
				if (focused) {
					paneState.splitPane(wsId, focused.id, "horizontal");
				}
				return;
			}

			// ── Cmd+Shift+\ — split down ────────────────────────────────────
			if (e.shiftKey && e.key === "|") {
				// On macOS, Shift+\ produces "|"
				e.preventDefault();
				const focused = paneState.getFocusedPane(wsId);
				if (focused) {
					paneState.splitPane(wsId, focused.id, "vertical");
				}
				return;
			}

			// ── Cmd+1-9 — focus pane by index ───────────────────────────────
			if (!e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
				e.preventDefault();
				const index = Number.parseInt(e.key, 10) - 1;
				paneState.focusPaneByIndex(wsId, index);
				return;
			}

			// ── Cmd+Option+Arrow — directional focus ────────────────────────
			if (
				e.altKey &&
				(e.key === "ArrowLeft" ||
					e.key === "ArrowRight" ||
					e.key === "ArrowUp" ||
					e.key === "ArrowDown")
			) {
				e.preventDefault();
				const root = paneState.getLayout(wsId);
				const focused = paneState.getFocusedPane(wsId);
				if (!root || !focused) return;

				const neighborId = findDirectionalNeighbor(root, focused.id, e.key as Direction);
				if (neighborId) {
					paneState.setFocusedPane(neighborId);
				}
				return;
			}

			// ── Cmd+Shift+] / [ — cycle tabs within focused pane ────────────
			if (e.shiftKey && (e.key === "]" || e.key === "[")) {
				e.preventDefault();
				const focused = paneState.getFocusedPane(wsId);
				if (!focused || focused.tabs.length === 0) return;

				const currentIdx = focused.tabs.findIndex((t) => t.id === focused.activeTabId);
				if (currentIdx === -1) return;

				const delta = e.key === "]" ? 1 : -1;
				const nextIdx = (currentIdx + delta + focused.tabs.length) % focused.tabs.length;
				const nextTab = focused.tabs[nextIdx];
				if (nextTab) {
					paneState.setActiveTabInPane(wsId, focused.id, nextTab.id);
				}
				return;
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);
}
