import { useEffect, useState } from "react";
import { isReviewAgentJobActive } from "../../../shared/review-agent-job";
import { formatReviewFetchProgress } from "../../../shared/review-fetch-progress";
import {
	observeReviewAgentJob,
	revealReview,
	reviewAgentJobLabel,
} from "../../lib/review-agent-jobs";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { ReviewAgentTerminal } from "./ReviewAgentTerminal";
import { reviewUIScopeKey, reviewUIStoreFor } from "./ReviewUIContext";
import { useReviewAgentJobs } from "./useReviewAgentJob";

export function ReviewAgentTab({
	workspaceId,
	jobId,
	active,
	savedScrollback,
	legacyTerminalId,
	legacyCwd,
}: {
	workspaceId: string;
	jobId: string;
	active: boolean;
	savedScrollback: Record<string, string>;
	legacyTerminalId?: string;
	legacyCwd?: string;
}) {
	const jobs = useReviewAgentJobs(workspaceId);
	const job = jobs.data?.find((job) => job.id === jobId);
	const cancel = trpc.reviewPath.cancelJob.useMutation();
	const retry = trpc.reviewPath.startJob.useMutation();
	const retryQuestion = trpc.reviewPath.askJob.useMutation();
	const ticking = !!job && isReviewAgentJobActive(job);
	const [, tick] = useState(0);
	useEffect(() => {
		if (!active || !ticking) return;
		const timer = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(timer);
	}, [active, ticking]);
	const busy = cancel.isPending || retry.isPending || retryQuestion.isPending;
	const error = cancel.error ?? retry.error ?? retryQuestion.error;
	const retryJob = async () => {
		if (!job) return;
		const common = {
			identity: job.identity,
			agent: job.agent,
			requestId: crypto.randomUUID(),
			retryJobId: job.id,
		};
		const next =
			job.kind === "question" && job.question
				? await retryQuestion.mutateAsync({ ...common, question: job.question })
				: await retry.mutateAsync({ ...common, alsoReview: job.alsoReview ?? false });
		observeReviewAgentJob(next, true);
		await jobs.refetch();
	};
	if (!job) {
		if (jobId.startsWith("legacy:") && legacyTerminalId && legacyCwd)
			return (
				<ReviewAgentTerminal
					id={legacyTerminalId}
					workspaceId={workspaceId}
					cwd={legacyCwd}
					active={active}
					initialContent={savedScrollback[legacyTerminalId]}
				/>
			);
		return (
			<output className="p-6 text-[13px] text-[var(--text-secondary)]">
				{jobs.isPending
					? "Loading agent job…"
					: jobs.isError
						? "Could not load the agent job."
						: "This job is no longer available."}
				<button type="button" onClick={() => void jobs.refetch()} className="ml-3 underline">
					Check again
				</button>
			</output>
		);
	}
	const running = isReviewAgentJobActive(job);
	const elapsed = job.startedAt
		? Math.max(
				0,
				Math.floor(
					((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.startedAt)) / 1000
				)
			)
		: null;
	const hasTerminal = (job.state === "running" || job.state === "needs-input") && !!job.terminalId;
	return (
		<section
			aria-label={`${job.agent.label} agent job`}
			className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]"
		>
			<div className="flex min-h-8 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-3 text-[12px] text-[var(--text-tertiary)]">
				<span className="min-w-0 flex-1 truncate" title={job.cwd}>
					{job.cwd
						? `Review worktree ${job.cwd} · ${job.identity.headSha.slice(0, 8)}`
						: `${job.agent.label} · ${reviewAgentJobLabel(job)}`}
				</span>
				{elapsed !== null && (
					<span>
						{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
					</span>
				)}
				{running && (
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							cancel.mutate({ workspaceId, jobId }, { onSuccess: () => void jobs.refetch() })
						}
					>
						{hasTerminal ? "Stop agent" : "Cancel"}
					</button>
				)}
			</div>
			{error && (
				<p role="alert" className="px-4 text-[var(--color-danger)]">
					{error.message}
				</p>
			)}
			{hasTerminal && job.terminalId ? (
				<div className="relative min-h-0 flex-1">
					<ReviewAgentTerminal
						key={job.terminalId}
						id={job.terminalId}
						cwd={job.cwd ?? legacyCwd ?? ""}
						workspaceId={workspaceId}
						active={active}
						initialContent={savedScrollback[job.terminalId]}
					/>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-auto p-6">
					<div className="mx-auto max-w-[640px] py-8">
						<h2 className="text-lg font-semibold">{reviewAgentJobLabel(job)}</h2>
						{job.phase === "fetching" && job.fetchProgress && (
							<output aria-live="polite" className="mt-3 block text-[14px] text-[var(--text)]">
								{formatReviewFetchProgress(job.fetchProgress)}
							</output>
						)}
						<p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
							Attempt {job.attempt} · {job.phase}
							{job.updatedAt ? ` · Updated ${new Date(job.updatedAt).toLocaleTimeString()}` : ""}
						</p>
						<p className="mt-2 text-[13px] text-[var(--text-secondary)]">
							{job.error ??
								(running
									? "You can keep reading while the agent prepares this PR."
									: "The saved reading path and findings remain available in Review.")}
						</p>
						<ol className="my-6 space-y-3 text-[13px]">
							{job.activity.map((activity, index) => (
								<li key={`${activity.at}:${index}`} className="flex gap-4">
									<time className="text-[var(--text-quaternary)]">
										{new Date(activity.at).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
											second: "2-digit",
										})}
									</time>
									<span>{activity.message}</span>
								</li>
							))}
						</ol>
						<div className="flex flex-wrap gap-3">
							<button
								type="button"
								className="rounded-md border border-[var(--border)] px-3 py-2 text-[13px]"
								onClick={() => revealReview(workspaceId)}
							>
								Open reading path
							</button>
							{!running && (
								<button
									type="button"
									className="rounded-md border border-[var(--border)] px-3 py-2 text-[13px]"
									onClick={() => {
										const review = useTabStore
											.getState()
											.getTabsByWorkspace(workspaceId)
											.find((tab) => tab.kind === "pr-review");
										if (review?.kind !== "pr-review") return;
										revealReview(workspaceId);
										const ui = reviewUIStoreFor(
											reviewUIScopeKey({ workspaceId, prCtx: review.prCtx })
										).getState();
										ui.setCommentFilter("pending");
										ui.setPanel("threads");
									}}
								>
									Review findings
								</button>
							)}
							{(job.state === "failed" || job.state === "cancelled") && (
								<button
									type="button"
									disabled={busy}
									className="rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] text-[var(--accent-foreground)]"
									onClick={() => void retryJob().catch(() => {})}
								>
									Retry
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</section>
	);
}
