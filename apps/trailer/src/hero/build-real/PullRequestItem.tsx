// Mirrors apps/desktop/src/renderer/components/PullRequestItem.tsx. Static, no handlers.

export interface GitHubReviewer {
	login: string;
	decision: "APPROVED" | "CHANGES_REQUESTED" | "PENDING" | "COMMENTED" | "DISMISSED" | null;
}

export interface GitHubPREnriched {
	author: string;
	reviewers: GitHubReviewer[];
	ciState?: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | null;
	mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
	headCommitOid?: string;
}

export interface MergedPR {
	provider: "github" | "bitbucket";
	id: string;
	number: number | string;
	title: string;
	state: "open" | "merged" | "closed";
	isDraft: boolean;
	repoDisplay: string;
	reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | null;
	commentCount?: number;
	sourceBranch: string;
	targetBranch: string;
}

function initials(name: string): string {
	const tokens = name.split(/[\s\-_]+/).filter(Boolean);
	if (tokens.length === 0) return "";
	if (tokens.length === 1) return tokens[0]!.slice(0, 2).toUpperCase();
	return tokens
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? "")
		.join("");
}

export function getHealthColor(pr: MergedPR, enriched?: GitHubPREnriched): string {
	if (enriched?.mergeable === "CONFLICTING") return "#f85149";
	if (enriched?.ciState === "FAILURE") return "#f85149";
	if (pr.reviewDecision === "CHANGES_REQUESTED") return "#d29922";
	if (pr.reviewDecision === "APPROVED") return "#3fb950";
	return "#484848";
}

function ReviewerAvatar({ reviewer }: { reviewer: GitHubReviewer }) {
	const borderColor =
		reviewer.decision === "APPROVED"
			? "#3fb950"
			: reviewer.decision === "CHANGES_REQUESTED"
				? "#d29922"
				: "#484848";

	return (
		<div
			title={`${reviewer.login}: ${reviewer.decision ?? "pending"}`}
			className="flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-[var(--text-tertiary)]"
			style={{
				border: `2px solid ${borderColor}`,
				backgroundColor: "var(--bg-elevated)",
			}}
		>
			{initials(reviewer.login)}
		</div>
	);
}

function EnrichmentSkeleton() {
	return (
		<div className="mt-0.5 flex items-center gap-1.5">
			<div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-elevated)]" />
			<div className="h-3 w-8 animate-pulse rounded bg-[var(--bg-elevated)]" />
		</div>
	);
}

function SwarmIndicator(_props: { alert: unknown }) {
	return null;
}

export function RichPRItem({
	pr,
	enriched,
	isReviewer,
	isActive,
	agentAlert,
	reviewStatus,
}: {
	pr: MergedPR;
	enriched: GitHubPREnriched | undefined;
	isReviewer: boolean;
	isActive: boolean;
	agentAlert: unknown | undefined;
	projectsList?: undefined;
	reviewStatus?: {
		status: string;
		commentCount: number;
		roundNumber: number;
	} | null;
}) {
	const sourceBranch = pr.sourceBranch;
	const resolvedTarget = pr.targetBranch;
	const healthColor = getHealthColor(pr, enriched);

	return (
		<button
			type="button"
			className={[
				"group relative flex w-full flex-col gap-0.5 border-none pl-[22px] pr-3 py-[7px] text-left text-[12px] cursor-pointer rounded-[6px]",
				"transition-all duration-[120ms]",
				isActive
					? "bg-[var(--bg-elevated)] hover:bg-[var(--bg-overlay)] text-[var(--text)]"
					: isReviewer
						? "bg-transparent hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
						: "bg-transparent hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
			].join(" ")}
			title={`${pr.repoDisplay}#${pr.number}: ${pr.title}`}
		>
			{isActive && (
				<span
					aria-hidden="true"
					className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-[var(--accent)]"
				/>
			)}
			{/* Row 1: Title + SwarmIndicator + health dot + PR number */}
			<div className="flex items-center gap-1">
				<span className="min-w-0 flex-1 truncate text-[12px] leading-tight">{pr.title}</span>
				{agentAlert ? <SwarmIndicator alert={agentAlert} /> : null}
				<span
					className="size-1.5 shrink-0 rounded-full"
					style={{ backgroundColor: healthColor }}
					title={
						healthColor === "#3fb950"
							? "Approved"
							: healthColor === "#d29922"
								? "Changes requested"
								: healthColor === "#f85149"
									? "Conflicts or CI failure"
									: "Pending review"
					}
				/>
				<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">
					#{pr.number}
				</span>
			</div>

			{/* Row 1.5: AI Review status badge */}
			{reviewStatus && (
				<div className="flex items-center gap-1 mt-px">
					{(reviewStatus.status === "queued" || reviewStatus.status === "in_progress") && (
						<span className="inline-flex items-center gap-1 text-[10px] text-[var(--accent)]">
							<span className="size-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
							Reviewing…
						</span>
					)}
					{reviewStatus.status === "ready" && (
						<span className="text-[10px] text-[var(--warning)]">Review ready</span>
					)}
					{reviewStatus.status === "submitted" && (
						<span className="text-[10px] text-[var(--success)]">
							Submitted{reviewStatus.roundNumber > 1 ? ` (Round ${reviewStatus.roundNumber})` : ""}
						</span>
					)}
					{reviewStatus.status === "cancelled" && (
						<span className="text-[10px] text-[var(--text-quaternary)]">Cancelled</span>
					)}
					{reviewStatus.status === "failed" && (
						<span className="text-[10px] text-[var(--danger)]">Failed</span>
					)}
				</div>
			)}

			{/* Row 2: Branch info */}
			<div className="flex items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
				<span className="min-w-0 truncate font-mono">{sourceBranch}</span>
				<span className="shrink-0">{">"}</span>
				<span className="shrink-0 truncate font-mono">{resolvedTarget}</span>
			</div>

			{/* Row 3: Author + Reviewers */}
			{enriched && (
				<div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
					<span className="shrink-0 text-[8px] uppercase tracking-[0.05em] text-[var(--text-quaternary)] opacity-50">
						by
					</span>
					<div
						className="flex size-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-[var(--text-tertiary)]"
						style={{ backgroundColor: "var(--bg-overlay)" }}
						title={enriched.author}
					>
						{initials(enriched.author)}
					</div>
					<span className="truncate">{enriched.author}</span>

					{enriched.reviewers.length > 0 && <span className="flex-1" />}

					<div className="flex items-center gap-0.5">
						{enriched.reviewers.map((r) => (
							<ReviewerAvatar key={r.login} reviewer={r} />
						))}
					</div>
				</div>
			)}
		</button>
	);
}

export { EnrichmentSkeleton };
