import { interpolate, useCurrentFrame } from "remotion";
import { WorkspaceShellV4 } from "../WorkspaceShellV4";
import { SCENES_V4 } from "../timeline";

const PROGRESS_POINTS = [0, 60, 120, 180];
const PROGRESS_VALUES = [0, 1, 1, 0];

export function ThemeSweep() {
	const frame = useCurrentFrame();
	const SCENE = SCENES_V4.s2bThemeSweep;
	if (frame < SCENE.from || frame >= SCENE.from + SCENE.duration) return null;
	const local = frame - SCENE.from;
	const opacity = interpolate(local, PROGRESS_POINTS, PROGRESS_VALUES, {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<div style={{ position: "absolute", inset: 0, opacity }}>
			<WorkspaceShellV4 mode="light" />
		</div>
	);
}
