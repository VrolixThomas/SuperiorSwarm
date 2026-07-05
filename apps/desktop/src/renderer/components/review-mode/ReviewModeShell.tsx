import { useReviewModeStore } from "../../stores/review-mode-store";
import { ReviewHeader } from "./ReviewHeader";
import { ReviewNavigator } from "./navigator/ReviewNavigator";
import { useReviewData } from "./useReviewData";
import { CommentsView } from "./views/CommentsView";

const VIEW_LABELS = {
	overview: "Overview",
	changes: "Changes",
	comments: "Comments",
} as const;

type ActiveReview = NonNullable<ReturnType<typeof useReviewModeStore.getState>["active"]>;

export function ReviewModeShell() {
	const active = useReviewModeStore((s) => s.active);

	if (!active) return null;

	return <ActiveReviewModeShell active={active} />;
}

function ActiveReviewModeShell({ active }: { active: ActiveReview }) {
	const view = useReviewModeStore((s) => s.view);
	const navigatorCollapsed = useReviewModeStore((s) => s.navigatorCollapsed);
	const { details, isLoading, allThreads, counts, sessionKey, fileOrder } = useReviewData(
		active.workspaceId,
		active.prCtx
	);
	const commentCount = (counts.pending ?? 0) + (counts.open ?? 0);

	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg-base)]">
			<ReviewHeader prCtx={active.prCtx} commentCount={commentCount} />
			<div className="flex min-h-0 flex-1">
				{!navigatorCollapsed && (
					<aside className="w-[280px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-surface)]">
						{details ? (
							<ReviewNavigator
								workspaceId={active.workspaceId}
								prCtx={active.prCtx}
								details={details}
								threads={allThreads}
							/>
						) : (
							<div className="p-4 text-[13px] text-[var(--text-tertiary)]">
								{isLoading ? "Loading review details..." : "Review details unavailable"}
							</div>
						)}
					</aside>
				)}
				<main className="min-w-0 flex-1 overflow-y-auto">
					{view === "comments" && details ? (
						<CommentsView
							workspaceId={active.workspaceId}
							prCtx={active.prCtx}
							allThreads={allThreads}
							counts={counts}
							fileOrder={fileOrder}
							sessionKey={sessionKey}
						/>
					) : (
						<div className="p-8 text-[13px] text-[var(--text-tertiary)]">{VIEW_LABELS[view]}</div>
					)}
				</main>
			</div>
		</div>
	);
}
