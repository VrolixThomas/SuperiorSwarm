import { interpolate, useCurrentFrame } from "remotion";
import { SolveDiffPane } from "../../build-real/SolveDiffPane";
import { MOCK_SESSION, SolveReviewTab } from "../../build-real/SolveReviewTab";
import { SolveSidebar } from "../../build-real/SolveSidebar";
import { useColorsV4 } from "../colors-v4";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const RIGHT_PANEL_W = 440;
const ACTIVE_FILE = "src/renderer/hooks/useAgentTerminalStream.ts";

// SolveSidebar / SolveDiffPane / SolveReviewTab all use Tailwind `h-full`. That
// requires the parent to have a resolved height — wrappers below give them
// `display:flex` so the child fills as a flex item.
export function SolveResultFull() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s8SolveResult.from;

	const fadeIn = interpolate(local, [0, 24], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const expandedGroupIds = new Set(MOCK_SESSION.groups.map((g) => g.id));

	const colStyle: React.CSSProperties = {
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
	};

	return (
		<>
			<div
				style={{
					...colStyle,
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
				}}
			>
				<SolveSidebar
					session={MOCK_SESSION}
					expandedGroupIds={expandedGroupIds}
					activeFilePath={ACTIVE_FILE}
				/>
			</div>

			<div
				style={{
					...colStyle,
					flex: 1,
					background: c.bgBase,
					opacity: fadeIn,
				}}
			>
				<SolveDiffPane session={MOCK_SESSION} activeFilePath={ACTIVE_FILE} />
			</div>

			<div
				style={{
					...colStyle,
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
				}}
			>
				<SolveReviewTab />
			</div>
		</>
	);
}
