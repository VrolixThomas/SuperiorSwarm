export interface Hint {
	keys: string[];
	label: string;
}

const DEFAULT_HINTS: Hint[] = [
	{ keys: ["J"], label: "Next" },
	{ keys: ["K"], label: "Prev" },
	{ keys: ["E"], label: "Edit" },
	{ keys: ["V"], label: "Viewed" },
	{ keys: ["1", "2", "3"], label: "Filter" },
	{ keys: ["Esc"], label: "Close" },
];

export function ReviewHintBar({ hints = DEFAULT_HINTS }: { hints?: Hint[] } = {}) {
	return (
		<div className="flex items-center gap-4 border-t border-[var(--border)] px-3 py-1 text-[10px] text-[var(--text-quaternary)]">
			{hints.map((h) => (
				<div key={h.label} className="flex items-center gap-1">
					{h.keys.map((k) => (
						<kbd
							key={k}
							className="rounded bg-[var(--bg-overlay)] px-1 py-0.5 text-[9px] text-[var(--text-tertiary)]"
						>
							{k}
						</kbd>
					))}
					<span>{h.label}</span>
				</div>
			))}
		</div>
	);
}
