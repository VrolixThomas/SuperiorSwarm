import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CreateWorktreeFromPRModal } from "./CreateWorktreeFromPRModal";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

// ── Shared components ────────────────────────────────────────────────────────

function ReviewBadge({ decision }: { decision: GitHubPR["reviewDecision"] }) {
	if (!decision) return null;
	const config = {
		approved: { label: "Approved", color: "text-green-400" },
		changes_requested: { label: "Changes", color: "text-red-400" },
		review_required: { label: "Review", color: "text-yellow-400" },
	} as const;
	const { label, color } = config[decision];
	return <span className={`shrink-0 text-[10px] font-medium ${color}`}>{label}</span>;
}

function PRStateDot({ state }: { state: "open" | "merged" | "closed" }) {
	const colors = {
		open: "bg-green-500",
		merged: "bg-purple-500",
		closed: "bg-red-500",
	};
	return <div className={`size-1.5 shrink-0 rounded-full ${colors[state]}`} />;
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

			if (!launchInfo.workspaceId || !launchInfo.worktreePath) return;

			// Create workspace terminal and run the launch script
			const tabStore = useTabStore.getState();
			tabStore.setActiveWorkspace(launchInfo.workspaceId, launchInfo.worktreePath);
			const tabId = tabStore.addTerminalTab(
				launchInfo.workspaceId,
				launchInfo.worktreePath,
				`AI Review`
			);
			attachTerminalRef2.current({
				workspaceId: launchInfo.workspaceId,
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
			triggeredRef.current.add(identifier);
			triggerReview.mutate({
				provider: "github",
				identifier,
				title: pr.title,
				author: "",
				sourceBranch: pr.branchName,
				targetBranch: project?.defaultBranch ?? "main",
				repoPath: project?.repoPath ?? "",
			});
		}

		// Auto-trigger for Bitbucket review PRs
		for (const pr of bbReviewPRs ?? []) {
			const identifier = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
			if (existingIdentifiers.has(identifier) || triggeredRef.current.has(identifier)) continue;
			triggeredRef.current.add(identifier);
			triggerReview.mutate({
				provider: "bitbucket",
				identifier,
				title: pr.title,
				author: pr.author,
				sourceBranch: pr.source?.branch?.name ?? "",
				targetBranch: pr.destination?.branch?.name ?? "main",
				repoPath: "",
			});
		}
	}, [ghPRs, bbReviewPRs, reviewDrafts.data, settings.data, projectsList]);

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
			const prCtx: import("../../shared/github-types").GitHubPRContext = {
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

	const handleGitHubLink = async (pr: GitHubPR) => {
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
	};

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
								<div className="flex flex-col gap-0.5">
									{group.items.map((pr) => {
										const ghPR = pr.githubPR;
										const linkKey = ghPR
											? `${ghPR.repoOwner}/${ghPR.repoName}#${ghPR.number}`
											: undefined;
										const linked = linkKey ? linkedMap.get(linkKey) : undefined;
										const isLinked = !!linked && linked.length > 0;

										return (
											<button
												key={pr.id}
												type="button"
												onClick={(e) => {
													if (pr.provider === "bitbucket" && pr.bitbucketPR) {
														window.electron.shell.openExternal(pr.url);
													} else if (ghPR) {
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
													}
												}}
												className={`flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
													isLinked
														? "text-[var(--text-secondary)]"
														: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
												}`}
												title={`${pr.repoDisplay}#${pr.number}: ${pr.title}`}
											>
												<PRStateDot state={pr.state} />
												<span
													className={`shrink-0 font-mono text-[11px] ${
														isLinked
															? "font-medium text-[var(--accent)]"
															: "font-medium text-[var(--text-quaternary)]"
													}`}
												>
													#{pr.number}
												</span>
												{pr.isDraft && (
													<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
														[Draft]
													</span>
												)}
												<span className="min-w-0 flex-1 truncate">{pr.title}</span>
												{pr.reviewDecision && <ReviewBadge decision={pr.reviewDecision} />}
												{/* AI Review status */}
												{(() => {
													const identifier = getPrIdentifier(pr);
													const draft = getReviewStatus(identifier);
													if (draft?.status === "ready") {
														return (
															<button
																type="button"
																className="shrink-0 cursor-pointer rounded-[4px] border-none bg-[rgba(48,209,88,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[#30d158]"
																onClick={(e) => {
																	e.stopPropagation();
																	// Open the standard PR review panel
																	if (pr.provider === "github" && pr.githubPR) {
																		const project = projectsList?.find(
																			(p) =>
																				p.githubOwner === pr.githubPR!.repoOwner &&
																				p.githubRepo === pr.githubPR!.repoName
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
																AI Review Ready
															</button>
														);
													}
													if (draft?.status === "in_progress") {
														return (
															<span className="flex shrink-0 items-center gap-1 rounded-[4px] bg-[rgba(255,214,10,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[#ffd60a]">
																<span className="inline-block size-1.5 animate-pulse rounded-full bg-[#ffd60a]" />
																Reviewing...
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
																Failed — Retry
															</button>
														);
													}
													if (!draft) {
														const handleTrigger = () => {
															if (pr.provider === "github" && pr.githubPR) {
																const project = projectsList?.find(
																	(p) =>
																		p.githubOwner === pr.githubPR!.repoOwner &&
																		p.githubRepo === pr.githubPR!.repoName
																);
																triggerReview.mutate({
																	provider: "github",
																	identifier,
																	title: pr.title,
																	author: "",
																	sourceBranch: pr.githubPR.branchName,
																	targetBranch: project?.defaultBranch ?? "main",
																	repoPath: project?.repoPath ?? "",
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
																Review with AI
															</button>
														);
													}
													return null;
												})()}
												{/* Provider icon badge */}
												<div className="shrink-0 opacity-40">
													{pr.provider === "github" ? (
														<svg
															aria-hidden="true"
															width="10"
															height="10"
															viewBox="0 0 16 16"
															fill="currentColor"
														>
															<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
														</svg>
													) : (
														<svg
															aria-hidden="true"
															width="10"
															height="10"
															viewBox="0 0 16 16"
															fill="currentColor"
														>
															<path d="M1.5 1h13l-1.5 14h-10L1.5 1zm8.5 10l.5-4h-5l.5 4h4z" />
														</svg>
													)}
												</div>
											</button>
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
