import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { useColorsV4 } from "../colors-v4";
import { OPENING_TERMINALS_V4 } from "../data";
import { SCENES_V4, SPRING_V4 } from "../timeline";

// Tile enters at frame: (tileIndex * STAGGER) + ENTRY_OFFSET.
// All 8 visible by frame ~330. Merge starts at frame 360, ends at 420 (cuts to
// s1Terminal which renders the single full-window terminal that picks up the
// "starting point" of the rest of the trailer).
const STAGGER = 30;
const ENTRY_OFFSET = 18;
const MERGE_START = 360;
const MERGE_END = SCENES_V4.opening.from + SCENES_V4.opening.duration;

// Final shared rectangle that all 8 tiles converge into. Matches the full
// content area of AppWindowV4 (52px title bar removed).
const TARGET = {
	left: 0,
	top: 52,
	width: 1920,
	height: 1080 - 52,
};

export function Opening8Terminals() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const SCENE = SCENES_V4.opening;
	if (frame < SCENE.from || frame >= SCENE.from + SCENE.duration) return null;

	const mergeT = interpolate(frame, [MERGE_START, MERGE_END], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const tileGap = 16;
	const gridW = 1920;
	const gridH = 1080;
	const cellW = (gridW - tileGap * 5) / 4;
	const cellH = (gridH - tileGap * 3) / 2;

	// Settle blur at the very end of the merge so the cut to s1Terminal feels
	// soft rather than a hard pop.
	const settleBlur = interpolate(mergeT, [0.85, 1], [0, 4], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				background: c.bgBase,
				filter: settleBlur > 0 ? `blur(${settleBlur}px)` : undefined,
			}}
		>
			{OPENING_TERMINALS_V4.map((t, i) => {
				const entry = i * STAGGER + ENTRY_OFFSET;
				const op = interpolate(frame, [entry, entry + 18], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const enterScale = spring({
					frame: frame - entry,
					fps,
					config: SPRING_V4,
					from: 0.85,
					to: 1,
				});

				// Original grid slot (px).
				const col = i % 4;
				const row = Math.floor(i / 4);
				const startLeft = tileGap + col * (cellW + tileGap);
				const startTop = tileGap + row * (cellH + tileGap);

				// Interpolate (left, top, width, height) toward the shared target rect.
				const left = interpolate(mergeT, [0, 1], [startLeft, TARGET.left]);
				const top = interpolate(mergeT, [0, 1], [startTop, TARGET.top]);
				const width = interpolate(mergeT, [0, 1], [cellW, TARGET.width]);
				const height = interpolate(mergeT, [0, 1], [cellH, TARGET.height]);

				// Crossfade so 8 overlapping rects become one without a winner.
				// Hold opacity through 70% of the merge, then taper to a fraction so
				// they overlay rather than dominate.
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
							<TerminalBody startFrame={entry} lines={t.lines} />
						</div>
					</div>
				);
			})}
		</div>
	);
}
