// Mirrors apps/desktop/.../MainContentArea.tsx top chrome:
//   [ BranchChip + QuickActionBar ]   ← branch indicator bar
//   [ PaneTabBar                  ]   ← tab pills
//
// Sits above the main pane content (right of left sidebar). Used in every
// scene where the workspace shell shows a main pane — including terminal-only.

import type { ReactNode } from "react";
import { useColorsV4 } from "./colors-v4";

interface Props {
	branch?: string;
	repo?: string;
	actions?: string[];
	tabBar?: ReactNode;
	opacity?: number;
}

export function MainPaneHeaderV4({
	branch = "main",
	repo = "feat/agent-stream",
	actions = ["claude"],
	tabBar,
	opacity = 1,
}: Props) {
	return (
		<div style={{ display: "flex", flexDirection: "column", flexShrink: 0, opacity }}>
			<BranchActionsBarV4 repo={repo} branch={branch} actions={actions} />
			{tabBar}
		</div>
	);
}

export function BranchActionsBarV4({
	repo = "feat/agent-stream",
	branch = "main",
	actions = ["claude"],
}: {
	repo?: string;
	branch?: string;
	actions?: string[];
}) {
	const c = useColorsV4();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "5px 12px",
				borderBottom: `1px solid ${c.borderSubtle}`,
				background: c.bgTabBar,
				flexShrink: 0,
			}}
		>
			<BranchChipV4 repo={repo} branch={branch} />
			<div style={{ width: 1, height: 14, background: c.borderSubtle, marginInline: 2 }} />
			{actions.map((label) => (
				<QuickActionPill key={label} label={label} />
			))}
			<AddActionButton />
		</div>
	);
}

function BranchChipV4({ repo, branch }: { repo: string; branch: string }) {
	const c = useColorsV4();
	return (
		<button
			type="button"
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "3px 8px",
				border: `1px solid ${c.borderSubtle}`,
				background: c.bgOverlay,
				borderRadius: 4,
				color: c.text,
				fontSize: 12,
			}}
			title={`${repo} • ${branch}`}
		>
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M6 3v12M18 9a9 9 0 0 1-9 9"
					stroke={c.textSecondary}
					strokeWidth="2"
					strokeLinecap="round"
				/>
				<circle cx="18" cy="6" r="2.5" stroke={c.textSecondary} strokeWidth="2" />
				<circle cx="6" cy="18" r="2.5" stroke={c.textSecondary} strokeWidth="2" />
			</svg>
			<span style={{ fontWeight: 500 }}>{repo}</span>
		</button>
	);
}

function QuickActionPill({ label }: { label: string }) {
	const c = useColorsV4();
	return (
		<button
			type="button"
			style={{
				display: "flex",
				alignItems: "center",
				gap: 4,
				padding: "3px 8px",
				background: "transparent",
				border: "none",
				color: c.textTertiary,
				fontSize: 12,
			}}
		>
			{label}
		</button>
	);
}

function AddActionButton() {
	const c = useColorsV4();
	return (
		<button
			type="button"
			aria-label="Add quick action"
			style={{
				display: "flex",
				height: 22,
				width: 22,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: 4,
				background: "transparent",
				border: "none",
				color: c.textQuaternary,
			}}
		>
			<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
			</svg>
		</button>
	);
}
