import { useCallback, useState } from "react";
import type { Pane } from "../../../shared/pane-types";
import { getAllPanes, usePaneStore } from "../../stores/pane-store";
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

	const handleContextMenu = useCallback((e: React.MouseEvent) => {
		// Only trigger on background area — skip if right-clicking on tabs
		// (PaneTabBar has its own context menu handler)
		if ((e.target as HTMLElement).closest("[role=tab], [role=tablist]")) return;
		e.preventDefault();
		setContextMenu({ x: e.clientX, y: e.clientY });
	}, []);

	return (
		<div
			className={`flex h-full flex-col overflow-hidden ${isFocused ? "ring-1 ring-[var(--accent)]" : ""}`}
			onMouseDown={() => setFocusedPane(pane.id)}
			onContextMenu={handleContextMenu}
		>
			<PaneTabBar pane={pane} workspaceId={workspaceId} paneIndex={paneIndex} />
			<PaneContent pane={pane} savedScrollback={savedScrollback} />

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
