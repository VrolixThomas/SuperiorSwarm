import { useCallback, useMemo, useRef, useState } from "react";
import type { JiraIssue } from "../../main/atlassian/jira";
import type { TicketIssue } from "../../shared/tickets";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CreateBranchFromIssueModal } from "./CreateBranchFromIssueModal";
import { IssueContextMenu } from "./IssueContextMenu";
import { StateIcon } from "./StateIcon";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

export function JiraIssueList() {
	const utils = trpc.useUtils();
	const [openModalIssue, setOpenModalIssue] = useState<TicketIssue | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		issue: TicketIssue;
		workspaces: LinkedWorkspace[];
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		position: { x: number; y: number };
		issue: TicketIssue;
		workspaces: LinkedWorkspace[] | undefined;
	} | null>(null);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	// Issues
	const { data: rawIssues, isLoading } = trpc.atlassian.getMyIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	// Linked tickets → Map<ticketId, LinkedWorkspace[]>
	const { data: linkedTickets } = trpc.tickets.getLinkedTickets.useQuery(undefined, {
		staleTime: 30_000,
	});
	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedTickets) return map;
		for (const l of linkedTickets) {
			if (l.provider !== "jira" || l.worktreePath === null) continue;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const existing = map.get(l.ticketId);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(l.ticketId, [entry]);
			}
		}
		return map;
	}, [linkedTickets]);

	// Mapping function
	const mapToTicketIssue = useCallback((issue: JiraIssue): TicketIssue => {
		return {
			provider: "jira",
			id: issue.key,
			identifier: issue.key,
			title: issue.summary,
			url: issue.webUrl,
			status: {
				id: issue.status, // We use status name as ID for Jira status display if no transition
				name: issue.status,
				color: issue.statusColor,
			},
			groupId: issue.projectKey,
		};
	}, []);

	const issues = useMemo(() => {
		return rawIssues?.map(mapToTicketIssue);
	}, [rawIssues, mapToTicketIssue]);

	// Navigate to a single workspace (with terminal tab creation)
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

	// State update (optimistic)
	const updateStatusMutation = trpc.atlassian.updateIssueStatus.useMutation({
		onMutate: async ({ issueKey, transitionId }) => {
			await utils.atlassian.getMyIssues.cancel();
			const prev = utils.atlassian.getMyIssues.getData();
			utils.atlassian.getMyIssues.setData(undefined, (old) => {
				if (!old) return old;
				return old.map((issue) => {
					if (issue.key !== issueKey) return issue;
					// Note: We don't easily know the new status name/color without fetching transitions first
					// So we just keep it as is until refetch, or we could find it in cached transitions
					return issue;
				});
			});
			return { prev };
		},
		onError: (_err, _vars, ctx) => {
			if (ctx?.prev) utils.atlassian.getMyIssues.setData(undefined, ctx.prev);
		},
		onSettled: () => utils.atlassian.getMyIssues.invalidate(),
	});

	// Get transitions for context menu (on-demand for Jira)
	const { data: transitions, isLoading: transitionsLoading } =
		trpc.atlassian.getIssueTransitions.useQuery(
			{ issueKey: contextMenu?.issue.id ?? "" },
			{ enabled: !!contextMenu?.issue.id, staleTime: 60_000 }
		);

	if (isLoading && !issues) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	return (
		<>
			<div className="flex flex-col gap-0.5">
				{/* Issue list */}
				{!issues || issues.length === 0 ? (
					<div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">
						No issues assigned
					</div>
				) : (
					issues.map((issue) => {
						const linked = linkedMap.get(issue.id);

						return (
							<button
								key={issue.id}
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
								title={
									linked
										? `Open workspace for ${issue.identifier}`
										: `${issue.identifier}: ${issue.title}`
								}
							>
								<StateIcon type="default" color={issue.status.color} />
								<span className="shrink-0 font-medium text-[var(--text-quaternary)]">
									{issue.identifier}
								</span>
								<span className="min-w-0 flex-1 truncate">{issue.title}</span>
								{/* Chain icon — visible when linked */}
								{linked && (
									<svg
										aria-hidden="true"
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="shrink-0 text-[var(--accent)]"
									>
										<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
										<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
									</svg>
								)}
							</button>
						);
					})
				)}
			</div>

			{/* Context menu */}
			{contextMenu && (
				<IssueContextMenu
					position={contextMenu.position}
					issue={contextMenu.issue}
					workspaces={contextMenu.workspaces}
					states={transitions}
					statesLoading={transitionsLoading}
					openInLabel="Open in Jira"
					onClose={() => setContextMenu(null)}
					onStateUpdate={(transitionId) =>
						updateStatusMutation.mutate({
							issueKey: contextMenu.issue.id,
							transitionId,
						})
					}
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

			{/* Workspace popover */}
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
