import { AbsoluteFill } from "remotion";

export const HERO_BUILD_V3_FRAMES = 3600;
export const HERO_BUILD_V3_FPS = 60;

export function HeroBuildV3() {
	return (
		<AbsoluteFill style={{ background: "#000", alignItems: "center", justifyContent: "center" }}>
			<div style={{ color: "#fff", fontFamily: "monospace", fontSize: 48 }}>v3 stub</div>
		</AbsoluteFill>
	);
}
