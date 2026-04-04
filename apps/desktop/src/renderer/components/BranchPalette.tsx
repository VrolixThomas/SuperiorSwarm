import { useEffect, useMemo, useRef, useState } from "react";
import type { BranchInfo } from "../../shared/branch-types";
import { useBranchStore } from "../stores/branch-store";
import { trpc } from "../trpc/client";
import { BranchRow } from "./BranchRow";

interface Props {
	projectId: string;
	onCheckout: (branch: string) => void;
	onOpenActionMenu: (
		branch: string,
		currentBranch: string,
		position: { x: number; y: number }
	) => void;
}

export function BranchPalette({ projectId, onCheckout, onOpenActionMenu }: Props) {
	const {
		isPaletteOpen,
		searchQuery,
		selectedIndex,
		closePalette,
		setSearchQuery,
		setSelectedIndex,
	} = useBranchStore();

	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [remoteCollapsed, setRemoteCollapsed] = useState(true);
	const [creatingBranch, setCreatingBranch] = useState(false);
	const [newBranchName, setNewBranchName] = useState("");

	const utils = trpc.useUtils();

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId },
		{ enabled: isPaletteOpen, staleTime: 10_000 }
	);

	const statusQuery = trpc.branches.getStatus.useQuery(
		{ projectId },
		{ enabled: isPaletteOpen, staleTime: 10_000 }
	);

	const workspacesQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId },
		{ enabled: isPaletteOpen },
	);

	const createMutation = trpc.branches.create.useMutation({
		onSuccess: () => {
			utils.branches.list.invalidate();
			setCreatingBranch(false);
			setNewBranchName("");
		},
	});
	const fetchMutation = trpc.remote.fetch.useMutation({
		onSuccess: () => utils.branches.list.invalidate(),
	});
	const pushMutation = trpc.remote.push.useMutation();
	const pullMutation = trpc.remote.pull.useMutation();

	const allBranches: BranchInfo[] = useMemo(() => {
		const names = branchesQuery.data ?? [];
		const currentBranch = statusQuery.data?.branch ?? "";
		const wsData = workspacesQuery.data ?? [];

		// Build a set of branch names that have workspaces
		const branchesWithWorkspace = new Set(
			wsData.filter((ws) => ws.worktreePath).map((ws) => ws.name),
		);

		return names.map((name) => ({
			name,
			isLocal: !name.startsWith("remotes/"),
			isRemote: name.startsWith("remotes/"),
			tracking: null,
			lastCommit: null,
			hasWorkspace: branchesWithWorkspace.has(name),
			isDefault: names.indexOf(name) === 0,
			isCurrent: name === currentBranch,
		}));
	}, [branchesQuery.data, statusQuery.data, workspacesQuery.data]);

	// The current branch (pinned at top)
	const currentBranch = useMemo(() => allBranches.find((b) => b.isCurrent) ?? null, [allBranches]);

	// Filter branches by search query, excluding the current branch from the main list
	const filtered = useMemo(() => {
		const q = searchQuery.toLowerCase().trim();
		return allBranches.filter((b) => {
			if (b.isCurrent) return false;
			if (!q) return true;
			return b.name.toLowerCase().includes(q);
		});
	}, [allBranches, searchQuery]);

	const localBranches = useMemo(() => filtered.filter((b) => b.isLocal), [filtered]);
	const remoteBranches = useMemo(
		() => filtered.filter((b) => b.isRemote && !b.isLocal),
		[filtered]
	);

	// Flat list of selectable branches for keyboard navigation (current + local + remote if expanded)
	const navigableBranches = useMemo(() => {
		const list: BranchInfo[] = [];
		if (currentBranch) list.push(currentBranch);
		list.push(...localBranches);
		if (!remoteCollapsed) list.push(...remoteBranches);
		return list;
	}, [currentBranch, localBranches, remoteBranches, remoteCollapsed]);

	// Reset selected index when search/branches change
	useEffect(() => {
		setSelectedIndex(0);
	}, [searchQuery, setSelectedIndex]);

	// Focus input when palette opens
	useEffect(() => {
		if (isPaletteOpen) {
			setRemoteCollapsed(true);
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [isPaletteOpen]);

	// Scroll selected row into view
	useEffect(() => {
		if (!listRef.current) return;
		const selected = listRef.current.querySelector('[aria-selected="true"]');
		selected?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	// Keyboard navigation
	useEffect(() => {
		if (!isPaletteOpen) return;

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				e.preventDefault();
				closePalette();
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIndex(Math.min(selectedIndex + 1, navigableBranches.length - 1));
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIndex(Math.max(selectedIndex - 1, 0));
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				const branch = navigableBranches[selectedIndex];
				if (branch && !branch.isCurrent) {
					onCheckout(branch.name);
					closePalette();
				}
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isPaletteOpen, selectedIndex, navigableBranches, closePalette, setSelectedIndex, onCheckout]);

	if (!isPaletteOpen) return null;

	const status = statusQuery.data;

	return (
		// Backdrop
		<div
			className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
			onClick={closePalette}
		>
			{/* Panel */}
			<div
				className="flex w-[480px] max-h-[70vh] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-active)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)] backdrop-blur-md"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Search bar */}
				<div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--text-tertiary)"
						strokeWidth="2"
						className="shrink-0"
					>
						<circle cx="11" cy="11" r="8" />
						<path d="m21 21-4.35-4.35" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						placeholder="Search branches…"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder-[var(--text-tertiary)] outline-none"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<path d="M18 6 6 18M6 6l12 12" />
							</svg>
						</button>
					)}
				</div>

				{/* Branch list */}
				<div ref={listRef} className="overflow-y-auto p-1.5" role="listbox">
					{branchesQuery.isLoading ? (
						<div className="px-3 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
							Loading branches…
						</div>
					) : (
						<>
							{/* Current branch — pinned */}
							{currentBranch && (
								<div className="mb-1">
									<div className="mb-0.5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-quaternary)]">
										Current
									</div>
									<div className="flex items-center gap-1">
										<div className="flex-1 min-w-0">
											<BranchRow
												branch={currentBranch}
												isSelected={selectedIndex === 0}
												onSelect={() => {
													/* already current */
												}}
												onContextMenu={(e) => {
													e.preventDefault();
													onOpenActionMenu(currentBranch.name, currentBranch.name, {
														x: e.clientX,
														y: e.clientY,
													});
												}}
												onActionClick={(e) =>
													onOpenActionMenu(currentBranch.name, currentBranch.name, {
														x: e.clientX,
														y: e.clientY,
													})
												}
											/>
										</div>
										{/* Ahead/behind badges */}
										{status && (status.ahead > 0 || status.behind > 0) && (
											<div className="flex shrink-0 items-center gap-1 pr-2 text-[11px]">
												{status.ahead > 0 && (
													<span className="flex items-center gap-0.5 text-[var(--text-secondary)]">
														<svg
															width="10"
															height="10"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															strokeWidth="2"
														>
															<path d="M12 19V5M5 12l7-7 7 7" />
														</svg>
														{status.ahead}
													</span>
												)}
												{status.behind > 0 && (
													<span className="flex items-center gap-0.5 text-[var(--text-secondary)]">
														<svg
															width="10"
															height="10"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															strokeWidth="2"
														>
															<path d="M12 5v14M5 12l7 7 7-7" />
														</svg>
														{status.behind}
													</span>
												)}
											</div>
										)}
									</div>
								</div>
							)}

							{/* Quick actions */}
							{!searchQuery && (
								<div className="mb-2 flex flex-wrap gap-1.5 px-2">
									{creatingBranch ? (
										<input
											autoFocus
											value={newBranchName}
											onChange={(e) => setNewBranchName(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && newBranchName) {
													createMutation.mutate({
														projectId,
														name: newBranchName,
														baseBranch: currentBranch?.name ?? "main",
													});
												}
												if (e.key === "Escape") setCreatingBranch(false);
											}}
											placeholder="Branch name..."
											className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
										/>
									) : (
										<>
											<button
												type="button"
												onClick={() => setCreatingBranch(true)}
												className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--bg-overlay)]"
											>
												+ New Branch
											</button>
											<button
												type="button"
												onClick={() => fetchMutation.mutate({ projectId })}
												className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--bg-overlay)]"
											>
												Fetch All
											</button>
											<button
												type="button"
												onClick={() => pushMutation.mutate({ projectId })}
												className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--bg-overlay)]"
											>
												Push
											</button>
											<button
												type="button"
												onClick={() => pullMutation.mutate({ projectId })}
												className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--bg-overlay)]"
											>
												Pull
											</button>
										</>
									)}
								</div>
							)}
							<div className="mx-2 mb-2 h-px bg-[var(--border-subtle)]" />

							{/* Local branches */}
							{localBranches.length > 0 && (
								<div className="mb-1">
									<div className="mb-0.5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-quaternary)]">
										Local
									</div>
									{localBranches.map((branch, i) => {
										const navIndex = (currentBranch ? 1 : 0) + i;
										return (
											<BranchRow
												key={branch.name}
												branch={branch}
												isSelected={selectedIndex === navIndex}
												onSelect={() => {
													onCheckout(branch.name);
													closePalette();
												}}
												onContextMenu={(e) => {
													e.preventDefault();
													onOpenActionMenu(branch.name, currentBranch?.name ?? "", {
														x: e.clientX,
														y: e.clientY,
													});
												}}
												onActionClick={(e) =>
													onOpenActionMenu(branch.name, currentBranch?.name ?? "", {
														x: e.clientX,
														y: e.clientY,
													})
												}
											/>
										);
									})}
								</div>
							)}

							{/* Remote branches — collapsible */}
							{remoteBranches.length > 0 && (
								<div>
									<button
										type="button"
										onClick={() => setRemoteCollapsed((c) => !c)}
										className="mb-0.5 flex w-full items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] transition-colors duration-[var(--transition-fast)]"
									>
										<svg
											width="10"
											height="10"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											className={`shrink-0 transition-transform duration-[var(--transition-fast)] ${remoteCollapsed ? "-rotate-90" : ""}`}
										>
											<path d="m6 9 6 6 6-6" />
										</svg>
										Remote ({remoteBranches.length})
									</button>
									{!remoteCollapsed &&
										remoteBranches.map((branch, i) => {
											const navIndex = (currentBranch ? 1 : 0) + localBranches.length + i;
											return (
												<BranchRow
													key={branch.name}
													branch={branch}
													isSelected={selectedIndex === navIndex}
													onSelect={() => {
														onCheckout(branch.name);
														closePalette();
													}}
													onContextMenu={(e) => {
														e.preventDefault();
														onOpenActionMenu(branch.name, currentBranch?.name ?? "", {
															x: e.clientX,
															y: e.clientY,
														});
													}}
													onActionClick={(e) =>
														onOpenActionMenu(branch.name, currentBranch?.name ?? "", {
															x: e.clientX,
															y: e.clientY,
														})
													}
												/>
											);
										})}
								</div>
							)}

							{/* Empty state */}
							{!currentBranch && localBranches.length === 0 && remoteBranches.length === 0 && (
								<div className="px-3 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
									{searchQuery ? "No branches match your search" : "No branches found"}
								</div>
							)}
						</>
					)}
				</div>

				{/* Footer hint */}
				<div className="border-t border-[var(--border)] px-3 py-2 flex items-center gap-3 text-[11px] text-[var(--text-quaternary)]">
					<span className="flex items-center gap-1">
						<kbd className="rounded bg-[rgba(255,255,255,0.06)] px-1 py-0.5 font-mono text-[10px]">
							↑↓
						</kbd>
						navigate
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded bg-[rgba(255,255,255,0.06)] px-1 py-0.5 font-mono text-[10px]">
							↵
						</kbd>
						checkout
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded bg-[rgba(255,255,255,0.06)] px-1 py-0.5 font-mono text-[10px]">
							esc
						</kbd>
						close
					</span>
				</div>
			</div>
		</div>
	);
}
