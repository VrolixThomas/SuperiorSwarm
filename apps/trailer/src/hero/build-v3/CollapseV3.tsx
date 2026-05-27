import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AppWindow } from "../build/AppWindow";
import { PaneColumn } from "../build/PaneColumn";
import { TerminalBody, type TerminalLine } from "../build/TerminalBody";
import { C } from "../build/colors";
import { ACTS_V3 } from "./timeline";

const WINDOW_W = 1620;
const WINDOW_H = 900;

const CALM_LINES: TerminalLine[] = [
	{ t: "> claude", from: 0, c: C.textSecondary },
	{ t: "", from: 6 },
	{ t: "Claude Code v0.2.14", from: 14, bold: true },
	{ t: "Workspace: SuperiorSwarm · main", from: 22, c: C.textTertiary },
	{ t: "", from: 30 },
	{ t: "> _", from: 50, c: C.textSecondary, bold: true },
];

// 120-frame act starting at ACTS_V3.collapse.from (480).
//   480–500: black + silence (slam already played at 480 via audio)
//   500–540: window fades up at scale 1.04 → 1.0
//   540–600: hold
export function CollapseV3() {
	const frame = useCurrentFrame();
	const localFrame = frame - ACTS_V3.collapse.from;

	const blackOp = interpolate(localFrame, [0, 8, 20], [0, 1, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const windowOp = interpolate(localFrame, [20, 60], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const windowScale = interpolate(localFrame, [20, 60], [1.04, 1.0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	if (
		frame < ACTS_V3.collapse.from ||
		frame >= ACTS_V3.collapse.from + ACTS_V3.collapse.durationInFrames
	) {
		return null;
	}

	return (
		<AbsoluteFill>
			<AbsoluteFill style={{ background: "#000", opacity: blackOp }} />
			<AbsoluteFill
				style={{
					alignItems: "center",
					justifyContent: "center",
					opacity: windowOp,
					transform: `scale(${windowScale})`,
				}}
			>
				<AppWindow width={WINDOW_W} height={WINDOW_H} agentCount={3}>
					<PaneColumn
						tabs={[{ id: "calm", kind: "terminal", title: "SuperiorSwarm" }]}
						activeId="calm"
					>
						<TerminalBody startFrame={ACTS_V3.collapse.from + 20} lines={CALM_LINES} />
					</PaneColumn>
				</AppWindow>
			</AbsoluteFill>
		</AbsoluteFill>
	);
}
