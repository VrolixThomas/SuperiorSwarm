import { useCallback, useEffect, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { LayoutNode } from "../../../shared/pane-types";
import { usePaneStore } from "../../stores/pane-store";
import { PaneContainer } from "./PaneContainer";

const RATIO_DEBOUNCE_MS = 200;

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

	// Debounce ratio commits: track latest sizes in a ref and only write to
	// the store after dragging settles (RATIO_DEBOUNCE_MS of inactivity).
	const latestRatioRef = useRef<number | null>(null);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const commitRatio = useCallback(() => {
		const ratio = latestRatioRef.current;
		if (ratio !== null) {
			setPaneRatio(workspaceId, node.id, ratio);
			latestRatioRef.current = null;
		}
	}, [setPaneRatio, workspaceId, node.id]);

	// Cleanup debounce timer on unmount
	useEffect(() => {
		return () => {
			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, []);

	const handleLayoutChanged = useCallback(
		(sizes: number[]) => {
			if (sizes[0] !== undefined) {
				latestRatioRef.current = sizes[0] / 100;
				if (debounceTimerRef.current !== null) {
					clearTimeout(debounceTimerRef.current);
				}
				debounceTimerRef.current = setTimeout(commitRatio, RATIO_DEBOUNCE_MS);
			}
		},
		[commitRatio]
	);

	return (
		<Group orientation={orientation} onLayoutChanged={handleLayoutChanged}>
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
