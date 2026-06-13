export function SidebarSectionHeader({
	title,
	count,
	onNew,
	newLabel,
	onToggle,
	expanded,
	className,
}: {
	title: string;
	count?: number;
	onNew: () => void;
	newLabel: string;
	onToggle?: () => void;
	expanded?: boolean;
	className?: string;
}) {
	const titleContent = (
		<>
			<span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
				{title}
			</span>
			{count != null && count > 0 && (
				<span className="shrink-0 rounded-full bg-[var(--bg-overlay)] px-[7px] py-[1px] text-[10px] font-semibold tabular-nums text-[var(--text-tertiary)]">
					{count}
				</span>
			)}
		</>
	);

	return (
		<div className={["flex items-center gap-2 px-3 pb-[8px] pt-[14px]", className ?? ""].join(" ")}>
			{onToggle ? (
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={expanded}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					{titleContent}
				</button>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-2">{titleContent}</div>
			)}
			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					onClick={onNew}
					title={newLabel}
					className="flex shrink-0 items-center gap-1 rounded-[6px] border border-[var(--border-subtle)] px-2 py-[3px] text-[12px] text-[var(--text-secondary)] transition-colors duration-[120ms] hover:border-[var(--border-active)] hover:text-[var(--text)]"
				>
					<span className="text-[13px] leading-none">+</span>
					New
				</button>
			</div>
		</div>
	);
}
