import type React from "react";
import { C } from "./colors";
import { INTER } from "./fonts";

export type SidebarSeg = "repos" | "tickets" | "prs";

interface SidebarProps {
	width: number;
	height: number;
	activeSegment: SidebarSeg;
	visibleSegments: SidebarSeg[];
	children?: React.ReactNode;
}

const LABELS: Record<SidebarSeg, string> = {
	repos: "Repos",
	tickets: "Tickets",
	prs: "PRs",
};

export function Sidebar({
	width,
	height,
	activeSegment,
	visibleSegments,
	children,
}: SidebarProps) {
	return (
		<div
			style={{
				width,
				height,
				background: C.bgSurface,
				display: "flex",
				flexDirection: "column",
				borderRight: `1px solid ${C.borderSubtle}`,
				fontFamily: INTER,
				color: C.text,
				overflow: "hidden",
			}}
		>
			{/* Segmented control */}
			<div
				style={{
					padding: "6px 8px",
					display: "flex",
					gap: 4,
					borderBottom: `1px solid ${C.borderSubtle}`,
				}}
			>
				{(["repos", "tickets", "prs"] as const).map((seg) => {
					const visible = visibleSegments.includes(seg);
					const isActive = seg === activeSegment;
					return (
						<div
							key={seg}
							style={{
								flex: 1,
								padding: "5px 0",
								textAlign: "center",
								fontSize: 10,
								fontWeight: 500,
								letterSpacing: 0.2,
								borderRadius: 5,
								background: isActive ? C.bgElevated : "transparent",
								color: isActive ? C.textSecondary : C.textQuaternary,
								opacity: visible ? 1 : 0,
								transition: "opacity 0.2s",
								textTransform: seg === "prs" ? "none" : "capitalize",
							}}
						>
							{LABELS[seg]}
						</div>
					);
				})}
			</div>
			{/* Content */}
			<div style={{ flex: 1, overflow: "auto" }}>{children}</div>
			{/* Settings pinned bottom */}
			<div
				style={{
					padding: "12px 16px",
					borderTop: `1px solid ${C.borderSubtle}`,
					display: "flex",
					alignItems: "center",
					gap: 8,
					fontSize: 12,
					color: C.textTertiary,
				}}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
					<path
						d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
					/>
				</svg>
				Settings
			</div>
		</div>
	);
}
