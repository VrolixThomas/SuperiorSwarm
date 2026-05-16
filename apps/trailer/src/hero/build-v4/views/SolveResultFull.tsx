import { interpolate, useCurrentFrame } from "remotion";
import { SolveDiffPane } from "../../build-real/SolveDiffPane";
import { MOCK_SESSION, SolveReviewTab } from "../../build-real/SolveReviewTab";
import { SolveSidebar } from "../../build-real/SolveSidebar";
import { useColorsV4 } from "../colors-v4";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const RIGHT_PANEL_W = 420;
const ACTIVE_FILE = "src/renderer/hooks/useAgentTerminalStream.ts";

export function SolveResultFull() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s8SolveResult.from;

	const fadeIn = interpolate(local, [0, 24], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const expandedGroupIds = new Set(MOCK_SESSION.groups.map((g) => g.id));

	return (
		<>
			{/* Left: real SolveSidebar (per-group changed files) */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					overflow: "hidden",
				}}
			>
				<SolveSidebar
					session={MOCK_SESSION}
					expandedGroupIds={expandedGroupIds}
					activeFilePath={ACTIVE_FILE}
				/>
			</div>

			{/* Center: real SolveDiffPane */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					opacity: fadeIn,
				}}
			>
				<SolveDiffPane session={MOCK_SESSION} activeFilePath={ACTIVE_FILE} />
			</div>

			{/* Right: real SolveReviewTab */}
			<div
				style={{
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
					overflow: "hidden",
				}}
			>
				<SolveReviewTab />
			</div>
		</>
	);
}
