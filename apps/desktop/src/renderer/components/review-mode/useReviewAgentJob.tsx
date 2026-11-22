import { useEffect, useState } from "react";
import { REVIEW_AGENT_STOP_EVENT, type ReviewAgentStopDetail } from "../../lib/pane-lifecycle";
import { observeReviewAgentJob } from "../../lib/review-agent-jobs";
import { useTabStore } from "../../stores/tab-store";
import { trpc, trpcVanilla } from "../../trpc/client";

export function useReviewAgentJobs(workspaceId: string, enabled = true) {
	return trpc.reviewPath.jobs.useQuery(
		{ workspaceId },
		{
			enabled,
			staleTime: 1000,
			refetchInterval: (query) =>
				query.state.data?.some((job) =>
					["queued", "preparing", "running", "needs-input"].includes(job.state)
				)
					? 1500
					: 15000,
		}
	);
}
function WorkspaceJobs({ workspaceId }: { workspaceId: string }) {
	const jobs = useReviewAgentJobs(workspaceId);
	useEffect(() => {
		for (const job of jobs.data ?? []) observeReviewAgentJob(job);
	}, [jobs.data]);
	return null;
}
/** Kept outside the selected tab so navigating away cannot drop a late launch. */
export function ReviewAgentJobCoordinator() {
	const [stopError, setStopError] = useState<string>();
	const metadata = useTabStore((s) => s.workspaceMetadata);
	const utils = trpc.useUtils();
	useEffect(() => {
		const stop = (event: Event) => {
			const { workspaceId, jobId } = (event as CustomEvent<ReviewAgentStopDetail>).detail;
			setStopError(undefined);
			void trpcVanilla.reviewPath.cancelJob
				.mutate({ workspaceId, jobId })
				.then(() => utils.reviewPath.jobs.invalidate({ workspaceId }))
				.catch((error) =>
					setStopError(
						`Could not stop the agent: ${error instanceof Error ? error.message : String(error)}`
					)
				);
		};
		const accepted = (event: Event) => {
			void utils.reviewPath.jobs.invalidate({
				workspaceId: (event as CustomEvent<{ workspaceId: string }>).detail.workspaceId,
			});
		};
		window.addEventListener("review-agent-job-accepted", accepted);
		window.addEventListener(REVIEW_AGENT_STOP_EVENT, stop);
		return () => {
			window.removeEventListener(REVIEW_AGENT_STOP_EVENT, stop);
			window.removeEventListener("review-agent-job-accepted", accepted);
		};
	}, [utils]);
	return (
		<>
			{stopError && (
				<div
					role="alert"
					className="fixed bottom-4 left-1/2 z-[80] flex max-w-[600px] -translate-x-1/2 items-center gap-4 rounded-lg border border-[var(--color-danger)] bg-[var(--bg-elevated)] px-4 py-3 text-[13px] text-[var(--text)]"
				>
					{stopError}
					<button
						type="button"
						aria-label="Dismiss agent error"
						onClick={() => setStopError(undefined)}
					>
						×
					</button>
				</div>
			)}
			{Object.entries(metadata)
				.filter(([, meta]) => meta.type === "review")
				.map(([workspaceId]) => (
					<WorkspaceJobs key={workspaceId} workspaceId={workspaceId} />
				))}
		</>
	);
}
