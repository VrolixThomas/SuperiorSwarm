import { interpolate, useCurrentFrame } from "remotion";
import { WorkspaceShellV4 } from "../WorkspaceShellV4";
import { SCENES_V4 } from "../timeline";

// 75° diagonal sweep: clip-path defined by a near-vertical line that slides
// from far-left (entirely off-screen) → full reveal → back to far-left.
// Reveal animates 0→100→0 over the scene's 180 frames.
const PROGRESS_POINTS = [0, 60, 120, 180]; // local frames
const PROGRESS_VALUES = [0, 1, 1, 0]; // 0=hidden, 1=full reveal

export function ThemeSweep() {
	const frame = useCurrentFrame();
	const SCENE = SCENES_V4.s2bThemeSweep;
	if (frame < SCENE.from || frame >= SCENE.from + SCENE.duration) return null;
	const local = frame - SCENES_V4.s2bThemeSweep.from;
	const t = interpolate(local, PROGRESS_POINTS, PROGRESS_VALUES, {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// At t=0: light layer clipped completely (line at x=-200% on top, x=0% on bottom).
	// At t=1: light layer fully revealed (line at x=100% on top, x=120% on bottom).
	const topX = interpolate(t, [0, 1], [-30, 110]);
	const bottomX = interpolate(t, [0, 1], [-10, 130]);

	const clip = `polygon(0 0, ${topX}% 0, ${bottomX}% 100%, 0% 100%)`;

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				clipPath: clip,
				WebkitClipPath: clip,
			}}
		>
			<WorkspaceShellV4 mode="light" />
		</div>
	);
}
