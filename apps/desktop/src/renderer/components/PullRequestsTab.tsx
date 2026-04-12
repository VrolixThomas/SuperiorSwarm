import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import type { AgentAlert } from "../../shared/agent-events";
import type { GitHubPREnriched, PRContext } from "../../shared/github-types";
import { useAgentAlertStore } from "../stores/agent-alert-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ConnectBanner } from "./ConnectBanner";
import { CreateWorktreeFromPRModal, type LinkablePR } from "./CreateWorktreeFromPRModal";
import { PullRequestGroup } from "./PullRequestGroup";
import type { MergedPR } from "./PullRequestItem";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";
import { findActivePRIdentifier, splitPROverviewRight } from "./pr-panel-helpers";

// ── Context Menu ──────────────────────────────────────────────────────────────

function PRContextMenu({
	position,
	url,
	workspaceId,
	onCleanup,
	onClose,
}: {
	position: { x: number; y: number };
	url: string;
	workspaceId?: string;
	onCleanup: () => void;
	onClose: () => void;
}) {
	useEffect(() => {
		const handler = () => onClose();
		window.addEventListener("click", handler);
		return () => window.removeEventListener("click", handler);
	}, [onClose]);

	return (
		<div
			className="fixed z-50 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: position.x, top: position.y }}
		>
			<button
				type="button"
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
				onClick={() => {
					window.electron.shell.openExternal(url);
					onClose();
				}}
			>
				Open in browser
			</button>
			{workspaceId && (
				<button
					type="button"
					className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400 hover:bg-[var(--bg-elevated)]"
					onClick={() => {
						onCleanup();
						onClose();
					}}
				>
					Remove worktree
				</button>
			)}
		</div>
	);
}

// ── Main Tab ─────────────────────────────────────────────────────────────────

export function PullRequestsTab() {
	const utils = trpc.useUtils();
	const [openModalPR, setOpenModalPR] = useState<LinkablePR | null>(null);
	const [linkError, setLinkError] = useState<string | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		pr: MergedPR;
		workspaces: LinkedWorkspace[];
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		position: { x: number; y: number };
		url: string;
		workspaceId?: string;
		identifier: string;
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

	const reviewDraftMap = useMemo(() => {
		const map = new Map<string, { status: string; commentCount: number; roundNumber: number }>();
		if (!reviewDrafts.data) return map;
		for (const d of reviewDrafts.data) {
			// Skip dismissed drafts
			if (d.status === "dismissed") continue;
			const existing = map.get(d.prIdentifier);
			// Keep the most actionable: prefer active states over terminal states
			const priority: Record<string, number> = {
				in_progress: 0,
				queued: 1,
				ready: 2,
				submitted: 3,
				cancelled: 4,
				failed: 5,
			};
			if (!existing || (priority[d.status] ?? 6) < (priority[existing.status] ?? 6)) {
				map.set(d.prIdentifier, {
					status: d.status,
					commentCount: 0,
					roundNumber: d.roundNumber ?? 1,
				});
			}
		}
		return map;
	}, [reviewDrafts.data]);

	// ── PR poller cache (backend-driven list) ─────────────────────────────────
	// Fetched here to warm the TanStack Query cache; the Sidebar badge reads it separately.
	trpc.prPoller.getCachedPRs.useQuery(undefined, {
		staleTime: 10_000,
		refetchInterval: 30_000,
	});

	const [reviewError, setReviewError] = useState<string | null>(null);
	// Store PR context for the pending triggerReview call so onSuccess can use it
	const pendingReviewCtxRef = useRef<PRContext | null>(null);
	// Local map of prIdentifier → workspaceId, populated when workspaces are created
	const workspaceIdMapRef = useRef<Map<string, string>>(new Map());
	// Tracks which prIdentifier is currently being opened to prevent duplicate calls
	const openingPRRef = useRef<string | null>(null);

	const triggerReview = trpc.aiReview.triggerReview.useMutation({
		onSuccess: (launchInfo) => {
			setReviewError(null);
			reviewDrafts.refetch();

			if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;

			// Track workspace ID for dismiss/cleanup lookups
			const prCtx = pendingReviewCtxRef.current;
			if (prCtx) {
				const identifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
				workspaceIdMapRef.current.set(identifier, launchInfo.reviewWorkspaceId);
			}

			const tabStore = useTabStore.getState();

			tabStore.setWorkspaceMetadata(launchInfo.reviewWorkspaceId, {
				type: "review",
				prProvider: prCtx?.provider,
				prIdentifier: prCtx ? `${prCtx.owner}/${prCtx.repo}#${prCtx.number}` : undefined,
				prTitle: prCtx?.title,
				sourceBranch: prCtx?.sourceBranch,
				targetBranch: prCtx?.targetBranch,
			});
			tabStore.setActiveWorkspace(launchInfo.reviewWorkspaceId, launchInfo.worktreePath, {
				rightPanel: prCtx
					? { open: true, mode: "pr-review", diffCtx: null, prCtx }
					: { open: true, mode: "pr-review", diffCtx: null },
			});

			// Create PR overview tab if prCtx is available
			if (prCtx) {
				tabStore.openPROverview(launchInfo.reviewWorkspaceId, prCtx);
			}

			const tabId = tabStore.addTerminalTab(
				launchInfo.reviewWorkspaceId,
				launchInfo.worktreePath,
				"AI Review"
			);
			if (prCtx) {
				splitPROverviewRight(launchInfo.reviewWorkspaceId, prCtx);
			}
			attachTerminalRef.current({
				workspaceId: launchInfo.reviewWorkspaceId,
				terminalId: tabId,
			});

			setTimeout(() => {
				window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
			}, 500);

			pendingReviewCtxRef.current = null;
		},
		onError: (err) => {
			setReviewError(err.message);
			reviewDrafts.refetch();
			pendingReviewCtxRef.current = null;
		},
	});

	const triggerReviewWithCtx = useCallback(
		(
			args: {
				provider: "github" | "bitbucket";
				identifier: string;
				title: string;
				author: string;
				sourceBranch: string;
				targetBranch: string;
				repoPath: string;
				projectId: string;
			},
			prCtx?: PRContext
		) => {
			pendingReviewCtxRef.current = prCtx ?? null;
			triggerReview.mutate(args);
		},
		[triggerReview.mutate]
	);

	const markCommitSeen = trpc.aiReview.markCommitSeen.useMutation({
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

	const bitbucketPRsForEnrichment = useMemo(() => {
		const prs: Array<{ workspace: string; repoSlug: string; prId: number }> = [];
		for (const pr of bbReviewPRs ?? []) {
			prs.push({ workspace: pr.workspace, repoSlug: pr.repoSlug, prId: pr.id });
		}
		return prs;
	}, [bbReviewPRs]);

	const enrichmentQuery = trpc.github.getPRListEnrichment.useQuery(
		{ prs: reviewerPRsForEnrichment },
		{
			enabled: reviewerPRsForEnrichment.length > 0,
			staleTime: 30_000,
			refetchInterval: 60_000,
		}
	);

	const bbEnrichmentQuery = trpc.atlassian.getPRListEnrichment.useQuery(
		{ prs: bitbucketPRsForEnrichment },
		{
			enabled: bitbucketPRsForEnrichment.length > 0,
			staleTime: 30_000,
			refetchInterval: 60_000,
		}
	);

	const enrichmentMap = useMemo(() => {
		const map = new Map<string, GitHubPREnriched>();
		for (const pr of enrichmentQuery.data ?? []) {
			map.set(`${pr.owner}/${pr.repo}#${pr.number}`, pr);
		}
		for (const pr of bbEnrichmentQuery.data ?? []) {
			map.set(`${pr.owner}/${pr.repo}#${pr.number}`, pr);
		}
		return map;
	}, [enrichmentQuery.data, bbEnrichmentQuery.data]);

	// ── getOrCreateReview mutation ────────────────────────────────────────────

	const getOrCreateReviewMutation = trpc.workspaces.getOrCreateReview.useMutation();

	// ── Cleanup mutation ──────────────────────────────────────────────────────

	const cleanupReviewMutation = trpc.workspaces.cleanupReviewWorkspace.useMutation();

	// ── PR state tracking for auto-cleanup on merge/close ──────────────────────
	// (prevPRStatesRef declared here; the effect that reads `grouped` is placed
	//  after the `grouped` useMemo, below the auto-trigger effect)

	const prevPRStatesRef = useRef<Map<string, string>>(new Map());
	const cleanupReviewMutateRef = useRef(cleanupReviewMutation.mutate);
	cleanupReviewMutateRef.current = cleanupReviewMutation.mutate;

	// ── Auto-trigger effect ──────────────────────────────────────────────────

	useEffect(() => {
		if (!settings.data?.autoReviewEnabled || !reviewDrafts.data) return;

		// Only block auto-trigger for PRs with active reviews (queued/in_progress)
		const activeIdentifiers = new Set(
			reviewDrafts.data
				.filter((d) => d.status === "queued" || d.status === "in_progress")
				.map((d) => d.prIdentifier)
		);

		// Auto-trigger for GitHub reviewer PRs
		for (const pr of ghPRs ?? []) {
			if (pr.role !== "reviewer") continue;
			const identifier = `${pr.repoOwner}/${pr.repoName}#${pr.number}`;
			if (activeIdentifiers.has(identifier) || triggeredRef.current.has(identifier)) continue;
			const project = projectsList?.find(
				(p) => p.remoteOwner === pr.repoOwner && p.remoteRepo === pr.repoName
			);
			if (!project) continue;
			triggeredRef.current.add(identifier);
			triggerReviewWithCtx(
				{
					provider: "github",
					identifier,
					title: pr.title,
					author: "",
					sourceBranch: pr.branchName,
					targetBranch: project.defaultBranch ?? "main",
					repoPath: project.repoPath,
					projectId: project.id,
				},
				{
					provider: "github",
					owner: pr.repoOwner,
					repo: pr.repoName,
					number: pr.number,
					title: pr.title,
					sourceBranch: pr.branchName,
					targetBranch: project.defaultBranch ?? "main",
					repoPath: project.repoPath,
				}
			);
		}

		// Auto-trigger for Bitbucket review PRs
		for (const pr of bbReviewPRs ?? []) {
			const identifier = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
			if (activeIdentifiers.has(identifier) || triggeredRef.current.has(identifier)) continue;
			const project = projectsList?.find(
				(p) => p.remoteOwner === pr.workspace && p.remoteRepo === pr.repoSlug
			);
			if (!project) continue;
			triggeredRef.current.add(identifier);
			triggerReviewWithCtx(
				{
					provider: "bitbucket",
					identifier,
					title: pr.title,
					author: pr.author,
					sourceBranch: pr.source?.branch?.name ?? "",
					targetBranch: pr.destination?.branch?.name ?? project.defaultBranch ?? "main",
					repoPath: project.repoPath,
					projectId: project.id,
				},
				{
					provider: "bitbucket",
					owner: pr.workspace,
					repo: pr.repoSlug,
					number: pr.id,
					title: pr.title,
					sourceBranch: pr.source?.branch?.name ?? "",
					targetBranch: pr.destination?.branch?.name ?? project.defaultBranch ?? "main",
					repoPath: project.repoPath,
				}
			);
		}
	}, [ghPRs, bbReviewPRs, reviewDrafts.data, settings.data, projectsList, triggerReviewWithCtx]);

	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const agentAlerts = useAgentAlertStore((s) => s.alerts);

	const getPrIdentifier = useCallback((pr: MergedPR): string => {
		if (pr.provider === "github" && pr.githubPR) {
			return `${pr.githubPR.repoOwner}/${pr.githubPR.repoName}#${pr.githubPR.number}`;
		}
		if (pr.provider === "bitbucket" && pr.bitbucketPR) {
			return `${pr.bitbucketPR.workspace}/${pr.bitbucketPR.repoSlug}#${pr.bitbucketPR.id}`;
		}
		return pr.id;
	}, []);

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

		// Bitbucket PRs — only review requests, not authored PRs
		for (const pr of bbReviewPRs ?? []) {
			const key = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
			if (seenBb.has(key)) continue;
			seenBb.add(key);
			// Skip merged or declined PRs (stale cache)
			if (pr.state === "MERGED" || pr.state === "DECLINED") continue;
			merged.push({
				provider: "bitbucket",
				id: `bb-${pr.workspace}-${pr.repoSlug}-${pr.id}`,
				number: pr.id,
				title: pr.title,
				url: pr.webUrl,
				state: "open",
				isDraft: false,
				repoKey: `${pr.workspace}/${pr.repoSlug}`,
				repoDisplay: `${pr.workspace}/${pr.repoSlug}`,
				bitbucketPR: pr,
			});
		}

		// GitHub PRs — only PRs where the user is a reviewer, not authored PRs
		for (const pr of ghPRs ?? []) {
			if (pr.role !== "reviewer") continue;
			// Skip closed PRs (stale cache)
			if (pr.state === "closed") continue;
			merged.push({
				provider: "github",
				id: `gh-${pr.repoOwner}-${pr.repoName}-${pr.number}`,
				number: pr.number,
				title: pr.title,
				url: pr.url,
				state: "open",
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
			{
				name: string;
				owner: string;
				repo: string;
				provider: "github" | "bitbucket";
				items: MergedPR[];
			}
		>();
		for (const pr of merged) {
			const existing = groups.get(pr.repoKey);
			if (existing) {
				existing.items.push(pr);
			} else {
				const [owner = "", repo = ""] = pr.repoKey.split("/");
				groups.set(pr.repoKey, {
					name: pr.repoDisplay,
					owner,
					repo,
					provider: pr.provider,
					items: [pr],
				});
			}
		}

		return groups;
	}, [bbReviewPRs, ghPRs]);

	// workspaceIdMapRef.current is intentionally excluded — refs are not reactive.
	// The memo recomputes whenever the active workspace changes, which is the
	// only time the result can differ in practice.
	const activePRIdentifier = useMemo(
		() => findActivePRIdentifier(workspaceIdMapRef.current, activeWorkspaceId),
		[activeWorkspaceId]
	);

	// ── PR state tracking effect (auto-cleanup on merge/close) ────────────────

	useEffect(() => {
		// Build current state map: prIdentifier → normalized state
		// Inline identifier logic to avoid adding getPrIdentifier to deps
		const currentStates = new Map<string, string>();
		for (const [, group] of grouped) {
			for (const pr of group.items) {
				let identifier: string;
				if (pr.provider === "github" && pr.githubPR) {
					identifier = `${pr.githubPR.repoOwner}/${pr.githubPR.repoName}#${pr.githubPR.number}`;
				} else if (pr.provider === "bitbucket" && pr.bitbucketPR) {
					identifier = `${pr.bitbucketPR.workspace}/${pr.bitbucketPR.repoSlug}#${pr.bitbucketPR.id}`;
				} else {
					identifier = pr.id;
				}
				currentStates.set(identifier, pr.state);
			}
		}

		// Detect transitions from open → merged/closed; clean up known workspaces
		for (const [identifier, prevState] of prevPRStatesRef.current) {
			const newState = currentStates.get(identifier);
			const wasOpen = prevState === "open";
			const isNowClosed = newState === "closed" || newState === "merged" || newState === undefined;
			if (wasOpen && isNowClosed) {
				const workspaceId = workspaceIdMapRef.current.get(identifier);
				if (workspaceId) {
					cleanupReviewMutateRef.current({ workspaceId });
					workspaceIdMapRef.current.delete(identifier);
				}
			}
		}

		prevPRStatesRef.current = currentStates;
	}, [grouped]);

	// ── Navigation ────────────────────────────────────────────────────────────

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace, pr: MergedPR) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

		if (pr.githubPR) {
			const prCtx: PRContext = {
				provider: "github",
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

	// ── Click handler for opening PR workspace ───────────────────────────────

	const openPRWorkspace = useCallback(
		async (
			projectId: string,
			prProvider: "github" | "bitbucket",
			prIdentifier: string,
			repoPath: string,
			prCtx: PRContext
		) => {
			if (openingPRRef.current === prIdentifier) return;
			openingPRRef.current = prIdentifier;

			try {
				// getOrCreateReview creates workspace + worktree atomically.
				// For existing worktrees the git fetch runs in the background on the
				// main process side, so this resolves quickly.
				const ws = await getOrCreateReviewMutation.mutateAsync({
					projectId,
					prProvider,
					prIdentifier,
					prTitle: prCtx.title,
					sourceBranch: prCtx.sourceBranch,
					targetBranch: prCtx.targetBranch,
				});

				// Track workspace ID for dismiss/cleanup lookups
				workspaceIdMapRef.current.set(prIdentifier, ws.id);

				const cwd = ws.worktreePath ?? repoPath;
				// Update prCtx.repoPath to the worktree path so git queries
				// (getCommitsAhead, getBranchDiff) run in the correct directory
				const resolvedPrCtx = { ...prCtx, repoPath: cwd };
				const tabStore = useTabStore.getState();
				tabStore.setWorkspaceMetadata(ws.id, {
					type: "review",
					prProvider: resolvedPrCtx.provider,
					prIdentifier: `${resolvedPrCtx.owner}/${resolvedPrCtx.repo}#${resolvedPrCtx.number}`,
					prTitle: resolvedPrCtx.title,
					sourceBranch: resolvedPrCtx.sourceBranch,
					targetBranch: resolvedPrCtx.targetBranch,
				});
				tabStore.setActiveWorkspace(ws.id, cwd, {
					rightPanel: { open: true, mode: "pr-review", diffCtx: null, prCtx: resolvedPrCtx },
				});

				// Create initial PR overview tab if no tabs exist for this workspace
				const existingTabs = tabStore.getTabsByWorkspace(ws.id);
				if (existingTabs.length === 0) {
					tabStore.openPROverview(ws.id, resolvedPrCtx);
				}
			} finally {
				openingPRRef.current = null;
			}
		},
		[getOrCreateReviewMutation]
	);

	const handleUnlinkedPR = useCallback(
		async (pr: LinkablePR) => {
			const projects = await utils.projects.getByRepo.fetch({
				owner: pr.repoOwner,
				repo: pr.repoName,
			});
			if (projects.length === 0) {
				setLinkError(`Repository ${pr.repoOwner}/${pr.repoName} is not tracked in SuperiorSwarm.`);
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
			const bbPR = pr.bitbucketPR;

			// ── Bitbucket reviewer PRs → open review workspace ──
			if (pr.provider === "bitbucket" && bbPR) {
				const project = projectsList?.find(
					(p) => p.remoteOwner === bbPR.workspace && p.remoteRepo === bbPR.repoSlug
				);
				if (!project) {
					handleUnlinkedPR({
						repoOwner: bbPR.workspace,
						repoName: bbPR.repoSlug,
						number: bbPR.id,
						title: bbPR.title,
						branchName: bbPR.source?.branch?.name ?? "",
					});
					return;
				}

				const prIdentifier = `${bbPR.workspace}/${bbPR.repoSlug}#${bbPR.id}`;
				const prCtx: PRContext = {
					provider: "bitbucket",
					owner: bbPR.workspace,
					repo: bbPR.repoSlug,
					number: bbPR.id,
					title: bbPR.title,
					sourceBranch: bbPR.source?.branch?.name ?? "",
					targetBranch: bbPR.destination?.branch?.name ?? project.defaultBranch ?? "main",
					repoPath: project.repoPath,
				};

				openPRWorkspace(project.id, "bitbucket", prIdentifier, project.repoPath, prCtx);

				const enriched = enrichmentMap.get(prIdentifier);
				if (enriched?.headCommitOid) {
					markCommitSeen.mutate({ prIdentifier, commitSha: enriched.headCommitOid });
				}
				return;
			}

			if (!ghPR) return;
			const isReviewer = ghPR.role === "reviewer";

			// For reviewer PRs, open the persistent review workspace
			if (isReviewer) {
				const project = projectsList?.find(
					(p) => p.remoteOwner === ghPR.repoOwner && p.remoteRepo === ghPR.repoName
				);
				if (!project) {
					handleUnlinkedPR({
						repoOwner: ghPR.repoOwner,
						repoName: ghPR.repoName,
						number: ghPR.number,
						title: ghPR.title,
						branchName: ghPR.branchName,
					});
					return;
				}

				const prIdentifier = `${ghPR.repoOwner}/${ghPR.repoName}#${ghPR.number}`;
				const prCtx: PRContext = {
					provider: "github",
					owner: ghPR.repoOwner,
					repo: ghPR.repoName,
					number: ghPR.number,
					title: ghPR.title,
					sourceBranch: ghPR.branchName,
					targetBranch: project.defaultBranch ?? "main",
					repoPath: project.repoPath,
				};

				openPRWorkspace(project.id, "github", prIdentifier, project.repoPath, prCtx);

				const enriched = enrichmentMap.get(prIdentifier);
				if (enriched?.headCommitOid) {
					markCommitSeen.mutate({ prIdentifier, commitSha: enriched.headCommitOid });
				}
				return;
			}

			// For author PRs, keep existing linked-workspace behavior
			const linkKey = `${ghPR.repoOwner}/${ghPR.repoName}#${ghPR.number}`;
			const linked = linkedMap.get(linkKey);
			if (!linked || linked.length === 0) {
				handleUnlinkedPR({
					repoOwner: ghPR.repoOwner,
					repoName: ghPR.repoName,
					number: ghPR.number,
					title: ghPR.title,
					branchName: ghPR.branchName,
				});
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
		[
			projectsList,
			linkedMap,
			openPRWorkspace,
			navigateToWorkspace,
			handleUnlinkedPR,
			enrichmentMap,
			markCommitSeen,
		]
	);

	// ── Render Helpers ────────────────────────────────────────────────────────

	const isLoading = (hasBitbucket && !bbReviewPRs) || (hasGitHub && !ghPRs);

	if (!hasBitbucket && !hasGitHub) {
		const remoteHosts =
			projectsList?.map((p) => p.remoteHost).filter((h): h is string => h != null) ?? [];
		const needsGitHub = remoteHosts.some((h) => h.includes("github"));
		const needsBitbucket = remoteHosts.some((h) => h.includes("bitbucket"));

		const serviceName =
			needsGitHub && !needsBitbucket
				? "GitHub"
				: needsBitbucket && !needsGitHub
					? "Bitbucket"
					: "a PR service";

		return (
			<div className="px-3 py-2">
				<ConnectBanner message={`Connect ${serviceName} to see pull requests.`} returnTo="prs" />
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

			<div className="flex flex-col gap-2 px-2 pt-2">
				{[...grouped.entries()].map(([repoKey, group]) => (
					<PullRequestGroup
						key={repoKey}
						owner={group.owner}
						repo={group.repo}
						prs={group.items}
						isCollapsed={collapsedGroups.has(repoKey)}
						onToggleCollapse={() => toggleGroup(repoKey)}
						activePRIdentifier={activePRIdentifier}
						getPrIdentifier={getPrIdentifier}
						enrichmentMap={enrichmentMap}
						enrichmentLoading={
							(reviewerPRsForEnrichment.length > 0 && enrichmentQuery.isLoading) ||
							(bitbucketPRsForEnrichment.length > 0 && bbEnrichmentQuery.isLoading)
						}
						agentAlerts={agentAlerts}
						workspaceIdMap={workspaceIdMapRef.current}
						projectsList={projectsList}
						reviewDraftMap={reviewDraftMap}
						onPRClick={handlePRClick}
						onPRContextMenu={(pr, e) => {
							e.preventDefault();
							const identifier = getPrIdentifier(pr);
							const knownWorkspaceId = workspaceIdMapRef.current.get(identifier);
							setContextMenu({
								position: { x: e.clientX, y: e.clientY },
								url: pr.url,
								workspaceId: knownWorkspaceId,
								identifier,
							});
						}}
					/>
				))}
			</div>

			{popover && (
				<WorkspacePopover
					position={popover.position}
					workspaces={popover.workspaces}
					onClose={() => setPopover(null)}
					onCreateBranch={() => {
						setPopover(null);
						const ghPR = popover.pr.githubPR;
						const bbPR = popover.pr.bitbucketPR;
						if (ghPR) {
							handleUnlinkedPR({
								repoOwner: ghPR.repoOwner,
								repoName: ghPR.repoName,
								number: ghPR.number,
								title: ghPR.title,
								branchName: ghPR.branchName,
							});
						} else if (bbPR) {
							handleUnlinkedPR({
								repoOwner: bbPR.workspace,
								repoName: bbPR.repoSlug,
								number: bbPR.id,
								title: bbPR.title,
								branchName: bbPR.source?.branch?.name ?? "",
							});
						}
					}}
				/>
			)}

			{contextMenu && (
				<PRContextMenu
					position={contextMenu.position}
					url={contextMenu.url}
					workspaceId={contextMenu.workspaceId}
					onCleanup={() => {
						if (contextMenu.workspaceId) {
							cleanupReviewMutation.mutate({ workspaceId: contextMenu.workspaceId });
							workspaceIdMapRef.current.delete(contextMenu.identifier);
						}
					}}
					onClose={() => setContextMenu(null)}
				/>
			)}

			<CreateWorktreeFromPRModal pr={openModalPR} onClose={() => setOpenModalPR(null)} />
		</>
	);
}
