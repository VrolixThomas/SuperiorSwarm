import { useReviewModeStore } from "../../stores/review-mode-store";
import { ReviewHeader } from "./ReviewHeader";

const VIEW_LABELS = {
	overview: "Overview",
	changes: "Changes",
	comments: "Comments",
} as const;

export function ReviewModeShell() {
	const active = useReviewModeStore((s) => s.active);
	const view = useReviewModeStore((s) => s.view);
	const navigatorCollapsed = useReviewModeStore((s) => s.navigatorCollapsed);

	if (!active) return null;

	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg-base)]">
			<ReviewHeader prCtx={active.prCtx} commentCount={0} />
			<div className="flex min-h-0 flex-1">
				{!navigatorCollapsed && (
					<aside className="w-[280px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-surface)]">
						<div className="p-4 text-[13px] text-[var(--text-tertiary)]">No comments yet</div>
					</aside>
				)}
				<main className="min-w-0 flex-1 p-8 text-[13px] text-[var(--text-tertiary)]">
					{VIEW_LABELS[view]}
				</main>
			</div>
		</div>
	);
}
