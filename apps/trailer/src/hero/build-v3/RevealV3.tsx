import { AbsoluteFill, Freeze, interpolate, useCurrentFrame } from "remotion";
import { Bg } from "../Bg";
import { INTER } from "../build/fonts";
import { WorkspaceV3 } from "./WorkspaceV3";
import { ACTS_V3 } from "./timeline";

const ACCENT = "#c4956c";
const BRAND = "#e07030";

const WORDMARK_LEFT_IN = 28;
const WORDMARK_RIGHT_IN = 36;
const URL_START = 80;
const REVEAL_DUR = ACTS_V3.reveal.durationInFrames; // 720

export function RevealV3() {
	const frame = useCurrentFrame();
	const buildEnd = ACTS_V3.build.from + ACTS_V3.build.durationInFrames;

	const workspaceDim = interpolate(frame, [0, 24], [0.85, 0.06], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const overlayOp = interpolate(frame, [12, 32], [0, 0.95], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const leftBlockOp = interpolate(frame, [WORDMARK_LEFT_IN, WORDMARK_LEFT_IN + 22], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const rightBlockOp = interpolate(frame, [WORDMARK_RIGHT_IN, WORDMARK_RIGHT_IN + 22], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const ruleOp = interpolate(frame, [WORDMARK_RIGHT_IN + 18, WORDMARK_RIGHT_IN + 40], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const ruleW = interpolate(frame, [WORDMARK_RIGHT_IN + 18, WORDMARK_RIGHT_IN + 40], [0, 220], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const urlOp = interpolate(frame, [URL_START, URL_START + 26], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const urlY = interpolate(frame, [URL_START, URL_START + 26], [12, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const finalFade = interpolate(frame, [REVEAL_DUR - 60, REVEAL_DUR], [1, 0.85], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<AbsoluteFill>
			<Bg />
			<Freeze frame={buildEnd - 1}>
				<AbsoluteFill style={{ opacity: workspaceDim }}>
					<WorkspaceV3 />
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
						fontWeight: 900,
						fontSize: 124,
						letterSpacing: -3,
						lineHeight: 1,
						display: "flex",
					}}
				>
					<span style={{ color: ACCENT, opacity: leftBlockOp }}>Superior</span>
					<span style={{ color: BRAND, opacity: rightBlockOp }}>Swarm</span>
				</div>
				<div
					style={{
						marginTop: 32,
						width: ruleW,
						height: 2,
						background: ACCENT,
						opacity: ruleOp,
					}}
				/>
				<div
					style={{
						marginTop: 24,
						fontWeight: 500,
						fontSize: 30,
						color: ACCENT,
						letterSpacing: 5,
						textTransform: "uppercase",
						opacity: urlOp,
						transform: `translateY(${urlY}px)`,
					}}
				>
					superiorswarm.com
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
}
