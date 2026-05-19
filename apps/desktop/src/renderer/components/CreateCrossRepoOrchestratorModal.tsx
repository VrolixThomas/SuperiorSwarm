import { useState } from "react";
import { trpc } from "../trpc/client";

type AgentKind = "claude" | "codex" | "gemini" | "opencode";

export function CreateCrossRepoOrchestratorModal({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [agentKind, setAgentKind] = useState<AgentKind>("claude");
	const utils = trpc.useUtils();
	const create = trpc.crossRepoOrchestrators.create.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.list.invalidate();
			onClose();
		},
	});

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
						onClick={() => create.mutate({ name: name.trim(), agentKind })}
						disabled={!name.trim() || create.isPending}
						className="px-3 py-1 text-[12px] bg-[var(--accent)] text-white rounded disabled:opacity-50"
					>
						Create
					</button>
				</div>
			</div>
		</div>
	);
}
