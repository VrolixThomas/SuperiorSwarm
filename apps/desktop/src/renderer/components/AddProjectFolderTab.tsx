import { useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

export function AddProjectFolderTab() {
	const [error, setError] = useState<string | null>(null);
	const [gitRepoPath, setGitRepoPath] = useState<string | null>(null);
	const utils = trpc.useUtils();
	const { closeAddModal } = useProjectStore();

	const openFolderMutation = trpc.projects.openFolder.useMutation();
	const openRepoMutation = trpc.projects.openNew.useMutation();

	const finish = () => {
		utils.projects.list.invalidate();
		closeAddModal();
	};

	const handleBrowse = async () => {
		setError(null);
		setGitRepoPath(null);
		const paths = await window.electron.dialog.openDirectory();
		if (!paths || paths.length === 0) return;
		try {
			for (const path of paths) {
				const res = await openFolderMutation.mutateAsync({ path });
				if (res.isGitRepo) {
					setGitRepoPath(path);
					return;
				}
			}
			finish();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleOpenAsRepo = async () => {
		if (!gitRepoPath) return;
		try {
			await openRepoMutation.mutateAsync({ path: gitRepoPath });
			finish();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleOpenAsFolder = async () => {
		if (!gitRepoPath) return;
		try {
			await openFolderMutation.mutateAsync({ path: gitRepoPath, force: true });
			finish();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const isPending = openFolderMutation.isPending || openRepoMutation.isPending;

	return (
		<div className="flex flex-col gap-4 p-4">
			<p className="text-[13px] text-[var(--text-secondary)]">
				Open any folder as a project. No git required. Terminals and agents run inside it.
			</p>

			<button
				type="button"
				onClick={handleBrowse}
				disabled={isPending}
				className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-[var(--accent-foreground)] transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
			>
				{isPending ? "Opening..." : "Browse..."}
			</button>

			{gitRepoPath && (
				<div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
					<p className="text-[13px] text-[var(--text-secondary)]">
						This folder is a git repository. Open it as a repository to get worktrees, branches, and
						PR features.
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleOpenAsRepo}
							disabled={isPending}
							className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent-foreground)] transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							Open as Repository
						</button>
						<button
							type="button"
							onClick={handleOpenAsFolder}
							disabled={isPending}
							className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] disabled:opacity-50"
						>
							Open as Folder Anyway
						</button>
					</div>
				</div>
			)}

			{error && <p className="text-[13px] text-[var(--term-red)]">{error}</p>}
		</div>
	);
}
