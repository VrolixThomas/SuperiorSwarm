// Mirrors apps/desktop/src/renderer/components/TabBar.tsx. Renders inside
// the AppWindow's 52px title bar (hiddenInset chrome) — traffic lights stay
// on the left, tab pills fill the rest, "+" button on the right.
//
// Static / prop-driven; no click handlers.

import { useColorsV4 } from "./colors-v4";

export type TabKindV4 = "terminal" | "diff-file" | "file" | "review" | "solve" | "tickets" | "prs";

export interface TabPillV4 {
	id: string;
	title: string;
	kind: TabKindV4;
}

interface Props {
	tabs: TabPillV4[];
	activeTabId: string | null;
	opacity?: number;
}

const ACCENT_BY_KIND: Record<TabKindV4, string> = {
	terminal: "var(--text-quaternary)",
	"diff-file": "#ffd43b",
	file: "#0a84ff",
	review: "#0a84ff",
	solve: "#30d158",
	tickets: "#0a84ff",
	prs: "#0a84ff",
};

export function WorkspaceTabBarV4({ tabs, activeTabId, opacity = 1 }: Props) {
	const c = useColorsV4();

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				alignItems: "flex-end",
				gap: 2,
				paddingBottom: 7,
				paddingLeft: 12,
				paddingRight: 8,
				overflow: "hidden",
				opacity,
			}}
		>
			{tabs.map((tab, i) => {
				const isActive = tab.id === activeTabId;
				const prevIsActive = i > 0 && tabs[i - 1]?.id === activeTabId;
				const accent = ACCENT_BY_KIND[tab.kind];

				return (
					<div key={tab.id} style={{ display: "flex", alignItems: "flex-end", gap: 0 }}>
						{i > 0 && !isActive && !prevIsActive && (
							<div
								style={{
									width: 1,
									height: 14,
									marginInline: 1,
									background: c.borderSubtle,
									borderRadius: 99,
									alignSelf: "center",
								}}
							/>
						)}
						{i > 0 && (isActive || prevIsActive) && <div style={{ width: 4 }} />}
						<TabPill tab={tab} isActive={isActive} accent={accent} />
					</div>
				);
			})}
			<NewTerminalButton />
		</div>
	);
}

function TabPill({
	tab,
	isActive,
	accent,
}: {
	tab: TabPillV4;
	isActive: boolean;
	accent: string;
}) {
	const c = useColorsV4();

	return (
		<div
			style={{
				position: "relative",
				display: "flex",
				alignItems: "center",
				gap: 8,
				height: 36,
				maxWidth: 220,
				padding: "0 8px 0 12px",
				borderRadius: 7,
				background: isActive ? c.bgBase : "transparent",
				color: isActive ? c.text : c.textTertiary,
				fontSize: 13,
				boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
				transition: "all 120ms",
			}}
		>
			{isActive && (
				<span
					style={{
						position: "absolute",
						left: 10,
						right: 10,
						bottom: 0,
						height: 2,
						borderRadius: 99,
						background: accent,
					}}
				/>
			)}
			<TabIcon kind={tab.kind} />
			<span
				style={{
					minWidth: 0,
					overflow: "hidden",
					whiteSpace: "nowrap",
					textOverflow: "ellipsis",
				}}
			>
				{tab.title}
			</span>
			<button
				type="button"
				aria-label="Close tab"
				style={{
					display: "flex",
					height: 22,
					width: 22,
					alignItems: "center",
					justifyContent: "center",
					borderRadius: 5,
					border: "none",
					background: "transparent",
					color: isActive ? c.textTertiary : c.textQuaternary,
					opacity: isActive ? 1 : 0,
				}}
			>
				<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
					<path
						d="M2 2l5 5M7 2l-5 5"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</div>
	);
}

function TabIcon({ kind }: { kind: TabKindV4 }) {
	const c = useColorsV4();
	if (kind === "terminal") {
		return (
			<span
				style={{
					flexShrink: 0,
					fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
					fontSize: 10,
					color: c.textQuaternary,
				}}
			>
				&gt;_
			</span>
		);
	}
	if (kind === "diff-file") {
		return (
			<span
				style={{
					flexShrink: 0,
					width: 6,
					height: 6,
					borderRadius: "50%",
					background: "#ffd43b",
					opacity: 0.7,
				}}
			/>
		);
	}
	if (kind === "review") {
		// Three short stacked lines (review/list)
		return (
			<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M3 4h10M3 8h7M3 12h4"
					stroke={c.textTertiary}
					strokeWidth="1.4"
					strokeLinecap="round"
				/>
			</svg>
		);
	}
	if (kind === "solve") {
		// Sparkle/check (solve)
		return (
			<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M3 8l3 3 7-7"
					stroke="#30d158"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}
	return null;
}

function NewTerminalButton() {
	const c = useColorsV4();
	return (
		<div style={{ marginLeft: 4, paddingBottom: 0 }}>
			<button
				type="button"
				aria-label="New terminal tab"
				style={{
					display: "flex",
					height: 30,
					width: 30,
					alignItems: "center",
					justifyContent: "center",
					borderRadius: 6,
					border: "none",
					background: "transparent",
					color: c.textQuaternary,
				}}
			>
				<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
					<path
						d="M8 3v10M3 8h10"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</div>
	);
}
