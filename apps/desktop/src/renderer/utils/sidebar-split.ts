/**
 * Clamp the orchestrator pane's height to a sane range:
 *  - never below `min` px
 *  - never above `maxFraction` of the available container height
 * If the container is so short that max < min, `min` wins (the divider just
 * stops being draggable smaller).
 */
export function clampPaneHeight(
	desired: number,
	containerHeight: number,
	opts: { min?: number; maxFraction?: number } = {}
): number {
	const min = opts.min ?? 80;
	const maxFraction = opts.maxFraction ?? 0.6;
	const max = Math.max(min, Math.floor(containerHeight * maxFraction));
	return Math.min(max, Math.max(min, Math.round(desired)));
}
