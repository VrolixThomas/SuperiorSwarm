import { useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

export function AddRepositoryOpenTab() {
	const [error, setError] = useState<string | null>(null);
	const [failedPath, setFailedPath] = useState<string | null>(null);
	const utils = trpc.useUtils();
	const { closeAddModal } = useProjectStore();

	const openMutation = trpc.projects.openNew.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
			closeAddModal();
		},
		onError: (err, variables) => {
			setError(err.message);
			if (err.message.includes("Not a git repository")) {
				setFailedPath(variables.path);
			}
		},
	});

	const openFolderMutation = trpc.projects.openFolder.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
			closeAddModal();
		},
		onError: (err) => setError(err.message),
	});

	const handleBrowse = async () => {
		setError(null);
		setFailedPath(null);
		const paths = await window.electron.dialog.openDirectory();
		if (paths && paths.length > 0) {
			for (const path of paths) {
				openMutation.mutate({ path });
			}
		}
	};

	return (
		<div className="flex flex-col gap-4 p-4">
			<p className="text-[13px] text-[var(--text-secondary)]">
				Select an existing git repository folder
			</p>

			<button
				type="button"
				onClick={handleBrowse}
				disabled={openMutation.isPending}
				className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-[var(--accent-foreground)] transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
			>
				{openMutation.isPending ? "Opening..." : "Browse..."}
			</button>

			{error && <p className="text-[13px] text-[var(--term-red)]">{error}</p>}
			{failedPath && (
				<button
					type="button"
					onClick={() => openFolderMutation.mutate({ path: failedPath, force: true })}
					disabled={openFolderMutation.isPending}
					className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] disabled:opacity-50"
				>
					{openFolderMutation.isPending ? "Opening..." : "Open as folder instead"}
				</button>
			)}
		</div>
	);
}
