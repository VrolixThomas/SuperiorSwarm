import { useState } from "react";
import { trpc } from "../trpc/client";
import { CrossRepoOrchestratorCreatePopover } from "./CrossRepoOrchestratorCreatePopover";
import { CrossRepoOrchestratorRow } from "./CrossRepoOrchestratorRow";

export function CrossRepoOrchestratorGroup() {
	const orchs = trpc.crossRepoOrchestrators.list.useQuery();
	const utils = trpc.useUtils();
	const renameMut = trpc.crossRepoOrchestrators.rename.useMutation({
		onSuccess: () => utils.crossRepoOrchestrators.list.invalidate(),
	});
	const deleteMut = trpc.crossRepoOrchestrators.delete.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.list.invalidate();
			utils.workspaces.listByProject.invalidate();
		},
	});

	const [showCreate, setShowCreate] = useState(false);

	const all = orchs.data ?? [];
	const allIds = all.map((o) => o.id);

	return (
		<div className="mt-3">
			{/* Section header — promoted to match the Projects section. */}
			<div className="relative px-2">
				<div className="flex items-center gap-2 py-1">
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 14 14"
						fill="none"
						className="shrink-0"
					>
						<circle cx="3" cy="7" r="2" stroke="var(--text-tertiary)" strokeWidth="1.2" />
						<circle cx="11" cy="7" r="2" stroke="var(--text-tertiary)" strokeWidth="1.2" />
						<circle cx="7" cy="7" r="1" fill="var(--text-tertiary)" />
						<path d="M5 7h.6M8.4 7H9" stroke="var(--text-tertiary)" strokeWidth="1.1" />
					</svg>
					<span className="flex-1 text-[12px] font-semibold tracking-[0.01em] text-[var(--text-secondary)]">
						Orchestrators
					</span>
					<button
						type="button"
						onClick={() => setShowCreate((v) => !v)}
						aria-expanded={showCreate}
						className="inline-flex h-[22px] items-center gap-[5px] rounded-[6px] border border-[rgba(10,132,255,0.25)] bg-[var(--accent-subtle)] pl-[6px] pr-[8px] text-[11.5px] font-semibold text-[var(--accent-hover)] transition-colors hover:bg-[rgba(10,132,255,0.24)]"
					>
						<svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden="true">
							<path
								d="M5.5 1.5v8M1.5 5.5h8"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
							/>
						</svg>
						New
					</button>
				</div>

				{showCreate && (
					<CrossRepoOrchestratorCreatePopover
						onClose={() => setShowCreate(false)}
						onCreated={() => utils.crossRepoOrchestrators.list.invalidate()}
					/>
				)}
			</div>

			{all.length === 0 ? (
				<button
					type="button"
					onClick={() => setShowCreate(true)}
					className="mx-1 mt-1 block w-[calc(100%-8px)] rounded-[10px] border border-dashed border-[var(--border)] bg-[linear-gradient(180deg,rgba(138,154,176,0.06),rgba(138,154,176,0.01))] px-[14px] py-[15px] text-center transition-colors hover:border-[var(--border-active)]"
				>
					<span className="mx-auto mb-[9px] grid h-[32px] w-[32px] place-items-center rounded-[9px] border border-[rgba(138,154,176,0.35)] bg-[var(--orch-1-bg)]">
						<svg width="17" height="17" viewBox="0 0 14 14" fill="none" aria-hidden="true">
							<circle cx="3" cy="7" r="2" stroke="var(--orch-1)" strokeWidth="1.2" />
							<circle cx="11" cy="7" r="2" stroke="var(--orch-1)" strokeWidth="1.2" />
							<circle cx="7" cy="7" r="1.1" fill="var(--orch-1)" />
							<path d="M5 7h.6M8.4 7H9" stroke="var(--orch-1)" strokeWidth="1.1" />
						</svg>
					</span>
					<span className="block text-[12.5px] font-semibold text-[var(--text)]">
						Coordinate across repos
					</span>
					<span className="mt-[3px] block text-[11px] leading-snug text-[var(--text-tertiary)]">
						One agent that dispatches and tracks work across backend, frontend, and more.
					</span>
					<span className="mt-[11px] inline-flex h-[28px] items-center gap-[6px] rounded-[8px] bg-[var(--accent)] px-[13px] text-[12px] font-semibold text-[var(--accent-foreground)]">
						<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
							<path
								d="M6 1.5v9M1.5 6h9"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						New orchestrator
					</span>
				</button>
			) : (
				<div className="mt-1 px-1">
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
			)}
		</div>
	);
}
