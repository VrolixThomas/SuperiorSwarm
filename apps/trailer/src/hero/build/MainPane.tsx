import type React from "react";
import { C } from "./colors";

interface MainPaneProps {
	left: React.ReactNode;
	right?: React.ReactNode;
	splitOpenAmt?: number; // 0..1 ; controls right pane width
}

export function MainPane({ left, right, splitOpenAmt = 0 }: MainPaneProps) {
	const amt = Math.max(0, Math.min(1, splitOpenAmt));
	return (
		<div
			style={{
				flex: 1,
				minWidth: 0,
				display: "grid",
				gridTemplateColumns: right ? `1fr ${amt}fr` : "1fr",
				gap: 0,
				background: C.bgBase,
				overflow: "hidden",
			}}
		>
			<div style={{ minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				{left}
			</div>
			{right && (
				<div
					style={{
						minWidth: 0,
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						borderLeft: amt > 0.02 ? `1px solid ${C.borderSubtle}` : "none",
						opacity: amt,
					}}
				>
					{right}
				</div>
			)}
		</div>
	);
}
