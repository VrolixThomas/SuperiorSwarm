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

	return (
		<>
			{/* Left: 280px sidebar */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
					padding: "12px 0",
				}}
			>
				<div
					style={{
						padding: "0 12px 12px",
						borderBottom: `1px solid ${c.borderSubtle}`,
					}}
				>
					<div
						style={{
							fontSize: 13,
							fontWeight: 600,
							color: c.text,
							marginBottom: 4,
						}}
					>
						{repo?.name ?? "SuperiorSwarm"}
					</div>
					<div
						style={{
							fontSize: 11,
							color: c.accent,
							background: c.accentSubtle,
							borderRadius: 4,
							padding: "2px 6px",
							display: "inline-block",
						}}
					>
						feature/auth-refactor
					</div>
				</div>
				<div
					style={{
						flex: 1,
						padding: "8px 12px",
						overflow: "hidden",
					}}
				>
					{repo?.worktrees.map((wt) => (
						<div
							key={wt.branch}
							style={{
								padding: "4px 8px",
								fontSize: 12,
								color: wt.branch === "feature/auth-refactor" ? c.text : c.textTertiary,
								fontWeight: wt.branch === "feature/auth-refactor" ? 600 : 400,
								background: wt.branch === "feature/auth-refactor" ? c.bgElevated : "transparent",
								borderRadius: 5,
								marginBottom: 2,
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}
						>
							{wt.branch}
						</div>
					))}
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
