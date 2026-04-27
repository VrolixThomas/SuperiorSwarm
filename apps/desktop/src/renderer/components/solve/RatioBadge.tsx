import type { SolveGroupInfo } from "../../../shared/solve-types";

export function RatioBadge({ group }: { group: SolveGroupInfo }) {
	const fixed = group.comments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const total = group.comments.length;
	const hasUnclear = group.comments.some((c) => c.status === "unclear");

	const bg =
		total === 0
			? "var(--bg-active)"
			: fixed === total
				? "var(--success-subtle)"
				: hasUnclear
					? "var(--warning-subtle)"
					: "var(--bg-active)";
	const color =
		total === 0
			? "var(--text-tertiary)"
			: fixed === total
				? "var(--success)"
				: hasUnclear
					? "var(--warning)"
					: "var(--text-tertiary)";

	return (
		<span
			className="shrink-0 py-[1px] px-[7px] rounded-full font-mono text-[10px] font-medium"
			style={{ background: bg, color }}
		>
			{fixed}/{total}
		</span>
	);
}
