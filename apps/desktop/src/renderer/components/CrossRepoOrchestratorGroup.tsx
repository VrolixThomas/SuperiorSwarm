import { useState } from "react";
import { trpc } from "../trpc/client";
import { CreateCrossRepoOrchestratorModal } from "./CreateCrossRepoOrchestratorModal";
import { CrossRepoOrchestratorBody } from "./CrossRepoOrchestratorBody";
import { CrossRepoOrchestratorRow } from "./CrossRepoOrchestratorRow";

export function CrossRepoOrchestratorGroup() {
	const orchs = trpc.crossRepoOrchestrators.list.useQuery();
	const utils = trpc.useUtils();
	const renameMut = trpc.crossRepoOrchestrators.rename.useMutation({
		onSuccess: () => utils.crossRepoOrchestrators.list.invalidate(),
	});
	const deleteMut = trpc.crossRepoOrchestrators.delete.useMutation({
		onSuccess: () => utils.crossRepoOrchestrators.list.invalidate(),
	});

	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [showCreate, setShowCreate] = useState(false);

	const all = orchs.data ?? [];
	const allIds = all.map((o) => o.id);

	return (
		<div className="mt-2">
			<div className="flex items-center justify-between px-2 py-1">
				<span className="text-[10px] uppercase tracking-wider text-[var(--text-quaternary)]">
					Cross-repo orchestrators
				</span>
				<button
					onClick={() => setShowCreate(true)}
					className="text-[var(--text-quaternary)] hover:text-[var(--text)] text-xs"
					aria-label="New cross-repo orchestrator"
					type="button"
				>
					+
				</button>
			</div>
			{all.map((o) => (
				<div key={o.id}>
					<CrossRepoOrchestratorRow
						orchestrator={o}
						allOrchestratorIds={allIds}
						expanded={!!expanded[o.id]}
						onToggle={() => setExpanded((p) => ({ ...p, [o.id]: !p[o.id] }))}
						onRename={() => {
							const name = window.prompt("Rename cross-repo orchestrator", o.name);
							if (name?.trim()) renameMut.mutate({ id: o.id, name: name.trim() });
						}}
						onDelete={() => {
							if (window.confirm(`Delete "${o.name}"?`)) deleteMut.mutate({ id: o.id });
						}}
					/>
					{expanded[o.id] && <CrossRepoOrchestratorBody orchestratorId={o.id} />}
				</div>
			))}
			{showCreate && <CreateCrossRepoOrchestratorModal onClose={() => setShowCreate(false)} />}
		</div>
	);
}
