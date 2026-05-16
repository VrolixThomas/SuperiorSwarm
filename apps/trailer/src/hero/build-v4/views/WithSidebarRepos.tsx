import { interpolate, useCurrentFrame } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;

// Stage offsets within s2SidebarBuild (540f total).
// 0-90    sidebar pane slides in
// 90-180  tab bar appears (Repos · Tickets · PRs)
// 180-300 repo cards appear one by one (3 repos)
// 300-420 SuperiorSwarm expands to show worktrees
// 420-510 +Repository button and Settings icon fade in
const STAGE = {
	pane: 0,
	tabs: 90,
	repos: 180,
	expand: 300,
	footer: 420,
};

export function WithSidebarRepos() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s2SidebarBuild.from;

	const paneX = interpolate(local, [STAGE.pane, STAGE.pane + 30], [-SIDEBAR_WIDTH, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const tabsOp = interpolate(local, [STAGE.tabs, STAGE.tabs + 30], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const footerOp = interpolate(local, [STAGE.footer, STAGE.footer + 30], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			<div
				style={{
					width: SIDEBAR_WIDTH,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					transform: `translateX(${paneX}px)`,
					display: "flex",
					flexDirection: "column",
					padding: "12px 0",
				}}
			>
				<div
					style={{
						opacity: tabsOp,
						display: "flex",
						padding: "0 12px 12px",
						gap: 4,
						borderBottom: `1px solid ${c.borderSubtle}`,
					}}
				>
					{["Repos", "Tickets", "PRs"].map((t, i) => (
						<div
							key={t}
							style={{
								padding: "6px 10px",
								borderRadius: 6,
								fontSize: 12,
								color: i === 0 ? c.text : c.textTertiary,
								background: i === 0 ? c.bgElevated : "transparent",
								fontWeight: i === 0 ? 600 : 400,
							}}
						>
							{t}
						</div>
					))}
				</div>
				<div style={{ flex: 1, overflow: "hidden", padding: "8px 0" }}>
					{REPOS_V4.map((repo, ri) => {
						const repoEntry = STAGE.repos + ri * 36;
						const op = interpolate(local, [repoEntry, repoEntry + 24], [0, 1], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						});
						const showWorktrees = ri === 0 && local >= STAGE.expand;
						return (
							<div key={repo.name} style={{ opacity: op, padding: "4px 12px" }}>
								<div
									style={{
										fontSize: 13,
										color: c.text,
										fontWeight: 600,
										padding: "6px 8px",
										display: "flex",
										alignItems: "center",
										gap: 6,
									}}
								>
									<span style={{ color: c.textTertiary }}>{showWorktrees ? "▾" : "▸"}</span>
									{repo.name}
								</div>
								{showWorktrees &&
									repo.worktrees.map((wt, wi) => {
										const wEntry = STAGE.expand + wi * 10;
										const wOp = interpolate(local, [wEntry, wEntry + 18], [0, 1], {
											extrapolateLeft: "clamp",
											extrapolateRight: "clamp",
										});
										return (
											<div
												key={wt.branch}
												style={{
													opacity: wOp,
													padding: "4px 8px 4px 28px",
													fontSize: 12,
													color: c.textSecondary,
												}}
											>
												{wt.branch}
											</div>
										);
									})}
							</div>
						);
					})}
				</div>
				{/* Add Repository inline button (matches real Sidebar.tsx layout) */}
				<div
					style={{
						opacity: footerOp,
						padding: "4px 8px 8px",
					}}
				>
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
			<div style={{ flex: 1, background: c.bgBase, display: "flex", flexDirection: "column" }}>
				<TerminalBody startFrame={SCENES_V4.s2SidebarBuild.from} />
			</div>
		</>
	);
}
