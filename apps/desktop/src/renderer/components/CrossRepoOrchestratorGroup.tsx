import { usePaneStore } from "../stores/pane-store";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CrossRepoOrchestratorRow } from "./CrossRepoOrchestratorRow";
import { OrchestratorIcon } from "./orchestrator/OrchestratorIcon";

export function CrossRepoOrchestratorGroup() {
	const orchs = trpc.crossRepoOrchestrators.list.useQuery();
	const utils = trpc.useUtils();
	const openCreate = useProjectStore((s) => s.openCreateCrossRepoModal);
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

	const collapsed = useProjectStore((s) => s.orchestratorPaneCollapsed);
	const toggleCollapsed = useProjectStore((s) => s.toggleOrchestratorPaneCollapsed);

	const all = orchs.data ?? [];
	const allIds = all.map((o) => o.id);

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Pane header */}
			<div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
				<button
					type="button"
					onClick={toggleCollapsed}
					aria-expanded={!collapsed}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
				>
					<svg
						aria-hidden="true"
						width="9"
						height="9"
						viewBox="0 0 10 10"
						fill="none"
						className={[
							"shrink-0 text-[var(--text-quaternary)] transition-transform duration-[120ms]",
							collapsed ? "rotate-0" : "rotate-90",
						].join(" ")}
					>
						<path
							d="M3 1.5L7 5L3 8.5"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					<span className="text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--text-quaternary)]">
						Orchestrators
					</span>
				</button>
				<button
					type="button"
					onClick={openCreate}
					className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[14px] text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:text-[var(--text-secondary)]"
					title="New Orchestrator"
				>
					+
				</button>
			</div>

			{/* Pane body */}
			{!collapsed &&
				(all.length === 0 ? (
					<button
						type="button"
						onClick={openCreate}
						className="mx-2 mt-1 flex shrink-0 items-center gap-[10px] rounded-[9px] border border-dashed border-[var(--border)] px-[12px] py-[9px] text-left transition-colors hover:border-[var(--border-active)]"
					>
						<span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] border border-[rgba(138,154,176,0.35)] bg-[var(--orch-1-bg)]">
							<OrchestratorIcon size={14} color="var(--orch-1)" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-[12px] font-semibold text-[var(--text)]">
								Coordinate across repos
							</span>
							<span className="block text-[11px] leading-snug text-[var(--text-tertiary)]">
								Dispatch and track work across multiple repos.
							</span>
						</span>
					</button>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
						{all.map((o) => (
							<CrossRepoOrchestratorRow
								key={o.id}
								orchestrator={o}
								allOrchestratorIds={allIds}
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
				))}
		</div>
	);
}
