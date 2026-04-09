import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import type { AgentAlert } from "../../shared/agent-events";
import type { GitHubPREnriched, GitHubReviewer } from "../../shared/github-types";
import { SwarmIndicator } from "./WorkspaceItem";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function initials(name: string): string {
	return name
		.split(/[\s-_]+/)
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

// ── Sub-components ───────────────────────────────────────────────────────────

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

// ── Merged types ─────────────────────────────────────────────────────────────

export interface MergedPR {
	provider: "github" | "bitbucket";
	id: string;
	number: number | string;
	title: string;
	url: string;
	state: "open" | "merged" | "closed";
	isDraft: boolean;
	repoKey: string;
	repoDisplay: string;
	githubPR?: GitHubPR;
	bitbucketPR?: BitbucketPullRequest;
	reviewDecision?: GitHubPR["reviewDecision"];
	commentCount?: number;
}

// ── Rich PR List Item ────────────────────────────────────────────────────────

export function RichPRItem({
	pr,
	enriched,
	enrichmentLoading,
	isReviewer,
	isActive,
	isInActiveGroup,
	agentAlert,
	projectsList,
	onClick,
	onContextMenu,
}: {
	pr: MergedPR;
	enriched: GitHubPREnriched | undefined;
	enrichmentLoading: boolean;
	isReviewer: boolean;
	isActive: boolean;
	isInActiveGroup: boolean;
	identifier: string;
	agentAlert: AgentAlert | undefined;
	projectsList:
		| Array<{
				id: string;
				remoteOwner: string | null;
				remoteRepo: string | null;
				repoPath: string;
				defaultBranch: string;
		  }>
		| undefined;
	onClick: (e: React.MouseEvent) => void;
	onContextMenu?: (e: React.MouseEvent) => void;
}) {
	const sourceBranch = pr.githubPR?.branchName ?? pr.bitbucketPR?.source?.branch?.name ?? "";
	const targetBranch = enriched ? undefined : pr.bitbucketPR?.destination?.branch?.name;
	const project = pr.githubPR
		? projectsList?.find(
				(p) => p.remoteOwner === pr.githubPR!.repoOwner && p.remoteRepo === pr.githubPR!.repoName
			)
		: pr.bitbucketPR
			? projectsList?.find(
					(p) =>
						p.remoteOwner === pr.bitbucketPR!.workspace && p.remoteRepo === pr.bitbucketPR!.repoSlug
				)
			: undefined;
	const resolvedTarget = targetBranch ?? project?.defaultBranch ?? "main";
	const healthColor = getHealthColor(pr, enriched);

	return (
		<button
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={[
				"group flex w-full flex-col gap-0.5 border-none pr-3 py-[7px] text-left text-[12px] cursor-pointer",
				"transition-all duration-[120ms]",
				isActive
					? "rounded-r-[6px] rounded-l-none bg-[#17171e] hover:bg-[#1c1c24]"
					: "rounded-[6px] bg-transparent hover:bg-[var(--bg-elevated)]",
				isActive && isInActiveGroup ? "pl-[20px]" : "pl-[22px]",
				isActive
					? "text-[var(--text)]"
					: isReviewer
						? "text-[var(--text-secondary)]"
						: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
			].join(" ")}
			style={
				isActive && isInActiveGroup
					? { borderLeft: "2px solid rgba(10, 132, 255, 0.5)", marginLeft: -2 }
					: undefined
			}
			title={`${pr.repoDisplay}#${pr.number}: ${pr.title}`}
		>
			{/* Row 1: Title + SwarmIndicator + health dot + PR number */}
			<div className="flex items-center gap-1">
				<span className="min-w-0 flex-1 truncate text-[12px] leading-tight">{pr.title}</span>
				{agentAlert && <SwarmIndicator alert={agentAlert} />}
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

			{/* Row 2: Branch info */}
			<div className="flex items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
				<span className="min-w-0 truncate font-mono">{sourceBranch}</span>
				<span className="shrink-0">{">"}</span>
				<span className="shrink-0 truncate font-mono">{resolvedTarget}</span>
			</div>

			{/* Row 3: Author + Reviewers */}
			{(enriched || enrichmentLoading) && (
				<div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
					{enriched ? (
						<>
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
						</>
					) : (
						<EnrichmentSkeleton />
					)}
				</div>
			)}
		</button>
	);
}
