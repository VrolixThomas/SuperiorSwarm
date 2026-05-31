import { useMemo } from "react";
import { trpc } from "../trpc/client";
import type { AgentCardData } from "./orchestrator/AgentCard";
import type { ActivityEvent } from "./orchestrator/CrossRepoActivityRail";
import { CrossRepoActivityRail } from "./orchestrator/CrossRepoActivityRail";
import { DispatchComposer } from "./orchestrator/DispatchComposer";
import { RepoLane } from "./orchestrator/RepoLane";

export function CrossRepoOrchestratorCanvas({ orchestratorId }: { orchestratorId: string }) {
	const orch = trpc.crossRepoOrchestrators.get.useQuery({ id: orchestratorId });
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestratorId });
	const projects = trpc.projects.list.useQuery();

	const projectsById = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p])),
		[projects.data]
	);

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
			});
			map.set(m.projectId, arr);
		}
		return map;
	}, [members.data]);

	const events: ActivityEvent[] = useMemo(
		() =>
			(members.data ?? [])
				.filter((m) => m.statusText)
				.map((m) => ({
					id: m.workspaceId,
					who: m.workspaceName,
					repo: projectsById.get(m.projectId)?.name ?? m.projectId,
					relTime: "",
					kind: m.currentPhase,
					text:
						m.currentPhase === "blocked" && m.needs ? `Blocked: ${m.needs}` : (m.statusText ?? ""),
				})),
		[members.data, projectsById]
	);

	return (
		<div className="grid h-full min-h-0 grid-cols-[1fr_312px] bg-[var(--bg-base)]">
			<main className="min-h-0 overflow-y-auto p-[22px_26px_40px]">
				<h1 className="text-[19px] font-semibold tracking-[-0.01em]">
					{orch.data?.name ?? "Orchestrator"}
				</h1>
				<div className="mt-[1px] text-[12.5px] text-[var(--text-tertiary)]">
					{repos.length} repos · {(members.data ?? []).length} agents
				</div>

				<div className="mt-[16px]">
					<DispatchComposer orchestratorId={orchestratorId} repos={repos} />
				</div>

				<h2 className="mb-[12px] mt-[26px] text-[13px] font-semibold text-[var(--text-secondary)]">
					Repos
				</h2>
				<div className="grid grid-cols-3 gap-[13px]">
					{repos.map((r) => (
						// biome-ignore lint/a11y/useValidAriaRole: `role` is a domain prop (backend/frontend), not an ARIA role
						<RepoLane
							key={r.projectId}
							repoName={r.name}
							role={null}
							cards={cardsByProject.get(r.projectId) ?? []}
							onAnswer={() => {}}
							onOpen={() => {}}
							onDispatchHere={() => {}}
						/>
					))}
				</div>
			</main>
			<CrossRepoActivityRail events={events} />
		</div>
	);
}
