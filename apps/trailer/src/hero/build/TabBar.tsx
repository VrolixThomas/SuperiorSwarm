import type React from "react";
import { C } from "./colors";
import { INTER } from "./fonts";

export type TabKind = "terminal" | "file" | "review" | "plan";

interface TabDef {
	id: string;
	kind: TabKind;
	title: string;
}

interface Props {
	tabs: TabDef[];
	activeId: string;
	rightSlot?: React.ReactNode;
}

function tabIcon(kind: TabKind, active: boolean) {
	const color = active ? C.textSecondary : C.textQuaternary;
	if (kind === "terminal") {
		return (
			<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M3 4l3 4-3 4M8 12h5"
					stroke={color}
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}
	if (kind === "review") {
		return (
			<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z"
					stroke={color}
					strokeWidth="1.4"
				/>
				<circle cx="6" cy="7" r="0.8" fill={color} />
				<circle cx="9" cy="7" r="0.8" fill={color} />
				<circle cx="12" cy="7" r="0.8" fill={color} />
			</svg>
		);
	}
	if (kind === "plan") {
		return (
			<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<rect
					x="3"
					y="2.5"
					width="10"
					height="11"
					rx="1"
					stroke={color}
					strokeWidth="1.3"
				/>
				<path d="M5.5 6h5M5.5 9h4M5.5 11.5h3" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
			</svg>
		);
	}
	// file
	return (
		<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M4 1.5h5l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z"
				stroke={color}
				strokeWidth="1.3"
			/>
			<path d="M9 1.5v3h3" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
		</svg>
	);
}

export function TabBar({ tabs, activeId, rightSlot }: Props) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "stretch",
				height: 32,
				background: C.bgTabBar,
				borderBottom: `1px solid ${C.borderSubtle}`,
				fontFamily: INTER,
				flexShrink: 0,
				overflow: "hidden",
			}}
		>
			{tabs.map((t) => {
				const active = t.id === activeId;
				return (
					<div
						key={t.id}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							padding: "0 12px",
							background: active ? C.bgElevated : "transparent",
							color: active ? C.text : C.textQuaternary,
							fontSize: 11,
							borderRight: `1px solid ${C.borderSubtle}`,
							maxWidth: 220,
							minWidth: 0,
						}}
					>
						{tabIcon(t.kind, active)}
						<span
							style={{
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
								flex: 1,
							}}
						>
							{t.title}
						</span>
						<span
							style={{
								color: C.textQuaternary,
								fontSize: 12,
								marginLeft: 4,
							}}
						>
							×
						</span>
					</div>
				);
			})}
			<div
				style={{
					padding: "0 10px",
					display: "flex",
					alignItems: "center",
					color: C.textQuaternary,
					fontSize: 13,
				}}
			>
				+
			</div>
			<div style={{ flex: 1 }} />
			{rightSlot && (
				<div style={{ padding: "0 10px", display: "flex", alignItems: "center" }}>
					{rightSlot}
				</div>
			)}
		</div>
	);
}
