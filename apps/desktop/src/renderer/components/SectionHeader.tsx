export function SectionHeader({
	label,
	count,
	isOpen,
	onToggle,
}: {
	label: string;
	count?: number;
	isOpen: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] transition-colors hover:text-[var(--text-tertiary)]"
		>
			<svg
				aria-hidden="true"
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				className={`shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
			>
				<path
					d="M3 1.5L7 5L3 8.5"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<span>{label}</span>
			{count !== undefined && count > 0 && (
				<span className="ml-auto text-[10px] tabular-nums">{count}</span>
			)}
		</button>
	);
}
