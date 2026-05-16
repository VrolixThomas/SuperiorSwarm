import { interpolate, useCurrentFrame } from "remotion";
import { BranchChanges } from "../../build-real/BranchChanges";
import { CodeEditor } from "../../build/CodeEditor";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const RIGHT_PANEL_TARGET_W = 380;

export function WithRightPanelChanges() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s5DiffPanel.from;

	const rightW = interpolate(local, [0, 24], [0, RIGHT_PANEL_TARGET_W], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const repo = REPOS_V4[0];

	const ACTIVE_BRANCH = "feature/auth-refactor";

	return (
		<>
			{/* Left: real Repos sidebar */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
				}}
			>
				{/* Tab strip */}
				<div
					style={{
						display: "flex",
						padding: "6px 8px",
						gap: 4,
						borderBottom: `1px solid ${c.borderSubtle}`,
					}}
				>
					{(["Repos", "Tickets", "PRs"] as const).map((label, i) => (
						<div
							key={label}
							style={{
								flex: 1,
								padding: "5px 0",
								textAlign: "center",
								fontSize: 10,
								fontWeight: 500,
								borderRadius: 5,
								background: i === 0 ? c.bgElevated : "transparent",
								color: i === 0 ? c.textSecondary : c.textQuaternary,
							}}
						>
							{label}
						</div>
					))}
				</div>

				{/* Repo header + worktrees */}
				<div style={{ flex: 1, overflow: "hidden", padding: "8px 0" }}>
					<div
						style={{
							fontSize: 13,
							fontWeight: 600,
							color: c.text,
							padding: "6px 16px",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<span style={{ color: c.textTertiary }}>▾</span>
						{repo?.name}
					</div>
					{repo?.worktrees.map((wt) => {
						const isActive = wt.branch === ACTIVE_BRANCH;
						return (
							<div
								key={wt.branch}
								style={{
									padding: "5px 12px 5px 32px",
									fontSize: 12,
									color: isActive ? c.text : c.textSecondary,
									fontWeight: isActive ? 600 : 400,
									background: isActive ? c.bgActive : "transparent",
									borderLeft: isActive ? `2px solid ${c.accent}` : "2px solid transparent",
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
								}}
							>
								{wt.branch}
							</div>
						);
					})}
				</div>
			</div>

			{/* Center: code editor */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				<CodeEditor entryFrame={SCENES_V4.s5DiffPanel.from} variant="use-agent-terminal-stream" />
			</div>

			{/* Right: sliding panel */}
			<div
				style={{
					width: rightW,
					flexShrink: 0,
					overflow: "hidden",
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
				}}
			>
				<div
					style={{
						width: RIGHT_PANEL_TARGET_W,
						height: "100%",
						overflow: "hidden",
					}}
				>
					<BranchChanges />
				</div>
			</div>
		</>
	);
}
