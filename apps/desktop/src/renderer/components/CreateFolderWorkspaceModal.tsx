import { useCallback, useEffect, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

export function CreateFolderWorkspaceModal() {
	const isOpen = useProjectStore((s) => s.isCreateFolderWorkspaceModalOpen);
	const projectId = useProjectStore((s) => s.createFolderWorkspaceProjectId);
	const close = useProjectStore((s) => s.closeCreateFolderWorkspaceModal);

	const [name, setName] = useState("");
	const [folderPath, setFolderPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const utils = trpc.useUtils();

	const createMutation = trpc.workspaces.createFolderWorkspace.useMutation({
		onSuccess: () => {
			if (projectId) utils.workspaces.listByProject.invalidate({ projectId });
			handleClose();
		},
		onError: (err) => setError(err.message),
	});

	const handleClose = useCallback(() => {
		setName("");
		setFolderPath(null);
		setError(null);
		close();
	}, [close]);

	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") handleClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, handleClose]);

	if (!isOpen || !projectId) return null;

	const handleBrowse = async () => {
		const paths = await window.electron.dialog.openDirectory();
		if (paths?.[0]) setFolderPath(paths[0]);
	};

	const handleCreate = () => {
		setError(null);
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		createMutation.mutate({
			projectId,
			name: name.trim(),
			folderPath: folderPath ?? undefined,
		});
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) handleClose();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="w-[420px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<h2 className="text-[15px] font-semibold text-[var(--text)]">New Workspace</h2>
					<button
						type="button"
						onClick={handleClose}
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

				<div className="flex flex-col gap-3 p-4">
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleCreate();
						}}
						placeholder="Workspace name"
						className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
					/>

					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleBrowse}
							className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
						>
							Subfolder...
						</button>
						<span className="truncate text-[12px] text-[var(--text-quaternary)]">
							{folderPath ?? "Project folder (default)"}
						</span>
					</div>

					{error && <p className="text-[13px] text-[var(--term-red)]">{error}</p>}

					<button
						type="button"
						onClick={handleCreate}
						disabled={createMutation.isPending}
						className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-[var(--accent-foreground)] transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{createMutation.isPending ? "Creating..." : "Create Workspace"}
					</button>
				</div>
			</div>
		</div>
	);
}
