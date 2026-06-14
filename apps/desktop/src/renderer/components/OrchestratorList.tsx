import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CrossRepoOrchestratorRow } from "./CrossRepoOrchestratorRow";

export function OrchestratorList() {
	const orchs = trpc.crossRepoOrchestrators.list.useQuery();
	const counts = trpc.crossRepoOrchestrators.memberCounts.useQuery(undefined, {
		refetchInterval: 30_000,
	});
	const utils = trpc.useUtils();
	const renameMut = trpc.crossRepoOrchestrators.rename.useMutation({
		onSuccess: () => utils.crossRepoOrchestrators.list.invalidate(),
	});
	const deleteMut = trpc.crossRepoOrchestrators.delete.useMutation({
		onSuccess: (_data, vars) => {
			usePaneStore.getState().clearLayout(vars.id);
			useTabStore.getState().cleanupWorkspace(vars.id);
			utils.crossRepoOrchestrators.list.invalidate();
			utils.workspaces.listByProject.invalidate();
		},
	});

	const all = orchs.data ?? [];
	if (all.length === 0) return null;

	return (
		<div className="flex flex-col gap-2">
			{all.map((o) => (
				<CrossRepoOrchestratorRow
					key={o.id}
					orchestrator={o}
					counts={counts.data?.[o.id] ?? { total: 0, working: 0, blocked: 0 }}
					onRename={() => {
						const name = window.prompt("Rename cross-repo orchestrator", o.name);
						if (name?.trim()) renameMut.mutate({ id: o.id, name: name.trim() });
					}}
					onDelete={async () => {
						if (!window.confirm(`Delete "${o.name}"?`)) return;
						const members = await utils.crossRepoOrchestrators.listMembers.fetch({
							id: o.id,
						});
						const n = members.filter((m) => m.createdByDispatch).length;
						let removeWorkspaces = false;
						if (n > 0) {
							removeWorkspaces = window.confirm(
								`Also permanently delete ${n} worktree workspace${n === 1 ? "" : "s"} this orchestrator created, including any uncommitted changes? Cancel keeps them.`
							);
						}
						deleteMut.mutate({ id: o.id, removeWorkspaces });
					}}
				/>
			))}
		</div>
	);
}
