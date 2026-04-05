export function Stat({
	label,
	value,
	color,
}: { label: string; value: number | string; color?: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="text-[var(--text-quaternary)]">{label}:</span>
			<span
				className="font-mono font-medium"
				style={{ color: color ?? "var(--text-secondary)" }}
			>
				{value}
			</span>
		</div>
	);
}
