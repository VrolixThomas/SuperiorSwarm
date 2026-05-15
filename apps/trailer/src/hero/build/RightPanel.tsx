import type React from "react";
import { C } from "./colors";
import { INTER } from "./fonts";

interface Props {
	width: number;
	activeTab?: "changes" | "files" | "comments" | "fixes";
	children?: React.ReactNode;
}

const ICON_SIZE = 14;

function ChangesIcon() {
	return (
		<svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M3 4h10M3 8h7M3 12h10"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}
function FilesIcon() {
	return (
		<svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M3 3h4l1.5 2H13a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z"
				stroke="currentColor"
				strokeWidth="1.4"
			/>
		</svg>
	);
}
function CommentsIcon() {
	return (
		<svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z"
				stroke="currentColor"
				strokeWidth="1.4"
			/>
		</svg>
	);
}
function FixesIcon() {
	return (
		<svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3L8 2z"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function RightPanel({ width, activeTab = "changes", children }: Props) {
	const tabs: { id: string; icon: React.ReactNode }[] = [
		{ id: "changes", icon: <ChangesIcon /> },
		{ id: "files", icon: <FilesIcon /> },
		{ id: "comments", icon: <CommentsIcon /> },
		{ id: "fixes", icon: <FixesIcon /> },
	];

	return (
		<div
			style={{
				width,
				height: "100%",
				background: C.bgBase,
				borderLeft: `1px solid ${C.border}`,
				display: "flex",
				flexDirection: "column",
				fontFamily: INTER,
				color: C.text,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "8px 12px",
					display: "flex",
					alignItems: "center",
					gap: 8,
					borderBottom: `1px solid ${C.border}`,
					flexShrink: 0,
				}}
			>
				<div
					style={{
						display: "flex",
						background: C.bgBase,
						padding: 2,
						borderRadius: 6,
					}}
				>
					{tabs.map((t) => (
						<div
							key={t.id}
							style={{
								padding: "4px 8px",
								borderRadius: 4,
								background: t.id === activeTab ? C.bgElevated : "transparent",
								color: t.id === activeTab ? C.textSecondary : C.textQuaternary,
								display: "flex",
								alignItems: "center",
								boxShadow: t.id === activeTab ? "0 1px 2px rgba(0,0,0,0.3)" : undefined,
							}}
						>
							{t.icon}
						</div>
					))}
				</div>
			</div>
			<div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
		</div>
	);
}
