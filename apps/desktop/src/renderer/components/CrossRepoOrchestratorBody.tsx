import { trpc } from "../trpc/client";

export function CrossRepoOrchestratorBody({ orchestratorId }: { orchestratorId: string }) {
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestratorId });
	const projects = trpc.projects.list.useQuery();
	const utils = trpc.useUtils();
	const unlinkProject = trpc.crossRepoOrchestrators.unlinkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
		},
	});

	const projectsById = new Map((projects.data ?? []).map((p) => [p.id, p]));

	return (
		<div className="ml-4">
			<div className="text-[10px] uppercase tracking-wider text-[var(--text-quaternary)] px-2 py-1">
				Repos
			</div>
			{(linked.data ?? []).length === 0 && (
				<div className="px-2 py-1 text-[11px] text-[var(--text-quaternary)]">
					No repos linked — hover the row to add one.
				</div>
			)}
			{(linked.data ?? []).map((pid) => (
				<div
					key={pid}
					className="group flex items-center px-2 py-1 text-[12px] text-[var(--text-secondary)]"
				>
					<span className="truncate">{projectsById.get(pid)?.name ?? pid}</span>
					<button
						type="button"
						onClick={() => unlinkProject.mutate({ id: orchestratorId, projectId: pid })}
						className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text)]"
						aria-label="Unlink repo"
					>
						×
					</button>
				</div>
			))}

			<div className="text-[10px] uppercase tracking-wider text-[var(--text-quaternary)] px-2 py-1 mt-2">
				Members
			</div>
			{(members.data ?? []).length === 0 && (
				<div className="px-2 py-1 text-[11px] text-[var(--text-quaternary)]">No active members</div>
			)}
			{(members.data ?? []).map((m) => (
				<div key={m.workspaceId} className="px-2 py-1 text-[12px] text-[var(--text)] truncate">
					{projectsById.get(m.projectId)?.name ?? m.projectId} / {m.workspaceName ?? m.workspaceId}
				</div>
			))}
		</div>
	);
}
