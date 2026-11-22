import { useTabStore } from "../../stores/tab-store";
export function HintBar({
	compact = false,
	context = false,
	hasThreads = false,
	showViewed = true,
}: { compact?: boolean; context?: boolean; hasThreads?: boolean; showViewed?: boolean }) {
	const mode = useTabStore((s) => s.diffMode);
	const setMode = useTabStore((s) => s.setDiffMode);
	const keyClass = "rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]";
	return (
		<footer className="flex h-[32px] shrink-0 items-center gap-4 overflow-hidden border-t border-[var(--border-subtle)] px-6 text-[11px] text-[var(--text-tertiary)]">
			<span className="shrink-0">
				<kbd className={keyClass}>j</kbd> <kbd className={keyClass}>k</kbd> next / previous file
			</span>
			{!context && showViewed && (
				<span className="shrink-0">
					<kbd className={keyClass}>v</kbd> viewed
				</span>
			)}
			<span className="truncate">
				{context ? "⌘ click a name to open it as context" : "Select lines to ask or comment"}
			</span>
			{hasThreads && (
				<span className="shrink-0">
					<kbd className={keyClass}>n</kbd> / <kbd className={keyClass}>p</kbd> threads
				</span>
			)}
			<div className="flex-1" />
			{!context && !compact && (
				<div className="flex shrink-0 rounded-md bg-[var(--bg-surface)] p-0.5">
					{(["inline", "split"] as const).map((value) => (
						<button
							type="button"
							key={value}
							aria-pressed={mode === value}
							onClick={() => setMode(value)}
							className={`rounded px-2 py-0.5 ${mode === value ? "bg-[var(--bg-overlay)] text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
						>
							{value === "inline" ? "Unified" : "Split"}
						</button>
					))}
				</div>
			)}
		</footer>
	);
}
