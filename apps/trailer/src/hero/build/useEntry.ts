import { spring, useCurrentFrame, useVideoConfig } from "remotion";

const ENTRY = { damping: 22, stiffness: 130, mass: 0.55 } as const;

export interface EntryOptions {
	from: number;
	dx?: number;
	dy?: number;
	scaleFrom?: number;
}

export function useEntry({ from, dx = 0, dy = 0, scaleFrom = 1 }: EntryOptions) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const f = frame - from;

	const op = spring({ frame: f, fps, config: ENTRY, from: 0, to: 1 });
	const x = spring({ frame: f, fps, config: ENTRY, from: dx, to: 0 });
	const y = spring({ frame: f, fps, config: ENTRY, from: dy, to: 0 });
	const scale = spring({ frame: f, fps, config: ENTRY, from: scaleFrom, to: 1 });

	return {
		opacity: op,
		transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
	};
}
