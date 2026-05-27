import { interpolate, useCurrentFrame } from "remotion";
import { C } from "./colors";

interface Props {
	state: "active" | "done";
	size?: number;
	frameOffset?: number;
}

// Frame-driven orbital dot logo. Matches WorkspaceItem.tsx `SwarmIndicator` visuals.
export function SwarmIndicator({ state, size = 22, frameOffset = 0 }: Props) {
	const frame = useCurrentFrame() + frameOffset;
	const animated = state === "active";
	const cycle = 120;
	const local = ((frame % cycle) + cycle) % cycle;
	const phase = local / cycle;
	const orbitalScale = animated ? interpolate(phase, [0, 0.45, 1], [1, 0.55, 1]) : 1;
	const innerScale = animated ? interpolate(phase, [0, 0.45, 1], [1, 0.7, 1]) : 1;
	const dotOp = animated ? interpolate(phase, [0, 0.45, 1], [0.85, 0.15, 0.85]) : 0.85;

	const c1 = state === "done" ? C.swarm.doneC1 : C.swarm.activeC1;
	const c2 = state === "done" ? C.swarm.doneC2 : C.swarm.activeC2;
	const c3 = state === "done" ? C.swarm.doneC3 : C.swarm.activeC3;
	const core = state === "done" ? C.termGreen : "#ffffff";

	return (
		<svg width={size} height={size} viewBox="0 0 100 100" aria-label="agent" role="img">
			<g style={{ transform: `scale(${orbitalScale})`, transformOrigin: "50px 50px" }}>
				<circle cx="26" cy="36" r="7" fill={c3} opacity={dotOp} />
				<circle cx="72" cy="30" r="6" fill={c2} opacity={dotOp} />
				<circle cx="78" cy="62" r="7" fill={c1} opacity={dotOp} />
				<circle cx="35" cy="75" r="6" fill={c2} opacity={dotOp} />
			</g>
			<g style={{ transform: `scale(${innerScale})`, transformOrigin: "50px 50px" }}>
				<circle cx="38" cy="40" r="9" fill={c1} opacity={0.9} />
				<circle cx="65" cy="44" r="8" fill={c2} opacity={0.85} />
				<circle cx="48" cy="67" r="7" fill={c1} opacity={0.8} />
			</g>
			<circle cx="50" cy="50" r="10" fill={core} opacity={0.95} />
		</svg>
	);
}
