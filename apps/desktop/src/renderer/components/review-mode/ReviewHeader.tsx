import type { ReactNode } from "react";
import type { PRContext } from "../../../shared/github-types";
import { type ReviewView, useReviewModeStore } from "../../stores/review-mode-store";

interface ReviewHeaderProps {
	prCtx: PRContext;
	commentCount: number;
	rightSlot?: ReactNode;
}

const REVIEW_VIEWS: { view: ReviewView; label: string }[] = [
	{ view: "overview", label: "Overview" },
	{ view: "changes", label: "Changes" },
	{ view: "comments", label: "Comments" },
];

export function ReviewHeader({ prCtx, commentCount, rightSlot }: ReviewHeaderProps) {
	const view = useReviewModeStore((s) => s.view);
	const setView = useReviewModeStore((s) => s.setView);
	const close = useReviewModeStore((s) => s.close);

	return (
		<header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[var(--text)]">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<button
					type="button"
					onClick={close}
					title="Back (Esc)"
					aria-label="Back"
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M10 3 5 8l5 5" />
					</svg>
				</button>
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="min-w-0 truncate text-[13px] font-medium text-[var(--text)]">
						{prCtx.title}
					</span>
					<span className="shrink-0 text-[12px] text-[var(--text-tertiary)]">#{prCtx.number}</span>
				</div>
			</div>

			<div className="flex shrink-0 items-center rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				{REVIEW_VIEWS.map((item) => {
					const active = view === item.view;
					const badgeCount = item.view === "comments" && commentCount > 0 ? commentCount : null;

					return (
						<button
							key={item.view}
							type="button"
							onClick={() => setView(item.view)}
							aria-pressed={active}
							className={[
								"flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[12px] font-medium transition-colors duration-[120ms]",
								active
									? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]",
							].join(" ")}
						>
							<span>{item.label}</span>
							{badgeCount != null && (
								<span className="min-w-4 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] leading-4 text-[var(--accent-foreground)]">
									{badgeCount}
								</span>
							)}
						</button>
					);
				})}
			</div>

			<div className="flex min-w-0 flex-1 items-center justify-end">{rightSlot}</div>
		</header>
	);
}
