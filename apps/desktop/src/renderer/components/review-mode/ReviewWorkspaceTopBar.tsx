import type { PRContext } from "../../../shared/github-types";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { SubmitReviewPopover } from "./SubmitReviewPopover";
import type { useReviewQueue } from "./queue/useReviewQueue";
import { ReviewTopBar } from "./top-bar/ReviewTopBar";
import type { useReviewWorkspaceData } from "./useReviewWorkspaceData";
export function ReviewWorkspaceTopBar({
	prCtx,
	data,
	queue,
	onNextPR,
}: {
	prCtx: PRContext;
	data: ReturnType<typeof useReviewWorkspaceData>;
	queue: ReturnType<typeof useReviewQueue>;
	onNextPR: () => void;
}) {
	const queueOpen = useReviewModeStore((s) => s.queueOpen);
	return (
		<ReviewTopBar
			prCtx={{
				...prCtx,
				title: data.details?.title ?? prCtx.title,
				sourceBranch: data.details?.sourceBranch ?? prCtx.sourceBranch,
				targetBranch: data.details?.targetBranch ?? prCtx.targetBranch,
			}}
			queueCount={queue.queue.needsReview.length + queue.queue.waitingOnAuthor.length}
			queueOpen={queueOpen}
			nextPrNumber={queue.next?.number}
			openingPR={!!queue.openingKey}
			onOpenQueue={() => {
				useReviewModeStore.getState().setPanel(null);
				useReviewModeStore.getState().setQueueOpen(true);
			}}
			onOpenOverview={() => {
				useReviewModeStore.getState().setQueueOpen(false);
				useReviewModeStore.getState().setOverviewOpen(true);
			}}
			onNextPR={onNextPR}
			onRefresh={queueOpen ? undefined : () => data.refreshDetails?.()}
			submitSlot={
				queueOpen ? null : (
					<>
						<button
							type="button"
							disabled={!data.canSubmitReview}
							onClick={() => data.setSubmitOpen(!data.submitOpen)}
							className="rounded-md border border-[var(--border)] px-3 py-1 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-overlay)] disabled:opacity-40"
						>
							Submit review
						</button>
						{data.submitOpen && data.canSubmitReview && (
							<SubmitReviewPopover
								prCtx={prCtx}
								draftId={data.aiDraft?.id ?? null}
								acceptedThreads={data.acceptedThreads}
								pendingCount={data.pendingCount}
								onClose={() => data.setSubmitOpen(false)}
								onSubmitted={data.handleSubmitted}
							/>
						)}
					</>
				)
			}
		/>
	);
}
