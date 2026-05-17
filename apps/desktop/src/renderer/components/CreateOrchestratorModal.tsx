import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export function CreateOrchestratorModal() {
	const {
		isCreateOrchestratorModalOpen,
		createOrchestratorProjectId,
		closeCreateOrchestratorModal,
	} = useProjectStore();

	const projectId = createOrchestratorProjectId ?? "";

	const [name, setName] = useState("");
	const [baseBranch, setBaseBranch] = useState("");
	const [attachIds, setAttachIds] = useState<Set<string>>(new Set());
	const [attachSectionOpen, setAttachSectionOpen] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const baseBranchInitialized = useRef(false);
	const utils = trpc.useUtils();

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: projectId },
		{ enabled: isCreateOrchestratorModalOpen && projectId !== "" }
	);

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId },
		{ enabled: isCreateOrchestratorModalOpen && projectId !== "" }
	);

	const treeQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId },
		{ enabled: isCreateOrchestratorModalOpen && projectId !== "" }
	);

	const looseWorkspaces = treeQuery.data?.loose ?? [];

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	useEffect(() => {
		if (!isCreateOrchestratorModalOpen) {
			setName("");
			setBaseBranch("");
			setAttachIds(new Set());
			setAttachSectionOpen(false);
			setErrorMsg(null);
			baseBranchInitialized.current = false;
		}
	}, [isCreateOrchestratorModalOpen]);

	useEffect(() => {
		if (projectQuery.data && !baseBranchInitialized.current) {
			baseBranchInitialized.current = true;
			setBaseBranch(projectQuery.data.defaultBranch);
		}
	}, [projectQuery.data]);

	useEffect(() => {
		if (looseWorkspaces.length > 0) setAttachSectionOpen(true);
	}, [looseWorkspaces.length]);

	const createMutation = trpc.workspaces.createOrchestrator.useMutation({
		onSuccess: (workspace) => {
			utils.workspaces.listByProject.invalidate({ projectId });
			const repoPath = projectQuery.data?.repoPath;
			const projectName = projectQuery.data?.name ?? "Project";
			if (repoPath) {
				const normalizedPath = repoPath.replace(/\/+$/, "");
				const cwd = `${normalizedPath}-worktrees/${workspace.name}`;
				const title = `${projectName}: ${workspace.name}`;
				const store = useTabStore.getState();
				store.setActiveWorkspace(workspace.id, cwd);
				const tabId = store.addTerminalTab(workspace.id, cwd, title);
				attachTerminal.mutate({ workspaceId: workspace.id, terminalId: tabId });
			}
			closeCreateOrchestratorModal();
		},
		onError: (err) => setErrorMsg(err.message),
	});

	if (!isCreateOrchestratorModalOpen) return null;

	const canSubmit = name.trim().length > 0 && baseBranch.trim().length > 0;

	function toggleAttach(id: string) {
		setAttachIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function handleSubmit() {
		setErrorMsg(null);
		createMutation.mutate({
			projectId,
			name: name.trim(),
			baseBranch: baseBranch.trim(),
			attachWorkspaceIds: Array.from(attachIds),
		});
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-[440px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-md)]">
				<h2 className="mb-3 text-[14px] font-medium text-[var(--text)]">
					New orchestrator
				</h2>

				<label className="block text-[12px] text-[var(--text-secondary)]">
					Name
					<input
						className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[13px] text-[var(--text)]"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="auth-orch"
						autoFocus
					/>
				</label>

				<label className="mt-3 block text-[12px] text-[var(--text-secondary)]">
					Base branch
					<input
						className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[13px] text-[var(--text)]"
						value={baseBranch}
						onChange={(e) => setBaseBranch(e.target.value)}
						list="orchestrator-base-branch-list"
					/>
					<datalist id="orchestrator-base-branch-list">
						{(branchesQuery.data ?? []).map((b) => (
							<option key={b.name} value={b.name} />
						))}
					</datalist>
				</label>

				<div className="mt-3">
					<button
						type="button"
						onClick={() => setAttachSectionOpen((v) => !v)}
						className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)]"
					>
						<span>{attachSectionOpen ? "▾" : "▸"}</span>
						<span>Attach existing worktrees (optional)</span>
					</button>
					{attachSectionOpen && (
						<div className="mt-2 max-h-[160px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
							{looseWorkspaces.length === 0 && (
								<div className="text-[11px] text-[var(--text-tertiary)]">
									No loose worktrees available.
								</div>
							)}
							{looseWorkspaces.map((w) => (
								<label
									key={w.id}
									className="flex items-center gap-2 py-[3px] text-[13px] text-[var(--text)]"
								>
									<input
										type="checkbox"
										checked={attachIds.has(w.id)}
										onChange={() => toggleAttach(w.id)}
									/>
									<span className="truncate">{w.name}</span>
								</label>
							))}
						</div>
					)}
				</div>

				{errorMsg && (
					<div className="mt-3 text-[12px] text-[var(--term-red)]">{errorMsg}</div>
				)}

				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={closeCreateOrchestratorModal}
						className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-3 py-1 text-[13px] text-[var(--text-secondary)]"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={!canSubmit || createMutation.isPending}
						onClick={handleSubmit}
						className="rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[13px] text-[var(--bg-base)] disabled:opacity-50"
					>
						{createMutation.isPending ? "Creating…" : "Create"}
					</button>
				</div>
			</div>
		</div>
	);
}
