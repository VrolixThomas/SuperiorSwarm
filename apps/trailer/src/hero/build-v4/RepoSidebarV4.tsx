import { interpolate, useCurrentFrame } from "remotion";
import { SwarmIndicator } from "../build/SwarmIndicator";
import { useColorsV4 } from "./colors-v4";
import { REPOS_V4 } from "./data";
import { SCENES_V4 } from "./timeline";

export const SIDEBAR_WIDTH_V4 = 280;

export type SidebarSegmentV4 = "repos" | "tickets" | "prs";
export type WorktreeAlertV4 = "active" | "done" | null;

interface Props {
	segment?: SidebarSegmentV4;
	worktreeAlerts?: Array<WorktreeAlertV4>;
	activeBranch?: string;
}

// Build-up timing inside s2SidebarBuild (540f local).
// Mirrors real Sidebar.tsx layout:
//   [tab strip (Repos | Tickets | PRs)]
//   [scroll area: repo list + "Add Repository" inside scroll]
//   [footer: Settings]
const STAGE = {
	pane: 0,
	tabs: 60,
	repos: 120,
	expand: 240,
	worktrees: 300,
	footer: 450,
};

export function RepoSidebarV4({ segment = "repos", worktreeAlerts, activeBranch }: Props) {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const buildStart = SCENES_V4.s2SidebarBuild.from;
	const buildEnd = buildStart + SCENES_V4.s2SidebarBuild.duration;
	const past = frame >= buildEnd;
	const local = frame - buildStart;

	// During build window: progressive opacity. After build: hold at 1.
	const fade = (start: number, end: number) =>
		past
			? 1
			: interpolate(local, [start, end], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});

	// Pane slides in only during build window.
	const paneX = past
		? 0
		: interpolate(local, [STAGE.pane, STAGE.pane + 30], [-SIDEBAR_WIDTH_V4, 0], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			});

	const tabsOp = fade(STAGE.tabs, STAGE.tabs + 30);
	const footerOp = fade(STAGE.footer, STAGE.footer + 30);
	const ssExpanded = past || local >= STAGE.expand;

	return (
		<div
			style={{
				width: SIDEBAR_WIDTH_V4,
				flexShrink: 0,
				background: c.bgSurface,
				borderRight: `1px solid ${c.borderSubtle}`,
				transform: `translateX(${paneX}px)`,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			{/* Tab strip — matches real Sidebar.tsx segmented control */}
			<div
				style={{
					opacity: tabsOp,
					display: "flex",
					padding: "6px 8px",
					gap: 4,
					borderBottom: `1px solid ${c.borderSubtle}`,
				}}
			>
				{(["repos", "tickets", "prs"] as const).map((seg) => {
					const label = seg === "prs" ? "PRs" : seg.charAt(0).toUpperCase() + seg.slice(1);
					const active = segment === seg;
					return (
						<div
							key={seg}
							style={{
								flex: 1,
								padding: "5px 0",
								textAlign: "center",
								fontSize: 10,
								fontWeight: 500,
								borderRadius: 5,
								background: active ? c.bgElevated : "transparent",
								color: active ? c.textSecondary : c.textQuaternary,
							}}
						>
							{label}
						</div>
					);
				})}
			</div>

			{/* Scroll area — only shown when segment === "repos" (other segments render
			    their own list/board in parent for now). */}
			{segment === "repos" && (
				<div style={{ flex: 1, overflow: "hidden", padding: "8px 0" }}>
					{REPOS_V4.map((repo, ri) => {
						const repoEntry = STAGE.repos + ri * 30;
						const op = fade(repoEntry, repoEntry + 24);
						const isExpanded = ri === 0 && ssExpanded;
						return (
							<div key={repo.name} style={{ opacity: op, padding: "2px 8px" }}>
								<div
									style={{
										fontSize: 12,
										color: c.text,
										fontWeight: 500,
										padding: "6px 8px",
										display: "flex",
										alignItems: "center",
										gap: 6,
									}}
								>
									<span style={{ color: c.textTertiary, fontSize: 10, width: 10 }}>
										{isExpanded ? "▾" : "▸"}
									</span>
									<span style={{ flex: 1 }}>{repo.name}</span>
									{ri === 0 && <span style={{ color: c.textQuaternary, fontSize: 14 }}>+</span>}
								</div>
								{isExpanded &&
									repo.worktrees.map((wt, wi) => {
										const wEntry = STAGE.worktrees + wi * 15;
										const wOp = fade(wEntry, wEntry + 18);
										const alert = worktreeAlerts?.[wi] ?? null;
										const isActiveBranch = activeBranch === wt.branch;
										return (
											<div
												key={wt.branch}
												style={{
													opacity: wOp,
													margin: "0 4px",
													padding: "5px 10px 5px 22px",
													borderRadius: 6,
													background: isActiveBranch ? c.bgActive : "transparent",
													borderLeft: isActiveBranch
														? `2px solid ${c.accent}`
														: "2px solid transparent",
													display: "flex",
													alignItems: "center",
													gap: 8,
												}}
											>
												<span
													style={{
														flex: 1,
														minWidth: 0,
														fontSize: 11,
														color: isActiveBranch ? c.text : c.textSecondary,
														fontWeight: isActiveBranch ? 500 : 400,
														whiteSpace: "nowrap",
														overflow: "hidden",
														textOverflow: "ellipsis",
													}}
												>
													{wt.branch}
												</span>
												{alert && <SwarmIndicator state={alert} size={14} />}
											</div>
										);
									})}
							</div>
						);
					})}

					{/* "Add Repository" — inside scroll area, immediately after repo list
					    (matches real Sidebar.tsx:91-114) */}
					<div style={{ opacity: footerOp, padding: "4px 8px" }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "6px 12px",
								borderRadius: 6,
								color: c.textQuaternary,
								fontSize: 12,
							}}
						>
							<svg
								aria-hidden="true"
								width="13"
								height="13"
								viewBox="0 0 16 16"
								fill="none"
								style={{ flexShrink: 0 }}
							>
								<path
									d="M8 3v10M3 8h10"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
							</svg>
							<span>Add Repository</span>
						</div>
					</div>
				</div>
			)}

			{/* Settings footer */}
			<div
				style={{
					opacity: footerOp,
					borderTop: `1px solid ${c.borderSubtle}`,
					padding: "8px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "6px 12px",
						borderRadius: 6,
						fontSize: 13,
						color: c.textTertiary,
					}}
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{ flexShrink: 0 }}
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
					<span>Settings</span>
				</div>
			</div>
		</div>
	);
}
