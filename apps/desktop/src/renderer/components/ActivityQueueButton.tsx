import { useActivityQueueStore } from "../stores/activity-queue-store";

/** Global utility entry; the dock owns data and survives workspace navigation. */
export function ActivityQueueButton({ compact = false }: { compact?: boolean }) {
	const { open, toggle, pendingCount, unavailable } = useActivityQueueStore();
	const label =
		pendingCount === null
			? unavailable
				? "Queue unavailable"
				: "Queue loading"
			: `Queue ${pendingCount}`;
	return (
		<button
			type="button"
			data-queue-trigger
			aria-label={label}
			aria-controls={open ? "activity-queue-panel" : undefined}
			aria-expanded={open}
			title={`${label} — ${open ? "Hide" : "Show"} queue`}
			onClick={toggle}
			className={`relative flex shrink-0 items-center justify-center gap-2 rounded-md text-[12px] outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${compact ? "size-8" : "min-w-0 flex-1 px-2.5 py-2"} ${open ? "bg-[var(--accent-subtle)] text-[var(--accent)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"}`}
		>
			<svg
				aria-hidden="true"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M4 5h16v14H4z" />
				<path d="m4 13 4 0 2 3h4l2-3h4M8 9h8" />
			</svg>
			{!compact && <span>Queue</span>}
			<span
				className={
					compact
						? "absolute -right-1 -top-1 min-w-3.5 rounded-full bg-[var(--bg-elevated)] px-0.5 text-[9px] leading-4 text-[var(--text-secondary)]"
						: "ml-auto rounded bg-[var(--bg-elevated)] px-1.5 text-[10px] tabular-nums text-[var(--text-secondary)]"
				}
			>
				{pendingCount === null
					? unavailable
						? "!"
						: "…"
					: pendingCount > 99 && compact
						? "99+"
						: pendingCount}
			</span>
		</button>
	);
}
