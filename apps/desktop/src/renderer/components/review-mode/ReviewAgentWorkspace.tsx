import type { LayoutNode } from "../../../shared/pane-types";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { LayoutRenderer } from "../panes/LayoutRenderer";
import type { ActiveReview } from "./ReviewWorkspace";
import { useReviewQueue } from "./queue/useReviewQueue";
import { ReviewTopBar } from "./top-bar/ReviewTopBar";

/** Normal workspace tabs, with the same PR identity and navigation as the reading view. */
export function ReviewAgentWorkspace({
	active,
	layout,
	savedScrollback,
}: {
	active: ActiveReview;
	layout: LayoutNode | null | undefined;
	savedScrollback: Record<string, string>;
}) {
	const queue = useReviewQueue(active.prCtx);
	const returnToReview = () => {
		useReviewModeStore.getState().setQueueOpen(false);
		useReviewModeStore.getState().setView("changes");
	};
	return (
		<main
			className="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--bg-base)]"
			aria-label="PR agent workspace"
		>
			<ReviewTopBar
				prCtx={active.prCtx}
				queueCount={queue.queue.needsReview.length + queue.queue.waitingOnAuthor.length}
				nextPrNumber={queue.next?.number}
				openingPR={!!queue.openingKey}
				onOpenQueue={() => {
					useReviewModeStore.getState().setQueueOpen(true);
					useReviewModeStore.getState().setView("changes");
				}}
				onOpenOverview={() => {
					useReviewModeStore.getState().setOverviewOpen(true);
					returnToReview();
				}}
				onNextPR={() => {
					if (queue.next) void queue.openPR(queue.next);
				}}
				submitSlot={
					<button
						type="button"
						onClick={returnToReview}
						className="rounded-md border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--text)] hover:bg-[var(--bg-overlay)]"
					>
						Back to PR review
					</button>
				}
			/>
			<div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
				<span className="text-[13px] font-medium text-[var(--text)]">Agent workspace</span>
				<span className="truncate text-[12px] text-[var(--text-secondary)]">
					{active.prCtx.owner}/{active.prCtx.repo} · PR #{active.prCtx.number}
				</span>
			</div>
			{queue.error && (
				<p role="alert" className="px-4 py-2 text-[12px] text-[var(--color-danger)]">
					{queue.error}
				</p>
			)}
			{layout ? (
				<LayoutRenderer
					node={layout}
					workspaceId={active.workspaceId}
					savedScrollback={savedScrollback}
				/>
			) : (
				<p className="p-6 text-[13px] text-[var(--text-secondary)]">
					No agent session has been opened for this PR.
				</p>
			)}
		</main>
	);
}
