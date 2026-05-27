// Compressed 8-terminal opening for short-v1. Mirrors v4 Opening8Terminals
// visual logic but condensed to 2s (120f): 8 tiles snap in with brief stagger,
// merge resolves in the last ~30f. Hard out at scene end.

import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { OPENING_TERMINALS_V4 } from "../../build-v4/data";
import { SCENES_SHORT, SPRING_SHORT } from "../timeline";

const STAGGER = 5;
const ENTRY_OFFSET = 4;
const MERGE_START = 75;
const MERGE_END = SCENES_SHORT.opening.duration;

const TARGET = {
	left: 0,
	top: 52,
	width: 1920,
	height: 1080 - 52,
};

export function OpeningTerminalsShort() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const SCENE = SCENES_SHORT.opening;
	if (frame < SCENE.from || frame >= SCENE.from + SCENE.duration) return null;
	const local = frame - SCENE.from;

	const mergeT = interpolate(local, [MERGE_START, MERGE_END], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const tileGap = 16;
	const gridW = 1920;
	const gridH = 1080;
	const cellW = (gridW - tileGap * 5) / 4;
	const cellH = (gridH - tileGap * 3) / 2;

	return (
		<div style={{ position: "absolute", inset: 0, background: c.bgBase }}>
			{OPENING_TERMINALS_V4.map((t, i) => {
				const entry = i * STAGGER + ENTRY_OFFSET;
				const op = interpolate(local, [entry, entry + 8], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const enterScale = spring({
					frame: local - entry,
					fps,
					config: SPRING_SHORT,
					from: 0.85,
					to: 1,
				});

				const col = i % 4;
				const row = Math.floor(i / 4);
				const startLeft = tileGap + col * (cellW + tileGap);
				const startTop = tileGap + row * (cellH + tileGap);

				const left = interpolate(mergeT, [0, 1], [startLeft, TARGET.left]);
				const top = interpolate(mergeT, [0, 1], [startTop, TARGET.top]);
				const width = interpolate(mergeT, [0, 1], [cellW, TARGET.width]);
				const height = interpolate(mergeT, [0, 1], [cellH, TARGET.height]);
				const mergeOp = interpolate(mergeT, [0, 0.7, 1], [1, 1, 1 / 8], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});

				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: stable list
						key={i}
						style={{
							position: "absolute",
							left,
							top,
							width,
							height,
							background: c.bgSurface,
							border: `1px solid ${c.borderSubtle}`,
							borderRadius: interpolate(mergeT, [0, 1], [8, 0]),
							overflow: "hidden",
							display: "flex",
							flexDirection: "column",
							opacity: op * mergeOp,
							transform: `scale(${enterScale})`,
							transformOrigin: "center center",
						}}
					>
						<div
							style={{
								height: 28,
								background: c.bgTabBar,
								borderBottom: `1px solid ${c.borderSubtle}`,
								display: "flex",
								alignItems: "center",
								padding: "0 10px",
								fontSize: 11,
								color: c.textTertiary,
								gap: 8,
								opacity: interpolate(mergeT, [0.5, 1], [1, 0], {
									extrapolateLeft: "clamp",
									extrapolateRight: "clamp",
								}),
							}}
						>
							<span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff5f57" }} />
							<span style={{ width: 7, height: 7, borderRadius: "50%", background: "#febc2e" }} />
							<span style={{ width: 7, height: 7, borderRadius: "50%", background: "#28c840" }} />
							<span>{t.label}</span>
						</div>
						<div style={{ flex: 1, overflow: "hidden" }}>
							<TerminalBody startFrame={SCENE.from + entry} lines={t.lines} />
						</div>
					</div>
				);
			})}
		</div>
	);
}
