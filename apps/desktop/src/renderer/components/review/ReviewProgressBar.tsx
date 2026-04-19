export function ReviewProgressBar({
	reviewed,
	total,
}: {
	reviewed: number;
	total: number;
}) {
	const pct = total === 0 ? 0 : Math.round((reviewed / total) * 100);
	return (
		<div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-tertiary)]">
			<span>
				{reviewed} of {total} reviewed
			</span>
			<div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
				<div
					className="h-full bg-[var(--term-green)] transition-[width] duration-150"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="tabular-nums text-[var(--text-quaternary)]">{pct}%</span>
		</div>
	);
}
