import { type ReviewAgentJob, isReviewAgentJobActive } from "../../shared/review-agent-job";
import { useTabStore } from "../stores/tab-store";

// A closed job view stays closed on subsequent polling updates. Explicit reveal
// is the only operation that reopens it after initial registration.
const observed = new Set<string>();
export function observeReviewAgentJob(job: ReviewAgentJob, accepted = false) {
	const tabs = useTabStore.getState();
	const visible = tabs
		.getTabsByWorkspace(job.identity.workspaceId)
		.some((t) => t.kind === "review-agent" && t.jobId === job.id);
	if (
		accepted ||
		visible ||
		(!observed.has(job.id) && !tabs.isReviewAgentTabHidden(job.identity.workspaceId, job.id))
	)
		tabs.ensureReviewAgentTab(job);
	observed.add(job.id);
	if (accepted && typeof window !== "undefined")
		window.dispatchEvent(
			new window.CustomEvent("review-agent-job-accepted", {
				detail: { workspaceId: job.identity.workspaceId },
			})
		);
	if (job.cwd) {
		const latest = useTabStore.getState();
		const meta = latest.workspaceMetadata[job.identity.workspaceId];
		if (meta && meta.reviewWorktreePath !== job.cwd)
			latest.setWorkspaceMetadata(job.identity.workspaceId, {
				...meta,
				reviewWorktreePath: job.cwd,
			});
	}
}
export function revealReview(workspaceId: string) {
	const store = useTabStore.getState();
	if (store.activeWorkspaceId !== workspaceId) return;
	const review = store.getTabsByWorkspace(workspaceId).find((t) => t.kind === "pr-review");
	if (review) store.setActiveTab(review.id);
}
export function reviewAgentJobLabel(job?: ReviewAgentJob) {
	if (!job) return "Start agent";
	if (job.state === "queued" || job.state === "preparing") return "Preparing";
	if (job.state === "running") return job.kind === "question" ? "Answering" : "Mapping";
	if (job.state === "needs-input") return "Waiting for you";
	if (job.state === "completed") return "Done";
	if (job.state === "failed") return "Failed";
	if (job.state === "cancelled") return "Stopped";
	return "Older revision";
}

/** Active work wins over a later completed question in the shared status chip. */
export function selectReviewAgentJob(jobs: ReviewAgentJob[]) {
	return jobs.filter(isReviewAgentJobActive).at(-1) ?? jobs.at(-1);
}
