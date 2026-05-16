import { interpolate, useCurrentFrame } from "remotion";
import { CommentsOverviewTab } from "../../build-real/CommentsOverviewTab";
import { PROverviewPane } from "../../build-real/PROverviewPane";
import { PullRequestsTab } from "../../build-real/PullRequestsTab";
import { useColorsV4 } from "../colors-v4";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 320;
const RIGHT_PANEL_W = 380;
const FOCUS_FRAME = 120;

export function WithPRsTab() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s10PRsList.from;

	const focusOp = interpolate(local, [FOCUS_FRAME, FOCUS_FRAME + 18], [0.7, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			{/* Left: 320px sidebar — Repos/Tickets/PRs strip + PullRequestsTab content */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
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
								background: i === 2 ? c.bgElevated : "transparent",
								color: i === 2 ? c.textSecondary : c.textQuaternary,
							}}
						>
							{label}
						</div>
					))}
				</div>
				<div style={{ flex: 1, overflow: "hidden" }}>
					<PullRequestsTab />
				</div>
			</div>

			{/* Center: PR overview (PROverviewPane renders its own PRHeader) */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					opacity: focusOp,
				}}
			>
				<PROverviewPane />
			</div>

			{/* Right: 380px comments panel */}
			<div
				style={{
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				<CommentsOverviewTab />
			</div>
		</>
	);
}
