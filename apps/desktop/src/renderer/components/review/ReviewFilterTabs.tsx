import type { ReviewScope } from "../../../shared/review-types";

interface Tab {
	key: ReviewScope;
	label: string;
	count: number;
	hint: "1" | "2" | "3";
}

export function ReviewFilterTabs({
	scope,
	allCount,
	workingCount,
	branchCount,
	onScopeChange,
}: {
	scope: ReviewScope;
	allCount: number;
	workingCount: number;
	branchCount: number;
	onScopeChange: (next: ReviewScope) => void;
}) {
	const tabs: Tab[] = [
		{ key: "all", label: "All", count: allCount, hint: "1" },
		{ key: "working", label: "Working", count: workingCount, hint: "2" },
		{ key: "branch", label: "Branch", count: branchCount, hint: "3" },
	];

	return (
		<div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1">
			{tabs.map((t) => {
				const active = scope === t.key;
				return (
					<button
						key={t.key}
						type="button"
						onClick={() => onScopeChange(t.key)}
						className={[
							"flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] transition-colors duration-[120ms]",
							active
								? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
								: "text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]",
						].join(" ")}
					>
						<span className={active ? "font-medium" : ""}>{t.label}</span>
						<span className="tabular-nums text-[var(--text-quaternary)]">{t.count}</span>
						<kbd className="rounded bg-[var(--bg-overlay)] px-1 text-[9px] text-[var(--text-quaternary)]">
							{t.hint}
						</kbd>
					</button>
				);
			})}
		</div>
	);
}
