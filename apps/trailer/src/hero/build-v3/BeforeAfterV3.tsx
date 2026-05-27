import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AppWindow } from "../build/AppWindow";
import { PaneColumn } from "../build/PaneColumn";
import { TerminalBody, type TerminalLine } from "../build/TerminalBody";
import { C } from "../build/colors";
import { ACTS_V3 } from "./timeline";

const WINDOW_W = 1620;
const WINDOW_H = 900;
const GHOST_SCALE = 0.32;

interface Ghost {
	x: number; // px from screen center
	y: number;
	rot: number;
	entry: number; // local frame within beforeAfter act
}

const GHOSTS: Ghost[] = [
	{ x: -700, y: -360, rot: -6, entry: 0 },
	{ x: 720, y: -380, rot: 5, entry: 8 },
	{ x: -780, y: 0, rot: -4, entry: 16 },
	{ x: 780, y: 20, rot: 6, entry: 24 },
	{ x: -680, y: 360, rot: -7, entry: 32 },
	{ x: 700, y: 380, rot: 5, entry: 40 },
	{ x: -360, y: -440, rot: -3, entry: 48 },
	{ x: 380, y: -440, rot: 4, entry: 56 },
	{ x: -360, y: 440, rot: -5, entry: 64 },
	{ x: 380, y: 440, rot: 3, entry: 72 },
	{ x: 0, y: -480, rot: -2, entry: 80 },
];

const GHOST_LINES: TerminalLine[] = [
	{ t: "> agent", from: 0, c: C.textSecondary },
	{ t: "running...", from: 12, c: C.textTertiary },
	{ t: "✓ done", from: 32, c: C.termGreen, bold: true },
];

const ACT_DUR = ACTS_V3.beforeAfter.durationInFrames; // 480
const FADE_OUT_START = ACT_DUR - 180; // last 3s

export function BeforeAfterV3() {
	const frame = useCurrentFrame();
	const localFrame = frame - ACTS_V3.beforeAfter.from;

	if (localFrame < 0 || localFrame >= ACT_DUR) return null;

	const fadeOut = interpolate(localFrame, [FADE_OUT_START, ACT_DUR], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
			{GHOSTS.map((g, i) => {
				if (localFrame < g.entry) return null;
				const enter = interpolate(localFrame, [g.entry, g.entry + 18], [0, 0.85], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const op = enter * fadeOut;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static positions
						key={i}
						style={{
							position: "absolute",
							transform: `translate3d(${g.x}px, ${g.y}px, 0) rotate(${g.rot}deg) scale(${GHOST_SCALE})`,
							opacity: op,
						}}
					>
						<AppWindow width={WINDOW_W} height={WINDOW_H} agentCount={0}>
							<PaneColumn
								tabs={[{ id: `g${i}`, kind: "terminal", title: `agent ${i}` }]}
								activeId={`g${i}`}
							>
								<TerminalBody startFrame={g.entry} lines={GHOST_LINES} />
							</PaneColumn>
						</AppWindow>
					</div>
				);
			})}
		</AbsoluteFill>
	);
}
