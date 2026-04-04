import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export function CreateWorktreeModal() {
	const { isCreateWorktreeModalOpen, createWorktreeProjectId, closeCreateWorktreeModal } =
		useProjectStore();

	const [mode, setMode] = useState<"new" | "existing">("new");
	const [branchName, setBranchName] = useState("");
	const [baseBranch, setBaseBranch] = useState("");
	const [selectedBranch, setSelectedBranch] = useState("");
	const [branchSearch, setBranchSearch] = useState("");
	const [baseBranchSearch, setBaseBranchSearch] = useState("");
	const [baseBranchDropdownOpen, setBaseBranchDropdownOpen] = useState(false);
	const baseBranchInitialized = useRef(false);
	const utils = trpc.useUtils();

	const projectId = createWorktreeProjectId ?? "";

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: projectId },
		{ enabled: isCreateWorktreeModalOpen && projectId !== "" }
	);

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId },
		{ enabled: isCreateWorktreeModalOpen && projectId !== "" }
	);

	const workspacesQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId },
		{ enabled: isCreateWorktreeModalOpen && projectId !== "" }
	);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const onSuccess = (workspace: { id: string; name: string }) => {
		utils.workspaces.listByProject.invalidate();

		const repoPath = projectQuery.data?.repoPath;
		const projectName = projectQuery.data?.name ?? "Project";

		if (repoPath) {
			const normalizedPath = repoPath.replace(/\/+$/, "");
			const cwd = `${normalizedPath}-worktrees/${workspace.name}`;
			const title = `${projectName}: ${workspace.name}`;

			const store = useTabStore.getState();
			store.setActiveWorkspace(workspace.id, cwd);
			const tabId = store.addTerminalTab(workspace.id, cwd, title);

			attachTerminal.mutate({
				workspaceId: workspace.id,
				terminalId: tabId,
			});
		}

		closeCreateWorktreeModal();
	};

	const createMutation = trpc.workspaces.create.useMutation({ onSuccess });

	const checkoutMutation = trpc.workspaces.checkoutExisting.useMutation({ onSuccess });

	const updateProjectMutation = trpc.projects.update.useMutation({
		onSuccess: () => {
			utils.projects.getById.invalidate({ id: projectId });
			utils.branches.list.invalidate({ projectId });
		},
	});

	// Set default base branch from project's defaultBranch (once on load)
	useEffect(() => {
		if (projectQuery.data && !baseBranchInitialized.current) {
			baseBranchInitialized.current = true;
			setBaseBranch(projectQuery.data.defaultBranch);
			setBaseBranchSearch(projectQuery.data.defaultBranch);
		}
	}, [projectQuery.data]);

	// Reset form state when modal opens/closes
	useEffect(() => {
		if (!isCreateWorktreeModalOpen) {
			setMode("new");
			setBranchName("");
			setBaseBranch("");
			setSelectedBranch("");
			setBranchSearch("");
			setBaseBranchSearch("");
			setBaseBranchDropdownOpen(false);
			baseBranchInitialized.current = false;
			createMutation.reset();
			checkoutMutation.reset();
		}
	}, [isCreateWorktreeModalOpen, createMutation.reset, checkoutMutation.reset]);

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

	// Branches that already have worktrees
	const existingWorktreeBranches = new Set(
		(workspacesQuery.data ?? []).map((ws) => ws.name).filter(Boolean)
	);

	// Available branches for checkout (remote branches minus those already checked out)
	const availableBranches = (branchesQuery.data ?? []).filter(
		(branch) => !existingWorktreeBranches.has(branch)
	);

	const filteredBranches = branchSearch
		? availableBranches.filter((b) => b.toLowerCase().includes(branchSearch.toLowerCase()))
		: availableBranches;

	const filteredBaseBranches = baseBranchSearch
		? (branchesQuery.data ?? []).filter((b) =>
				b.toLowerCase().includes(baseBranchSearch.toLowerCase())
			)
		: (branchesQuery.data ?? []);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		if (mode === "new") {
			if (!branchName.trim() || !projectId) return;
			createMutation.mutate({
				projectId,
				branch: branchName.trim(),
				baseBranch: baseBranch || undefined,
			});
		} else {
			if (!selectedBranch || !projectId) return;
			checkoutMutation.mutate({
				projectId,
				branch: selectedBranch,
			});
		}
	};

	const isPending = mode === "new" ? createMutation.isPending : checkoutMutation.isPending;
	const isError = mode === "new" ? createMutation.isError : checkoutMutation.isError;
	const errorMessage =
		mode === "new" ? createMutation.error?.message : checkoutMutation.error?.message;

	const isSubmitDisabled = isPending || (mode === "new" ? !branchName.trim() : !selectedBranch);

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
					{/* Mode toggle */}
					<div className="flex rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5">
						<button
							type="button"
							onClick={() => setMode("new")}
							className="flex-1 rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-all duration-[120ms]"
							style={{
								background: mode === "new" ? "var(--bg-overlay)" : "transparent",
								color: mode === "new" ? "var(--text)" : "var(--text-tertiary)",
							}}
						>
							New branch
						</button>
						<button
							type="button"
							onClick={() => setMode("existing")}
							className="flex-1 rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-all duration-[120ms]"
							style={{
								background: mode === "existing" ? "var(--bg-overlay)" : "transparent",
								color: mode === "existing" ? "var(--text)" : "var(--text-tertiary)",
							}}
						>
							Existing branch
						</button>
					</div>

					{mode === "new" && (
						<>
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
								<div className="relative">
									<input
										id="worktree-base"
										type="text"
										value={baseBranchSearch}
										onChange={(e) => {
											setBaseBranchSearch(e.target.value);
											setBaseBranch("");
											setBaseBranchDropdownOpen(true);
										}}
										onFocus={() => {
											setBaseBranchSearch("");
											setBaseBranchDropdownOpen(true);
										}}
										placeholder="Search branches..."
										className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
									/>
									{baseBranchDropdownOpen && (
										<>
											<div
												className="fixed inset-0 z-10"
												onClick={() => {
													setBaseBranchDropdownOpen(false);
													setBaseBranchSearch(baseBranch);
												}}
												onKeyDown={() => {}}
												role="presentation"
											/>
											<div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[180px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)]">
												{branchesQuery.isPending && (
													<p className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">
														Loading branches...
													</p>
												)}
												{!branchesQuery.isPending && filteredBaseBranches.length === 0 && (
													<p className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">
														No branches found
													</p>
												)}
												{filteredBaseBranches.map((branch) => (
													<button
														key={branch}
														type="button"
														onClick={() => {
															setBaseBranch(branch);
															setBaseBranchSearch(branch);
															setBaseBranchDropdownOpen(false);
														}}
														className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
														style={{
															color: baseBranch === branch ? "var(--accent)" : "var(--text)",
															background:
																baseBranch === branch ? "var(--bg-overlay)" : "transparent",
														}}
													>
														{branch}
														{branch === projectQuery.data?.defaultBranch && (
															<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 py-0.5 text-[11px] text-[var(--text-quaternary)]">
																default
															</span>
														)}
													</button>
												))}
											</div>
										</>
									)}
								</div>
								{baseBranch && baseBranch !== projectQuery.data?.defaultBranch && (
									<button
										type="button"
										disabled={updateProjectMutation.isPending}
										onClick={() => {
											updateProjectMutation.mutate({
												id: projectId,
												defaultBranch: baseBranch,
											});
										}}
										className="self-start text-[12px] text-[var(--accent)] transition-opacity duration-[120ms] hover:opacity-80 disabled:opacity-50"
									>
										{updateProjectMutation.isPending ? "Saving..." : "Set as default"}
									</button>
								)}
							</div>
						</>
					)}

					{mode === "existing" && (
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="worktree-existing-search"
								className="text-[13px] font-medium text-[var(--text-secondary)]"
							>
								Branch
							</label>
							<input
								id="worktree-existing-search"
								type="text"
								value={branchSearch}
								onChange={(e) => {
									setBranchSearch(e.target.value);
									setSelectedBranch("");
								}}
								placeholder="Search branches..."
								className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
							/>
							{(branchesQuery.isPending || workspacesQuery.isPending) && (
								<p className="text-[12px] text-[var(--text-tertiary)]">Loading branches...</p>
							)}
							{!branchesQuery.isPending &&
								!workspacesQuery.isPending &&
								filteredBranches.length === 0 && (
									<p className="text-[12px] text-[var(--text-tertiary)]">No branches available</p>
								)}
							{filteredBranches.length > 0 && (
								<div className="max-h-[180px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)]">
									{filteredBranches.map((branch) => (
										<button
											key={branch}
											type="button"
											onClick={() => {
												setSelectedBranch(branch);
												setBranchSearch(branch);
											}}
											className="w-full px-3 py-2 text-left text-[13px] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
											style={{
												color: selectedBranch === branch ? "var(--accent)" : "var(--text)",
												background: selectedBranch === branch ? "var(--bg-overlay)" : "transparent",
											}}
										>
											{branch}
										</button>
									))}
								</div>
							)}
						</div>
					)}

					<button
						type="submit"
						disabled={isSubmitDisabled}
						className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{isPending
							? mode === "new"
								? "Creating..."
								: "Checking out..."
							: mode === "new"
								? "Create Worktree"
								: "Checkout Branch"}
					</button>

					{isError && <p className="text-[13px] text-[var(--term-red)]">{errorMessage}</p>}
				</form>
			</div>
		</div>
	);
}
