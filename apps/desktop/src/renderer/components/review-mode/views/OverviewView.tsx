import { useState } from "react";
import type { GitHubPRDetails, PRContext } from "../../../../shared/github-types";
import type { ThreadFilter } from "../../../lib/pr-review-threads";
import { trpc } from "../../../trpc/client";
import { MarkdownRenderer } from "../../MarkdownRenderer";

interface OverviewDraft {
	summaryMarkdown?: string | null;
	roundNumber?: number | null;
	reviewChainId?: string | null;
}
interface OverviewViewProps {
	prCtx: PRContext;
	details: GitHubPRDetails;
	aiDraft: OverviewDraft | undefined;
	counts: Record<ThreadFilter, number>;
	onJumpToComments: (filter: ThreadFilter) => void;
	onReadFiles?: () => void;
}
const decisions: Record<string, string> = {
	APPROVED: "Approved",
	CHANGES_REQUESTED: "Changes requested",
	COMMENTED: "Commented",
	PENDING: "Pending",
};
const checkLabel: Record<string, string> = {
	SUCCESS: "Checks passing",
	FAILURE: "Checks failing",
	PENDING: "Checks running",
	NEUTRAL: "Checks complete",
};
export function OverviewView({
	prCtx,
	details,
	aiDraft,
	counts,
	onJumpToComments,
	onReadFiles,
}: OverviewViewProps) {
	const [historyExpanded, setHistoryExpanded] = useState(false);
	const reviewChainId = aiDraft?.reviewChainId ?? "";
	const { data: history } = trpc.aiReview.getReviewChainHistory.useQuery(
		{ reviewChainId },
		{ enabled: !!reviewChainId, staleTime: 30_000 }
	);
	const previous = (history ?? []).filter((round) => round.roundNumber !== aiDraft?.roundNumber);
	const additions = details.files.reduce((sum, file) => sum + file.additions, 0);
	const deletions = details.files.reduce((sum, file) => sum + file.deletions, 0);
	const approved = details.reviewers.filter((reviewer) => reviewer.decision === "APPROVED").length;
	const state = details.isDraft
		? "Draft"
		: details.state === "OPEN"
			? "Open"
			: details.state === "MERGED"
				? "Merged"
				: "Closed";
	return (
		<div className="mx-auto w-full max-w-[1120px] px-[32px] py-[28px]">
			<header className="mb-[24px] border-b border-[var(--border-subtle)] pb-[24px]">
				<div className="mb-[10px] flex flex-wrap items-center gap-[8px] text-[12px] text-[var(--text-tertiary)]">
					<span>
						{prCtx.owner}/{prCtx.repo}
					</span>
					<span>#{prCtx.number}</span>
					<span className="rounded-[5px] bg-[var(--bg-elevated)] px-[8px] py-[3px] text-[var(--text-secondary)]">
						{state}
					</span>
					<span className="ml-auto">{prCtx.provider === "github" ? "GitHub" : "Bitbucket"}</span>
				</div>
				<h1 className="max-w-[960px] text-[20px] font-semibold leading-[28px] tracking-tight text-[var(--text)]">
					{details.title}
				</h1>
				<div className="mt-[14px] flex flex-wrap items-center gap-x-[16px] gap-y-[8px] text-[12px] text-[var(--text-secondary)]">
					<span>By {details.author}</span>
					<span
						className="min-w-0 max-w-full truncate font-mono text-[11px] text-[var(--text-tertiary)]"
						title={`${details.sourceBranch} → ${details.targetBranch}`}
					>
						{details.sourceBranch} <span aria-label="into">→</span> {details.targetBranch}
					</span>
				</div>
			</header>
			<div className="grid gap-[28px] min-[1100px]:grid-cols-[minmax(0,1fr)_250px]">
				<div className="min-w-0 space-y-[24px]">
					<section
						aria-label="Changes"
						className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[18px]"
					>
						<div className="flex flex-wrap items-center justify-between gap-[16px]">
							<div>
								<h2 className="text-[13px] font-semibold text-[var(--text)]">Changes to review</h2>
								<p className="mt-[5px] text-[13px] text-[var(--text-secondary)]">
									{details.files.length} changed files{" "}
									<span className="mx-[8px] text-[var(--text-tertiary)]">·</span>
									<span className="font-mono text-[12px] text-[var(--color-success)]">
										+{additions}
									</span>
									<span className="ml-[6px] font-mono text-[12px] text-[var(--color-danger)]">
										−{deletions}
									</span>
								</p>
							</div>
							{onReadFiles && (
								<button
									type="button"
									onClick={onReadFiles}
									disabled={!details.files.length}
									className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-[12px] py-[8px] text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-overlay)] disabled:opacity-50"
								>
									Browse changed files →
								</button>
							)}
						</div>
						<p className="mt-[12px] border-t border-[var(--border-subtle)] pt-[12px] text-[12px] leading-[18px] text-[var(--text-tertiary)]">
							Use the review controls above to start an agent, or browse these files yourself.
							<kbd className="ml-1 rounded bg-[var(--bg-overlay)] px-[4px]">j</kbd> opens the first
							file.
						</p>
					</section>
					<section>
						<h2 className="mb-[10px] text-[13px] font-semibold text-[var(--text)]">Description</h2>
						{details.body.trim() ? (
							<MarkdownRenderer content={details.body} />
						) : (
							<p className="rounded-[6px] border border-dashed border-[var(--border)] px-[14px] py-[16px] text-[13px] text-[var(--text-tertiary)]">
								The author hasn’t added a description.
							</p>
						)}
					</section>
					{aiDraft?.summaryMarkdown && (
						<section className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[18px]">
							<div className="mb-[12px] flex items-center gap-[8px]">
								<h2 className="text-[13px] font-semibold text-[var(--text)]">
									Agent review summary
								</h2>
								{aiDraft.roundNumber != null && (
									<span className="text-[11px] text-[var(--text-tertiary)]">
										Round {aiDraft.roundNumber}
									</span>
								)}
							</div>
							<MarkdownRenderer content={aiDraft.summaryMarkdown} />
							{previous.length > 0 && (
								<div className="mt-[14px] border-t border-[var(--border-subtle)] pt-[10px]">
									<button
										type="button"
										onClick={() => setHistoryExpanded(!historyExpanded)}
										className="text-[12px] text-[var(--accent-hover)]"
									>
										{historyExpanded ? "Hide" : "Show"} previous review rounds
									</button>
									{historyExpanded &&
										previous.map((round) => (
											<p
												key={round.id}
												className="mt-[8px] text-[12px] text-[var(--text-secondary)]"
											>
												Round {round.roundNumber} · {round.commentCount} comments
											</p>
										))}
								</div>
							)}
						</section>
					)}
				</div>
				<aside className="min-w-0 space-y-[24px]" aria-label="Review status">
					<section>
						<h2 className="mb-[10px] text-[13px] font-semibold text-[var(--text)]">Discussion</h2>
						<div className="flex flex-col gap-[6px]">
							{(
								[
									{ filter: "open", label: "Open threads" },
									{ filter: "pending", label: "Pending findings" },
									{ filter: "accepted", label: "Accepted comments" },
									{ filter: "resolved", label: "Resolved threads" },
								] as const
							).map((item) => (
								<button
									type="button"
									key={item.filter}
									disabled={!counts[item.filter]}
									onClick={() => onJumpToComments(item.filter)}
									className="flex items-center justify-between rounded-[6px] bg-[var(--bg-surface)] px-[12px] py-[9px] text-[12px] text-[var(--text-secondary)] enabled:hover:bg-[var(--bg-overlay)] disabled:opacity-60"
								>
									<span>{item.label}</span>
									<span className="font-medium tabular-nums text-[var(--text)]">
										{counts[item.filter]}
									</span>
								</button>
							))}
						</div>
					</section>
					<section>
						<div className="mb-[10px] flex items-center justify-between">
							<h2 className="text-[13px] font-semibold text-[var(--text)]">Reviewers</h2>
							{details.reviewers.length > 0 && (
								<span className="text-[11px] text-[var(--text-tertiary)]">
									{approved}/{details.reviewers.length} approved
								</span>
							)}
						</div>
						{!details.reviewers.length && (
							<p className="text-[12px] text-[var(--text-tertiary)]">No reviewers assigned.</p>
						)}
						<div className="space-y-[10px]">
							{details.reviewers.map((reviewer) => (
								<div
									key={reviewer.login}
									className="flex items-start justify-between gap-[10px] text-[12px]"
								>
									<span className="min-w-0 text-[var(--text-secondary)]">{reviewer.login}</span>
									<span
										className={`shrink-0 text-[11px] ${reviewer.decision === "APPROVED" ? "text-[var(--color-success)]" : reviewer.decision === "CHANGES_REQUESTED" ? "text-[var(--tag-amber-fg)]" : "text-[var(--text-tertiary)]"}`}
									>
										{decisions[reviewer.decision ?? "PENDING"] ?? "Pending"}
									</span>
								</div>
							))}
						</div>
					</section>
					<section>
						<h2 className="mb-[10px] text-[13px] font-semibold text-[var(--text)]">Checks</h2>
						<p
							className={`text-[12px] ${details.ciState === "SUCCESS" ? "text-[var(--color-success)]" : details.ciState === "FAILURE" ? "text-[var(--color-danger)]" : "text-[var(--text-tertiary)]"}`}
						>
							{details.ciState ? checkLabel[details.ciState] : "No checks reported"}
						</p>
						{details.checks.map((check) => (
							<div
								key={check.name}
								className="mt-[8px] flex justify-between gap-[8px] text-[11px] text-[var(--text-secondary)]"
							>
								<span className="min-w-0 truncate" title={check.name}>
									{check.name}
								</span>
								<span className="text-[var(--text-tertiary)]">
									{check.conclusion ?? check.status}
								</span>
							</div>
						))}
					</section>
				</aside>
			</div>
		</div>
	);
}
