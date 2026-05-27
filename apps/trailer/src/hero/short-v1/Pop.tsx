// Element-level reveal wrapper for short-v1 "Poppy" scenes. Each Pop instance
// owns the entry animation for one piece of UI. Use multiple Pops with stepped
// `delay` values to construct a scene piece-by-piece — that's the whole point.
//
// Variants:
//   stampPop    — spring scale 0.6→1 + opacity 0→1 (default; punchy)
//   slideUp     — translateY 14→0 + opacity (rows / list items)
//   slideLeft   — translateX 24→0 (right-anchored panels)
//   slideRight  — translateX -24→0 (left-anchored panels / sidebar)
//   slideDown   — translateY -14→0 (top bars / tabs)
//   fadeIn      — pure opacity (text / overlays)
//   ringPulse   — outline pulse for "this is the focused element" beats

import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SPRING_SHORT } from "./timeline";

export type PopVariant =
	| "stampPop"
	| "slideUp"
	| "slideLeft"
	| "slideRight"
	| "slideDown"
	| "fadeIn"
	| "ringPulse";

interface Props {
	variant?: PopVariant;
	delay?: number;
	duration?: number;
	style?: CSSProperties;
	children: ReactNode;
}

export function Pop({
	variant = "stampPop",
	delay = 0,
	duration = 14,
	style,
	children,
}: Props) {
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

	const base: CSSProperties = { ...style, willChange: "transform, opacity" };

	switch (variant) {
		case "stampPop":
			return (
				<div
					style={{
						...base,
						opacity: pop,
						transform: `scale(${interpolate(pop, [0, 1], [0.62, 1])})`,
						transformOrigin: "center center",
					}}
				>
					{children}
				</div>
			);
		case "slideUp":
			return (
				<div
					style={{
						...base,
						opacity: t,
						transform: `translateY(${interpolate(t, [0, 1], [14, 0])}px)`,
					}}
				>
					{children}
				</div>
			);
		case "slideDown":
			return (
				<div
					style={{
						...base,
						opacity: t,
						transform: `translateY(${interpolate(t, [0, 1], [-14, 0])}px)`,
					}}
				>
					{children}
				</div>
			);
		case "slideLeft":
			return (
				<div
					style={{
						...base,
						opacity: t,
						transform: `translateX(${interpolate(t, [0, 1], [24, 0])}px)`,
					}}
				>
					{children}
				</div>
			);
		case "slideRight":
			return (
				<div
					style={{
						...base,
						opacity: t,
						transform: `translateX(${interpolate(t, [0, 1], [-24, 0])}px)`,
					}}
				>
					{children}
				</div>
			);
		case "fadeIn":
			return <div style={{ ...base, opacity: t }}>{children}</div>;
		case "ringPulse": {
			const pulseT = interpolate(local, [0, 22, 44], [0, 1, 0], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			});
			return (
				<div style={{ ...base, position: "relative" }}>
					{children}
					<div
						style={{
							position: "absolute",
							inset: -4,
							borderRadius: 8,
							boxShadow: `0 0 0 ${interpolate(pulseT, [0, 1], [0, 4])}px rgba(80, 200, 120, ${interpolate(pulseT, [0, 1], [0, 0.55])})`,
							pointerEvents: "none",
						}}
					/>
				</div>
			);
		}
	}
}
