import type { ReactNode } from "react";
import { useColorsV4 } from "./colors-v4";

// V4 app window chrome. Reads colors from theme context so the same component
// renders both dark and light variants. Distinct from build/AppWindow which
// hardcodes dark via build/colors.ts.
interface Props {
	agentCount?: number;
	title?: string;
	children?: ReactNode;
}

export function AppWindowV4({ agentCount = 3, title = "SuperiorSwarm", children }: Props) {
	const c = useColorsV4();
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				background: c.bgBase,
				borderRadius: 12,
				border: `1px solid ${c.borderSubtle}`,
				boxShadow:
					"0 40px 100px rgba(0,0,0,0.7), 0 12px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				color: c.text,
				position: "relative",
			}}
		>
			<div
				style={{
					height: 52,
					display: "flex",
					alignItems: "center",
					padding: "0 16px",
					position: "relative",
					flexShrink: 0,
					background: c.bgTabBar,
					borderBottom: `1px solid ${c.borderSubtle}`,
				}}
			>
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
				</div>
				<div
					style={{
						position: "absolute",
						left: 0,
						right: 0,
						textAlign: "center",
						pointerEvents: "none",
						fontSize: 13,
						color: c.textTertiary,
						fontWeight: 500,
					}}
				>
					{title}
				</div>
				<div
					style={{
						marginLeft: "auto",
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 12,
						color: c.textSecondary,
					}}
				>
					<span
						style={{
							width: 7,
							height: 7,
							borderRadius: "50%",
							background: c.success,
							boxShadow: `0 0 8px ${c.success}`,
						}}
					/>
					<span>{agentCount} agents</span>
				</div>
			</div>
			<div style={{ flex: 1, display: "flex", overflow: "hidden" }}>{children}</div>
		</div>
	);
}
