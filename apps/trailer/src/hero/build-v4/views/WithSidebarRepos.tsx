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
													display: "flex",
													justifyContent: "space-between",
												}}
											>
												<span>{wt.branch}</span>
												<span style={{ color: c.textQuaternary, fontSize: 11 }}>
													{wt.lastActivity}
												</span>
											</div>
										);
									})}
							</div>
						);
					})}
				</div>
				<div
					style={{
						opacity: footerOp,
						borderTop: `1px solid ${c.borderSubtle}`,
						padding: "8px 12px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						fontSize: 12,
						color: c.textSecondary,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							padding: "6px 8px",
							borderRadius: 6,
							background: c.bgElevated,
						}}
					>
						<span style={{ fontSize: 14 }}>+</span>
						Repository
					</div>
					<div style={{ padding: "4px 6px", color: c.textTertiary, fontSize: 16 }}>⚙</div>
				</div>
			</div>
			<div style={{ flex: 1, background: c.bgBase, display: "flex", flexDirection: "column" }}>
				<TerminalBody startFrame={SCENES_V4.s2SidebarBuild.from} />
			</div>
		</>
	);
}
