import { useCallback, useMemo, useRef, useState } from "react";
import type { MergedTicketIssue, TicketIssue } from "../../shared/tickets";
import { useTicketsData } from "../hooks/useTicketsData";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ConnectBanner } from "./ConnectBanner";
import { CreateBranchFromIssueModal } from "./CreateBranchFromIssueModal";
import { IssueContextMenu } from "./IssueContextMenu";
import { StateIcon } from "./StateIcon";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

export function TicketsTab() {
	const utils = trpc.useUtils();
	const [openModalIssue, setOpenModalIssue] = useState<TicketIssue | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		issue: TicketIssue;
		workspaces: LinkedWorkspace[];
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		position: { x: number; y: number };
		issue: MergedTicketIssue;
		workspaces: LinkedWorkspace[] | undefined;
	} | null>(null);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	// ── Data Fetching ─────────────────────────────────────────────────────────

	const { activeTicketProject, activeTicketScope, filteredIssues, linkedMap, isLoading, isEmpty } =
		useTicketsData();

	const { data: collapsedGroupsList } = trpc.tickets.getCollapsedGroups.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setCollapsedMutation = trpc.tickets.setCollapsedGroups.useMutation();

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

	const grouped = useMemo(() => {
		// Group by groupId (teamId for Linear, projectKey for Jira)
		const groups = new Map<
			string,
			{ name: string; provider: "jira" | "linear"; items: MergedTicketIssue[] }
		>();
		for (const issue of filteredIssues) {
			const gid = issue.groupId;
			const existing = groups.get(gid);
			if (existing) {
				existing.items.push(issue);
			} else {
				groups.set(gid, {
					name: issue.teamName || issue.projectKey || gid,
					provider: issue.provider as "jira" | "linear",
					items: [issue],
				});
			}
		}

		// Sort items within groups by status type (simplified)
		// In a real implementation we'd map status names/types to a sort order
		return groups;
	}, [filteredIssues]);

	// ── Handlers ──────────────────────────────────────────────────────────────

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

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

	// Context menu state fetching
	const { data: linearStates, isLoading: linearStatesLoading } = trpc.linear.getTeamStates.useQuery(
		{ teamId: contextMenu?.issue.groupId ?? "" },
		{
			enabled: !!contextMenu && contextMenu.issue.provider === "linear",
			staleTime: 5 * 60_000,
		}
	);

	const { data: jiraTransitions, isLoading: jiraTransitionsLoading } =
		trpc.atlassian.getIssueTransitions.useQuery(
			{ issueKey: contextMenu?.issue.id ?? "" },
			{
				enabled: !!contextMenu && contextMenu.issue.provider === "jira",
				staleTime: 60_000,
			}
		);

	const refreshAfterStatusChange = trpc.tickets.refreshTickets.useMutation({
		onSuccess: () => utils.tickets.getCachedTickets.invalidate(),
	});
	const refreshStatus = () =>
		refreshAfterStatusChange.mutate({
			scope: activeTicketScope,
			focus:
				activeTicketProject === "all" || activeTicketProject === null
					? undefined
					: activeTicketProject,
		});
	const updateLinearState = trpc.linear.updateIssueState.useMutation({
		onSuccess: refreshStatus,
	});
	const updateJiraStatus = trpc.atlassian.updateIssueStatus.useMutation({
		onSuccess: refreshStatus,
	});

	// ── Render Helpers ────────────────────────────────────────────────────────

	if (isEmpty) {
		return (
			<div className="px-3 py-2">
				<ConnectBanner message="Connect Jira or Linear to see your tickets." returnTo="tickets" />
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
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No issues assigned</div>
		);
	}

	return (
		<>
			<div className="flex flex-col">
				{[...grouped.entries()].map(([groupId, group]) => {
					const isCollapsed = collapsedGroups.has(groupId);
					return (
						<div key={groupId}>
							<button
								type="button"
								onClick={() => toggleGroup(groupId)}
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
									{group.items.map((issue) => {
										const linked = linkedMap.get(`${issue.provider}:${issue.id}`);
										return (
											<button
												key={`${issue.provider}:${issue.id}`}
												type="button"
												onClick={(e) => {
													if (!linked) {
														setOpenModalIssue(issue);
													} else if (linked.length === 1 && linked[0]) {
														navigateToWorkspace(linked[0]);
													} else {
														const rect = e.currentTarget.getBoundingClientRect();
														setPopover({
															position: { x: rect.left, y: rect.bottom + 4 },
															issue,
															workspaces: linked,
														});
													}
												}}
												onContextMenu={(e) => {
													e.preventDefault();
													setContextMenu({
														position: { x: e.clientX, y: e.clientY },
														issue,
														workspaces: linked,
													});
												}}
												className={`flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
													linked
														? "text-[var(--text-secondary)]"
														: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
												}`}
												title={`${issue.identifier}: ${issue.title}`}
											>
												<StateIcon
													type={issue.stateType || "default"}
													color={issue.status.color}
													size={12}
												/>
												<span
													className={`shrink-0 font-medium ${linked ? "text-[var(--accent)]" : "text-[var(--text-quaternary)]"}`}
												>
													{issue.identifier}
												</span>
												<span className="min-w-0 flex-1 truncate">{issue.title}</span>
												{/* Provider icon badge */}
												<div className="shrink-0 opacity-40">
													{issue.provider === "linear" ? (
														<svg
															aria-hidden="true"
															width="10"
															height="10"
															viewBox="0 0 16 16"
															fill="currentColor"
														>
															<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.5 11.5L4.5 11.5V4.5L11.5 4.5v7z" />
														</svg>
													) : (
														<svg
															aria-hidden="true"
															width="10"
															height="10"
															viewBox="0 0 16 16"
															fill="currentColor"
														>
															<path d="M8.5 0a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5h-5zM2.5 7a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5h-5z" />
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

			{contextMenu && (
				<IssueContextMenu
					position={contextMenu.position}
					issue={contextMenu.issue}
					workspaces={contextMenu.workspaces}
					states={contextMenu.issue.provider === "linear" ? linearStates : jiraTransitions}
					statesLoading={
						contextMenu.issue.provider === "linear" ? linearStatesLoading : jiraTransitionsLoading
					}
					openInLabel={`Open in ${contextMenu.issue.provider === "linear" ? "Linear" : "Jira"}`}
					onClose={() => setContextMenu(null)}
					onStateUpdate={(stateOrTransitionId) => {
						if (contextMenu.issue.provider === "linear") {
							updateLinearState.mutate({
								issueId: contextMenu.issue.id,
								stateId: stateOrTransitionId,
							});
						} else {
							updateJiraStatus.mutate({
								issueKey: contextMenu.issue.id,
								transitionId: stateOrTransitionId,
							});
						}
					}}
					onCreateBranch={() => {
						setContextMenu(null);
						setOpenModalIssue(contextMenu.issue);
					}}
					onNavigateToWorkspace={(ws) => {
						navigateToWorkspace(ws);
						setContextMenu(null);
					}}
				/>
			)}

			{popover && (
				<WorkspacePopover
					position={popover.position}
					workspaces={popover.workspaces}
					onClose={() => setPopover(null)}
					onCreateBranch={() => {
						setPopover(null);
						setOpenModalIssue(popover.issue);
					}}
				/>
			)}

			<CreateBranchFromIssueModal issue={openModalIssue} onClose={() => setOpenModalIssue(null)} />
		</>
	);
}
