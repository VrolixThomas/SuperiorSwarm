import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { INTER } from "../build/fonts";
import { BEAT_COPY_V3 } from "./beat-copy";
import { SPRING_V3 } from "./timeline";

const HOLD_FRAMES = 240; // captions hold ~4s, fade out 30f before next

export function CaptionV3() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	let active: (typeof BEAT_COPY_V3)[number] | undefined;
	for (const e of BEAT_COPY_V3) {
		if (frame >= e.startFrame) active = e;
	}
	if (!active || !active.caption) return null;

	const localFrame = frame - active.startFrame;
	const idx = BEAT_COPY_V3.indexOf(active);
	const next = BEAT_COPY_V3[idx + 1];
	const fadeOutStart = next ? next.startFrame - active.startFrame - 24 : HOLD_FRAMES + 60;

	const inAmt = spring({
		frame: localFrame,
		fps,
		config: SPRING_V3,
		from: 0,
		to: 1,
	});
	const outAmt = interpolate(localFrame, [fadeOutStart, fadeOutStart + 24], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const opacity = Math.min(inAmt, outAmt);
	const translateY = (1 - inAmt) * 24;

	return (
		<div
			style={{
				position: "absolute",
				bottom: 120,
				left: 0,
				right: 0,
				display: "flex",
				justifyContent: "center",
				pointerEvents: "none",
			}}
		>
			<div
				style={{
					fontFamily: INTER,
					fontWeight: 800,
					fontSize: 64,
					letterSpacing: "-0.02em",
					color: "#f5f5f7",
					opacity,
					transform: `translateY(${translateY}px)`,
					textShadow: "0 4px 32px rgba(0,0,0,0.8)",
					maxWidth: 1400,
					textAlign: "center",
					lineHeight: 1.1,
				}}
			>
				{active.caption}
			</div>
		</div>
	);
}
