import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import type { MergedTicketIssue, TicketViewMode } from "../../../shared/tickets";
import { useTicketDragDrop } from "../../hooks/useTicketDragDrop";
import { useTicketsData } from "../../hooks/useTicketsData";
import { useAssigneePickerStore } from "../../stores/assignee-picker-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { ConnectBanner } from "../ConnectBanner";
import { CreateBranchFromIssueModal } from "../CreateBranchFromIssueModal";
import { IssueContextMenu } from "../IssueContextMenu";
import type { LinkedWorkspace } from "../WorkspacePopover";
import { AssigneePicker } from "./AssigneePicker";
import { TicketDetailPanel } from "./TicketDetailPanel";
import { TicketsBoardView } from "./TicketsBoardView";
import { TicketsListView } from "./TicketsListView";
import { TicketsTableView } from "./TicketsTableView";
import { TicketsToolbar } from "./TicketsToolbar";

export function TicketsCanvas() {
	const utils = trpc.useUtils();

	const selectedTicketId = useTabStore((s) => s.selectedTicketId);
	const ticketDetailOpen = useTabStore((s) => s.ticketDetailOpen);
	const setSelectedTicket = useTabStore((s) => s.setSelectedTicket);

	const {
		columns,
		filteredIssues,
		linkedMap,
		isLoading,
		isEmpty,
		activeTicketProject,
		lastFetched,
		teamMembers,
		projectId,
	} = useTicketsData();

	const { data: savedViewMode } = trpc.tickets.getViewMode.useQuery(
		{ projectId },
		{ staleTime: Number.POSITIVE_INFINITY }
	);
	const setViewModeMutation = trpc.tickets.setViewMode.useMutation();
	const [localViewMode, setLocalViewMode] = useState<TicketViewMode | null>(null);
	const viewMode: TicketViewMode = localViewMode ?? savedViewMode ?? "board";

	const handleViewModeChange = useCallback(
		(mode: TicketViewMode) => {
			setLocalViewMode(mode);
			setViewModeMutation.mutate({ projectId, mode });
			utils.tickets.getViewMode.setData({ projectId }, mode);
		},
		[projectId, setViewModeMutation, utils]
	);

	// Reset local override when project changes
	const prevProjectIdRef = useRef(projectId);
	if (prevProjectIdRef.current !== projectId) {
		prevProjectIdRef.current = projectId;
		setLocalViewMode(null);
	}

	// ── Detail panel (resizable) ─────────────────────────────────────────────
	const detailPanelRef = usePanelRef();
	const { defaultLayout: ticketPanelLayout, onLayoutChanged: onTicketLayoutChanged } =
		useDefaultLayout({
			id: "ticket-detail-layout",
			storage: localStorage,
		});

	useEffect(() => {
		if (!detailPanelRef.current) return;
		if (ticketDetailOpen && detailPanelRef.current.isCollapsed()) {
			detailPanelRef.current.expand();
		} else if (!ticketDetailOpen && !detailPanelRef.current.isCollapsed()) {
			detailPanelRef.current.collapse();
		}
	}, [ticketDetailOpen, detailPanelRef]);

	// ── Context menu ─────────────────────────────────────────────────────────
	const [contextMenu, setContextMenu] = useState<{
		position: { x: number; y: number };
		issue: MergedTicketIssue;
		workspaces: LinkedWorkspace[] | undefined;
	} | null>(null);

	const [openModalIssue, setOpenModalIssue] = useState<MergedTicketIssue | null>(null);

	// ── Workspace navigation ─────────────────────────────────────────────────
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const pickerOpen = useAssigneePickerStore((s) => s.open);
	const closePicker = useAssigneePickerStore((s) => s.close);

	const reassignMutation = trpc.tickets.reassignTicket.useMutation({
		onSuccess: () => {
			utils.tickets.getCachedTickets.invalidate();
		},
	});

	const handleReassign = useCallback(
		(userId: string | null) => {
			if (!pickerOpen) return;
			reassignMutation.mutate({
				provider: pickerOpen.ticket.provider,
				ticketId: pickerOpen.ticket.id,
				assigneeId: userId,
			});
			closePicker();
		},
		[pickerOpen, closePicker, reassignMutation]
	);

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);
		store.setSidebarSegment("repos");

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

	// ── Context menu state fetching ──────────────────────────────────────────
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

	const updateLinearState = trpc.linear.updateIssueState.useMutation({
		onSettled: () => utils.linear.getAssignedIssues.invalidate(),
	});
	const updateJiraStatus = trpc.atlassian.updateIssueStatus.useMutation({
		onSettled: () => utils.atlassian.getMyIssues.invalidate(),
	});

	const dnd = useTicketDragDrop(columns, { updateJiraStatus, updateLinearState });

	// ── Ticket click / context menu handlers ─────────────────────────────────
	const handleTicketClick = useCallback(
		(issue: MergedTicketIssue) => {
			setSelectedTicket(issue.id);
		},
		[setSelectedTicket]
	);

	const handleTicketContextMenu = useCallback(
		(e: React.MouseEvent, issue: MergedTicketIssue) => {
			e.preventDefault();
			const key = `${issue.provider}:${issue.id}`;
			setContextMenu({
				position: { x: e.clientX, y: e.clientY },
				issue,
				workspaces: linkedMap.get(key),
			});
		},
		[linkedMap]
	);

	const handleStatusChange = useCallback(
		(issue: MergedTicketIssue, transitionOrStateId: string) => {
			if (issue.provider === "jira") {
				updateJiraStatus.mutate({
					issueKey: issue.id,
					transitionId: transitionOrStateId,
				});
			} else {
				updateLinearState.mutate({
					issueId: issue.id,
					stateId: transitionOrStateId,
				});
			}
		},
		[updateJiraStatus, updateLinearState]
	);

	// ── Derived display values ───────────────────────────────────────────────
	const showProvider = activeTicketProject === "all";

	const projectName = useMemo(() => {
		if (activeTicketProject === "all" || activeTicketProject === null) return "All Tickets";
		const sample = filteredIssues[0];
		if (sample?.teamName) return sample.teamName;
		if (sample?.projectKey) return sample.projectKey;
		return activeTicketProject.id;
	}, [activeTicketProject, filteredIssues]);

	const providerLabel = useMemo(() => {
		if (activeTicketProject === "all" || activeTicketProject === null) return "All providers";
		return activeTicketProject.provider === "linear" ? "Linear" : "Jira";
	}, [activeTicketProject]);

	// ── Resolve selected issue for detail panel ──────────────────────────────
	const selectedIssue = useMemo(() => {
		if (!selectedTicketId) return null;
		return filteredIssues.find((i) => i.id === selectedTicketId) ?? null;
	}, [selectedTicketId, filteredIssues]);

	// ── Empty / loading states ───────────────────────────────────────────────
	if (isEmpty) {
		return (
			<main className="flex h-full min-w-0 items-center justify-center overflow-hidden">
				<div className="text-center text-[13px]">
					<ConnectBanner message="Connect Jira or Linear to see your tickets." returnTo="tickets" />
				</div>
			</main>
		);
	}

	if (isLoading) {
		return (
			<main className="flex h-full min-w-0 items-center justify-center overflow-hidden">
				<div className="flex flex-col items-center gap-3">
					<div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-elevated)]" />
					<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
				</div>
			</main>
		);
	}

	return (
		<main className="flex h-full min-w-0 flex-col overflow-hidden">
			<TicketsToolbar
				projectName={projectName}
				providerLabel={providerLabel}
				ticketCount={filteredIssues.length}
				viewMode={viewMode}
				onViewModeChange={handleViewModeChange}
				lastFetched={lastFetched}
			/>

			<div className="min-h-0 flex-1">
				<Group
					orientation="vertical"
					className="h-full"
					defaultLayout={ticketPanelLayout}
					onLayoutChanged={onTicketLayoutChanged}
				>
					<Panel id="ticket-view" minSize="20%">
						{viewMode === "board" && (
							<TicketsBoardView
								columns={columns}
								linkedMap={linkedMap}
								selectedTicketId={selectedTicketId}
								showProvider={showProvider}
								onTicketClick={handleTicketClick}
								onTicketContextMenu={handleTicketContextMenu}
								dnd={dnd}
							/>
						)}
						{viewMode === "list" && (
							<TicketsListView
								columns={columns}
								linkedMap={linkedMap}
								selectedTicketId={selectedTicketId}
								showProvider={showProvider}
								onTicketClick={handleTicketClick}
								onTicketContextMenu={handleTicketContextMenu}
								dnd={dnd}
							/>
						)}
						{viewMode === "table" && (
							<TicketsTableView
								issues={filteredIssues}
								linkedMap={linkedMap}
								selectedTicketId={selectedTicketId}
								onTicketClick={handleTicketClick}
								onTicketContextMenu={handleTicketContextMenu}
								onStatusChange={handleStatusChange}
							/>
						)}
					</Panel>

					<Separator className="panel-resize-handle-vertical" />

					<Panel
						id="ticket-detail"
						panelRef={detailPanelRef}
						defaultSize="40%"
						minSize="15%"
						collapsible
						collapsedSize="0%"
						onResize={() => {
							const collapsed = detailPanelRef.current?.isCollapsed() ?? true;
							if (collapsed && ticketDetailOpen) {
								useTabStore.getState().closeTicketDetail();
							}
						}}
					>
						{selectedIssue && (
							<TicketDetailPanel
								issue={selectedIssue}
								linked={linkedMap.get(`${selectedIssue.provider}:${selectedIssue.id}`)}
								onCreateBranch={() => setOpenModalIssue(selectedIssue)}
								onNavigateToWorkspace={navigateToWorkspace}
							/>
						)}
					</Panel>
				</Group>
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

			<CreateBranchFromIssueModal issue={openModalIssue} onClose={() => setOpenModalIssue(null)} />

			{pickerOpen && (
				<AssigneePicker
					members={teamMembers.filter((m) => m.provider === pickerOpen.ticket.provider)}
					currentAssigneeId={pickerOpen.ticket.assigneeId ?? null}
					position={pickerOpen.position}
					onSelect={handleReassign}
					onClose={closePicker}
				/>
			)}
		</main>
	);
}
