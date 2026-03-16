import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import type { GitHubPRContext, GitHubPREnriched, GitHubReviewer } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CreateWorktreeFromPRModal } from "./CreateWorktreeFromPRModal";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
	const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	return `${Math.floor(days / 30)}mo`;
}

function initials(name: string): string {
	return name
		.split(/[\s-_]+/)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? "")
		.join("");
}

// ── Shared sub-components ────────────────────────────────────────────────────

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

function CIBadge({ state }: { state: GitHubPREnriched["ciState"] }) {
	if (!state) return null;
	const config = {
		SUCCESS: { color: "#3fb950", label: "CI" },
		FAILURE: { color: "#f85149", label: "CI" },
		PENDING: { color: "#d29922", label: "CI" },
		NEUTRAL: { color: "#484848", label: "CI" },
	} as const;
	const { color, label } = config[state];
	return (
		<span
			className="shrink-0 rounded-[3px] px-1 py-px text-[9px] font-semibold leading-tight"
			style={{ color, border: `1px solid ${color}40` }}
		>
			{label}
		</span>
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

interface MergedPR {
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

// ── AI Review Status Badge ───────────────────────────────────────────────────

function AIReviewBadge({
	pr,
	identifier,
	getReviewStatus,
	projectsList,
	store,
	triggerReview,
	dismissReview,
}: {
	pr: MergedPR;
	identifier: string;
	getReviewStatus: (id: string) => { id: string; status: string } | undefined;
	projectsList:
		| Array<{
				id: string;
				githubOwner: string | null;
				githubRepo: string | null;
				repoPath: string;
				defaultBranch: string;
		  }>
		| undefined;
	store: ReturnType<typeof useTabStore>;
	triggerReview: { mutate: (args: Record<string, string>) => void };
	dismissReview: { mutate: (args: { draftId: string }) => void };
}) {
	const draft = getReviewStatus(identifier);

	if (draft?.status === "ready") {
		return (
			<button
				type="button"
				className="shrink-0 cursor-pointer rounded-[4px] border-none bg-[rgba(48,209,88,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[#30d158]"
				onClick={(e) => {
					e.stopPropagation();
					if (pr.provider === "github" && pr.githubPR) {
						const project = projectsList?.find(
							(p) =>
								p.githubOwner === pr.githubPR!.repoOwner && p.githubRepo === pr.githubPR!.repoName
						);
						store.openPRReviewPanel(store.activeWorkspaceId ?? "", {
							owner: pr.githubPR.repoOwner,
							repo: pr.githubPR.repoName,
							number: pr.githubPR.number,
							title: pr.title,
							sourceBranch: pr.githubPR.branchName,
							targetBranch: project?.defaultBranch ?? "main",
							repoPath: project?.repoPath ?? "",
						});
					}
				}}
			>
				AI Ready
			</button>
		);
	}
	if (draft?.status === "in_progress") {
		return (
			<span className="flex shrink-0 items-center gap-1 rounded-[4px] bg-[rgba(255,214,10,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[#ffd60a]">
				<span className="inline-block size-1.5 animate-pulse rounded-full bg-[#ffd60a]" />
				AI...
			</span>
		);
	}
	if (draft?.status === "queued") {
		return (
			<span className="shrink-0 rounded-[4px] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-quaternary)]">
				Queued
			</span>
		);
	}
	if (draft?.status === "failed") {
		return (
			<button
				type="button"
				className="shrink-0 cursor-pointer rounded-[4px] border-none bg-[rgba(255,69,58,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[#ff453a] transition-colors hover:bg-[rgba(255,69,58,0.25)]"
				onClick={(e) => {
					e.stopPropagation();
					dismissReview.mutate({ draftId: draft.id });
				}}
			>
				Failed
			</button>
		);
	}
	if (!draft) {
		const handleTrigger = () => {
			if (pr.provider === "github" && pr.githubPR) {
				const project = projectsList?.find(
					(p) => p.githubOwner === pr.githubPR!.repoOwner && p.githubRepo === pr.githubPR!.repoName
				);
				if (!project) return;
				triggerReview.mutate({
					provider: "github",
					identifier,
					title: pr.title,
					author: "",
					sourceBranch: pr.githubPR.branchName,
					targetBranch: project.defaultBranch ?? "main",
					repoPath: project.repoPath,
					projectId: project.id,
				});
			}
			if (pr.provider === "bitbucket" && pr.bitbucketPR) {
				triggerReview.mutate({
					provider: "bitbucket",
					identifier,
					title: pr.title,
					author: pr.bitbucketPR.author,
					sourceBranch: pr.bitbucketPR.source?.branch?.name ?? "",
					targetBranch: pr.bitbucketPR.destination?.branch?.name ?? "main",
					repoPath: "",
					projectId: "",
				});
			}
		};
		return (
			<button
				type="button"
				className="shrink-0 cursor-pointer rounded-[4px] border-none bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]"
				onClick={(e) => {
					e.stopPropagation();
					handleTrigger();
				}}
			>
				AI
			</button>
		);
	}
	return null;
}

// ── Rich PR List Item ────────────────────────────────────────────────────────

function RichPRItem({
	pr,
	enriched,
	enrichmentLoading,
	isReviewer,
	identifier,
	getReviewStatus,
	projectsList,
	store,
	triggerReview,
	dismissReview,
	onClick,
}: {
	pr: MergedPR;
	enriched: GitHubPREnriched | undefined;
	enrichmentLoading: boolean;
	isReviewer: boolean;
	identifier: string;
	getReviewStatus: (id: string) => { id: string; status: string } | undefined;
	projectsList:
		| Array<{
				id: string;
				githubOwner: string | null;
				githubRepo: string | null;
				repoPath: string;
				defaultBranch: string;
		  }>
		| undefined;
	store: ReturnType<typeof useTabStore>;
	triggerReview: { mutate: (args: Record<string, string>) => void };
	dismissReview: { mutate: (args: { draftId: string }) => void };
	onClick: (e: React.MouseEvent) => void;
}) {
	const borderLeftColor =
		pr.state === "merged"
			? "#a371f7"
			: pr.state === "closed"
				? "#f85149"
				: enriched?.isDraft
					? "#484848"
					: "#3fb950";

	const sourceBranch = pr.githubPR?.branchName ?? pr.bitbucketPR?.source?.branch?.name ?? "";
	const targetBranch = enriched
		? undefined // enriched doesn't carry targetBranch but we can get it from project
		: pr.bitbucketPR?.destination?.branch?.name;
	const project = pr.githubPR
		? projectsList?.find(
				(p) => p.githubOwner === pr.githubPR!.repoOwner && p.githubRepo === pr.githubPR!.repoName
			)
		: undefined;
	const resolvedTarget = targetBranch ?? project?.defaultBranch ?? "main";

	return (
		<button
			type="button"
			onClick={onClick}
			className={`group flex w-full flex-col gap-0.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
				isReviewer
					? "cursor-pointer text-[var(--text-secondary)]"
					: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
			}`}
			style={{ borderLeft: `3px solid ${borderLeftColor}` }}
			title={`${pr.repoDisplay}#${pr.number}: ${pr.title}`}
		>
			{/* Row 1: Title + PR number */}
			<div className="flex items-start gap-1.5">
				<span className="min-w-0 flex-1 truncate text-[12px] leading-tight">{pr.title}</span>
				<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">
					#{pr.number}
				</span>
			</div>

			{/* Row 2: Branch info + time since update */}
			<div className="flex items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
				<span className="min-w-0 truncate font-mono">{sourceBranch}</span>
				<span className="shrink-0">{">"}</span>
				<span className="shrink-0 truncate font-mono">{resolvedTarget}</span>
				{enriched?.updatedAt && (
					<span className="ml-auto shrink-0 tabular-nums">{timeAgo(enriched.updatedAt)}</span>
				)}
			</div>

			{/* Row 3: Author + Reviewers */}
			{(enriched || enrichmentLoading) && (
				<div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-quaternary)]">
					{enriched ? (
						<>
							{/* Author */}
							<div className="flex items-center gap-1">
								<div
									className="flex size-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-[var(--text-tertiary)]"
									style={{ backgroundColor: "var(--bg-overlay)" }}
									title={enriched.author}
								>
									{initials(enriched.author)}
								</div>
								<span className="truncate">{enriched.author}</span>
							</div>

							{/* Divider */}
							{enriched.reviewers.length > 0 && (
								<span className="text-[var(--text-quaternary)] opacity-30">|</span>
							)}

							{/* Reviewer avatars */}
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

			{/* Row 4: Activity indicators */}
			<div className="mt-0.5 flex items-center gap-1.5">
				{/* Draft badge */}
				{(enriched?.isDraft ?? pr.isDraft) && (
					<span className="rounded-[3px] bg-[var(--bg-overlay)] px-1 py-px text-[9px] font-medium text-[var(--text-quaternary)]">
						Draft
					</span>
				)}

				{/* Merge conflicts */}
				{enriched?.mergeable === "CONFLICTING" && (
					<span
						className="rounded-[3px] px-1 py-px text-[9px] font-semibold leading-tight"
						style={{ color: "#f85149", border: "1px solid rgba(248,81,73,0.25)" }}
					>
						Conflict
					</span>
				)}

				{/* CI status */}
				{enriched && <CIBadge state={enriched.ciState} />}

				{/* Unresolved comments */}
				{enriched && enriched.unresolvedThreadCount > 0 && (
					<span className="flex items-center gap-0.5 text-[9px] text-[var(--text-quaternary)]">
						<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25v-7.5z" />
						</svg>
						{enriched.unresolvedThreadCount}
					</span>
				)}

				{/* Files changed */}
				{enriched && enriched.files.count > 0 && (
					<span className="flex items-center gap-0.5 text-[9px] text-[var(--text-quaternary)]">
						<svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25V1.75z" />
						</svg>
						{enriched.files.count}
						<span className="text-green-500">+{enriched.files.additions}</span>
						<span className="text-red-400">-{enriched.files.deletions}</span>
					</span>
				)}

				{/* Spacer to push AI badge right */}
				<span className="flex-1" />

				{/* AI Review badge */}
				<AIReviewBadge
					pr={pr}
					identifier={identifier}
					getReviewStatus={getReviewStatus}
					projectsList={projectsList}
					store={store}
					triggerReview={triggerReview}
					dismissReview={dismissReview}
				/>
			</div>
		</button>
	);
}

// ── Main Tab ─────────────────────────────────────────────────────────────────

export function PullRequestsTab() {
	const utils = trpc.useUtils();
	const [openModalPR, setOpenModalPR] = useState<GitHubPR | null>(null);
	const [linkError, setLinkError] = useState<string | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		pr: MergedPR;
		workspaces: LinkedWorkspace[];
	} | null>(null);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	// ── Data Fetching ─────────────────────────────────────────────────────────

	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: githubStatus } = trpc.github.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});

	const hasBitbucket = atlassianStatus?.bitbucket.connected;
	const hasGitHub = githubStatus?.connected;

	const { data: bbMyPRs } = trpc.atlassian.getMyPullRequests.useQuery(undefined, {
		enabled: hasBitbucket,
		staleTime: 30_000,
	});
	const { data: bbReviewPRs } = trpc.atlassian.getReviewRequests.useQuery(undefined, {
		enabled: hasBitbucket,
		staleTime: 30_000,
	});
	const { data: ghPRs } = trpc.github.getMyPRs.useQuery(undefined, {
		enabled: hasGitHub,
		staleTime: 30_000,
	});

	const { data: linkedPRs } = trpc.github.getLinkedPRs.useQuery(undefined, {
		staleTime: 30_000,
	});

	const { data: collapsedGroupsList } = trpc.tickets.getCollapsedGroups.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setCollapsedMutation = trpc.tickets.setCollapsedGroups.useMutation();

	const reviewDrafts = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 3_000,
		refetchInterval: 5_000,
	});
	const attachTerminalMut = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef2 = useRef(attachTerminalMut.mutate);
	attachTerminalRef2.current = attachTerminalMut.mutate;

	const [reviewError, setReviewError] = useState<string | null>(null);
	const triggerReview = trpc.aiReview.triggerReview.useMutation({
		onSuccess: (launchInfo) => {
			setReviewError(null);
			reviewDrafts.refetch();
			utils.workspaces.listByProject.invalidate();

			if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;

			// Create workspace terminal and run the launch script
			const tabStore = useTabStore.getState();
			tabStore.setActiveWorkspace(launchInfo.reviewWorkspaceId, launchInfo.worktreePath);
			const tabId = tabStore.addTerminalTab(
				launchInfo.reviewWorkspaceId,
				launchInfo.worktreePath,
				"AI Review"
			);
			attachTerminalRef2.current({
				workspaceId: launchInfo.reviewWorkspaceId,
				terminalId: tabId,
			});

			// Run the launch script after shell initializes
			setTimeout(() => {
				window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
			}, 500);
		},
		onError: (err) => {
			setReviewError(err.message);
			reviewDrafts.refetch();
		},
	});

	const dismissReview = trpc.aiReview.dismissReview.useMutation({
		onSuccess: () => reviewDrafts.refetch(),
	});

	const settings = trpc.aiReview.getSettings.useQuery();
	const { data: projectsList } = trpc.projects.list.useQuery();
	const triggeredRef = useRef(new Set<string>());

	// ── Enrichment query (Change 1) ──────────────────────────────────────────

	const reviewerPRsForEnrichment = useMemo(() => {
		const prs: Array<{ owner: string; repo: string; number: number }> = [];
		for (const pr of ghPRs ?? []) {
			if (pr.role !== "reviewer") continue;
			prs.push({ owner: pr.repoOwner, repo: pr.repoName, number: pr.number });
		}
		return prs;
	}, [ghPRs]);

	const enrichmentQuery = trpc.github.getPRListEnrichment.useQuery(
		{ prs: reviewerPRsForEnrichment },
		{
			enabled: reviewerPRsForEnrichment.length > 0,
			staleTime: 30_000,
			refetchInterval: 60_000,
		}
	);

	const enrichmentMap = useMemo(() => {
		const map = new Map<string, GitHubPREnriched>();
		for (const pr of enrichmentQuery.data ?? []) {
			map.set(`${pr.owner}/${pr.repo}#${pr.number}`, pr);
		}
		return map;
	}, [enrichmentQuery.data]);

	// ── getOrCreate mutation (Change 2) ──────────────────────────────────────

	const getOrCreateMutation = trpc.reviewWorkspaces.getOrCreate.useMutation();

	// ── Auto-trigger effect ──────────────────────────────────────────────────

	useEffect(() => {
		if (!settings.data?.autoReviewEnabled || !reviewDrafts.data) return;

		const existingIdentifiers = new Set(reviewDrafts.data.map((d) => d.prIdentifier));

		// Auto-trigger for GitHub reviewer PRs
		for (const pr of ghPRs ?? []) {
			if (pr.role !== "reviewer") continue;
			const identifier = `${pr.repoOwner}/${pr.repoName}#${pr.number}`;
			if (existingIdentifiers.has(identifier) || triggeredRef.current.has(identifier)) continue;
			const project = projectsList?.find(
				(p) => p.githubOwner === pr.repoOwner && p.githubRepo === pr.repoName
			);
			if (!project) continue;
			triggeredRef.current.add(identifier);
			triggerReview.mutate({
				provider: "github",
				identifier,
				title: pr.title,
				author: "",
				sourceBranch: pr.branchName,
				targetBranch: project.defaultBranch ?? "main",
				repoPath: project.repoPath,
				projectId: project.id,
			});
		}

		// Auto-trigger for Bitbucket review PRs
		for (const pr of bbReviewPRs ?? []) {
			const identifier = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
			if (existingIdentifiers.has(identifier) || triggeredRef.current.has(identifier)) continue;
			// Bitbucket PRs need a tracked project to proceed
			// TODO: resolve bitbucket project mapping
			triggeredRef.current.add(identifier);
			triggerReview.mutate({
				provider: "bitbucket",
				identifier,
				title: pr.title,
				author: pr.author,
				sourceBranch: pr.source?.branch?.name ?? "",
				targetBranch: pr.destination?.branch?.name ?? "main",
				repoPath: "",
				projectId: "",
			});
		}
	}, [ghPRs, bbReviewPRs, reviewDrafts.data, settings.data, projectsList, triggerReview.mutate]);

	const store = useTabStore();

	function getReviewStatus(prIdentifier: string) {
		return reviewDrafts.data?.find((d) => d.prIdentifier === prIdentifier);
	}

	function getPrIdentifier(pr: MergedPR): string {
		if (pr.provider === "github" && pr.githubPR) {
			return `${pr.githubPR.repoOwner}/${pr.githubPR.repoName}#${pr.githubPR.number}`;
		}
		if (pr.provider === "bitbucket" && pr.bitbucketPR) {
			return `${pr.bitbucketPR.workspace}/${pr.bitbucketPR.repoSlug}#${pr.bitbucketPR.id}`;
		}
		return pr.id;
	}

	const collapsedGroups = useMemo(() => new Set(collapsedGroupsList ?? []), [collapsedGroupsList]);

	const toggleGroup = useCallback(
		(groupId: string) => {
			const next = new Set(collapsedGroups);
			if (next.has(groupId)) next.delete(groupId);
			else next.add(groupId);
			setCollapsedMutation.mutate({ groups: Array.from(next) });
			utils.tickets.getCollapsedGroups.setData(undefined, Array.from(next));
		},
		[collapsedGroups, setCollapsedMutation, utils]
	);

	// ── Merging & Grouping ────────────────────────────────────────────────────

	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedPRs) return map;
		for (const l of linkedPRs) {
			if (l.worktreePath === null) continue;
			const key = `${l.prRepoOwner}/${l.prRepoName}#${l.prNumber}`;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const existing = map.get(key);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(key, [entry]);
			}
		}
		return map;
	}, [linkedPRs]);

	const grouped = useMemo(() => {
		const merged: MergedPR[] = [];
		const seenBb = new Set<string>();

		// Bitbucket PRs
		for (const pr of [...(bbMyPRs ?? []), ...(bbReviewPRs ?? [])]) {
			const key = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
			if (seenBb.has(key)) continue;
			seenBb.add(key);
			merged.push({
				provider: "bitbucket",
				id: `bb-${pr.workspace}-${pr.repoSlug}-${pr.id}`,
				number: pr.id,
				title: pr.title,
				url: pr.webUrl,
				state: pr.state === "MERGED" ? "merged" : pr.state === "DECLINED" ? "closed" : "open",
				isDraft: false,
				repoKey: `${pr.workspace}/${pr.repoSlug}`,
				repoDisplay: `${pr.workspace}/${pr.repoSlug}`,
				bitbucketPR: pr,
			});
		}

		// GitHub PRs
		for (const pr of ghPRs ?? []) {
			merged.push({
				provider: "github",
				id: `gh-${pr.repoOwner}-${pr.repoName}-${pr.number}`,
				number: pr.number,
				title: pr.title,
				url: pr.url,
				state: pr.state === "closed" ? "closed" : "open",
				isDraft: pr.isDraft,
				repoKey: `${pr.repoOwner}/${pr.repoName}`,
				repoDisplay: `${pr.repoOwner}/${pr.repoName}`,
				githubPR: pr,
				reviewDecision: pr.reviewDecision,
				commentCount: pr.commentCount,
			});
		}

		// Group by repo
		const groups = new Map<
			string,
			{ name: string; provider: "github" | "bitbucket"; items: MergedPR[] }
		>();
		for (const pr of merged) {
			const existing = groups.get(pr.repoKey);
			if (existing) {
				existing.items.push(pr);
			} else {
				groups.set(pr.repoKey, {
					name: pr.repoDisplay,
					provider: pr.provider,
					items: [pr],
				});
			}
		}

		return groups;
	}, [bbMyPRs, bbReviewPRs, ghPRs]);

	// ── Navigation ────────────────────────────────────────────────────────────

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace, pr: MergedPR) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

		if (pr.githubPR) {
			const prCtx: GitHubPRContext = {
				owner: pr.githubPR.repoOwner,
				repo: pr.githubPR.repoName,
				number: pr.githubPR.number,
				title: pr.githubPR.title,
				sourceBranch: pr.githubPR.branchName,
				targetBranch: "main",
				repoPath: ws.worktreePath,
			};
			store.openPRReviewPanel(ws.workspaceId, prCtx);
		}

		const existing = store.getTabsByWorkspace(ws.workspaceId);
		const hasTerminal = existing.some((t) => t.kind === "terminal");
		if (!hasTerminal) {
			const title = ws.workspaceName ?? ws.workspaceId;
			const tabId = store.addTerminalTab(ws.workspaceId, ws.worktreePath, title);
			attachTerminalRef.current({
				workspaceId: ws.workspaceId,
				terminalId: tabId,
			});
		}
	}, []);

	// ── Click handler for opening PR workspace (Change 3) ────────────────────

	const openPRWorkspace = useCallback(
		async (
			projectId: string,
			prProvider: "github" | "bitbucket",
			prIdentifier: string,
			repoPath: string,
			worktreePath: string | null,
			prCtx: GitHubPRContext
		) => {
			const rw = await getOrCreateMutation.mutateAsync({
				projectId,
				prProvider,
				prIdentifier,
			});

			const cwd = worktreePath ?? repoPath;
			const tabStore = useTabStore.getState();
			tabStore.setActiveWorkspace(rw.id, cwd, {
				rightPanel: { open: true, mode: "pr-review", diffCtx: null, prCtx },
			});

			// Create initial PR overview tab if no tabs exist for this workspace
			const existingTabs = tabStore.getTabsByWorkspace(rw.id);
			if (existingTabs.length === 0) {
				tabStore.openPROverview(rw.id, prCtx);
			}
		},
		[getOrCreateMutation]
	);

	const handleGitHubLink = useCallback(
		async (pr: GitHubPR) => {
			const projects = await utils.github.getProjectsByRepo.fetch({
				owner: pr.repoOwner,
				repo: pr.repoName,
			});
			if (projects.length === 0) {
				setLinkError(`Repository ${pr.repoOwner}/${pr.repoName} is not tracked in BranchFlux.`);
				return;
			}
			setLinkError(null);
			setOpenModalPR(pr);
		},
		[utils]
	);

	// ── Click handler builder (Change 5) ─────────────────────────────────────

	const handlePRClick = useCallback(
		(pr: MergedPR, e: React.MouseEvent) => {
			const ghPR = pr.githubPR;
			const isReviewer = ghPR?.role === "reviewer";

			if (pr.provider === "bitbucket" && pr.bitbucketPR) {
				window.electron.shell.openExternal(pr.url);
				return;
			}

			if (!ghPR) return;

			// For reviewer PRs, open the persistent review workspace
			if (isReviewer) {
				const project = projectsList?.find(
					(p) => p.githubOwner === ghPR.repoOwner && p.githubRepo === ghPR.repoName
				);
				if (!project) {
					handleGitHubLink(ghPR);
					return;
				}

				const prIdentifier = `${ghPR.repoOwner}/${ghPR.repoName}#${ghPR.number}`;
				const prCtx: GitHubPRContext = {
					owner: ghPR.repoOwner,
					repo: ghPR.repoName,
					number: ghPR.number,
					title: ghPR.title,
					sourceBranch: ghPR.branchName,
					targetBranch: project.defaultBranch ?? "main",
					repoPath: project.repoPath,
				};

				openPRWorkspace(
					project.id,
					"github",
					prIdentifier,
					project.repoPath,
					null, // worktreePath resolved later if needed
					prCtx
				);
				return;
			}

			// For author PRs, keep existing linked-workspace behavior
			const linkKey = `${ghPR.repoOwner}/${ghPR.repoName}#${ghPR.number}`;
			const linked = linkedMap.get(linkKey);
			if (!linked || linked.length === 0) {
				handleGitHubLink(ghPR);
			} else if (linked.length === 1 && linked[0]) {
				navigateToWorkspace(linked[0], pr);
			} else {
				const rect = e.currentTarget.getBoundingClientRect();
				setPopover({
					position: { x: rect.left, y: rect.bottom + 4 },
					pr,
					workspaces: linked,
				});
			}
		},
		[projectsList, linkedMap, openPRWorkspace, navigateToWorkspace, handleGitHubLink]
	);

	// ── Render Helpers ────────────────────────────────────────────────────────

	const isLoading = (hasBitbucket && !bbMyPRs && !bbReviewPRs) || (hasGitHub && !ghPRs);

	if (!hasBitbucket && !hasGitHub) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
				No PR services connected
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	if (grouped.size === 0) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No pull requests</div>
		);
	}

	return (
		<>
			{linkError && (
				<div className="mx-3 my-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] text-red-400">
					{linkError}
				</div>
			)}
			{reviewError && (
				<div className="mx-3 my-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] text-red-400">
					{reviewError}
				</div>
			)}

			<div className="flex flex-col">
				{[...grouped.entries()].map(([repoKey, group]) => {
					const isCollapsed = collapsedGroups.has(repoKey);
					return (
						<div key={repoKey}>
							<button
								type="button"
								onClick={() => toggleGroup(repoKey)}
								className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] transition-colors hover:text-[var(--text-tertiary)]"
							>
								<svg
									aria-hidden="true"
									width="8"
									height="8"
									viewBox="0 0 10 10"
									fill="none"
									className={`shrink-0 transition-transform duration-150 ${!isCollapsed ? "rotate-90" : ""}`}
								>
									<path
										d="M3 1.5L7 5L3 8.5"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
								<span className="truncate">{group.name}</span>
								<span className="ml-auto text-[10px] tabular-nums opacity-60">
									{group.items.length}
								</span>
							</button>

							{!isCollapsed && (
								<div className="flex flex-col gap-0.5 px-1">
									{group.items.map((pr) => {
										const identifier = getPrIdentifier(pr);
										const isReviewer = pr.githubPR?.role === "reviewer";
										const enrichmentKey = pr.githubPR
											? `${pr.githubPR.repoOwner}/${pr.githubPR.repoName}#${pr.githubPR.number}`
											: undefined;
										const enriched =
											isReviewer && enrichmentKey ? enrichmentMap.get(enrichmentKey) : undefined;
										const enrichmentLoading =
											isReviewer &&
											reviewerPRsForEnrichment.length > 0 &&
											enrichmentQuery.isLoading;

										return (
											<RichPRItem
												key={pr.id}
												pr={pr}
												enriched={enriched}
												enrichmentLoading={enrichmentLoading}
												isReviewer={isReviewer}
												identifier={identifier}
												getReviewStatus={getReviewStatus}
												projectsList={projectsList}
												store={store}
												triggerReview={triggerReview}
												dismissReview={dismissReview}
												onClick={(e) => handlePRClick(pr, e)}
											/>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{popover && (
				<WorkspacePopover
					position={popover.position}
					workspaces={popover.workspaces}
					onClose={() => setPopover(null)}
					onCreateBranch={() => {
						setPopover(null);
						if (popover.pr.githubPR) {
							handleGitHubLink(popover.pr.githubPR);
						}
					}}
				/>
			)}

			<CreateWorktreeFromPRModal pr={openModalPR} onClose={() => setOpenModalPR(null)} />
		</>
	);
}
