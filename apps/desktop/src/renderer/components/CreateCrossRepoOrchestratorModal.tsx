import { useState } from "react";
import { trpc } from "../trpc/client";

type AgentKind = "claude" | "codex" | "gemini" | "opencode";

export function CreateCrossRepoOrchestratorModal({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [agentKind, setAgentKind] = useState<AgentKind>("claude");
	const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
	const [isPending, setIsPending] = useState(false);

	const utils = trpc.useUtils();
	const projects = trpc.projects.list.useQuery();

	const createMut = trpc.crossRepoOrchestrators.create.useMutation();
	const linkMut = trpc.crossRepoOrchestrators.linkProject.useMutation();

	function toggleProject(projectId: string) {
		setSelectedProjectIds((prev) => {
			const next = new Set(prev);
			if (next.has(projectId)) next.delete(projectId);
			else next.add(projectId);
			return next;
		});
	}

	async function handleCreate() {
		const trimmed = name.trim();
		if (!trimmed) return;
		setIsPending(true);
		try {
			const id = await createMut.mutateAsync({ name: trimmed, agentKind });
			if (selectedProjectIds.size > 0) {
				await Promise.all(
					[...selectedProjectIds].map((projectId) => linkMut.mutateAsync({ id, projectId }))
				);
			}
			utils.crossRepoOrchestrators.list.invalidate();
			onClose();
		} catch (err) {
			console.error("[xro] create failed:", err);
			setIsPending(false);
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			onClick={onClose}
			onKeyDown={() => {}}
		>
			<div
				className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border)] p-5 w-[420px]"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				<h3 className="text-[14px] mb-3 text-[var(--text)]">New cross-repo orchestrator</h3>
				<label
					htmlFor="cross-repo-orch-name"
					className="block text-[11px] mb-1 text-[var(--text-secondary)]"
				>
					Name
				</label>
				<input
					id="cross-repo-orch-name"
					className="w-full bg-transparent border border-[var(--border)] rounded px-2 py-1 mb-3 text-[var(--text)]"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<label
					htmlFor="cross-repo-orch-agent"
					className="block text-[11px] mb-1 text-[var(--text-secondary)]"
				>
					Agent
				</label>
				<select
					id="cross-repo-orch-agent"
					value={agentKind}
					onChange={(e) => setAgentKind(e.target.value as AgentKind)}
					className="w-full bg-transparent border border-[var(--border)] rounded px-2 py-1 mb-4 text-[var(--text)]"
				>
					<option value="claude">claude</option>
					<option value="codex">codex</option>
					<option value="gemini">gemini</option>
					<option value="opencode">opencode</option>
				</select>

				{(projects.data ?? []).length > 0 && (
					<>
						<div className="text-[11px] mb-1 text-[var(--text-secondary)]">Repos</div>
						<div className="mb-4 max-h-[140px] overflow-y-auto rounded border border-[var(--border)] divide-y divide-[var(--border-subtle)]">
							{(projects.data ?? []).map((p) => (
								<label
									key={p.id}
									className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-overlay)] text-[12px] text-[var(--text-secondary)]"
								>
									<input
										type="checkbox"
										checked={selectedProjectIds.has(p.id)}
										onChange={() => toggleProject(p.id)}
										className="accent-[var(--accent)]"
									/>
									{p.name}
								</label>
							))}
						</div>
					</>
				)}

				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="px-3 py-1 text-[12px] text-[var(--text-secondary)]"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleCreate}
						disabled={!name.trim() || isPending}
						className="px-3 py-1 text-[12px] bg-[var(--accent)] text-white rounded disabled:opacity-50"
					>
						{isPending ? "Creating…" : "Create"}
					</button>
				</div>
			</div>
		</div>
	);
}
