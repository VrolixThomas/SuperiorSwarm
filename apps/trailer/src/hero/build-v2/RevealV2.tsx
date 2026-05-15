import { AbsoluteFill, Freeze, interpolate, useCurrentFrame } from "remotion";
import { Bg } from "../Bg";
import { PulsingLogo } from "../build/PulsingLogo";
import { INTER } from "../build/fonts";
import { WorkspaceV2 } from "./Workspace";
import { ACTS_V2 } from "./timeline";

// Mirrors apps/trailer/src/hero/Reveal.tsx structurally but freezes WorkspaceV2
// at its final build frame instead of v1's Workspace.

const ACCENT = "#c4956c";
const BRAND = "#e07030";
const GLOW = "rgba(224,112,48,0.32)";

const LOGO_IN = 14;
const WORDMARK_LEFT_IN = 20;
const WORDMARK_RIGHT_IN = 26;
const URL_START = 60;
const HOLD_GLOW_START = 380;
const REVEAL_DUR = ACTS_V2.reveal.durationInFrames;

export function RevealV2() {
	const frame = useCurrentFrame();

	const workspaceDim = interpolate(frame, [0, 12], [1, 0.05], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const overlayOp = interpolate(frame, [6, 18], [0, 0.95], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const logoOp = interpolate(frame, [LOGO_IN - 8, LOGO_IN + 4], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const logoScale = interpolate(frame, [LOGO_IN - 8, LOGO_IN + 12], [0.92, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const leftBlockOp = interpolate(frame, [WORDMARK_LEFT_IN, WORDMARK_LEFT_IN + 16], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const rightBlockOp = interpolate(frame, [WORDMARK_RIGHT_IN, WORDMARK_RIGHT_IN + 16], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const urlOp = interpolate(frame, [URL_START, URL_START + 22], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const urlY = interpolate(frame, [URL_START, URL_START + 22], [10, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const glowBoost = interpolate(frame, [HOLD_GLOW_START, REVEAL_DUR], [1, 1.35], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const finalFade = interpolate(frame, [REVEAL_DUR - 30, REVEAL_DUR], [1, 0.85], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<AbsoluteFill>
			<Bg />
			{/* Freeze WorkspaceV2 at its final build frame (one before reveal). */}
			<Freeze frame={ACTS_V2.reveal.from - 1}>
				<AbsoluteFill style={{ opacity: workspaceDim }}>
					<WorkspaceV2 />
				</AbsoluteFill>
			</Freeze>
			<AbsoluteFill
				style={{
					background:
						"radial-gradient(ellipse 60% 50% at 50% 50%, rgba(5,5,7,0.6) 0%, rgba(5,5,7,0.95) 75%)",
					opacity: overlayOp,
				}}
			/>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse 48% 38% at 50% 48%, ${GLOW} 0%, transparent 70%)`,
					opacity: (glowBoost - 0.4) * finalFade,
				}}
			/>
			<AbsoluteFill
				style={{
					alignItems: "center",
					justifyContent: "center",
					fontFamily: INTER,
					flexDirection: "column",
					pointerEvents: "none",
					opacity: finalFade,
				}}
			>
				<div
					style={{
						opacity: logoOp,
						transform: `scale(${logoScale})`,
						filter: `drop-shadow(0 0 ${46 * glowBoost}px ${GLOW})`,
					}}
				>
					<PulsingLogo size={168} />
				</div>
				<div
					style={{
						marginTop: 26,
						fontWeight: 900,
						fontSize: 92,
						letterSpacing: -2.4,
						lineHeight: 1,
						textShadow: `0 0 36px ${GLOW}`,
						display: "flex",
					}}
				>
					<span style={{ color: ACCENT, opacity: leftBlockOp }}>Superior</span>
					<span style={{ color: BRAND, opacity: rightBlockOp }}>Swarm</span>
				</div>
				<div
					style={{
						marginTop: 28,
						fontWeight: 500,
						fontSize: 26,
						color: ACCENT,
						letterSpacing: 4,
						textTransform: "uppercase",
						opacity: urlOp,
						transform: `translateY(${urlY}px)`,
						textShadow: `0 0 18px ${GLOW}`,
					}}
				>
					superiorswarm.com
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
}
