import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { useColorsV4 } from "../colors-v4";
import { OPENING_TERMINALS_V4 } from "../data";
import { SCENES_V4, SPRING_V4 } from "../timeline";

// Tile enters at frame: (tileIndex * STAGGER) + ENTRY_OFFSET.
// All 8 visible by frame ~330. Collapse starts at frame 360, ends at 420.
const STAGGER = 30;
const ENTRY_OFFSET = 18;
const COLLAPSE_START = 360;
const COLLAPSE_END = SCENES_V4.opening.from + SCENES_V4.opening.duration;

export function Opening8Terminals() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const SCENE = SCENES_V4.opening;
	if (frame < SCENE.from || frame >= SCENE.from + SCENE.duration) return null;
	const { fps } = useVideoConfig();

	const collapseT = interpolate(frame, [COLLAPSE_START, COLLAPSE_END], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const tileGap = 16;
	const gridW = 1920;
	const gridH = 1080;
	const cellW = (gridW - tileGap * 5) / 4;
	const cellH = (gridH - tileGap * 3) / 2;

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				background: c.bgBase,
				padding: tileGap,
				display: "grid",
				gridTemplateColumns: `repeat(4, ${cellW}px)`,
				gridTemplateRows: `repeat(2, ${cellH}px)`,
				gap: tileGap,
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

				// During collapse: tiles 0-6 fade and scale down; tile 4 (middle-ish, swarm)
				// scales up to fill the center.
				const isAnchor = i === 4;
				const collapseOp = isAnchor ? 1 : interpolate(collapseT, [0, 1], [1, 0]);
				const collapseScale = isAnchor
					? interpolate(collapseT, [0, 1], [1, 2.3])
					: interpolate(collapseT, [0, 1], [1, 0.8]);

				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: stable list
						key={i}
						style={{
							background: c.bgSurface,
							border: `1px solid ${c.borderSubtle}`,
							borderRadius: 8,
							overflow: "hidden",
							display: "flex",
							flexDirection: "column",
							opacity: op * collapseOp,
							transform: `scale(${enterScale * collapseScale})`,
							transformOrigin: isAnchor ? "center center" : "center center",
							zIndex: isAnchor ? 2 : 1,
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
