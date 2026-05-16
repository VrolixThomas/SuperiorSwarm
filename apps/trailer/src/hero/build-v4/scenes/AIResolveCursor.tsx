import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { useColorsV4 } from "../colors-v4";
import { SCENES_V4, SPRING_V4 } from "../timeline";

// Cursor path: starts at center of screen, moves to right panel's Solve-with-AI button.
// Target: roughly x=1700, y=820 (right panel button anchor).
const CURSOR_START = { x: 960, y: 540 };
const CURSOR_TARGET = { x: 1700, y: 820 };
const MOVE_START_FRAME = 60;
const MOVE_END_FRAME = 180;
const CLICK_FRAME = 200;
const RIPPLE_DUR = 30;

export function AIResolveCursor() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const SCENE = SCENES_V4.s7PRComment;
	if (frame < SCENE.from || frame >= SCENE.from + SCENE.duration) return null;
	const { fps } = useVideoConfig();
	const local = frame - SCENES_V4.s7PRComment.from;

	const eased = spring({
		frame: local - MOVE_START_FRAME,
		fps,
		config: SPRING_V4,
		from: 0,
		to: 1,
		durationInFrames: MOVE_END_FRAME - MOVE_START_FRAME,
	});

	const x = interpolate(eased, [0, 1], [CURSOR_START.x, CURSOR_TARGET.x]);
	const y = interpolate(eased, [0, 1], [CURSOR_START.y, CURSOR_TARGET.y]);

	const showRipple = local >= CLICK_FRAME && local < CLICK_FRAME + RIPPLE_DUR;
	const rippleScale = showRipple
		? interpolate(local - CLICK_FRAME, [0, RIPPLE_DUR], [0.3, 2.4], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 0;
	const rippleOp = showRipple
		? interpolate(local - CLICK_FRAME, [0, RIPPLE_DUR], [0.8, 0], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 0;

	const opCursor = interpolate(local, [0, 30, 220, 250], [0, 1, 1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			{showRipple && (
				<div
					style={{
						position: "absolute",
						left: CURSOR_TARGET.x - 30,
						top: CURSOR_TARGET.y - 30,
						width: 60,
						height: 60,
						borderRadius: "50%",
						background: c.accent,
						transform: `scale(${rippleScale})`,
						opacity: rippleOp,
						pointerEvents: "none",
					}}
				/>
			)}
			<svg
				role="img"
				aria-label="cursor"
				width="32"
				height="32"
				viewBox="0 0 24 24"
				style={{
					position: "absolute",
					left: x - 6,
					top: y - 4,
					opacity: opCursor,
					pointerEvents: "none",
					filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
				}}
			>
				<path
					d="M5 3 L19 12 L12 13 L9 20 Z"
					fill={c.text}
					stroke={c.bgBase}
					strokeWidth="1.5"
					strokeLinejoin="round"
				/>
			</svg>
		</>
	);
}
