import { useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface StatePickerProps {
	issueId: string;
	currentStateId: string;
	teamId: string;
	onUpdate: (issueId: string, stateId: string) => void;
}

function StatePicker({ issueId, currentStateId, teamId, onUpdate }: StatePickerProps) {
	const { data: states } = trpc.linear.getTeamStates.useQuery(
		{ teamId },
		{ staleTime: 5 * 60_000 }
	);

	if (!states) return null;

	return (
		<select
			className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none"
			value={currentStateId}
			onChange={(e) => onUpdate(issueId, e.target.value)}
		>
			{states.map((s) => (
				<option key={s.id} value={s.id}>
					{s.name}
				</option>
			))}
		</select>
	);
}

export function LinearIssueList() {
	const utils = trpc.useUtils();
	const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null);

	// Team selection
	const { data: teams } = trpc.linear.getTeams.useQuery(undefined, { staleTime: 5 * 60_000 });
	const { data: selectedTeamId } = trpc.linear.getSelectedTeam.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setTeamMutation = trpc.linear.setSelectedTeam.useMutation({
		onSuccess: () => utils.linear.getAssignedIssues.invalidate(),
	});

	// Issues
	const { data: issues, isLoading } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	// Branch linking — uses active workspace from tab store
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const { data: linkedIssueIds } = trpc.linear.getLinkedIssues.useQuery(
		{ workspaceId: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId, staleTime: 30_000 }
	);
	const linkMutation = trpc.linear.linkIssue.useMutation({
		onSuccess: () =>
			activeWorkspaceId &&
			utils.linear.getLinkedIssues.invalidate({ workspaceId: activeWorkspaceId }),
	});
	const unlinkMutation = trpc.linear.unlinkIssue.useMutation({
		onSuccess: () =>
			activeWorkspaceId &&
			utils.linear.getLinkedIssues.invalidate({ workspaceId: activeWorkspaceId }),
	});

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

	const linkedSet = new Set(linkedIssueIds ?? []);

	return (
		<div className="flex flex-col gap-0.5">
			{/* Team selector — only shown when user has multiple teams */}
			{teams && teams.length > 1 && (
				<div className="px-3 pb-1">
					<select
						className="w-full rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] outline-none"
						value={selectedTeamId ?? ""}
						onChange={(e) => setTeamMutation.mutate({ teamId: e.target.value || null })}
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
					const isLinked = linkedSet.has(issue.id);
					const isHovered = hoveredIssueId === issue.id;

					return (
						<div
							key={issue.id}
							className="group relative"
							onMouseEnter={() => setHoveredIssueId(issue.id)}
							onMouseLeave={() => setHoveredIssueId(null)}
						>
							<button
								type="button"
								onClick={() => window.electron.shell.openExternal(issue.url)}
								className={`flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
									isLinked
										? "text-[var(--text-secondary)]"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
								title={`${issue.identifier}: ${issue.title}`}
							>
								{/* Status dot */}
								<span
									className="h-2 w-2 shrink-0 rounded-full"
									style={{ backgroundColor: issue.stateColor }}
								/>
								<span className="shrink-0 font-medium text-[var(--text-quaternary)]">
									{issue.identifier}
								</span>
								<span className="min-w-0 flex-1 truncate">{issue.title}</span>
								{isLinked && (
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

							{/* Hover actions */}
							{isHovered && (
								<div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
									<StatePicker
										issueId={issue.id}
										currentStateId={issue.stateId}
										teamId={issue.teamId}
										onUpdate={(id, stateId) => updateStateMutation.mutate({ issueId: id, stateId })}
									/>
									{activeWorkspaceId && (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												if (isLinked) {
													unlinkMutation.mutate({
														workspaceId: activeWorkspaceId,
														linearIssueId: issue.id,
													});
												} else {
													linkMutation.mutate({
														workspaceId: activeWorkspaceId,
														linearIssueId: issue.id,
													});
												}
											}}
											className="rounded px-1 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
											title={isLinked ? "Unlink from workspace" : "Link to workspace"}
										>
											{isLinked ? "unlink" : "link"}
										</button>
									)}
								</div>
							)}
						</div>
					);
				})
			)}
		</div>
	);
}
