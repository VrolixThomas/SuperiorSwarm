// PoppyDiffPanel — 6s scene that constructs the diff review surface piece by
// piece instead of just sliding the whole thing in. Composition mirrors v4's
// WithRightPanelChanges layout (sidebar | center diff | right changes panel)
// but each right-panel section pops in on its own beat.
//
// Sidebar uses RepoSidebarV4 anchored past the v4 build window (already-built
// state) — wrapped in its own inner Sequence shift so siblings can still see
// the fresh scene-local clock that Pop needs.
//
// Center uses ReviewTabV4 with entryFrame=0 so its internal tabs/progress/body
// animation plays inside the scene window.
//
// Right panel is recomposed from build-real atoms (DraftCommitCard,
// BranchChanges, CommittedStack) and v4's PanelHeader + BranchChipRow, each
// wrapped in <Pop> with staggered delays.

import type { ReactNode } from "react";
import { Sequence } from "remotion";
import { BranchChanges } from "../../build-real/BranchChanges";
import { CommittedStack } from "../../build-real/CommittedStack";
import { DraftCommitCard } from "../../build-real/DraftCommitCard";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../../build-v4/RepoSidebarV4";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { REPOS_V4 } from "../../build-v4/data";
import { SCENES_V4 } from "../../build-v4/timeline";
import { ReviewTabV4 } from "../../build-v4/views/ReviewTabV4";
import { Pop } from "../Pop";

const ACTIVE_BRANCH = "feat/agent-terminal-chat";
const SIDEBAR_PAST = SCENES_V4.s2SidebarBuild.from + SCENES_V4.s2SidebarBuild.duration;
const RIGHT_PANEL_W = 420;

interface Props {
	tabBar?: ReactNode;
}

export function PoppyDiffPanel({ tabBar }: Props) {
	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "active"));

	return (
		<>
			{/* Sidebar — past-anchored so RepoSidebarV4 renders fully built. */}
			<Sequence from={-SIDEBAR_PAST} layout="none">
				<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />
			</Sequence>

			{/* Center — tab bar fades in then ReviewTabV4 plays its internal build. */}
			<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				<Pop variant="fadeIn" delay={2} duration={10}>
					{tabBar}
				</Pop>
				<Pop variant="slideUp" delay={6} duration={18} style={{ flex: 1, minHeight: 0 }}>
					<ReviewTabV4 entryFrame={0} currentBranch={ACTIVE_BRANCH} baseBranch="main" />
				</Pop>
			</div>

			{/* Right panel — container slides in from right, then each section
			    pops in on its own beat. */}
			<Pop
				variant="slideLeft"
				delay={0}
				duration={18}
				style={{ width: RIGHT_PANEL_W, flexShrink: 0, height: "100%" }}
			>
				<PoppyRightPanelChanges />
			</Pop>
		</>
	);
}

function PoppyRightPanelChanges() {
	const c = useColorsV4();
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				overflow: "hidden",
				background: c.bgSurface,
				borderLeft: `1px solid ${c.borderSubtle}`,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<Pop variant="slideDown" delay={18} duration={12}>
				<PanelHeaderInline />
			</Pop>
			<Pop variant="slideDown" delay={26} duration={12}>
				<BranchChipRowInline />
			</Pop>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<Pop variant="slideLeft" delay={36} duration={16}>
					<DraftCommitCard />
				</Pop>
				<Pop variant="slideLeft" delay={64} duration={16} style={{ marginTop: 12 }}>
					<BranchChanges />
				</Pop>
				<Pop variant="slideUp" delay={100} duration={20} style={{ marginTop: 4, marginBottom: 16 }}>
					<CommittedStack />
				</Pop>
			</div>
		</div>
	);
}

function PanelHeaderInline() {
	const c = useColorsV4();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "8px 12px",
				borderBottom: `1px solid ${c.borderSubtle}`,
			}}
		>
			<div
				style={{
					display: "flex",
					background: c.bgBase,
					padding: 2,
					borderRadius: 6,
				}}
			>
				{[0, 1, 2, 3].map((i) => {
					const active = i === 0;
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: static index
							key={i}
							style={{
								padding: "4px 8px",
								borderRadius: 4,
								background: active ? c.bgElevated : "transparent",
								color: active ? c.textSecondary : c.textQuaternary,
								boxShadow: active ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
							}}
						>
							<HeaderIcon kind={i} />
						</div>
					);
				})}
			</div>
		</div>
	);
}

function HeaderIcon({ kind }: { kind: number }) {
	if (kind === 0)
		return (
			<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M3 4h10M3 8h7M3 12h4"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
				/>
			</svg>
		);
	if (kind === 1)
		return (
			<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M2.5 4.5C2.5 3.95 2.95 3.5 3.5 3.5h3l1.5 1.5h4.5c.55 0 1 .45 1 1V12c0 .55-.45 1-1 1h-9c-.55 0-1-.45-1-1V4.5z"
					stroke="currentColor"
					strokeWidth="1.2"
					strokeLinejoin="round"
				/>
			</svg>
		);
	if (kind === 2)
		return (
			<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M3 4.5c0-.55.45-1 1-1h8c.55 0 1 .45 1 1V10c0 .55-.45 1-1 1H7l-2.5 2.2V11H4c-.55 0-1-.45-1-1V4.5z"
					stroke="currentColor"
					strokeWidth="1.2"
					strokeLinejoin="round"
				/>
			</svg>
		);
	return (
		<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M8 1.5l1.6 4.3L14 7l-3.5 2.5L11.5 14 8 11.6 4.5 14l1-4.5L2 7l4.4-1.2L8 1.5z"
				stroke="currentColor"
				strokeWidth="1.1"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function BranchChipRowInline() {
	const c = useColorsV4();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 12px",
				borderBottom: `1px solid ${c.borderSubtle}`,
				fontSize: 11,
				color: c.textTertiary,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "3px 8px",
					background: c.bgOverlay,
					borderRadius: 4,
				}}
			>
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<path
						d="M4 3v10M4 6c0 2 4 1 4 4v3M12 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4 4.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4 14.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
						stroke={c.textTertiary}
						strokeWidth="1.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span style={{ fontWeight: 500, color: c.text }}>feat/agent-stream</span>
			</div>
			<span style={{ color: c.textQuaternary }}>→</span>
			<span style={{ color: c.textSecondary }}>main</span>
		</div>
	);
}
