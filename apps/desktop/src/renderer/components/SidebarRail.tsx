import { useCallback, useMemo, useRef, useState } from "react";
import type { Project } from "../../main/db/schema";
import type { GitHubPR } from "../../main/github/github";
import type { PRContext } from "../../shared/github-types";
import type { TicketIssue } from "../../shared/tickets";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CreateBranchFromIssueModal } from "./CreateBranchFromIssueModal";
import { type LinkablePR, CreateWorktreeFromPRModal } from "./CreateWorktreeFromPRModal";
import { ProjectItem } from "./ProjectItem";
import { PullRequestsTab } from "./PullRequestsTab";
import { RailFlyout } from "./RailFlyout";
import { TicketsTab } from "./TicketsTab";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

/** Extract a short, meaningful label from a branch/worktree name. */
function smartAbbrev(name: string): string {
	// 1. Ticket-prefixed: PROJ-123-fix-login → "123"
	const ticketMatch = name.match(/^[A-Za-z]+-(\d+)/);
	if (ticketMatch) return ticketMatch[1]!;

	// 2. Short names (≤5 chars): main, dev → as-is
	if (name.length <= 5) return name;

	// 3. Strip common prefixes, take first meaningful segment
	const stripped = name.replace(/^(?:feature|fix|hotfix|bugfix|chore|release)[/-]/, "");
	const segment = stripped.split(/[-/]/)[0] ?? stripped;
	// If the segment itself is short enough, use it whole
	if (segment.length <= 5) return segment;
	// Otherwise truncate with ellipsis so it's clearly abbreviated
	return `${segment.slice(0, 4)}\u2026`;
}

interface SidebarRailProps {
	onExpand: (section?: "tickets" | "prs") => void;
}

type FlyoutTarget = { kind: "project"; project: Project } | { kind: "tickets" } | { kind: "prs" };

const MAX_PILLS = 5;

interface RailProjectItemProps {
	project: Project;
	flyout: FlyoutTarget | null;
	openFlyout: (target: FlyoutTarget, el: HTMLElement) => void;
	scheduleDismiss: () => void;
	onExpand: () => void;
}

function RailProjectItem({
	project,
	flyout,
	openFlyout,
	scheduleDismiss,
	onExpand,
}: RailProjectItemProps) {
	const { data: workspacesList } = trpc.workspaces.listByProject.useQuery(
		{ projectId: project.id },
		{ enabled: project.status === "ready" }
	);

	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const [hoveredWs, setHoveredWs] = useState<string | null>(null);
	const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dismissHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showInfoCard = useCallback((wsId: string, el: HTMLElement) => {
		if (dismissHoverTimer.current) {
			clearTimeout(dismissHoverTimer.current);
			dismissHoverTimer.current = null;
		}
		hoverTimer.current = setTimeout(() => {
			setHoveredWs(wsId);
			setHoverRect(el.getBoundingClientRect());
		}, 200);
	}, []);

	const hideInfoCard = useCallback(() => {
		if (hoverTimer.current) {
			clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		dismissHoverTimer.current = setTimeout(() => {
			setHoveredWs(null);
			setHoverRect(null);
		}, 150);
	}, []);

	const cancelInfoDismiss = useCallback(() => {
		if (dismissHoverTimer.current) {
			clearTimeout(dismissHoverTimer.current);
			dismissHoverTimer.current = null;
		}
	}, []);

	const handlePillClick = useCallback(
		(ws: { id: string; type: string; name: string; worktreePath: string | null }) => {
			const cwd = ws.type === "worktree" && ws.worktreePath ? ws.worktreePath : project.repoPath;

			const store = useTabStore.getState();
			store.setActiveWorkspace(ws.id, cwd);

			const existing = store.getTabsByWorkspace(ws.id);
			const hasTerminal = existing.some((t) => t.kind === "terminal");
			if (!hasTerminal) {
				const title = `${project.name}: ${ws.name}`;
				const tabId = store.addTerminalTab(ws.id, cwd, title);
				attachTerminalRef.current({ workspaceId: ws.id, terminalId: tabId });
			}
		},
		[project.repoPath, project.name]
	);

	const isFlyoutActive = flyout?.kind === "project" && flyout.project.id === project.id;
	const visiblePills = workspacesList?.slice(0, MAX_PILLS);
	const hoveredWsData = workspacesList?.find((ws) => ws.id === hoveredWs);

	return (
		<div className="flex w-full flex-col items-stretch rounded-[8px] border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-1.5">
			{/* Project initials button */}
			<button
				type="button"
				title={project.name}
				onMouseEnter={(e) => openFlyout({ kind: "project", project }, e.currentTarget)}
				onMouseLeave={scheduleDismiss}
				onClick={onExpand}
				className={[
					"flex h-8 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-medium transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]",
					isFlyoutActive
						? "bg-[var(--bg-overlay)] text-[var(--text)]"
						: "text-[var(--text-secondary)]",
				].join(" ")}
				style={{
					borderLeft: `2px solid ${project.color ?? "transparent"}`,
				}}
			>
				{project.name.slice(0, 2).toUpperCase()}
			</button>

			{/* Worktree pills */}
			{visiblePills && visiblePills.length > 0 && (
				<div className="flex flex-col gap-0.5 pt-1">
					{visiblePills.map((ws) => {
						const isActive = activeWorkspaceId === ws.id;
						return (
							<button
								key={ws.id}
								type="button"
								onClick={() => handlePillClick(ws)}
								onMouseEnter={(e) => showInfoCard(ws.id, e.currentTarget)}
								onMouseLeave={hideInfoCard}
								className={[
									"truncate rounded-[4px] px-1.5 py-[3px] text-[10px] leading-tight text-left transition-colors duration-[120ms]",
									isActive
										? "bg-[var(--accent)]/15 text-[var(--text)] shadow-[inset_2px_0_0_var(--accent)]"
										: "bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:brightness-125 hover:text-[var(--text-secondary)]",
								].join(" ")}
							>
								{smartAbbrev(ws.name)}
							</button>
						);
					})}
				</div>
			)}

			{/* Hover info card */}
			{hoveredWsData && hoverRect && (
				<div
					className="fixed z-50 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 shadow-[var(--shadow-md)] animate-[flyout-in_120ms_ease-out]"
					style={{
						left: hoverRect.right + 8,
						top: hoverRect.top + hoverRect.height / 2,
						transform: "translateY(-50%)",
					}}
					onMouseEnter={cancelInfoDismiss}
					onMouseLeave={hideInfoCard}
				>
					<div className="whitespace-nowrap text-[12px] text-[var(--text)]">
						{hoveredWsData.name}
					</div>
					<div className="whitespace-nowrap text-[10px] text-[var(--text-quaternary)]">
						{hoveredWsData.type}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Tickets Rail Section ──────────────────────────────────────────────────────

interface RailSectionProps {
	flyout: FlyoutTarget | null;
	openFlyout: (target: FlyoutTarget, el: HTMLElement) => void;
	scheduleDismiss: () => void;
	onExpand: () => void;
}

function RailTicketsSection({ flyout, openFlyout, scheduleDismiss, onExpand }: RailSectionProps) {
	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: linearStatus } = trpc.linear.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});

	const hasJira = atlassianStatus?.jira.connected;
	const hasLinear = linearStatus?.connected;

	const { data: jiraIssues } = trpc.atlassian.getMyIssues.useQuery(undefined, {
		enabled: hasJira,
		staleTime: 30_000,
	});
	const { data: linearIssues } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		enabled: hasLinear,
		staleTime: 30_000,
	});

	const { data: linkedTickets } = trpc.tickets.getLinkedTickets.useQuery(undefined, {
		staleTime: 30_000,
	});

	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedTickets) return map;
		for (const l of linkedTickets) {
			if (l.worktreePath === null) continue;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const key = `${l.provider}:${l.ticketId}`;
			const existing = map.get(key);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(key, [entry]);
			}
		}
		return map;
	}, [linkedTickets]);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);
		const existing = store.getTabsByWorkspace(ws.workspaceId);
		const hasTerminal = existing.some((t) => t.kind === "terminal");
		if (!hasTerminal) {
			const title = ws.workspaceName ?? ws.workspaceId;
			const tabId = store.addTerminalTab(ws.workspaceId, ws.worktreePath, title);
			attachTerminalRef.current({ workspaceId: ws.workspaceId, terminalId: tabId });
		}
	}, []);

	const [openModalIssue, setOpenModalIssue] = useState<TicketIssue | null>(null);
	const [ticketPopover, setTicketPopover] = useState<{
		position: { x: number; y: number };
		issue: TicketIssue;
		workspaces: LinkedWorkspace[];
	} | null>(null);

	const tickets = useMemo(() => {
		const items: {
			id: string;
			label: string;
			title: string;
			color?: string;
			ticketIssue: TicketIssue;
		}[] = [];
		if (jiraIssues) {
			for (const issue of jiraIssues) {
				items.push({
					id: `jira:${issue.key}`,
					label: issue.key,
					title: `${issue.key}: ${issue.summary}`,
					color: issue.statusColor,
					ticketIssue: {
						provider: "jira",
						id: issue.key,
						identifier: issue.key,
						title: issue.summary,
						url: issue.webUrl,
						status: {
							id: issue.status,
							name: issue.status,
							color: issue.statusColor,
						},
						groupId: issue.projectKey,
					},
				});
			}
		}
		if (linearIssues) {
			for (const issue of linearIssues) {
				items.push({
					id: `linear:${issue.id}`,
					label: issue.identifier,
					title: `${issue.identifier}: ${issue.title}`,
					color: issue.stateColor,
					ticketIssue: {
						provider: "linear",
						id: issue.id,
						identifier: issue.identifier,
						title: issue.title,
						url: issue.url,
						status: {
							id: issue.stateId,
							name: issue.stateName,
							color: issue.stateColor,
						},
						groupId: issue.teamId,
					},
				});
			}
		}
		return items;
	}, [jiraIssues, linearIssues]);

	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dismissHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showInfoCard = useCallback((id: string, el: HTMLElement) => {
		if (dismissHoverTimer.current) {
			clearTimeout(dismissHoverTimer.current);
			dismissHoverTimer.current = null;
		}
		hoverTimer.current = setTimeout(() => {
			setHoveredId(id);
			setHoverRect(el.getBoundingClientRect());
		}, 200);
	}, []);

	const hideInfoCard = useCallback(() => {
		if (hoverTimer.current) {
			clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		dismissHoverTimer.current = setTimeout(() => {
			setHoveredId(null);
			setHoverRect(null);
		}, 150);
	}, []);

	const cancelInfoDismiss = useCallback(() => {
		if (dismissHoverTimer.current) {
			clearTimeout(dismissHoverTimer.current);
			dismissHoverTimer.current = null;
		}
	}, []);

	if (!hasJira && !hasLinear) return null;

	const isFlyoutActive = flyout?.kind === "tickets";
	const visibleTickets = tickets.slice(0, MAX_PILLS);
	const hoveredData = tickets.find((t) => t.id === hoveredId);

	return (
		<>
			<div className="flex w-full flex-col items-stretch rounded-[8px] border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-1.5">
				{/* Tickets icon header */}
				<button
					type="button"
					title="Tickets"
					onMouseEnter={(e) => openFlyout({ kind: "tickets" }, e.currentTarget)}
					onMouseLeave={scheduleDismiss}
					onClick={onExpand}
					className={[
						"flex h-8 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]",
						isFlyoutActive
							? "bg-[var(--bg-overlay)] text-[var(--text)]"
							: "text-[var(--text-secondary)]",
					].join(" ")}
				>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
						<rect x="9" y="3" width="6" height="4" rx="1" />
					</svg>
				</button>

				{/* Ticket pills */}
				{visibleTickets.length > 0 && (
					<div className="flex flex-col gap-0.5 pt-1">
						{visibleTickets.map((ticket) => {
							const linked = linkedMap.get(ticket.id);
							return (
								<button
									key={ticket.id}
									type="button"
									onClick={(e) => {
										if (!linked) {
											setOpenModalIssue(ticket.ticketIssue);
										} else if (linked.length === 1 && linked[0]) {
											navigateToWorkspace(linked[0]);
										} else {
											const rect = e.currentTarget.getBoundingClientRect();
											setTicketPopover({
												position: { x: rect.right + 8, y: rect.top },
												issue: ticket.ticketIssue,
												workspaces: linked,
											});
										}
									}}
									onMouseEnter={(e) => showInfoCard(ticket.id, e.currentTarget)}
									onMouseLeave={hideInfoCard}
									className="truncate rounded-[4px] bg-[var(--bg-overlay)] px-1.5 py-[3px] text-[10px] leading-tight text-left text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:brightness-125 hover:text-[var(--text-secondary)]"
								>
									{ticket.label}
								</button>
							);
						})}
						{tickets.length > MAX_PILLS && (
							<button
								type="button"
								onClick={onExpand}
								className="rounded-[4px] px-1.5 py-[2px] text-[9px] text-left text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
							>
								+{tickets.length - MAX_PILLS} more
							</button>
						)}
					</div>
				)}

				{/* Hover info card */}
				{hoveredData && hoverRect && (
					<div
						className="fixed z-50 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 shadow-[var(--shadow-md)] animate-[flyout-in_120ms_ease-out]"
						style={{
							left: hoverRect.right + 8,
							top: hoverRect.top + hoverRect.height / 2,
							transform: "translateY(-50%)",
						}}
						onMouseEnter={cancelInfoDismiss}
						onMouseLeave={hideInfoCard}
					>
						<div className="max-w-[200px] whitespace-nowrap text-[12px] text-[var(--text)] truncate">
							{hoveredData.title}
						</div>
					</div>
				)}
			</div>

			{ticketPopover && (
				<WorkspacePopover
					position={ticketPopover.position}
					workspaces={ticketPopover.workspaces}
					onClose={() => setTicketPopover(null)}
					onCreateBranch={() => {
						setTicketPopover(null);
						setOpenModalIssue(ticketPopover.issue);
					}}
				/>
			)}

			<CreateBranchFromIssueModal issue={openModalIssue} onClose={() => setOpenModalIssue(null)} />
		</>
	);
}

// ── Pull Requests Rail Section ───────────────────────────────────────────────

function RailPRsSection({ flyout, openFlyout, scheduleDismiss, onExpand }: RailSectionProps) {
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

	const prLinkedMap = useMemo(() => {
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

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace, ghPR?: GitHubPR) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);
		if (ghPR) {
			const prCtx: PRContext = {
				provider: "github",
				owner: ghPR.repoOwner,
				repo: ghPR.repoName,
				number: ghPR.number,
				title: ghPR.title,
				sourceBranch: ghPR.branchName,
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
			attachTerminalRef.current({ workspaceId: ws.workspaceId, terminalId: tabId });
		}
	}, []);

	const [openModalPR, setOpenModalPR] = useState<LinkablePR | null>(null);
	const [prPopover, setPrPopover] = useState<{
		position: { x: number; y: number };
		githubPR: GitHubPR;
		workspaces: LinkedWorkspace[];
	} | null>(null);

	const prs = useMemo(() => {
		const items: {
			id: string;
			label: string;
			title: string;
			state: "open" | "merged" | "closed";
			provider: "github" | "bitbucket";
			url: string;
			githubPR?: GitHubPR;
			linkKey?: string;
		}[] = [];
		const seenBb = new Set<string>();

		for (const pr of [...(bbMyPRs ?? []), ...(bbReviewPRs ?? [])]) {
			const key = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
			if (seenBb.has(key)) continue;
			seenBb.add(key);
			items.push({
				id: `bb-${key}`,
				label: `#${pr.id}`,
				title: `${pr.workspace}/${pr.repoSlug} #${pr.id}: ${pr.title}`,
				state: pr.state === "MERGED" ? "merged" : pr.state === "DECLINED" ? "closed" : "open",
				provider: "bitbucket",
				url: pr.webUrl,
			});
		}

		for (const pr of ghPRs ?? []) {
			items.push({
				id: `gh-${pr.repoOwner}-${pr.repoName}-${pr.number}`,
				label: `#${pr.number}`,
				title: `${pr.repoOwner}/${pr.repoName} #${pr.number}: ${pr.title}`,
				state: pr.state === "closed" ? "closed" : "open",
				provider: "github",
				url: pr.url,
				githubPR: pr,
				linkKey: `${pr.repoOwner}/${pr.repoName}#${pr.number}`,
			});
		}

		return items;
	}, [bbMyPRs, bbReviewPRs, ghPRs]);

	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dismissHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showInfoCard = useCallback((id: string, el: HTMLElement) => {
		if (dismissHoverTimer.current) {
			clearTimeout(dismissHoverTimer.current);
			dismissHoverTimer.current = null;
		}
		hoverTimer.current = setTimeout(() => {
			setHoveredId(id);
			setHoverRect(el.getBoundingClientRect());
		}, 200);
	}, []);

	const hideInfoCard = useCallback(() => {
		if (hoverTimer.current) {
			clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		dismissHoverTimer.current = setTimeout(() => {
			setHoveredId(null);
			setHoverRect(null);
		}, 150);
	}, []);

	const cancelInfoDismiss = useCallback(() => {
		if (dismissHoverTimer.current) {
			clearTimeout(dismissHoverTimer.current);
			dismissHoverTimer.current = null;
		}
	}, []);

	if (!hasBitbucket && !hasGitHub) return null;

	const stateColors = { open: "bg-green-500", merged: "bg-purple-500", closed: "bg-red-500" };
	const isFlyoutActive = flyout?.kind === "prs";
	const visiblePRs = prs.slice(0, MAX_PILLS);
	const hoveredData = prs.find((p) => p.id === hoveredId);

	return (
		<>
			<div className="flex w-full flex-col items-stretch rounded-[8px] border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-1.5">
				{/* PRs icon header */}
				<button
					type="button"
					title="Pull Requests"
					onMouseEnter={(e) => openFlyout({ kind: "prs" }, e.currentTarget)}
					onMouseLeave={scheduleDismiss}
					onClick={onExpand}
					className={[
						"flex h-8 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]",
						isFlyoutActive
							? "bg-[var(--bg-overlay)] text-[var(--text)]"
							: "text-[var(--text-secondary)]",
					].join(" ")}
				>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="18" cy="18" r="3" />
						<circle cx="6" cy="6" r="3" />
						<path d="M6 9v12M18 9v0" />
						<path d="M13 6h3a2 2 0 0 1 2 2v1" />
					</svg>
				</button>

				{/* PR pills */}
				{visiblePRs.length > 0 && (
					<div className="flex flex-col gap-0.5 pt-1">
						{visiblePRs.map((pr) => {
							const linked = pr.linkKey ? prLinkedMap.get(pr.linkKey) : undefined;
							return (
								<button
									key={pr.id}
									type="button"
									onClick={(e) => {
										if (pr.provider === "bitbucket") {
											window.electron.shell.openExternal(pr.url);
										} else if (pr.githubPR) {
											if (!linked || linked.length === 0) {
												const ghPR = pr.githubPR;
												if (ghPR) {
													setOpenModalPR({
														repoOwner: ghPR.repoOwner,
														repoName: ghPR.repoName,
														number: ghPR.number,
														title: ghPR.title,
														branchName: ghPR.branchName,
													});
												}
											} else if (linked.length === 1 && linked[0]) {
												navigateToWorkspace(linked[0], pr.githubPR);
											} else {
												const rect = e.currentTarget.getBoundingClientRect();
												setPrPopover({
													position: { x: rect.right + 8, y: rect.top },
													githubPR: pr.githubPR,
													workspaces: linked,
												});
											}
										}
									}}
									onMouseEnter={(e) => showInfoCard(pr.id, e.currentTarget)}
									onMouseLeave={hideInfoCard}
									className="flex items-center gap-1 truncate rounded-[4px] bg-[var(--bg-overlay)] px-1.5 py-[3px] text-[10px] leading-tight text-left text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:brightness-125 hover:text-[var(--text-secondary)]"
								>
									<div className={`size-1.5 shrink-0 rounded-full ${stateColors[pr.state]}`} />
									{pr.label}
								</button>
							);
						})}
						{prs.length > MAX_PILLS && (
							<button
								type="button"
								onClick={onExpand}
								className="rounded-[4px] px-1.5 py-[2px] text-[9px] text-left text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
							>
								+{prs.length - MAX_PILLS} more
							</button>
						)}
					</div>
				)}

				{/* Hover info card */}
				{hoveredData && hoverRect && (
					<div
						className="fixed z-50 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 shadow-[var(--shadow-md)] animate-[flyout-in_120ms_ease-out]"
						style={{
							left: hoverRect.right + 8,
							top: hoverRect.top + hoverRect.height / 2,
							transform: "translateY(-50%)",
						}}
						onMouseEnter={cancelInfoDismiss}
						onMouseLeave={hideInfoCard}
					>
						<div className="max-w-[200px] text-[12px] text-[var(--text)] truncate">
							{hoveredData.title}
						</div>
					</div>
				)}
			</div>

			{prPopover && (
				<WorkspacePopover
					position={prPopover.position}
					workspaces={prPopover.workspaces}
					onClose={() => setPrPopover(null)}
					onCreateBranch={() => {
						setPrPopover(null);
						const ghPR = prPopover.githubPR;
						if (ghPR) {
							setOpenModalPR({
								repoOwner: ghPR.repoOwner,
								repoName: ghPR.repoName,
								number: ghPR.number,
								title: ghPR.title,
								branchName: ghPR.branchName,
							});
						}
					}}
				/>
			)}

			<CreateWorktreeFromPRModal pr={openModalPR} onClose={() => setOpenModalPR(null)} />
		</>
	);
}

export function SidebarRail({ onExpand }: SidebarRailProps) {
	const { openAddModal, openSettings } = useProjectStore();
	const { data: projectsList } = trpc.projects.list.useQuery();

	const [flyout, setFlyout] = useState<FlyoutTarget | null>(null);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const railRef = useRef<HTMLDivElement>(null);

	const cancelDismiss = useCallback(() => {
		if (dismissTimer.current) {
			clearTimeout(dismissTimer.current);
			dismissTimer.current = null;
		}
	}, []);

	const scheduleDismiss = useCallback(() => {
		cancelDismiss();
		dismissTimer.current = setTimeout(() => {
			setFlyout(null);
			setAnchorRect(null);
		}, 150);
	}, [cancelDismiss]);

	const openFlyout = useCallback(
		(target: FlyoutTarget, el: HTMLElement) => {
			cancelDismiss();
			setFlyout(target);
			setAnchorRect(el.getBoundingClientRect());
		},
		[cancelDismiss]
	);

	const railWidth = railRef.current?.getBoundingClientRect().width ?? 56;

	return (
		<div ref={railRef} className="flex h-full w-full flex-col items-center bg-[var(--bg-surface)]">
			{/* Traffic light clearance */}
			<div className="app-drag h-[52px] w-full shrink-0" />

			{/* Project groups + Tickets + PRs */}
			<div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto px-1 py-1">
				{projectsList?.map((project) => (
					<RailProjectItem
						key={project.id}
						project={project}
						flyout={flyout}
						openFlyout={openFlyout}
						scheduleDismiss={scheduleDismiss}
						onExpand={() => onExpand()}
					/>
				))}

				{/* Add Repository */}
				<button
					type="button"
					onClick={openAddModal}
					title="Add Repository"
					className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
				>
					<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
				</button>

				{/* Divider */}
				<div className="w-6 border-t border-[var(--border-subtle)]" />

				{/* Tickets section */}
				<RailTicketsSection
					flyout={flyout}
					openFlyout={openFlyout}
					scheduleDismiss={scheduleDismiss}
					onExpand={() => onExpand("tickets")}
				/>

				{/* PRs section */}
				<RailPRsSection
					flyout={flyout}
					openFlyout={openFlyout}
					scheduleDismiss={scheduleDismiss}
					onExpand={() => onExpand("prs")}
				/>
			</div>

			{/* Settings — pinned to bottom */}
			<div className="shrink-0 border-t border-[var(--border-subtle)] p-2">
				<button
					type="button"
					title="Settings"
					onClick={openSettings}
					className="flex size-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
				</button>
			</div>

			{/* Flyout portal */}
			{flyout && anchorRect && (
				<RailFlyout
					anchorRect={anchorRect}
					railWidth={railWidth}
					onMouseEnter={cancelDismiss}
					onMouseLeave={scheduleDismiss}
				>
					{flyout.kind === "project" && (
						<div className="p-2">
							<ProjectItem project={flyout.project} isExpanded onToggle={() => {}} />
						</div>
					)}
					{flyout.kind === "tickets" && <TicketsTab />}
					{flyout.kind === "prs" && <PullRequestsTab />}
				</RailFlyout>
			)}
		</div>
	);
}
