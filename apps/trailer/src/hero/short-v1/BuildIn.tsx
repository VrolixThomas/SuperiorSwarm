// Reveal primitive for short-v1. Wraps a region and animates it IN from the
// start of the enclosing Sequence. Variants drive the "epic build" feel:
//   slideFromLeft   — sidebar
//   slideFromRight  — right panel / split file pane
//   slideFromTop    — tab strip / branch action bar
//   revealTopDown   — file content / list rows (clip-path mask top→bottom)
//   stampPop        — per-item spring pop (use Stagger to chain)
//   scaleDownOut    — pullback at end of comp (reverse build for outro lead-in)
//
// All variants finish in ~0.6s by default; pass `duration` for tighter beats.

import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SPRING_SHORT } from "./timeline";

type Variant =
	| "slideFromLeft"
	| "slideFromRight"
	| "slideFromTop"
	| "revealTopDown"
	| "stampPop"
	| "scaleDownOut";

interface Props {
	variant: Variant;
	children: ReactNode;
	duration?: number;
	delay?: number;
	style?: CSSProperties;
}

export function BuildIn({ variant, children, duration = 24, delay = 0, style }: Props) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const local = frame - delay;

	const t = interpolate(local, [0, duration], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const pop = spring({
		frame: local,
		fps,
		config: SPRING_SHORT,
		from: 0,
		to: 1,
	});

	const wrap: CSSProperties = { ...style, willChange: "transform, opacity, clip-path" };

	switch (variant) {
		case "slideFromLeft":
			return (
				<div
					style={{
						...wrap,
						transform: `translateX(${interpolate(t, [0, 1], [-80, 0])}px)`,
						opacity: t,
					}}
				>
					{children}
				</div>
			);
		case "slideFromRight":
			return (
				<div
					style={{
						...wrap,
						transform: `translateX(${interpolate(t, [0, 1], [80, 0])}px)`,
						opacity: t,
					}}
				>
					{children}
				</div>
			);
		case "slideFromTop":
			return (
				<div
					style={{
						...wrap,
						transform: `translateY(${interpolate(t, [0, 1], [-24, 0])}px)`,
						opacity: t,
					}}
				>
					{children}
				</div>
			);
		case "revealTopDown":
			return (
				<div
					style={{
						...wrap,
						clipPath: `inset(0 0 ${interpolate(t, [0, 1], [100, 0])}% 0)`,
						opacity: interpolate(t, [0, 0.2], [0, 1], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						}),
					}}
				>
					{children}
				</div>
			);
		case "stampPop":
			return (
				<div
					style={{
						...wrap,
						transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
						opacity: pop,
						transformOrigin: "center center",
					}}
				>
					{children}
				</div>
			);
		case "scaleDownOut":
			return (
				<div
					style={{
						...wrap,
						transform: `scale(${interpolate(t, [0, 1], [1, 0.85])})`,
						opacity: interpolate(t, [0, 1], [1, 0]),
						transformOrigin: "center center",
					}}
				>
					{children}
				</div>
			);
	}
}
