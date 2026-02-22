import { useEffect, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { useTerminalStore } from "../stores/terminal";
import { trpc } from "../trpc/client";

export function CreateWorktreeModal() {
	const { isCreateWorktreeModalOpen, createWorktreeProjectId, closeCreateWorktreeModal } =
		useProjectStore();

	const [branchName, setBranchName] = useState("");
	const [baseBranch, setBaseBranch] = useState("");
	const utils = trpc.useUtils();

	const projectId = createWorktreeProjectId ?? "";

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: projectId },
		{ enabled: isCreateWorktreeModalOpen && projectId !== "" },
	);

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId },
		{ enabled: isCreateWorktreeModalOpen && projectId !== "" },
	);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const createMutation = trpc.workspaces.create.useMutation({
		onSuccess: (workspace) => {
			utils.workspaces.listByProject.invalidate();

			const repoPath = projectQuery.data?.repoPath;
			const projectName = projectQuery.data?.name ?? "Project";

			if (repoPath) {
				const normalizedPath = repoPath.replace(/\/+$/, "");
				const cwd = `${normalizedPath}-worktrees/${workspace.name}`;
				const title = `${projectName}: ${workspace.name}`;

				const store = useTerminalStore.getState();
				const tabId = store.openWorkspace(workspace.id, cwd, title);

				window.electron.terminal.create(tabId, cwd).catch((err: Error) => {
					console.error("Failed to create workspace terminal:", err);
				});

				attachTerminal.mutate({
					workspaceId: workspace.id,
					terminalId: tabId,
				});
			}

			closeCreateWorktreeModal();
		},
	});

	// Set default base branch when branches load
	useEffect(() => {
		if (branchesQuery.data && branchesQuery.data.length > 0 && baseBranch === "") {
			const first = branchesQuery.data[0];
			if (first) {
				setBaseBranch(first);
			}
		}
	}, [branchesQuery.data, baseBranch]);

	// Reset form state when modal opens/closes
	useEffect(() => {
		if (!isCreateWorktreeModalOpen) {
			setBranchName("");
			setBaseBranch("");
			createMutation.reset();
		}
	}, [isCreateWorktreeModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

	// Escape key to close
	useEffect(() => {
		if (!isCreateWorktreeModalOpen) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				closeCreateWorktreeModal();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isCreateWorktreeModalOpen, closeCreateWorktreeModal]);

	if (!isCreateWorktreeModalOpen) return null;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!branchName.trim() || !projectId) return;

		createMutation.mutate({
			projectId,
			branch: branchName.trim(),
			baseBranch: baseBranch || undefined,
		});
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) closeCreateWorktreeModal();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="w-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<h2 className="text-[15px] font-semibold text-[var(--text)]">New Worktree</h2>
					<button
						type="button"
						onClick={closeCreateWorktreeModal}
						className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					>
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Form */}
				<form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="worktree-branch"
							className="text-[13px] font-medium text-[var(--text-secondary)]"
						>
							Branch Name
						</label>
						<input
							id="worktree-branch"
							type="text"
							value={branchName}
							onChange={(e) => setBranchName(e.target.value)}
							placeholder="feature-branch-name"
							autoFocus
							className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="worktree-base"
							className="text-[13px] font-medium text-[var(--text-secondary)]"
						>
							Base Branch
						</label>
						<select
							id="worktree-base"
							value={baseBranch}
							onChange={(e) => setBaseBranch(e.target.value)}
							disabled={branchesQuery.isPending}
							className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
						>
							{branchesQuery.isPending && <option value="">Loading branches...</option>}
							{branchesQuery.data?.map((branch) => (
								<option key={branch} value={branch}>
									{branch}
								</option>
							))}
						</select>
					</div>

					<button
						type="submit"
						disabled={!branchName.trim() || createMutation.isPending}
						className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{createMutation.isPending ? "Creating..." : "Create Worktree"}
					</button>

					{createMutation.isError && (
						<p className="text-[13px] text-[var(--term-red)]">
							{createMutation.error.message}
						</p>
					)}
				</form>
			</div>
		</div>
	);
}
