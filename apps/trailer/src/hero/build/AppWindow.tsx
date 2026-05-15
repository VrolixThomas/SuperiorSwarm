import type React from "react";
import { C } from "./colors";
import { INTER } from "./fonts";

interface Props {
	width: number;
	height: number;
	agentCount?: number;
	children?: React.ReactNode;
}

export function AppWindow({ width, height, agentCount = 3, children }: Props) {
	return (
		<div
			style={{
				width,
				height,
				background: C.bgBase,
				borderRadius: 12,
				border: `1px solid ${C.borderSubtle}`,
				boxShadow:
					"0 40px 100px rgba(0,0,0,0.7), 0 12px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				fontFamily: INTER,
				color: C.text,
				position: "relative",
			}}
		>
			{/* Title bar (52px clearance) */}
			<div
				style={{
					height: 52,
					display: "flex",
					alignItems: "center",
					padding: "0 16px",
					position: "relative",
					flexShrink: 0,
				}}
			>
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: C.tl.r }} />
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: C.tl.y }} />
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: C.tl.g }} />
				</div>
				<div
					style={{
						position: "absolute",
						left: 0,
						right: 0,
						textAlign: "center",
						pointerEvents: "none",
						fontSize: 13,
						color: C.textTertiary,
						fontWeight: 500,
					}}
				>
					SuperiorSwarm
				</div>
				<div
					style={{
						marginLeft: "auto",
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 12,
						color: C.textSecondary,
					}}
				>
					<span
						style={{
							width: 7,
							height: 7,
							borderRadius: "50%",
							background: C.success,
							boxShadow: `0 0 8px ${C.success}`,
						}}
					/>
					<span>{agentCount} agents</span>
				</div>
			</div>
			<div style={{ flex: 1, display: "flex", overflow: "hidden" }}>{children}</div>
		</div>
	);
}
