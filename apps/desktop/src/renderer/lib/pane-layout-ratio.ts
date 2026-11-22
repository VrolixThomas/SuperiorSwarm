import type { Layout } from "react-resizable-panels";

/** react-resizable-panels emits percentages keyed by panel ID, not an array. */
export function ratioFromPanelLayout(splitId: string, layout: Layout): number | null {
	const first = layout[`${splitId}-first`];
	const second = layout[`${splitId}-second`];
	if (
		typeof first !== "number" ||
		typeof second !== "number" ||
		!Number.isFinite(first) ||
		!Number.isFinite(second) ||
		first < 0 ||
		second < 0 ||
		Math.abs(first + second - 100) > 0.01
	)
		return null;
	return first / 100;
}
