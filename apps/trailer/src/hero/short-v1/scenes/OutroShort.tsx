// Outro: pulsing logo + CTA. Mirrors v4 Outro at compressed timing (4s vs 5s).

import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AnimatedLogoV4 } from "../../build-v4/scenes/AnimatedLogoV4";
import { ThemeProviderV4, useColorsV4 } from "../../build-v4/colors-v4";
import { SCENES_SHORT } from "../timeline";

function OutroInner() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const SCENE = SCENES_SHORT.outro;
	if (frame < SCENE.from || frame >= SCENE.from + SCENE.duration) return null;
	const local = frame - SCENE.from;

	const fadeIn = interpolate(local, [0, 20], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const fadeOut = interpolate(local, [SCENE.duration - 18, SCENE.duration], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const overall = fadeIn * fadeOut;

	return (
		<AbsoluteFill
			style={{
				background: `radial-gradient(circle at center, ${c.bgSurface} 0%, ${c.bgBase} 70%)`,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 28,
				opacity: overall,
			}}
		>
			<AnimatedLogoV4 size={520} />
			<div
				style={{
					fontSize: 84,
					fontWeight: 600,
					letterSpacing: "-0.02em",
					color: c.text,
					fontFamily: "var(--font-ui)",
				}}
			>
				superiorswarm.com
			</div>
			<div
				style={{
					fontSize: 28,
					color: c.textTertiary,
					fontFamily: "var(--font-ui)",
				}}
			>
				Download for macOS
			</div>
		</AbsoluteFill>
	);
}

export function OutroShort() {
	return (
		<ThemeProviderV4 value="dark">
			<OutroInner />
		</ThemeProviderV4>
	);
}
