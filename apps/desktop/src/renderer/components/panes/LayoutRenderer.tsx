import { Group, Panel, Separator } from "react-resizable-panels";
import type { LayoutNode } from "../../../shared/pane-types";
import { usePaneStore } from "../../stores/pane-store";
import { PaneContainer } from "./PaneContainer";

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

	const orientation = node.direction === "horizontal" ? "horizontal" : "vertical";
	const firstSize = node.ratio * 100;
	const secondSize = (1 - node.ratio) * 100;
	const setPaneRatio = usePaneStore((s) => s.setPaneRatio);

	return (
		<Group
			orientation={orientation}
			onLayoutChanged={(sizes: number[]) => {
				if (sizes[0] !== undefined) {
					setPaneRatio(workspaceId, node.id, sizes[0] / 100);
				}
			}}
		>
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
