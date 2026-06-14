export type BandId = "folders" | "repositories" | "orchestrators";

export const ALL_BANDS: readonly BandId[] = ["folders", "repositories", "orchestrators"];

export type BandStyle =
	| { kind: "hidden" }
	| { kind: "collapsed" }
	| { kind: "flex" }
	| { kind: "fixed"; heightPx: number }
	| { kind: "auto" };

/**
 * Clamp a band's explicit (divider-dragged) height:
 *  - never below `min` px
 *  - never above `maxFraction` of the container height
 * If the container is so short that max < min, `min` wins.
 */
export function clampBandHeight(
	desired: number,
	containerHeight: number,
	opts: { min?: number; maxFraction?: number } = {}
): number {
	const min = opts.min ?? 80;
	const maxFraction = opts.maxFraction ?? 0.6;
	const max = Math.max(min, Math.floor(containerHeight * maxFraction));
	return Math.min(max, Math.max(min, Math.round(desired)));
}

export interface BandLayoutInput {
	order: BandId[];
	present: Record<BandId, boolean>;
	open: Record<BandId, boolean>;
	heights: Record<BandId, number | null>;
	preferredFlex: BandId;
	containerHeight: number;
}

/**
 * Resolve each band's render style. Exactly one open band "flexes" to absorb
 * leftover height: the preferred band when it is open and has no explicit
 * height, otherwise the bottom-most (last in order) open band with no explicit
 * height. Open bands with an explicit height are `fixed`; the rest are `auto`.
 */
export function computeBandLayout(input: BandLayoutInput): Record<BandId, BandStyle> {
	const { order, present, open, heights, preferredFlex, containerHeight } = input;

	const isOpenAuto = (id: BandId) => present[id] && open[id] && heights[id] == null;

	let flexId: BandId | null = null;
	if (isOpenAuto(preferredFlex)) {
		flexId = preferredFlex;
	} else {
		for (const id of order) {
			if (isOpenAuto(id)) flexId = id; // last match wins → bottom-most
		}
	}

	const result = {} as Record<BandId, BandStyle>;
	for (const id of ALL_BANDS) {
		if (!present[id]) {
			result[id] = { kind: "hidden" };
		} else if (!open[id]) {
			result[id] = { kind: "collapsed" };
		} else if (id === flexId) {
			result[id] = { kind: "flex" };
		} else if (heights[id] != null) {
			// `!= null` guard above proves this is a number under noUncheckedIndexedAccess.
			const heightPx = clampBandHeight(heights[id] as number, containerHeight);
			result[id] = { kind: "fixed", heightPx };
		} else {
			result[id] = { kind: "auto" };
		}
	}
	return result;
}
