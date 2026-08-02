import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { normalizeBranchNameInput } from "../utils/branch-name";
import { filterAndSortBranches } from "../utils/branch-search";
import { flattenWorkspaceTree } from "../utils/workspace-tree";

const FOCUSABLE_SELECTOR = [
	'button:not([disabled]):not([tabindex="-1"])',
	'input:not([disabled]):not([tabindex="-1"])',
	'select:not([disabled]):not([tabindex="-1"])',
	'textarea:not([disabled]):not([tabindex="-1"])',
	'[href]:not([tabindex="-1"])',
	'[tabindex]:not([tabindex="-1"])',
].join(",");

// These custom roles support searchable comboboxes, which cannot use a native select element.
const LISTBOX_ROLE = { role: "listbox" as const };
const OPTION_ROLE = { role: "option" as const };

export function CreateWorktreeModal() {
	const {
		isCreateWorktreeModalOpen,
		createWorktreeProjectId,
		createWorktreeAsOrchestrator,
		closeCreateWorktreeModal,
	} = useProjectStore();

	const [mode, setMode] = useState<"new" | "existing">("new");
	const [branchName, setBranchName] = useState("");
	const [baseBranch, setBaseBranch] = useState("");
	const [selectedBranch, setSelectedBranch] = useState("");
	const [branchSearch, setBranchSearch] = useState("");
	const [baseBranchSearch, setBaseBranchSearch] = useState("");
	const [baseBranchDropdownOpen, setBaseBranchDropdownOpen] = useState(false);
	const [baseBranchActiveIndex, setBaseBranchActiveIndex] = useState(-1);
	const [existingBranchActiveIndex, setExistingBranchActiveIndex] = useState(-1);
	const [asOrchestrator, setAsOrchestrator] = useState(false);
	const [attachIds, setAttachIds] = useState<Set<string>>(new Set());
	const baseBranchInitialized = useRef(false);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const branchNameInputRef = useRef<HTMLInputElement>(null);
	const baseBranchInputRef = useRef<HTMLInputElement>(null);
	const baseBranchListRef = useRef<HTMLDivElement>(null);
	const existingBranchInputRef = useRef<HTMLInputElement>(null);
	const existingBranchListRef = useRef<HTMLDivElement>(null);
	const newModeTabRef = useRef<HTMLButtonElement>(null);
	const existingModeTabRef = useRef<HTMLButtonElement>(null);
	const openerRef = useRef<HTMLElement | null>(null);
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

	const onSuccess = (workspace: { id: string; name: string; baseBranch?: string | null }) => {
		utils.workspaces.listByProject.invalidate();

		const repoPath = projectQuery.data?.repoPath;
		const projectName = projectQuery.data?.name ?? "Project";

		if (repoPath) {
			const normalizedPath = repoPath.replace(/\/+$/, "");
			const cwd = `${normalizedPath}-worktrees/${workspace.name}`;
			const title = `${projectName}: ${workspace.name}`;

			const store = useTabStore.getState();
			store.setActiveWorkspace(workspace.id, cwd);
			if (workspace.baseBranch) {
				store.setBaseBranch(workspace.id, workspace.baseBranch);
			}
			const tabId = store.addTerminalTab(workspace.id, cwd, title);

			attachTerminal.mutate({
				workspaceId: workspace.id,
				terminalId: tabId,
			});
		}

		closeCreateWorktreeModal();
	};

	const createMutation = trpc.workspaces.create.useMutation({ onSuccess });

	const createOrchestratorMutation = trpc.workspaces.createOrchestrator.useMutation({
		onSuccess,
	});

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
			setBaseBranchActiveIndex(-1);
			setExistingBranchActiveIndex(-1);
			setAsOrchestrator(false);
			setAttachIds(new Set());
			baseBranchInitialized.current = false;
			createMutation.reset();
			createOrchestratorMutation.reset();
			checkoutMutation.reset();
		}
	}, [
		isCreateWorktreeModalOpen,
		createMutation.reset,
		createOrchestratorMutation.reset,
		checkoutMutation.reset,
	]);

	// Sync orchestrator-mode flag from store (when caller opens modal with asOrchestrator: true)
	useEffect(() => {
		if (isCreateWorktreeModalOpen) {
			setAsOrchestrator(createWorktreeAsOrchestrator);
			if (createWorktreeAsOrchestrator) setMode("new");
		}
	}, [isCreateWorktreeModalOpen, createWorktreeAsOrchestrator]);

	// Move focus into the modal when it opens, then return it to the opener on close.
	useEffect(() => {
		if (!isCreateWorktreeModalOpen) return;

		const activeElement = document.activeElement;
		openerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
		const focusFrame = requestAnimationFrame(() => branchNameInputRef.current?.focus());

		return () => {
			cancelAnimationFrame(focusFrame);
			const opener = openerRef.current;
			openerRef.current = null;
			if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
		};
	}, [isCreateWorktreeModalOpen]);

	// Keep keyboard focus in the modal. Escape closes a picker first, then the modal.
	useEffect(() => {
		if (!isCreateWorktreeModalOpen) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (!isTopmostModal()) return;
			if (e.key === "Tab") {
				trapDialogFocus(e);
				return;
			}
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();

			if (baseBranchDropdownOpen) {
				setBaseBranchDropdownOpen(false);
				setBaseBranchSearch(baseBranch);
				setBaseBranchActiveIndex(-1);
				baseBranchInputRef.current?.focus();
				return;
			}

			closeCreateWorktreeModal();
		};

		document.addEventListener("keydown", handleKeyDown, true);
		return () => document.removeEventListener("keydown", handleKeyDown, true);
	}, [isCreateWorktreeModalOpen, baseBranchDropdownOpen, baseBranch, closeCreateWorktreeModal]);

	// Extract branch names from the detailed branch info
	const branchNames = (branchesQuery.data ?? []).map((b) => b.name);

	// Branches that already have worktrees
	const workspacesTree = workspacesQuery.data;
	const workspacesList = workspacesTree ? flattenWorkspaceTree(workspacesTree) : [];
	const existingWorktreeBranches = new Set(workspacesList.map((ws) => ws.name).filter(Boolean));

	// Loose worktrees that can be attached at orchestrator creation time
	const looseWorkspaces = workspacesTree?.loose ?? [];

	// Available branches for checkout (remote branches minus those already checked out)
	const availableBranches = branchNames.filter((branch) => !existingWorktreeBranches.has(branch));

	const filteredBranches = filterAndSortBranches(
		availableBranches,
		branchSearch,
		(branch) => branch
	);

	const filteredBaseBranches = filterAndSortBranches(
		branchNames,
		baseBranchSearch,
		(branch) => branch
	);

	useEffect(() => {
		if (!baseBranchDropdownOpen || filteredBaseBranches.length === 0) {
			setBaseBranchActiveIndex(-1);
			return;
		}
		setBaseBranchActiveIndex((current) =>
			current < 0 ? 0 : Math.min(current, filteredBaseBranches.length - 1)
		);
	}, [baseBranchDropdownOpen, filteredBaseBranches.length]);

	useEffect(() => {
		if (mode !== "existing" || filteredBranches.length === 0) {
			setExistingBranchActiveIndex(-1);
			return;
		}
		setExistingBranchActiveIndex((current) =>
			current < 0 ? 0 : Math.min(current, filteredBranches.length - 1)
		);
	}, [mode, filteredBranches.length]);

	useEffect(() => {
		if (!baseBranchDropdownOpen || baseBranchActiveIndex < 0) return;
		baseBranchListRef.current
			?.querySelector(`[data-branch-index="${baseBranchActiveIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [baseBranchDropdownOpen, baseBranchActiveIndex]);

	useEffect(() => {
		if (mode !== "existing" || existingBranchActiveIndex < 0) return;
		existingBranchListRef.current
			?.querySelector(`[data-branch-index="${existingBranchActiveIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [mode, existingBranchActiveIndex]);

	if (!isCreateWorktreeModalOpen) return null;

	function toggleAttach(id: string) {
		setAttachIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function changeMode(nextMode: "new" | "existing") {
		setMode(nextMode);
		setBaseBranchDropdownOpen(false);
		setBaseBranchSearch(baseBranch);
		setBaseBranchActiveIndex(-1);
		if (nextMode === "existing") {
			const selectedIndex = filteredBranches.indexOf(selectedBranch);
			setExistingBranchActiveIndex(filteredBranches.length === 0 ? -1 : Math.max(0, selectedIndex));
		}
	}

	function handleModeKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
		let nextMode: "new" | "existing" | null = null;
		if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
			nextMode = mode === "new" ? "existing" : "new";
		} else if (e.key === "Home") {
			nextMode = "new";
		} else if (e.key === "End") {
			nextMode = "existing";
		}

		if (!nextMode) return;
		e.preventDefault();
		e.stopPropagation();
		changeMode(nextMode);
		requestAnimationFrame(() => {
			if (nextMode === "new") newModeTabRef.current?.focus();
			else existingModeTabRef.current?.focus();
		});
	}

	function selectBaseBranch(branch: string) {
		setBaseBranch(branch);
		setBaseBranchSearch(branch);
		setBaseBranchDropdownOpen(false);
		setBaseBranchActiveIndex(-1);
	}

	function openBaseBranchPicker() {
		setBaseBranchSearch("");
		setBaseBranchDropdownOpen(true);
		const selectedIndex = branchNames.indexOf(baseBranch);
		setBaseBranchActiveIndex(branchNames.length === 0 ? -1 : Math.max(0, selectedIndex));
	}

	function handleBaseBranchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			if (!baseBranchDropdownOpen) {
				openBaseBranchPicker();
				return;
			}
			setBaseBranchDropdownOpen(true);
			setBaseBranchActiveIndex((current) => {
				if (filteredBaseBranches.length === 0) return -1;
				if (e.key === "ArrowDown") {
					return current < 0 ? 0 : Math.min(current + 1, filteredBaseBranches.length - 1);
				}
				return current < 0 ? filteredBaseBranches.length - 1 : Math.max(current - 1, 0);
			});
			return;
		}

		if (e.key === "Enter" && baseBranchDropdownOpen) {
			e.preventDefault();
			e.stopPropagation();
			const branch = filteredBaseBranches[baseBranchActiveIndex];
			if (branch) selectBaseBranch(branch);
			return;
		}

		if (e.key === "Tab" && baseBranchDropdownOpen) {
			setBaseBranchDropdownOpen(false);
			setBaseBranchSearch(baseBranch);
			setBaseBranchActiveIndex(-1);
		}
	}

	function selectExistingBranch(branch: string) {
		setSelectedBranch(branch);
		setBranchSearch(branch);
		setExistingBranchActiveIndex(0);
	}

	function handleExistingBranchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			setExistingBranchActiveIndex((current) => {
				if (filteredBranches.length === 0) return -1;
				if (e.key === "ArrowDown") {
					return current < 0 ? 0 : Math.min(current + 1, filteredBranches.length - 1);
				}
				return current < 0 ? filteredBranches.length - 1 : Math.max(current - 1, 0);
			});
			return;
		}

		if (e.key === "Enter") {
			const branch = filteredBranches[existingBranchActiveIndex];
			if (!branch) return;
			e.preventDefault();
			e.stopPropagation();
			selectExistingBranch(branch);
		}
	}

	function trapDialogFocus(e: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">) {
		if (e.key !== "Tab") return;

		const dialog = dialogRef.current;
		if (!dialog) return;
		const focusableElements = Array.from(
			dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
		).filter((element) => element.getClientRects().length > 0);
		if (focusableElements.length === 0) return;

		const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
		if (currentIndex === -1) {
			e.preventDefault();
			const target = e.shiftKey ? focusableElements.at(-1) : focusableElements[0];
			target?.focus();
			return;
		}

		if (e.shiftKey && currentIndex === 0) {
			e.preventDefault();
			focusableElements.at(-1)?.focus();
		} else if (!e.shiftKey && currentIndex === focusableElements.length - 1) {
			e.preventDefault();
			focusableElements[0]?.focus();
		}
	}

	function isTopmostModal() {
		const modalRoot = dialogRef.current?.closest<HTMLElement>("[data-app-modal-root]");
		if (!modalRoot) return true;
		const openModals = Array.from(
			document.querySelectorAll<HTMLElement>("[data-app-modal-root]")
		).filter((modal) => modal.getClientRects().length > 0);
		return openModals.at(-1) === modalRoot;
	}

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		if (mode === "new") {
			if (!branchName.trim() || !projectId) return;
			if (asOrchestrator) {
				createOrchestratorMutation.mutate({
					projectId,
					name: branchName.trim(),
					baseBranch: baseBranch || projectQuery.data?.defaultBranch || "main",
					attachWorkspaceIds: Array.from(attachIds),
				});
			} else {
				createMutation.mutate({
					projectId,
					branch: branchName.trim(),
					baseBranch: baseBranch || undefined,
				});
			}
		} else {
			if (!selectedBranch || !projectId) return;
			checkoutMutation.mutate({
				projectId,
				branch: selectedBranch,
			});
		}
	};

	const activeNewMutation = asOrchestrator ? createOrchestratorMutation : createMutation;
	const isPending = mode === "new" ? activeNewMutation.isPending : checkoutMutation.isPending;
	const isError = mode === "new" ? activeNewMutation.isError : checkoutMutation.isError;
	const errorMessage =
		mode === "new" ? activeNewMutation.error?.message : checkoutMutation.error?.message;

	const isSubmitDisabled = isPending || (mode === "new" ? !branchName.trim() : !selectedBranch);

	return (
		<div
			data-app-modal-root=""
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) closeCreateWorktreeModal();
			}}
			onKeyDown={trapDialogFocus}
			role="presentation"
		>
			<dialog
				ref={dialogRef}
				open
				aria-modal="true"
				aria-labelledby="create-worktree-title"
				tabIndex={-1}
				className="relative m-0 w-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text)] shadow-[var(--shadow-md)]"
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<h2 id="create-worktree-title" className="text-[15px] font-semibold text-[var(--text)]">
						{asOrchestrator ? "New Orchestrator" : "New Worktree"}
					</h2>
					<button
						type="button"
						onClick={closeCreateWorktreeModal}
						aria-label={`Close ${asOrchestrator ? "new orchestrator" : "new worktree"} dialog`}
						className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
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
					{/* Mode toggle — hidden when creating an orchestrator (always a new branch) */}
					{!asOrchestrator && (
						<div
							role="tablist"
							aria-label="Worktree branch mode"
							className="flex rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5"
						>
							<button
								ref={newModeTabRef}
								id="worktree-new-tab"
								type="button"
								role="tab"
								aria-selected={mode === "new"}
								aria-controls="worktree-new-panel"
								tabIndex={mode === "new" ? 0 : -1}
								onClick={() => changeMode("new")}
								onKeyDown={handleModeKeyDown}
								className="flex-1 rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
								style={{
									background: mode === "new" ? "var(--bg-overlay)" : "transparent",
									color: mode === "new" ? "var(--text)" : "var(--text-tertiary)",
								}}
							>
								New branch
							</button>
							<button
								ref={existingModeTabRef}
								id="worktree-existing-tab"
								type="button"
								role="tab"
								aria-selected={mode === "existing"}
								aria-controls="worktree-existing-panel"
								tabIndex={mode === "existing" ? 0 : -1}
								onClick={() => changeMode("existing")}
								onKeyDown={handleModeKeyDown}
								className="flex-1 rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
								style={{
									background: mode === "existing" ? "var(--bg-overlay)" : "transparent",
									color: mode === "existing" ? "var(--text)" : "var(--text-tertiary)",
								}}
							>
								Existing branch
							</button>
						</div>
					)}

					{mode === "new" && (
						<div
							id="worktree-new-panel"
							role={!asOrchestrator ? "tabpanel" : undefined}
							aria-labelledby={!asOrchestrator ? "worktree-new-tab" : undefined}
							className="contents"
						>
							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="worktree-branch"
									className="text-[13px] font-medium text-[var(--text-secondary)]"
								>
									Branch Name
								</label>
								<input
									ref={branchNameInputRef}
									id="worktree-branch"
									type="text"
									value={branchName}
									onChange={(e) => setBranchName(normalizeBranchNameInput(e.target.value))}
									placeholder="feature-branch-name"
									className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
								/>
								{branchNames.includes(branchName.trim()) && (
									<span className="text-[12px] text-[var(--color-warning)]">
										This branch already exists and will be checked out as-is. The base branch will
										not apply.
									</span>
								)}
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
										ref={baseBranchInputRef}
										id="worktree-base"
										type="text"
										role="combobox"
										aria-autocomplete="list"
										aria-expanded={baseBranchDropdownOpen}
										aria-controls="worktree-base-listbox"
										aria-activedescendant={
											baseBranchDropdownOpen && baseBranchActiveIndex >= 0
												? `worktree-base-option-${baseBranchActiveIndex}`
												: undefined
										}
										value={baseBranchSearch}
										onChange={(e) => {
											setBaseBranchSearch(e.target.value);
											setBaseBranchDropdownOpen(true);
											setBaseBranchActiveIndex(0);
										}}
										onFocus={openBaseBranchPicker}
										onClick={() => {
											if (!baseBranchDropdownOpen) openBaseBranchPicker();
										}}
										onKeyDown={handleBaseBranchKeyDown}
										placeholder="Search branches..."
										className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
									/>
									{baseBranchDropdownOpen && (
										<>
											<div
												className="fixed inset-0 z-10"
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => {
													setBaseBranchDropdownOpen(false);
													setBaseBranchSearch(baseBranch);
													setBaseBranchActiveIndex(-1);
												}}
												onKeyDown={() => {}}
												role="presentation"
											/>
											<div
												{...LISTBOX_ROLE}
												ref={baseBranchListRef}
												id="worktree-base-listbox"
												aria-label="Base branches"
												tabIndex={-1}
												className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[180px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)]"
											>
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
												{filteredBaseBranches.map((branch, index) => (
													<button
														{...OPTION_ROLE}
														key={branch}
														id={`worktree-base-option-${index}`}
														type="button"
														aria-selected={baseBranch === branch}
														tabIndex={-1}
														data-branch-index={index}
														onMouseDown={(e) => e.preventDefault()}
														onMouseEnter={() => setBaseBranchActiveIndex(index)}
														onClick={() => selectBaseBranch(branch)}
														className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
														style={{
															color: baseBranch === branch ? "var(--accent)" : "var(--text)",
															background:
																baseBranchActiveIndex === index || baseBranch === branch
																	? "var(--bg-overlay)"
																	: "transparent",
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
										className="self-start rounded-[2px] text-[12px] text-[var(--accent)] transition-opacity duration-[120ms] hover:opacity-80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
									>
										{updateProjectMutation.isPending ? "Saving..." : "Set as default"}
									</button>
								)}
							</div>
						</div>
					)}

					{mode === "new" && (
						<div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
							<label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
								<input
									type="checkbox"
									checked={asOrchestrator}
									onChange={(e) => setAsOrchestrator(e.target.checked)}
									className="mt-[3px]"
								/>
								<span className="flex-1">
									<span className="font-medium">Create as orchestrator</span>
									<span className="block text-[11px] text-[var(--text-tertiary)] leading-snug">
										Lets this workspace coordinate other worktrees in this project.
									</span>
								</span>
							</label>

							{asOrchestrator && (
								<div className="mt-1 flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-2">
									<div className="text-[12px] font-medium text-[var(--text-secondary)]">
										Attach existing worktrees (optional)
									</div>
									{looseWorkspaces.length === 0 ? (
										<div className="text-[11px] text-[var(--text-tertiary)]">
											No loose worktrees in this project.
										</div>
									) : (
										<div className="max-h-[140px] overflow-y-auto">
											{looseWorkspaces.map((w) => (
												<label
													key={w.id}
													className="flex items-center gap-2 py-[3px] text-[12px] text-[var(--text)]"
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
							)}
						</div>
					)}

					{mode === "existing" && (
						<div
							id="worktree-existing-panel"
							role="tabpanel"
							aria-labelledby="worktree-existing-tab"
							className="flex flex-col gap-1.5"
						>
							<label
								htmlFor="worktree-existing-search"
								className="text-[13px] font-medium text-[var(--text-secondary)]"
							>
								Branch
							</label>
							<input
								ref={existingBranchInputRef}
								id="worktree-existing-search"
								type="text"
								role="combobox"
								aria-autocomplete="list"
								aria-expanded={filteredBranches.length > 0}
								aria-controls="worktree-existing-listbox"
								aria-activedescendant={
									existingBranchActiveIndex >= 0
										? `worktree-existing-option-${existingBranchActiveIndex}`
										: undefined
								}
								value={branchSearch}
								onChange={(e) => {
									setBranchSearch(e.target.value);
									setSelectedBranch("");
									setExistingBranchActiveIndex(0);
								}}
								onKeyDown={handleExistingBranchKeyDown}
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
								<div
									{...LISTBOX_ROLE}
									ref={existingBranchListRef}
									id="worktree-existing-listbox"
									aria-label="Existing branches"
									tabIndex={-1}
									className="max-h-[180px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)]"
								>
									{filteredBranches.map((branch, index) => (
										<button
											{...OPTION_ROLE}
											key={branch}
											id={`worktree-existing-option-${index}`}
											type="button"
											aria-selected={selectedBranch === branch}
											tabIndex={-1}
											data-branch-index={index}
											onMouseDown={(e) => e.preventDefault()}
											onMouseEnter={() => setExistingBranchActiveIndex(index)}
											onClick={() => selectExistingBranch(branch)}
											className="w-full px-3 py-2 text-left text-[13px] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
											style={{
												color: selectedBranch === branch ? "var(--accent)" : "var(--text)",
												background:
													existingBranchActiveIndex === index || selectedBranch === branch
														? "var(--bg-overlay)"
														: "transparent",
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
						className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-[var(--accent-foreground)] transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-hover)]"
					>
						{isPending
							? mode === "new"
								? "Creating..."
								: "Checking out..."
							: mode === "new"
								? asOrchestrator
									? "Create Orchestrator"
									: "Create Worktree"
								: "Checkout Branch"}
					</button>

					{isError && <p className="text-[13px] text-[var(--term-red)]">{errorMessage}</p>}
				</form>
			</dialog>
		</div>
	);
}
