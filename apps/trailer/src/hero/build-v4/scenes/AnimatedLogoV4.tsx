import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

// Frame-driven port of apps/website/src/components/animated-logo.tsx. The
// website version uses SVG <animate>/<animateTransform> which play in
// wall-clock time and are not frame-deterministic under Remotion render.
// Here we drive the same scale/opacity envelopes from useCurrentFrame.

type Particle = {
	cx: number;
	cy: number;
	r: number;
	fill: string;
	opacity?: number;
	filter?: "sm" | "md" | "lg" | "core";
	group: "outer" | "mid" | "inner" | "core";
	animateToOpacity?: number;
};

const PARTICLES: Particle[] = [
	// outer (8)
	{
		cx: 829,
		cy: 645,
		r: 17,
		fill: "#e07030",
		filter: "sm",
		opacity: 0.55,
		animateToOpacity: 0,
		group: "outer",
	},
	{ cx: 195, cy: 481, r: 15, fill: "#a04020", opacity: 0.45, animateToOpacity: 0, group: "outer" },
	{
		cx: 624,
		cy: 850,
		r: 16,
		fill: "#f0a060",
		filter: "sm",
		opacity: 0.48,
		animateToOpacity: 0,
		group: "outer",
	},
	{ cx: 850, cy: 358, r: 14, fill: "#e07030", opacity: 0.38, animateToOpacity: 0, group: "outer" },
	{ cx: 154, cy: 563, r: 13, fill: "#a04020", opacity: 0.34, animateToOpacity: 0, group: "outer" },
	{
		cx: 522,
		cy: 891,
		r: 15,
		fill: "#f0a060",
		filter: "sm",
		opacity: 0.38,
		animateToOpacity: 0,
		group: "outer",
	},
	{ cx: 870, cy: 522, r: 12, fill: "#c05828", opacity: 0.28, animateToOpacity: 0, group: "outer" },
	{ cx: 317, cy: 829, r: 11, fill: "#a04020", opacity: 0.26, animateToOpacity: 0, group: "outer" },
	// mid (7)
	{
		cx: 747,
		cy: 542,
		r: 30,
		fill: "#e07030",
		filter: "md",
		opacity: 1,
		animateToOpacity: 0.35,
		group: "mid",
	},
	{
		cx: 297,
		cy: 379,
		r: 27,
		fill: "#c05828",
		filter: "md",
		opacity: 0.82,
		animateToOpacity: 0.2,
		group: "mid",
	},
	{
		cx: 583,
		cy: 727,
		r: 29,
		fill: "#f0a060",
		filter: "md",
		opacity: 1,
		animateToOpacity: 0.3,
		group: "mid",
	},
	{
		cx: 707,
		cy: 317,
		r: 25,
		fill: "#f0b070",
		filter: "md",
		opacity: 1,
		animateToOpacity: 0.3,
		group: "mid",
	},
	{
		cx: 256,
		cy: 624,
		r: 24,
		fill: "#a04020",
		filter: "md",
		opacity: 0.78,
		animateToOpacity: 0.15,
		group: "mid",
	},
	{
		cx: 768,
		cy: 420,
		r: 26,
		fill: "#e07030",
		filter: "md",
		opacity: 1,
		animateToOpacity: 0.3,
		group: "mid",
	},
	{
		cx: 399,
		cy: 747,
		r: 23,
		fill: "#c05828",
		filter: "md",
		opacity: 0.72,
		animateToOpacity: 0.15,
		group: "mid",
	},
	// inner (5)
	{ cx: 440, cy: 420, r: 51, fill: "#f0a060", filter: "lg", group: "inner" },
	{ cx: 604, cy: 461, r: 45, fill: "#e07030", filter: "lg", group: "inner" },
	{ cx: 491, cy: 604, r: 41, fill: "#f0b070", filter: "lg", group: "inner" },
	{ cx: 358, cy: 563, r: 36, fill: "#c05828", filter: "lg", opacity: 0.88, group: "inner" },
	{ cx: 645, cy: 378, r: 34, fill: "#e07030", filter: "lg", group: "inner" },
	// core (2)
	{ cx: 512, cy: 512, r: 87, fill: "white", filter: "core", opacity: 0.92, group: "core" },
	{ cx: 512, cy: 512, r: 49, fill: "white", group: "core" },
];

const FILTER_STD: Record<"sm" | "md" | "lg" | "core", number> = {
	sm: 7,
	md: 11,
	lg: 18,
	core: 28,
};

// Original duration in the website: 3.2s. Keep parity.
const CYCLE_SECONDS = 3.2;

function FilterDefs({ prefix }: { prefix: string }) {
	return (
		<defs>
			{(Object.keys(FILTER_STD) as Array<"sm" | "md" | "lg" | "core">).map((k) => (
				<filter
					key={k}
					id={`${prefix}-${k}`}
					x={k === "core" ? "-50%" : k === "lg" ? "-80%" : "-100%"}
					y={k === "core" ? "-50%" : k === "lg" ? "-80%" : "-100%"}
					width={k === "core" ? "200%" : k === "lg" ? "260%" : "300%"}
					height={k === "core" ? "200%" : k === "lg" ? "260%" : "300%"}
				>
					<feGaussianBlur stdDeviation={FILTER_STD[k]} result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			))}
		</defs>
	);
}

const GROUP_SCALES: Record<"outer" | "mid" | "inner", [number, number, number]> = {
	outer: [1, 0.28, 1],
	mid: [1, 0.46, 1],
	inner: [1, 0.62, 1],
};

// Frame-aware (0..1) phase within the breath cycle.
function breathPhase(frame: number, fps: number) {
	const cycleFrames = Math.max(1, Math.round(CYCLE_SECONDS * fps));
	return (((frame % cycleFrames) + cycleFrames) % cycleFrames) / cycleFrames;
}

export function AnimatedLogoV4({ size = 600 }: { size?: number }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const phase = breathPhase(frame, fps);
	const prefix = "logo";

	const scaleFor = (group: "outer" | "mid" | "inner") => {
		const [a, b, c] = GROUP_SCALES[group];
		return interpolate(phase, [0, 0.45, 1], [a, b, c]);
	};

	const opacityFor = (p: Particle) => {
		if (p.animateToOpacity === undefined) return p.opacity ?? 1;
		const base = p.opacity ?? 1;
		return interpolate(phase, [0, 0.45, 1], [base, p.animateToOpacity, base]);
	};

	const renderCircle = (p: Particle, useOpacityAnim: boolean) => (
		<circle
			key={`${p.cx}-${p.cy}-${p.r}`}
			cx={p.cx}
			cy={p.cy}
			r={p.r}
			fill={p.fill}
			opacity={useOpacityAnim ? opacityFor(p) : p.opacity}
			filter={p.filter ? `url(#${prefix}-${p.filter})` : undefined}
		/>
	);

	const outer = PARTICLES.filter((p) => p.group === "outer");
	const mid = PARTICLES.filter((p) => p.group === "mid");
	const inner = PARTICLES.filter((p) => p.group === "inner");
	const core = PARTICLES.filter((p) => p.group === "core");

	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 1024 1024"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<FilterDefs prefix={prefix} />

			<g style={{ transform: `scale(${scaleFor("outer")})`, transformOrigin: "512px 512px" }}>
				{outer.map((p) => renderCircle(p, true))}
			</g>
			<g style={{ transform: `scale(${scaleFor("mid")})`, transformOrigin: "512px 512px" }}>
				{mid.map((p) => renderCircle(p, true))}
			</g>
			<g style={{ transform: `scale(${scaleFor("inner")})`, transformOrigin: "512px 512px" }}>
				{inner.map((p) => renderCircle(p, false))}
			</g>
			{core.map((p) => renderCircle(p, false))}
		</svg>
	);
}
