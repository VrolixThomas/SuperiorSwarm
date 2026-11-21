import type { ReactNode } from "react";
import type { PRContext } from "../../../../shared/github-types";

export interface ReviewTopBarProps {
	prCtx: PRContext;
	queueCount: number;
	queueOpen?: boolean;
	nextPrNumber?: number | null;
	openingPR?: boolean;
	onOpenQueue: () => void;
	onOpenOverview: () => void;
	onNextPR: () => void;
	/** MappingPill while mapping, otherwise the existing AgentStatusChip. */
	statusSlot?: ReactNode;
	/** Existing submit control and SubmitReviewPopover, owned by the workspace. */
	submitSlot?: ReactNode;
}

export function ReviewTopBar({
	prCtx,
	queueCount,
	queueOpen,
	nextPrNumber,
	openingPR,
	onOpenQueue,
	onOpenOverview,
	onNextPR,
	statusSlot,
	submitSlot,
}: ReviewTopBarProps) {
	return (
		<header className="app-drag relative z-20 flex h-[44px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-[88px] pr-3 text-[var(--text)]">
			<button
				type="button"
				onClick={onOpenQueue}
				aria-expanded={queueOpen}
				aria-haspopup="dialog"
				className={`app-no-drag flex h-7 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-[12px] font-medium hover:bg-[var(--bg-overlay)] ${queueOpen ? "bg-[var(--bg-overlay)]" : "bg-[var(--bg-elevated)]"}`}
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
				>
					<path d="M5 4h8M5 8h8M5 12h8M2 4h.01M2 8h.01M2 12h.01" />
				</svg>
				All PRs <span className="ml-2 text-[11px] text-[var(--text-secondary)]">{queueCount}</span>
			</button>
			<span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--border)]" />
			<div className="flex min-w-0 flex-1 items-baseline gap-2">
				<button
					type="button"
					onClick={onOpenOverview}
					title={prCtx.title}
					className="app-no-drag min-w-0 truncate text-left text-[13px] font-medium hover:text-[var(--accent-hover)]"
				>
					{prCtx.title}
				</button>
				<span className="shrink-0 text-[12px] text-[var(--text-tertiary)]">#{prCtx.number}</span>
				<span
					title={`${prCtx.sourceBranch} → ${prCtx.targetBranch}`}
					className="min-w-0 max-w-[240px] truncate font-mono text-[11px] text-[var(--text-tertiary)]"
				>
					{prCtx.sourceBranch} → {prCtx.targetBranch}
				</span>
			</div>
			<div className="app-no-drag relative flex shrink-0 items-center gap-3">
				{statusSlot}
				<button
					type="button"
					onClick={onNextPR}
					disabled={nextPrNumber == null || openingPR}
					title={
						nextPrNumber == null
							? "No more pull requests need your review"
							: "Next pull request (⌘↓)"
					}
					className="flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					Next PR{" "}
					{nextPrNumber != null && (
						<span className="text-[11px] text-[var(--text-tertiary)]">#{nextPrNumber}</span>
					)}
					<svg
						aria-hidden="true"
						width="12"
						height="12"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
					>
						<path d="m6 3 5 5-5 5" />
					</svg>
				</button>
				{submitSlot}
			</div>
		</header>
	);
}
