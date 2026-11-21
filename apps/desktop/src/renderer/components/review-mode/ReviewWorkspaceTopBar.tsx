import type { PRContext } from "../../../shared/github-types";
import type { ReviewPathSource } from "../../lib/review-path-source";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { AgentStatusChip } from "./AgentStatusChip";
import { SubmitReviewPopover } from "./SubmitReviewPopover";
import type { useReviewQueue } from "./queue/useReviewQueue";
import { MappingPill } from "./top-bar/MappingPill";
import { ReviewTopBar } from "./top-bar/ReviewTopBar";
import type { useReviewWorkspaceData } from "./useReviewWorkspaceData";
export function ReviewWorkspaceTopBar({
	prCtx,
	data,
	source,
	queue,
	onNextPR,
	openTerminal,
}: {
	prCtx: PRContext;
	data: ReturnType<typeof useReviewWorkspaceData>;
	source: ReviewPathSource;
	queue: ReturnType<typeof useReviewQueue>;
	onNextPR: () => void;
	openTerminal?: () => void;
}) {
	const queueOpen = useReviewModeStore((s) => s.queueOpen);
	const files = data.details?.files ?? [];
	return (
		<ReviewTopBar
			prCtx={{ ...prCtx, title: data.details?.title ?? prCtx.title }}
			queueCount={queue.queue.needsReview.length + queue.queue.waitingOnAuthor.length}
			queueOpen={queueOpen}
			onOpenTerminal={openTerminal}
			nextPrNumber={queue.next?.number}
			openingPR={!!queue.openingKey}
			onOpenQueue={() => {
				useReviewModeStore.getState().setPanel(null);
				useReviewModeStore.getState().setQueueOpen(true);
			}}
			onOpenOverview={() => useReviewModeStore.getState().setOverviewOpen(true)}
			onNextPR={onNextPR}
			statusSlot={
				source.status === "mapping" ? (
					<MappingPill
						placed={source.path?.progress?.placed ?? 0}
						total={files.length}
						onOpen={openTerminal}
					/>
				) : (
					<>
						<AgentStatusChip
							active={data.agentActions.isReviewActive}
							startedAt={data.agentActions.startedAt}
							onOpen={openTerminal}
							onCancel={data.agentActions.cancel}
						/>
						{!data.agentActions.isReviewActive && (
							<button
								type="button"
								disabled={data.agentActions.isPending}
								onClick={() => void data.agentActions.trigger()}
								className="rounded-md px-2 py-1 text-[12px] text-[var(--text-secondary)] disabled:opacity-40"
							>
								{data.agentActions.label}
							</button>
						)}
					</>
				)
			}
			submitSlot={
				<>
					<button
						type="button"
						disabled={!data.canSubmitReview}
						onClick={() => data.setSubmitOpen(!data.submitOpen)}
						className="rounded-md bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-[var(--accent-foreground)] disabled:opacity-40"
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
			}
		/>
	);
}
