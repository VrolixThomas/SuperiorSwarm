import type { DraggableAttributes } from "@dnd-kit/core";
import type { useSortable } from "@dnd-kit/sortable";

type DragListeners = ReturnType<typeof useSortable>["listeners"];

export function SidebarSectionHeader({
	title,
	count,
	onNew,
	newLabel,
	onToggle,
	expanded,
	className,
	dragHandle,
}: {
	title: string;
	count?: number;
	onNew: () => void;
	newLabel: string;
	onToggle?: () => void;
	expanded?: boolean;
	className?: string;
	dragHandle?: { attributes: DraggableAttributes; listeners: DragListeners };
}) {
	const titleContent = (
		<>
			{onToggle && (
				<svg
					aria-hidden="true"
					width="9"
					height="9"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="3"
					strokeLinecap="round"
					strokeLinejoin="round"
					className={`shrink-0 text-[var(--text-quaternary)] transition-transform duration-[120ms] ${
						expanded ? "rotate-90" : ""
					}`}
				>
					<path d="M9 18l6-6-6-6" />
				</svg>
			)}
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
		<div className={["flex items-center gap-2 px-3 pb-[8px] pt-[14px]", className].filter(Boolean).join(" ")}>
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
				{dragHandle && (
					<button
						type="button"
						aria-label="Reorder section"
						className="cursor-grab touch-none px-1 text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:text-[var(--text-secondary)] active:cursor-grabbing"
						{...dragHandle.attributes}
						{...dragHandle.listeners}
					>
						<svg
							aria-hidden="true"
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<circle cx="9" cy="6" r="1.6" />
							<circle cx="15" cy="6" r="1.6" />
							<circle cx="9" cy="12" r="1.6" />
							<circle cx="15" cy="12" r="1.6" />
							<circle cx="9" cy="18" r="1.6" />
							<circle cx="15" cy="18" r="1.6" />
						</svg>
					</button>
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
		</div>
	);
}
