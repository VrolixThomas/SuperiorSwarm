import type { ReactNode } from "react";
import { useColorsV4 } from "./colors-v4";

// V4 app window chrome. Matches real app's hiddenInset title bar: 52px tall,
// traffic lights at left, optional tab strip filling the rest.
interface Props {
	children?: ReactNode;
	tabBar?: ReactNode;
}

export function AppWindowV4({ children, tabBar }: Props) {
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
					alignItems: "flex-end",
					padding: "0 0 0 16px",
					flexShrink: 0,
					background: c.bgTabBar,
					borderBottom: `1px solid ${c.borderSubtle}`,
				}}
			>
				<div
					style={{
						display: "flex",
						gap: 8,
						alignItems: "center",
						height: 52,
						flexShrink: 0,
					}}
				>
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
					<span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
				</div>
				{tabBar}
			</div>
			<div style={{ flex: 1, display: "flex", overflow: "hidden" }}>{children}</div>
		</div>
	);
}
