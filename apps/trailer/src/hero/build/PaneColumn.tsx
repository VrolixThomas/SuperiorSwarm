import type React from "react";
import { C } from "./colors";
import { TabBar, type TabKind } from "./TabBar";

interface PaneColumnProps {
	tabs: { id: string; kind: TabKind; title: string }[];
	activeId: string;
	children?: React.ReactNode;
}

export function PaneColumn({ tabs, activeId, children }: PaneColumnProps) {
	return (
		<div
			style={{
				flex: 1,
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
				background: C.bgBase,
				overflow: "hidden",
			}}
		>
			<TabBar tabs={tabs} activeId={activeId} />
			<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				{children}
			</div>
		</div>
	);
}
