import { useCallback, useEffect } from "react";
import { Group, type Layout, Panel, Separator, useGroupRef } from "react-resizable-panels";
import type { LayoutNode } from "../../../shared/pane-types";
import { ratioFromPanelLayout } from "../../lib/pane-layout-ratio";
import { usePaneStore } from "../../stores/pane-store";
import { PaneContainer } from "./PaneContainer";

function SplitRenderer({
	node,
	workspaceId,
	savedScrollback,
}: {
	node: LayoutNode & { type: "split" };
	workspaceId: string;
	savedScrollback: Record<string, string>;
}) {
	const orientation = node.direction === "horizontal" ? "horizontal" : "vertical";
	const firstSize = node.ratio * 100;
	const secondSize = (1 - node.ratio) * 100;
	const setPaneRatio = usePaneStore((s) => s.setPaneRatio);

	const groupRef = useGroupRef();
	const handleLayoutChanged = useCallback(
		(layout: Layout) => {
			const ratio = ratioFromPanelLayout(node.id, layout);
			if (ratio !== null) setPaneRatio(workspaceId, node.id, ratio);
		},
		[node.id, workspaceId, setPaneRatio]
	);
	// Also apply explicit "Open beside Review" ratio changes to an already mounted split.
	useEffect(() => {
		const group = groupRef.current;
		if (!group) return;
		const ratio = ratioFromPanelLayout(node.id, group.getLayout());
		if (ratio !== null && Math.abs(ratio - node.ratio) > 0.0001)
			group.setLayout({ [`${node.id}-first`]: firstSize, [`${node.id}-second`]: secondSize });
	}, [groupRef, node.id, node.ratio, firstSize, secondSize]);

	return (
		<Group groupRef={groupRef} orientation={orientation} onLayoutChanged={handleLayoutChanged}>
			<Panel id={`${node.id}-first`} defaultSize={`${firstSize}%`}>
				<LayoutRenderer
					node={node.children[0]}
					workspaceId={workspaceId}
					savedScrollback={savedScrollback}
				/>
			</Panel>
			<Separator
				className={
					orientation === "horizontal" ? "panel-resize-handle" : "panel-resize-handle-vertical"
				}
			/>
			<Panel id={`${node.id}-second`} defaultSize={`${secondSize}%`}>
				<LayoutRenderer
					node={node.children[1]}
					workspaceId={workspaceId}
					savedScrollback={savedScrollback}
				/>
			</Panel>
		</Group>
	);
}

export function LayoutRenderer({
	node,
	workspaceId,
	savedScrollback,
}: {
	node: LayoutNode;
	workspaceId: string;
	savedScrollback: Record<string, string>;
}) {
	if (node.type === "pane") {
		return (
			<PaneContainer pane={node} workspaceId={workspaceId} savedScrollback={savedScrollback} />
		);
	}

	return <SplitRenderer node={node} workspaceId={workspaceId} savedScrollback={savedScrollback} />;
}
