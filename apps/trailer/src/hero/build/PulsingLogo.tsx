import { interpolate, useCurrentFrame } from "remotion";

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
	{ cx: 829, cy: 645, r: 17, fill: "#e07030", filter: "sm", opacity: 0.55, animateToOpacity: 0, group: "outer" },
	{ cx: 195, cy: 481, r: 15, fill: "#a04020", opacity: 0.45, animateToOpacity: 0, group: "outer" },
	{ cx: 624, cy: 850, r: 16, fill: "#f0a060", filter: "sm", opacity: 0.48, animateToOpacity: 0, group: "outer" },
	{ cx: 850, cy: 358, r: 14, fill: "#e07030", opacity: 0.38, animateToOpacity: 0, group: "outer" },
	{ cx: 154, cy: 563, r: 13, fill: "#a04020", opacity: 0.34, animateToOpacity: 0, group: "outer" },
	{ cx: 522, cy: 891, r: 15, fill: "#f0a060", filter: "sm", opacity: 0.38, animateToOpacity: 0, group: "outer" },
	{ cx: 870, cy: 522, r: 12, fill: "#c05828", opacity: 0.28, animateToOpacity: 0, group: "outer" },
	{ cx: 317, cy: 829, r: 11, fill: "#a04020", opacity: 0.26, animateToOpacity: 0, group: "outer" },
	{ cx: 747, cy: 542, r: 30, fill: "#e07030", filter: "md", opacity: 1, animateToOpacity: 0.35, group: "mid" },
	{ cx: 297, cy: 379, r: 27, fill: "#c05828", filter: "md", opacity: 0.82, animateToOpacity: 0.2, group: "mid" },
	{ cx: 583, cy: 727, r: 29, fill: "#f0a060", filter: "md", opacity: 1, animateToOpacity: 0.3, group: "mid" },
	{ cx: 707, cy: 317, r: 25, fill: "#f0b070", filter: "md", opacity: 1, animateToOpacity: 0.3, group: "mid" },
	{ cx: 256, cy: 624, r: 24, fill: "#a04020", filter: "md", opacity: 0.78, animateToOpacity: 0.15, group: "mid" },
	{ cx: 768, cy: 420, r: 26, fill: "#e07030", filter: "md", opacity: 1, animateToOpacity: 0.3, group: "mid" },
	{ cx: 399, cy: 747, r: 23, fill: "#c05828", filter: "md", opacity: 0.72, animateToOpacity: 0.15, group: "mid" },
	{ cx: 440, cy: 420, r: 51, fill: "#f0a060", filter: "lg", group: "inner" },
	{ cx: 604, cy: 461, r: 45, fill: "#e07030", filter: "lg", group: "inner" },
	{ cx: 491, cy: 604, r: 41, fill: "#f0b070", filter: "lg", group: "inner" },
	{ cx: 358, cy: 563, r: 36, fill: "#c05828", filter: "lg", opacity: 0.88, group: "inner" },
	{ cx: 645, cy: 378, r: 34, fill: "#e07030", filter: "lg", group: "inner" },
	{ cx: 512, cy: 512, r: 87, fill: "white", filter: "core", opacity: 0.92, group: "core" },
	{ cx: 512, cy: 512, r: 49, fill: "white", group: "core" },
];

const GROUP_SCALES = {
	outer: [1, 0.28, 1],
	mid: [1, 0.46, 1],
	inner: [1, 0.62, 1],
} as const;

function pulse(frame: number, values: readonly [number, number, number]) {
	const cycle = frame % 192;
	return interpolate(cycle, [0, 86, 192], values, {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
}

function LogoCircle({ particle, opacity }: { particle: Particle; opacity?: number }) {
	return (
		<circle
			cx={particle.cx}
			cy={particle.cy}
			r={particle.r}
			fill={particle.fill}
			opacity={opacity ?? particle.opacity}
			filter={particle.filter ? `url(#logo-${particle.filter})` : undefined}
		/>
	);
}

export function PulsingLogo({ size = 154 }: { size?: number }) {
	const frame = useCurrentFrame();
	const outerScale = pulse(frame, GROUP_SCALES.outer);
	const midScale = pulse(frame, GROUP_SCALES.mid);
	const innerScale = pulse(frame, GROUP_SCALES.inner);
	const phaseOpacity = interpolate(frame % 192, [0, 86, 192], [0, 1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const groups = {
		outer: PARTICLES.filter((p) => p.group === "outer"),
		mid: PARTICLES.filter((p) => p.group === "mid"),
		inner: PARTICLES.filter((p) => p.group === "inner"),
		core: PARTICLES.filter((p) => p.group === "core"),
	};

	return (
		<svg width={size} height={size} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<defs>
				<filter id="logo-core" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="28" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="logo-lg" x="-80%" y="-80%" width="260%" height="260%">
					<feGaussianBlur stdDeviation="18" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="logo-md" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="11" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="logo-sm" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="7" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<g transform={`translate(512 512) scale(${outerScale}) translate(-512 -512)`}>
				{groups.outer.map((p) => (
					<LogoCircle
						key={`${p.cx}-${p.cy}-${p.r}`}
						particle={p}
						opacity={interpolate(phaseOpacity, [0, 1], [p.opacity ?? 1, p.animateToOpacity ?? p.opacity ?? 1])}
					/>
				))}
			</g>
			<g transform={`translate(512 512) scale(${midScale}) translate(-512 -512)`}>
				{groups.mid.map((p) => (
					<LogoCircle
						key={`${p.cx}-${p.cy}-${p.r}`}
						particle={p}
						opacity={interpolate(phaseOpacity, [0, 1], [p.opacity ?? 1, p.animateToOpacity ?? p.opacity ?? 1])}
					/>
				))}
			</g>
			<g transform={`translate(512 512) scale(${innerScale}) translate(-512 -512)`}>
				{groups.inner.map((p) => (
					<LogoCircle key={`${p.cx}-${p.cy}-${p.r}`} particle={p} />
				))}
			</g>
			{groups.core.map((p) => (
				<LogoCircle key={`${p.cx}-${p.cy}-${p.r}`} particle={p} />
			))}
		</svg>
	);
}
