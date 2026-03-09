import { useCallback, useState } from "react";
import type { Pane } from "../../../shared/pane-types";
import { findParentSplit, getAllPanes, usePaneStore } from "../../stores/pane-store";
import type { DropZone } from "./DropZoneOverlay";
import { DropZoneOverlay, TAB_DRAG_MIME } from "./DropZoneOverlay";
import { PaneContent } from "./PaneContent";
import { PaneContextMenu } from "./PaneContextMenu";
import { PaneTabBar } from "./PaneTabBar";

export function PaneContainer({
	pane,
	workspaceId,
	savedScrollback,
}: {
	pane: Pane;
	workspaceId: string;
	savedScrollback: Record<string, string>;
}) {
	const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
	const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
	const splitPane = usePaneStore((s) => s.splitPane);
	const closePane = usePaneStore((s) => s.closePane);
	const moveTabBetweenPanes = usePaneStore((s) => s.moveTabBetweenPanes);
	const swapSplitChildren = usePaneStore((s) => s.swapSplitChildren);
	const isFocused = focusedPaneId === pane.id;
	// O(1) check: a split root means at least 2 panes exist
	const canClosePane = usePaneStore((s) => {
		const layout = s.layouts[workspaceId];
		return layout ? layout.type === "split" : false;
	});
	const paneIndex = usePaneStore((s) => {
		const layout = s.layouts[workspaceId];
		if (!layout) return 1;
		const panes = getAllPanes(layout);
		return panes.findIndex((p) => p.id === pane.id) + 1;
	});

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	const [isDragOver, setIsDragOver] = useState(false);
	const dragCounter = useState(0);

	const handleContextMenu = useCallback((e: React.MouseEvent) => {
		// Only trigger on background area — skip if right-clicking on tabs
		// (PaneTabBar has its own context menu handler)
		if ((e.target as HTMLElement).closest("[role=tab], [role=tablist]")) return;
		e.preventDefault();
		setContextMenu({ x: e.clientX, y: e.clientY });
	}, []);

	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
			e.preventDefault();
			dragCounter[1]((c) => {
				const next = c + 1;
				if (next === 1) setIsDragOver(true);
				return next;
			});
		},
		[dragCounter]
	);

	const handleDragLeave = useCallback(
		(e: React.DragEvent) => {
			if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
			e.preventDefault();
			dragCounter[1]((c) => {
				const next = c - 1;
				if (next === 0) setIsDragOver(false);
				return next;
			});
		},
		[dragCounter]
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
		e.preventDefault();
	}, []);

	const handleDrop = useCallback(
		(zone: DropZone, tabId: string, sourcePaneId: string) => {
			setIsDragOver(false);
			dragCounter[1](0);

			if (zone === "center") {
				moveTabBetweenPanes(workspaceId, sourcePaneId, pane.id, tabId);
				return;
			}

			// Edge drop: split the target pane, then move the tab to the new pane
			const direction: "horizontal" | "vertical" =
				zone === "left" || zone === "right" ? "horizontal" : "vertical";

			// Split creates an empty new pane as the second child
			const newPaneId = splitPane(workspaceId, pane.id, direction);

			// For left/top, the new pane should be on that side.
			// splitPane creates [original, new]. We need [new, original].
			if (zone === "left" || zone === "top") {
				const layout = usePaneStore.getState().layouts[workspaceId];
				if (layout) {
					const parentSplit = findParentSplit(layout, newPaneId);
					if (parentSplit) {
						swapSplitChildren(workspaceId, parentSplit.id);
					}
				}
			}

			// Move the dragged tab from source pane to the new pane
			moveTabBetweenPanes(workspaceId, sourcePaneId, newPaneId, tabId);
		},
		[workspaceId, pane.id, splitPane, moveTabBetweenPanes, swapSplitChildren, dragCounter]
	);

	return (
		<div
			className={`relative flex h-full flex-col overflow-hidden ${isFocused ? "ring-1 ring-[var(--accent)]" : ""}`}
			onMouseDown={() => setFocusedPane(pane.id)}
			onContextMenu={handleContextMenu}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
		>
			<PaneTabBar pane={pane} workspaceId={workspaceId} paneIndex={paneIndex} />
			<PaneContent pane={pane} savedScrollback={savedScrollback} />

			{isDragOver && (
				<DropZoneOverlay paneId={pane.id} workspaceId={workspaceId} onDrop={handleDrop} />
			)}

			{contextMenu && (
				<PaneContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onSplitRight={() => splitPane(workspaceId, pane.id, "horizontal")}
					onSplitDown={() => splitPane(workspaceId, pane.id, "vertical")}
					onClosePane={canClosePane ? () => closePane(workspaceId, pane.id) : undefined}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	);
}
