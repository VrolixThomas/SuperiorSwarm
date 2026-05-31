import { useMemo } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { AddRepoButton } from "./orchestrator/AddRepoButton";
import type { AgentCardData } from "./orchestrator/AgentCard";
import { DispatchComposer } from "./orchestrator/DispatchComposer";
import { RepoLane } from "./orchestrator/RepoLane";

export function CrossRepoOrchestratorCanvas({ orchestratorId }: { orchestratorId: string }) {
	const orch = trpc.crossRepoOrchestrators.get.useQuery({ id: orchestratorId });
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestratorId });
	const projects = trpc.projects.list.useQuery();

	const utils = trpc.useUtils();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const unlinkProject = trpc.crossRepoOrchestrators.unlinkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
		},
	});
	const projectsById = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p])),
		[projects.data]
	);
	const membersById = useMemo(
		() => new Map((members.data ?? []).map((m) => [m.workspaceId, m])),
		[members.data]
	);

	function openMember(workspaceId: string) {
		const m = membersById.get(workspaceId);
		if (!m?.worktreePath) return;
		const store = useTabStore.getState();
		store.setActiveWorkspace(m.workspaceId, m.worktreePath);
		const existing = store.getTabsByWorkspace(m.workspaceId);
		if (!existing.some((t) => t.kind === "terminal")) {
			const tabId = store.addTerminalTab(m.workspaceId, m.worktreePath, m.workspaceName);
			attachTerminal.mutate({ workspaceId: m.workspaceId, terminalId: tabId });
		}
	}

	const repos = (linked.data ?? []).map((pid) => ({
		projectId: pid,
		name: projectsById.get(pid)?.name ?? pid,
	}));

	const cardsByProject = useMemo(() => {
		const map = new Map<string, AgentCardData[]>();
		for (const m of members.data ?? []) {
			const arr = map.get(m.projectId) ?? [];
			arr.push({
				workspaceId: m.workspaceId,
				branch: m.workspaceName,
				phase: m.currentPhase,
				statusText: m.statusText,
				needs: m.needs,
				worktreePath: m.worktreePath,
			});
			map.set(m.projectId, arr);
		}
		return map;
	}, [members.data]);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--bg-base)]">
			<div className="mx-auto w-full max-w-[820px] p-[22px_26px_40px]">
				<h1 className="text-[19px] font-semibold tracking-[-0.01em]">
					{orch.data?.name ?? "Orchestrator"}
				</h1>
				<div className="mt-[1px] text-[12.5px] text-[var(--text-tertiary)]">
					{repos.length} repos · {(members.data ?? []).length} agents
				</div>

				<div className="mt-[16px]">
					<DispatchComposer orchestratorId={orchestratorId} repos={repos} />
				</div>

				<div className="mb-[12px] mt-[26px] flex items-center justify-between">
					<h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">Repos</h2>
					<AddRepoButton orchestratorId={orchestratorId} />
				</div>
				<div className="flex flex-col gap-[12px]">
					{repos.map((r) => (
						// biome-ignore lint/a11y/useValidAriaRole: `role` is a domain prop (backend/frontend), not an ARIA role
						<RepoLane
							key={r.projectId}
							repoName={r.name}
							role={null}
							cards={cardsByProject.get(r.projectId) ?? []}
							onAnswer={(workspaceId) => openMember(workspaceId)}
							onOpen={(workspaceId) => openMember(workspaceId)}
							onUnlink={() => {
								if (window.confirm(`Unlink "${r.name}" from this orchestrator?`)) {
									unlinkProject.mutate({ id: orchestratorId, projectId: r.projectId });
								}
							}}
						/>
					))}
					{repos.length === 0 && (
						<div className="rounded-[10px] border border-dashed border-[var(--border)] px-[14px] py-[16px] text-center text-[12px] text-[var(--text-tertiary)]">
							No repos linked yet. Use "Add repo" to link one.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
