import { useEffect, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

function CheckboxButton({ checked, onClick }: { checked: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`shrink-0 h-4 w-4 rounded border text-[10px] ${
				checked
					? "border-[var(--accent)] bg-[var(--accent)] text-white"
					: "border-[var(--border)] text-transparent"
			}`}
		>
			&#10003;
		</button>
	);
}

export function SharedFilesPanel() {
	const projectId = useProjectStore((s) => s.sharedFilesProjectId);
	const closePanel = useProjectStore((s) => s.closeSharedFilesPanel);

	const [manualPath, setManualPath] = useState("");
	const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());

	const utils = trpc.useUtils();

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: projectId ?? "" },
		{ enabled: projectId != null }
	);

	const sharedFilesQuery = trpc.sharedFiles.list.useQuery(
		{ projectId: projectId ?? "" },
		{ enabled: projectId != null }
	);

	const candidatesQuery = trpc.sharedFiles.discoverCandidates.useQuery(
		{ projectId: projectId ?? "" },
		{ enabled: projectId != null }
	);

	const addMutation = trpc.sharedFiles.add.useMutation({
		onSuccess: () => {
			utils.sharedFiles.list.invalidate();
			utils.sharedFiles.discoverCandidates.invalidate();
		},
	});

	const removeMutation = trpc.sharedFiles.remove.useMutation({
		onSuccess: () => {
			utils.sharedFiles.list.invalidate();
			utils.sharedFiles.discoverCandidates.invalidate();
		},
	});

	const syncMutation = trpc.sharedFiles.sync.useMutation();

	// Reset state when panel opens/closes
	useEffect(() => {
		setManualPath("");
		setSelectedCandidates(new Set());
	}, [projectId]);

	// Escape key to close
	useEffect(() => {
		if (!projectId) return;
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") closePanel();
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [projectId, closePanel]);

	if (!projectId) return null;

	function toggleCandidate(path: string) {
		setSelectedCandidates((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}

	function handleAddSelected() {
		for (const path of selectedCandidates) {
			addMutation.mutate({ projectId: projectId!, relativePath: path });
		}
		setSelectedCandidates(new Set());
	}

	function handleManualAdd(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = manualPath.trim();
		if (!trimmed || !projectId) return;
		addMutation.mutate({ projectId, relativePath: trimmed });
		setManualPath("");
	}

	function handleSync() {
		if (!projectId) return;
		syncMutation.mutate({ projectId });
	}

	const projectName = projectQuery.data?.name ?? "Project";
	const candidates = candidatesQuery.data ?? [];
	const activeFiles = sharedFilesQuery.data ?? [];

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) closePanel();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="w-[520px] max-h-[80vh] flex flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 shrink-0">
					<h2 className="text-[15px] font-semibold text-[var(--text)]">
						Shared Files
						<span className="ml-2 text-[13px] font-normal text-[var(--text-tertiary)]">
							{projectName}
						</span>
					</h2>
					<button
						type="button"
						onClick={closePanel}
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

				{/* Description */}
				<div className="px-4 pt-3 pb-2 shrink-0">
					<p className="text-[12px] text-[var(--text-tertiary)]">
						These files are symlinked from the main repo to all worktrees. Changes in any location
						are reflected everywhere.
					</p>
				</div>

				{/* Scrollable content */}
				<div className="flex-1 overflow-y-auto px-4">
					{/* Active shared files */}
					{activeFiles.length > 0 && (
						<div className="pb-3">
							<div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] pb-1.5">
								Active ({activeFiles.length})
							</div>
							<div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
								{activeFiles.map((file) => (
									<div
										key={file.id}
										className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b border-[var(--border-subtle)] last:border-b-0"
									>
										<span className="flex-1 truncate font-[var(--font-mono)] text-[var(--text-secondary)]">
											{file.relativePath}
										</span>
										<button
											type="button"
											onClick={() => removeMutation.mutate({ id: file.id })}
											className="shrink-0 rounded p-0.5 text-[var(--text-quaternary)] transition-all duration-[120ms] hover:text-[var(--term-red)]"
											title="Remove from shared files"
										>
											<svg
												aria-hidden="true"
												width="12"
												height="12"
												viewBox="0 0 16 16"
												fill="none"
											>
												<path
													d="M4 4l8 8M12 4l-8 8"
													stroke="currentColor"
													strokeWidth="1.5"
													strokeLinecap="round"
												/>
											</svg>
										</button>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Discovered candidates */}
					{candidates.length > 0 && (
						<div className="pb-3">
							<div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] pb-1.5">
								Discovered
							</div>
							<div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] max-h-48 overflow-y-auto">
								{candidates.map((path) => (
									<div
										key={path}
										className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b border-[var(--border-subtle)] last:border-b-0"
									>
										<CheckboxButton
											checked={selectedCandidates.has(path)}
											onClick={() => toggleCandidate(path)}
										/>
										<span className="flex-1 truncate font-[var(--font-mono)] text-[var(--text-tertiary)]">
											{path}
										</span>
									</div>
								))}
							</div>
							{selectedCandidates.size > 0 && (
								<button
									type="button"
									onClick={handleAddSelected}
									disabled={addMutation.isPending}
									className="mt-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
								>
									Add Selected ({selectedCandidates.size})
								</button>
							)}
						</div>
					)}

					{candidates.length === 0 && !candidatesQuery.isLoading && (
						<div className="pb-3">
							<div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] pb-1.5">
								Discovered
							</div>
							<p className="text-[12px] text-[var(--text-quaternary)]">
								No additional gitignored files found.
							</p>
						</div>
					)}

					{/* Manual add */}
					<div className="pb-3">
						<div className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] pb-1.5">
							Add Manually
						</div>
						<form onSubmit={handleManualAdd} className="flex gap-2">
							<input
								type="text"
								value={manualPath}
								onChange={(e) => setManualPath(e.target.value)}
								placeholder="relative/path/to/file"
								className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[12px] font-[var(--font-mono)] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
							/>
							<button
								type="submit"
								disabled={!manualPath.trim() || addMutation.isPending}
								className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
							>
								Add
							</button>
						</form>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 shrink-0">
					<p className="text-[11px] text-[var(--text-quaternary)]">
						{syncMutation.isSuccess
							? `Synced ${syncMutation.data.synced} worktree${syncMutation.data.synced === 1 ? "" : "s"}`
							: "Symlinks are created on worktree creation"}
					</p>
					<button
						type="button"
						onClick={handleSync}
						disabled={syncMutation.isPending || activeFiles.length === 0}
						className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)] disabled:opacity-50"
					>
						{syncMutation.isPending ? "Syncing..." : "Sync All Worktrees"}
					</button>
				</div>

				{/* Error display */}
				{addMutation.isError && (
					<div className="px-4 pb-3">
						<p className="text-[12px] text-[var(--term-red)]">{addMutation.error.message}</p>
					</div>
				)}
			</div>
		</div>
	);
}
