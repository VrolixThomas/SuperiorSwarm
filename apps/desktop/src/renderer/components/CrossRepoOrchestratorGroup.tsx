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
		<div className="mt-2.5">
			{/* Divider + header */}
			<div className="px-2 mb-1">
				<div className="flex items-center gap-2">
					<span className="text-[10px] tracking-[0.05em] text-[var(--text-quaternary)]">
						Cross-repo
					</span>
					<div className="flex-1 h-px bg-[var(--border-subtle)]" />
					<button
						type="button"
						onClick={() => setShowCreate(true)}
						className="text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] transition-colors"
						aria-label="New cross-repo orchestrator"
						title="New cross-repo orchestrator"
					>
						<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none">
							<path
								d="M5.5 1.5v8M1.5 5.5h8"
								stroke="currentColor"
								strokeWidth="1.2"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>
			</div>

			{all.length === 0 ? (
				<button
					type="button"
					onClick={() => setShowCreate(true)}
					className="w-full text-left text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] px-2 py-1.5 italic"
				>
					Coordinate work across multiple repos
				</button>
			) : (
				<div className="px-1">
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
				</div>
			)}

			{showCreate && <CreateCrossRepoOrchestratorModal onClose={() => setShowCreate(false)} />}
		</div>
	);
}
