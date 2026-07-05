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
}

const REVIEWER_META: Record<string, { label: string; className: string }> = {
	APPROVED: { label: "Approved", className: "text-[var(--color-success)]" },
	CHANGES_REQUESTED: {
		label: "Changes requested",
		className: "text-[var(--color-danger)]",
	},
	COMMENTED: { label: "Commented", className: "text-[var(--text-tertiary)]" },
	PENDING: { label: "Pending", className: "text-[var(--color-warning)]" },
};

const COMMENT_STATS: Array<{ label: string; filter: Exclude<ThreadFilter, "all"> }> = [
	{ label: "Pending", filter: "pending" },
	{ label: "Accepted", filter: "accepted" },
	{ label: "Declined", filter: "declined" },
	{ label: "Open", filter: "open" },
	{ label: "Resolved", filter: "resolved" },
];

function stateLabel(details: GitHubPRDetails): string {
	if (details.isDraft) return "Draft";
	if (details.state === "OPEN") return "Open";
	if (details.state === "MERGED") return "Merged";
	return "Closed";
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleDateString();
}

export function OverviewView({
	prCtx,
	details,
	aiDraft,
	counts,
	onJumpToComments,
}: OverviewViewProps) {
	const [historyExpanded, setHistoryExpanded] = useState(false);
	const additions = details.files.reduce((sum, file) => sum + file.additions, 0);
	const deletions = details.files.reduce((sum, file) => sum + file.deletions, 0);
	const reviewChainId = aiDraft?.reviewChainId ?? "";
	const { data: chainHistory } = trpc.aiReview.getReviewChainHistory.useQuery(
		{ reviewChainId },
		{ enabled: reviewChainId.length > 0 }
	);
	const previousRounds = (chainHistory ?? []).filter(
		(round) => round.roundNumber !== aiDraft?.roundNumber
	);

	return (
		<div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-8">
			<section>
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="min-w-0 text-[18px] font-semibold text-[var(--text)]">{details.title}</h1>
					<span className="shrink-0 text-[12px] text-[var(--text-tertiary)]">#{prCtx.number}</span>
					<span className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
						{stateLabel(details)}
					</span>
				</div>
				<div className="mt-1 text-[12px] text-[var(--text-tertiary)]">
					by {details.author} - {details.sourceBranch} -&gt; {details.targetBranch}
				</div>
			</section>

			<section className="text-[13px] text-[var(--text-secondary)]">
				{details.body.trim().length > 0 ? (
					<MarkdownRenderer content={details.body} />
				) : (
					<div className="text-[13px] text-[var(--text-tertiary)]">No description</div>
				)}
			</section>

			{aiDraft?.summaryMarkdown && (
				<section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
					<div className="mb-3 flex items-center gap-2">
						<span className="ai-badge">AI</span>
						<span className="text-[13px] font-medium text-[var(--text)]">Review summary</span>
						{aiDraft.roundNumber != null && (
							<span className="text-[11px] text-[var(--text-quaternary)]">
								Round {aiDraft.roundNumber}
							</span>
						)}
					</div>
					<MarkdownRenderer content={aiDraft.summaryMarkdown} />

					{previousRounds.length > 0 && (
						<div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
							<button
								type="button"
								onClick={() => setHistoryExpanded((expanded) => !expanded)}
								className="text-[12px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:text-[var(--text-secondary)]"
							>
								{historyExpanded ? "Hide" : "Show"} previous rounds
							</button>
							{historyExpanded && (
								<div className="mt-2 flex flex-col gap-1.5">
									{previousRounds.map((round) => (
										<div
											key={round.id}
											className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px]"
										>
											<span className="text-[var(--text-secondary)]">
												Round {round.roundNumber}
											</span>
											<span className="text-[11px] text-[var(--text-quaternary)]">
												{round.commentCount} comments - {formatDate(round.createdAt)}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</section>
			)}

			<section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				<div className="rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2">
					<div className="text-[13px] font-medium text-[var(--text)]">{details.files.length}</div>
					<div className="text-[12px] text-[var(--text-tertiary)]">Files</div>
				</div>
				<div className="rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2">
					<div className="font-mono text-[13px] font-medium">
						<span className="text-[var(--color-success)]">+{additions}</span>{" "}
						<span className="text-[var(--color-danger)]">-{deletions}</span>
					</div>
					<div className="text-[12px] text-[var(--text-tertiary)]">Diff</div>
				</div>
				{COMMENT_STATS.filter((stat) => counts[stat.filter] > 0).map((stat) => (
					<button
						key={stat.filter}
						type="button"
						onClick={() => onJumpToComments(stat.filter)}
						className="rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
					>
						<div className="text-[13px] font-medium text-[var(--text)]">{counts[stat.filter]}</div>
						<div className="text-[12px] text-[var(--text-tertiary)]">{stat.label}</div>
					</button>
				))}
			</section>

			{details.reviewers.length > 0 && (
				<section className="flex flex-col gap-2">
					<h2 className="text-[13px] font-medium text-[var(--text)]">Reviewers</h2>
					{details.reviewers.map((reviewer) => {
						const meta = reviewer.decision ? REVIEWER_META[reviewer.decision] : null;
						return (
							<div
								key={reviewer.login}
								className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2"
							>
								<span className="min-w-0 truncate text-[13px] text-[var(--text-secondary)]">
									{reviewer.login}
								</span>
								<span
									className={`shrink-0 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium ${
										meta?.className ?? "text-[var(--text-tertiary)]"
									}`}
								>
									{meta?.label ?? "Pending"}
								</span>
							</div>
						);
					})}
				</section>
			)}
		</div>
	);
}
