/**
 * Shared section header for sidebar zones (Repositories, Orchestrators).
 * One design for every zone: 15px medium title, neutral count badge,
 * persistent "+ New" action on the right. Pass `onToggle` to make the
 * title a collapse toggle for the section.
 */
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
			<span className="truncate text-[15px] font-medium text-[var(--text)]">{title}</span>
			{count != null && count > 0 && (
				<span className="shrink-0 rounded-full bg-[var(--bg-overlay)] px-[7px] py-[1px] text-[10px] font-semibold tabular-nums text-[var(--text-tertiary)]">
					{count}
				</span>
			)}
		</>
	);

	return (
		<div className={["flex items-center gap-2 px-3 pb-[10px] pt-4", className ?? ""].join(" ")}>
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
	);
}
