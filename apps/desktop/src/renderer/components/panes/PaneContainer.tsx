import { useCallback, useRef, useState } from "react";
import type { Pane } from "../../../shared/pane-types";
import { getAllPanes, usePaneStore } from "../../stores/pane-store";
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
	const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
	const splitPane = usePaneStore((s) => s.splitPane);
	const closePane = usePaneStore((s) => s.closePane);
	const moveTabBetweenPanes = usePaneStore((s) => s.moveTabBetweenPanes);
	const dropTabOnEdge = usePaneStore((s) => s.dropTabOnEdge);
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
	const dragCounterRef = useRef(0);

	const handleContextMenu = useCallback((e: React.MouseEvent) => {
		// Only trigger on background area — skip if right-clicking on tabs
		// (PaneTabBar has its own context menu handler)
		if ((e.target as HTMLElement).closest("[role=tab], [role=tablist]")) return;
		e.preventDefault();
		setContextMenu({ x: e.clientX, y: e.clientY });
	}, []);

	const handleDragEnter = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
		e.preventDefault();
		dragCounterRef.current += 1;
		if (dragCounterRef.current === 1) setIsDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
		e.preventDefault();
		dragCounterRef.current -= 1;
		if (dragCounterRef.current === 0) setIsDragOver(false);
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
		e.preventDefault();
	}, []);

	const handleDrop = useCallback(
		(zone: DropZone, tabId: string, sourcePaneId: string) => {
			setIsDragOver(false);
			dragCounterRef.current = 0;

			// No-op: dropping on same pane's center
			if (zone === "center" && sourcePaneId === pane.id) return;

			if (zone === "center") {
				moveTabBetweenPanes(workspaceId, sourcePaneId, pane.id, tabId);
				return;
			}

			// Edge drop: split + swap + move in one atomic action
			dropTabOnEdge(workspaceId, sourcePaneId, pane.id, tabId, zone);
		},
		[workspaceId, pane.id, moveTabBetweenPanes, dropTabOnEdge]
	);

	return (
		<div
			className="relative flex h-full flex-col overflow-hidden"
			onMouseDown={() => setFocusedPane(pane.id)}
			onContextMenu={handleContextMenu}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
		>
			<PaneTabBar pane={pane} workspaceId={workspaceId} paneIndex={paneIndex} />
			<PaneContent pane={pane} workspaceId={workspaceId} savedScrollback={savedScrollback} />

			{isDragOver && <DropZoneOverlay paneId={pane.id} onDrop={handleDrop} />}

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
