import { useEffect, useState } from "react";
import type { LayoutNode } from "../../../shared/pane-types";
import { isReviewAgentJobActive } from "../../../shared/review-agent-job";
import {
	revealReview,
	reviewAgentJobLabel,
	selectReviewAgentJob,
} from "../../lib/review-agent-jobs";
import { useProjectStore } from "../../stores/projects";
import { useTabStore } from "../../stores/tab-store";
import { LayoutRenderer } from "../panes/LayoutRenderer";
import { ReviewUIProvider, reviewUIScopeKey, useReviewUIApi } from "./ReviewUIContext";
import type { ActiveReview } from "./ReviewWorkspace";
import { SubmitReviewPopover } from "./SubmitReviewPopover";
import { useReviewQueue } from "./queue/useReviewQueue";
import { useReviewAgentJobs } from "./useReviewAgentJob";
import { useReviewWorkspaceData } from "./useReviewWorkspaceData";

function PRHeader({ active }: { active: ActiveReview }) {
	const { workspaceId, prCtx } = active;
	const ui = useReviewUIApi();
	const collapsed = useProjectStore((s) => s.sidebarCollapsed);
	const data = useReviewWorkspaceData(workspaceId, prCtx, { manageFileOrder: false });
	const queue = useReviewQueue(prCtx);
	const jobs = useReviewAgentJobs(workspaceId);
	const matchingJobs = jobs.data?.filter(
		(j) => !data.details?.headCommitOid || j.identity.headSha === data.details.headCommitOid
	);
	const job = selectReviewAgentJob(matchingJobs ?? []);
	const ticking = !!job && isReviewAgentJobActive(job);
	const [, tick] = useState(0);
	useEffect(() => {
		if (!ticking) return;
		const timer = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(timer);
	}, [ticking]);
	const summary = () => {
		revealReview(workspaceId);
		ui.getState().setOverviewOpen(true);
	};
	const elapsed =
		job?.startedAt && isReviewAgentJobActive(job)
			? Math.max(0, Math.floor((Date.now() - Date.parse(job.startedAt)) / 1000))
			: null;
	return (
		<>
			<header className="app-drag relative z-20 flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-[var(--text)]">
				<button
					type="button"
					aria-label="Toggle PR list"
					aria-expanded={!collapsed}
					title="Toggle PR list"
					onClick={() => window.dispatchEvent(new Event("app:toggle-sidebar"))}
					className="app-no-drag flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded hover:bg-[var(--bg-overlay)]"
				>
					<svg
						aria-hidden="true"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<rect x="3" y="4" width="18" height="16" rx="2" />
						<path d="M9 4v16" />
					</svg>
				</button>
				<div className="min-w-0 flex-1">
					<button
						type="button"
						title="Path summary"
						className="app-no-drag block max-w-full truncate text-left text-[13px] font-medium"
						onClick={summary}
					>
						{data.details?.title ?? prCtx.title}{" "}
						<span className="text-[var(--text-tertiary)]">#{prCtx.number}</span>
					</button>
					<div className="truncate font-mono text-[11px] text-[var(--text-tertiary)]">
						{prCtx.owner}/{prCtx.repo} · {prCtx.sourceBranch}
					</div>
				</div>
				<button
					type="button"
					aria-label="Refresh PR"
					onClick={() => data.refreshDetails()}
					className="app-no-drag h-[30px] w-[30px] shrink-0 rounded hover:bg-[var(--bg-overlay)]"
				>
					↻
				</button>
				<button
					type="button"
					title={
						job
							? `${job.phase} · Click to open agent; Option-click to open beside Review`
							: "Choose an agent to review this PR"
					}
					onClick={(event) => {
						if (job) {
							useTabStore.getState().ensureReviewAgentTab(job);
							useTabStore
								.getState()
								.revealReviewAgentTab(workspaceId, { jobId: job.id, beside: event.altKey });
						} else {
							summary();
							ui.getState().setRailMode("path");
							requestAnimationFrame(() =>
								document
									.querySelector<HTMLButtonElement>(
										'[data-review-workspace] [aria-label="Map reading path"] button'
									)
									?.focus()
							);
						}
					}}
					className={`app-no-drag shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-[12px] ${job?.state === "failed" ? "text-[var(--color-danger)]" : job?.state === "needs-input" ? "text-[var(--tag-amber-fg)]" : "text-[var(--text-secondary)]"}`}
				>
					{job && isReviewAgentJobActive(job) && job.state !== "needs-input" && (
						<span
							aria-hidden="true"
							className="mr-1.5 inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-r-transparent"
						/>
					)}
					{job ? `${job.agent.label} · ` : ""}
					{reviewAgentJobLabel(job)}
					{job?.progress ? ` · ${job.progress.placed} of ${job.progress.total}` : ""}
					{elapsed !== null
						? ` · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
						: ""}
				</button>
				<button
					type="button"
					disabled={!queue.next || !!queue.openingKey}
					onClick={() => queue.next && void queue.openPR(queue.next)}
					className="app-no-drag shrink-0 rounded-md border border-[var(--border)] px-3 py-1.5 text-[12px] disabled:opacity-40"
				>
					{queue.openingKey ? "Opening…" : `Next PR${queue.next ? ` #${queue.next.number}` : ""}`} →
				</button>
				<div className="app-no-drag relative shrink-0">
					<button
						type="button"
						disabled={!data.canSubmitReview}
						onClick={() => data.setSubmitOpen(!data.submitOpen)}
						className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] disabled:opacity-40"
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
				</div>
			</header>
			{queue.error && (
				<p
					role="alert"
					className="border-b border-[var(--border)] px-3 py-1 text-[12px] text-[var(--color-danger)]"
				>
					{queue.error}
				</p>
			)}
		</>
	);
}
export function PRReviewWorkspace({
	active,
	layout,
	savedScrollback,
}: {
	active: ActiveReview;
	layout: LayoutNode | null | undefined;
	savedScrollback: Record<string, string>;
}) {
	useEffect(() => {
		useTabStore.getState().ensureReviewTab(active.workspaceId, active.prCtx);
	}, [active.workspaceId, active.prCtx]);
	return (
		<main className="flex h-full min-w-0 flex-col overflow-hidden">
			<ReviewUIProvider scopeKey={reviewUIScopeKey(active)}>
				<PRHeader active={active} />
			</ReviewUIProvider>
			{layout && (
				<LayoutRenderer
					node={layout}
					workspaceId={active.workspaceId}
					savedScrollback={savedScrollback}
				/>
			)}
		</main>
	);
}
