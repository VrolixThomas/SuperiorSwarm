export function shortPath(p: string): string {
	const parts = p.split("/");
	return parts.length > 2 ? parts.slice(-2).join("/") : p;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
	return (
		<div className="mb-4 flex items-center justify-between rounded-[8px] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.08)] px-3 py-2 text-[11px] text-[#ff453a]">
			<span>{message}</span>
			<button
				type="button"
				onClick={onDismiss}
				className="ml-2 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
			>
				Dismiss
			</button>
		</div>
	);
}

export function Stat({
	label,
	value,
	color,
}: { label: string; value: number | string; color?: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="text-[var(--text-quaternary)]">{label}:</span>
			<span className="font-mono font-medium" style={{ color: color ?? "var(--text-secondary)" }}>
				{value}
			</span>
		</div>
	);
}
