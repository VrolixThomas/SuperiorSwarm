import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { ACTS_V3 } from "./timeline";

// Slow Ken-Burns push-in across the build act, pull-back during reveal.
// scale(1.0) at build start → scale(1.06) at build end → scale(0.92) during reveal.
export function CameraV3({ children }: { children: React.ReactNode }) {
	const frame = useCurrentFrame();

	const buildStart = ACTS_V3.build.from;
	const buildEnd = buildStart + ACTS_V3.build.durationInFrames;
	const beforeAfterEnd = ACTS_V3.beforeAfter.from + ACTS_V3.beforeAfter.durationInFrames;
	const revealStart = ACTS_V3.reveal.from;

	const scale = interpolate(
		frame,
		[buildStart, buildEnd, beforeAfterEnd, revealStart + 60],
		[1.0, 1.06, 1.06, 0.92],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);

	return (
		<AbsoluteFill
			style={{
				transform: `scale(${scale})`,
				transformOrigin: "50% 50%",
			}}
		>
			{children}
		</AbsoluteFill>
	);
}
