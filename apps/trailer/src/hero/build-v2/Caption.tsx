import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { INTER } from "../build/fonts";
import { BEAT_COPY } from "./beat-copy";

// One caption per beat. Cross-fade swap on beat start.
// Rendered absolute-coordinated; pass in current frame from composition root.
export function CaptionV2() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const entries = BEAT_COPY.map((b) => ({ key: b.key, text: b.caption, start: b.startFrame }));

	// Determine active caption by last start <= frame.
	let active = entries[0];
	for (const e of entries) {
		if (frame >= e.start) active = e;
	}
	if (!active) return null;

	const localFrame = frame - active.start;
	const inAmt = spring({
		frame: localFrame,
		fps,
		config: { damping: 22, stiffness: 110, mass: 0.7 },
		from: 0,
		to: 1,
	});
	const idx = entries.indexOf(active);
	const next = entries[idx + 1];
	const outAmt = next
		? interpolate(localFrame, [next.start - active.start - 18, next.start - active.start], [1, 0], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 1;
	const opacity = Math.min(inAmt, outAmt);
	const translateY = (1 - inAmt) * 12;

	if (!active.text) return null;

	return (
		<div
			style={{
				position: "absolute",
				bottom: 96,
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
					fontWeight: 500,
					fontSize: 36,
					letterSpacing: "-0.01em",
					color: "#f5f5f7",
					opacity,
					transform: `translateY(${translateY}px)`,
					textShadow: "0 2px 24px rgba(0,0,0,0.6)",
				}}
			>
				{active.text}
			</div>
		</div>
	);
}
