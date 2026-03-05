import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { type BranchIssue, CreateBranchFromIssueModal } from "./CreateBranchFromIssueModal";
import { IssueContextMenu } from "./IssueContextMenu";
import { StateIcon } from "./StateIcon";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

export function LinearIssueList() {
	const utils = trpc.useUtils();
	const [openModalIssue, setOpenModalIssue] = useState<BranchIssue | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		issue: BranchIssue;
		workspaces: LinkedWorkspace[];
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		position: { x: number; y: number };
		issue: BranchIssue;
		workspaces: LinkedWorkspace[] | undefined;
	} | null>(null);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	// Team selection
	const { data: teams } = trpc.linear.getTeams.useQuery(undefined, { staleTime: 5 * 60_000 });
	const { data: selectedTeamId } = trpc.linear.getSelectedTeam.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setTeamMutation = trpc.linear.setSelectedTeam.useMutation();

	// Issues
	const { data: issues, isLoading } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	// Prefetch team states so the context menu state picker never shows "Loading..."
	useEffect(() => {
		if (!issues) return;
		const teamIds = new Set(issues.map((i) => i.teamId));
		for (const teamId of teamIds) {
			utils.linear.getTeamStates.prefetch({ teamId }, { staleTime: 5 * 60_000 });
		}
	}, [issues, utils]);

	// Linked issues → Map<linearIssueId, LinkedWorkspace[]>
	const { data: linkedIssues } = trpc.linear.getLinkedIssues.useQuery(undefined, {
		staleTime: 30_000,
	});
	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedIssues) return map;
		for (const l of linkedIssues) {
			if (l.worktreePath === null) continue;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const existing = map.get(l.linearIssueId);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(l.linearIssueId, [entry]);
			}
		}
		return map;
	}, [linkedIssues]);

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
	const updateStateMutation = trpc.linear.updateIssueState.useMutation({
		onMutate: async ({ issueId, stateId }) => {
			await utils.linear.getAssignedIssues.cancel();
			const prev = utils.linear.getAssignedIssues.getData();
			utils.linear.getAssignedIssues.setData(undefined, (old) => {
				if (!old) return old;
				return old.map((issue) => {
					if (issue.id !== issueId) return issue;
					const states = utils.linear.getTeamStates.getData({ teamId: issue.teamId });
					const newState = states?.find((s) => s.id === stateId);
					return {
						...issue,
						stateId,
						...(newState
							? { stateName: newState.name, stateColor: newState.color, stateType: newState.type }
							: {}),
					};
				});
			});
			return { prev };
		},
		onError: (_err, _vars, ctx) => {
			if (ctx?.prev) utils.linear.getAssignedIssues.setData(undefined, ctx.prev);
		},
		onSettled: () => utils.linear.getAssignedIssues.invalidate(),
	});

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
				{/* Team selector — only shown when user has multiple teams */}
				{teams && teams.length > 1 && (
					<div className="px-3 pb-1">
						<select
							className="w-full rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] outline-none"
							value={selectedTeamId ?? ""}
							onChange={(e) =>
							setTeamMutation.mutate(
								{ teamId: e.target.value || null },
								{ onSuccess: () => utils.linear.getAssignedIssues.invalidate() },
							)
						}
						>
							<option value="">All teams</option>
							{teams.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
					</div>
				)}

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
								<StateIcon type={issue.stateType} color={issue.stateColor} />
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
					onClose={() => setContextMenu(null)}
					onStateUpdate={(issueId, stateId) => updateStateMutation.mutate({ issueId, stateId })}
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
