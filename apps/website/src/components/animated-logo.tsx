"use client";

import { useReducedMotion } from "motion/react";
import { useId } from "react";

type Particle = {
	cx: number;
	cy: number;
	r: number;
	fill: string;
	opacity?: number;
	filter?: "sm" | "md" | "lg" | "core";
	group: "outer" | "mid" | "inner" | "core";
	/** Opacity at the 0.45 keyTime during animation (outer/mid only) */
	animateToOpacity?: number;
};

const PARTICLES: Particle[] = [
	// — outer (8) —
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
	// — mid (7) —
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
	// — inner (5) —
	{ cx: 440, cy: 420, r: 51, fill: "#f0a060", filter: "lg", group: "inner" },
	{ cx: 604, cy: 461, r: 45, fill: "#e07030", filter: "lg", group: "inner" },
	{ cx: 491, cy: 604, r: 41, fill: "#f0b070", filter: "lg", group: "inner" },
	{ cx: 358, cy: 563, r: 36, fill: "#c05828", filter: "lg", opacity: 0.88, group: "inner" },
	{ cx: 645, cy: 378, r: 34, fill: "#e07030", filter: "lg", group: "inner" },
	// — core (2) —
	{ cx: 512, cy: 512, r: 87, fill: "white", filter: "core", opacity: 0.92, group: "core" },
	{ cx: 512, cy: 512, r: 49, fill: "white", group: "core" },
];

function FilterDefs({ prefix }: { prefix: string }) {
	return (
		<defs>
			<filter id={`${prefix}-core`} x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="28" result="b" />
				<feMerge>
					<feMergeNode in="b" />
					<feMergeNode in="SourceGraphic" />
				</feMerge>
			</filter>
			<filter id={`${prefix}-lg`} x="-80%" y="-80%" width="260%" height="260%">
				<feGaussianBlur stdDeviation="18" result="b" />
				<feMerge>
					<feMergeNode in="b" />
					<feMergeNode in="SourceGraphic" />
				</feMerge>
			</filter>
			<filter id={`${prefix}-md`} x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur stdDeviation="11" result="b" />
				<feMerge>
					<feMergeNode in="b" />
					<feMergeNode in="SourceGraphic" />
				</feMerge>
			</filter>
			<filter id={`${prefix}-sm`} x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur stdDeviation="7" result="b" />
				<feMerge>
					<feMergeNode in="b" />
					<feMergeNode in="SourceGraphic" />
				</feMerge>
			</filter>
		</defs>
	);
}

const ANIM_COMMON = {
	keyTimes: "0;0.45;1",
	dur: "3.2s",
	repeatCount: "indefinite" as const,
	calcMode: "spline" as const,
	keySplines: "0.4 0 0.6 1;0.4 0 0.6 1",
};

const GROUP_SCALES: Record<"outer" | "mid" | "inner", string> = {
	outer: "1;0.28;1",
	mid: "1;0.46;1",
	inner: "1;0.62;1",
};

function renderCircle(p: Particle, prefix: string) {
	return (
		<circle
			key={`${p.cx}-${p.cy}-${p.r}`}
			cx={p.cx}
			cy={p.cy}
			r={p.r}
			fill={p.fill}
			opacity={p.opacity}
			filter={p.filter ? `url(#${prefix}-${p.filter})` : undefined}
		/>
	);
}

function renderAnimatedCircle(p: Particle, prefix: string) {
	const baseOpacity = p.opacity ?? 1;
	const hasOpacityAnim = p.animateToOpacity !== undefined;

	return (
		<circle
			key={`${p.cx}-${p.cy}-${p.r}`}
			cx={p.cx}
			cy={p.cy}
			r={p.r}
			fill={p.fill}
			opacity={baseOpacity}
			filter={p.filter ? `url(#${prefix}-${p.filter})` : undefined}
		>
			{hasOpacityAnim && (
				<animate
					attributeName="opacity"
					values={`${baseOpacity};${p.animateToOpacity};${baseOpacity}`}
					{...ANIM_COMMON}
				/>
			)}
		</circle>
	);
}

export function AnimatedLogo({
	size = 140,
	className = "",
}: {
	size?: number;
	className?: string;
}) {
	const reduced = useReducedMotion();
	const prefix = useId();

	if (reduced) {
		return <StaticLogo size={size} className={className} />;
	}

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
			className={className}
			aria-hidden="true"
		>
			<FilterDefs prefix={prefix} />

			{/* OUTER dots -- breathe most dramatically */}
			<g style={{ transformOrigin: "512px 512px" }}>
				<animateTransform
					attributeName="transform"
					type="scale"
					values={GROUP_SCALES.outer}
					{...ANIM_COMMON}
				/>
				{outer.map((p) => renderAnimatedCircle(p, prefix))}
			</g>

			{/* MID dots */}
			<g style={{ transformOrigin: "512px 512px" }}>
				<animateTransform
					attributeName="transform"
					type="scale"
					values={GROUP_SCALES.mid}
					{...ANIM_COMMON}
				/>
				{mid.map((p) => renderAnimatedCircle(p, prefix))}
			</g>

			{/* INNER cluster -- least movement */}
			<g style={{ transformOrigin: "512px 512px" }}>
				<animateTransform
					attributeName="transform"
					type="scale"
					values={GROUP_SCALES.inner}
					{...ANIM_COMMON}
				/>
				{inner.map((p) => renderCircle(p, prefix))}
			</g>

			{/* CORE -- static */}
			{core.map((p) => renderCircle(p, prefix))}
		</svg>
	);
}

function StaticLogo({ size, className }: { size: number; className: string }) {
	const prefix = useId();

	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 1024 1024"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			aria-hidden="true"
		>
			<FilterDefs prefix={prefix} />
			{PARTICLES.map((p) => renderCircle(p, prefix))}
		</svg>
	);
}
