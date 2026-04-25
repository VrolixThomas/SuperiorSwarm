import { useEffect, useMemo, useRef, useState } from "react";
import type { BranchInfo } from "../../shared/branch-types";
import { useBranchStore } from "../stores/branch-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { BranchRow } from "./BranchRow";

interface Props {
	projectId: string;
	onOpenActionMenu: (
		branch: string,
		currentBranch: string,
		position: { x: number; y: number },
		mergeRef: string,
		isRemote: boolean
	) => void;
}

function branchMeta(branch: BranchInfo, isRemote: boolean) {
	const displayName = isRemote ? `origin/${branch.name}` : branch.name;
	const mergeRef = isRemote ? `origin/${branch.name}` : (branch.tracking ?? branch.name);
	return { displayName, mergeRef };
}

export function BranchPalette({ projectId, onOpenActionMenu }: Props) {
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

	const utils = trpc.useUtils();

	const cwd = useTabStore((s) => s.activeWorkspaceCwd);

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId, cwd: cwd || undefined },
		{ enabled: isPaletteOpen, staleTime: 10_000 }
	);
	const statusQuery = trpc.branches.getStatus.useQuery(
		{ projectId, cwd: cwd || undefined },
		{ enabled: isPaletteOpen, staleTime: 10_000 }
	);

	const workspacesQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId },
		{ enabled: isPaletteOpen, staleTime: 10_000 }
	);

	const fetchMutation = trpc.remote.fetch.useMutation({
		onSuccess: () => utils.branches.list.invalidate(),
	});
	const pushMutation = trpc.remote.push.useMutation({
		onSuccess: () => utils.branches.getStatus.invalidate(),
	});
	const pullMutation = trpc.remote.pull.useMutation({
		onSuccess: () => {
			utils.branches.getStatus.invalidate();
			utils.branches.list.invalidate();
			utils.diff.getWorkingTreeStatus.invalidate();
			utils.diff.getWorkingTreeDiff.invalidate();
		},
	});

	const allBranches: BranchInfo[] = useMemo(() => {
		const branches = branchesQuery.data ?? [];
		const wsData = workspacesQuery.data ?? [];

		// Enrich with workspace info
		const branchesWithWorkspace = new Set(
			wsData.filter((ws) => ws.worktreePath).map((ws) => ws.name)
		);

		return branches.map((b) => ({
			...b,
			hasWorkspace: branchesWithWorkspace.has(b.name),
		}));
	}, [branchesQuery.data, workspacesQuery.data]);

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

	// Branches that exist locally (may also exist on remote)
	const localBranches = useMemo(() => filtered.filter((b) => b.isLocal), [filtered]);
	// All remote tracking refs (origin/*), excluding the current branch's own remote counterpart
	const allRemoteBranches = useMemo(
		() => filtered.filter((b) => b.isRemote && b.name !== currentBranch?.name),
		[filtered, currentBranch]
	);

	// Flat list of selectable branches for keyboard navigation (current + local + remote if expanded)
	const navigableBranches = useMemo(() => {
		const list: BranchInfo[] = [];
		if (currentBranch) list.push(currentBranch);
		list.push(...localBranches);
		if (!remoteCollapsed) list.push(...allRemoteBranches);
		return list;
	}, [currentBranch, localBranches, allRemoteBranches, remoteCollapsed]);

	// Reset selected index when search/branches change
	// biome-ignore lint/correctness/useExhaustiveDependencies: searchQuery triggers reset but isn't read inside effect
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex triggers scroll but isn't read inside effect
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
			if (e.key === "Enter" || e.key === "ArrowRight" || e.key === "Tab") {
				e.preventDefault();
				const branch = navigableBranches[selectedIndex];
				if (branch) {
					const selectedEl = listRef.current?.querySelector('[aria-selected="true"]');
					if (selectedEl) {
						const rect = selectedEl.getBoundingClientRect();
						const localCount = (currentBranch ? 1 : 0) + localBranches.length;
						const isBranchRemote = selectedIndex >= localCount;
						const { displayName, mergeRef } = branchMeta(branch, isBranchRemote);
						onOpenActionMenu(
							displayName,
							currentBranch?.name ?? "",
							{
								x: rect.right,
								y: rect.top,
							},
							mergeRef,
							isBranchRemote
						);
					}
				}
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [
		isPaletteOpen,
		selectedIndex,
		navigableBranches,
		closePalette,
		setSelectedIndex,
		onOpenActionMenu,
		currentBranch,
		localBranches.length,
	]);

	if (!isPaletteOpen) return null;

	const status = statusQuery.data;

	function branchCallbacks(branch: BranchInfo, isRemote = false) {
		const cur = currentBranch?.name ?? "";
		const { displayName, mergeRef } = branchMeta(branch, isRemote);
		return {
			onSelect: (e: React.MouseEvent) =>
				onOpenActionMenu(displayName, cur, { x: e.clientX, y: e.clientY }, mergeRef, isRemote),
			onContextMenu: (e: React.MouseEvent) => {
				e.preventDefault();
				onOpenActionMenu(displayName, cur, { x: e.clientX, y: e.clientY }, mergeRef, isRemote);
			},
			onActionClick: (e: React.MouseEvent) =>
				onOpenActionMenu(displayName, cur, { x: e.clientX, y: e.clientY }, mergeRef, isRemote),
		};
	}

	return (
		// Backdrop
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled via document event listener in useEffect
		<div
			className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
			onClick={closePalette}
		>
			{/* Panel */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation on click only; keyboard nav handled by document listener */}
			<div
				className="flex w-[480px] max-h-[70vh] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-active)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)] backdrop-blur-md"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Search bar */}
				<div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
					<svg
						aria-hidden="true"
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
								aria-hidden="true"
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

				{/* biome-ignore lint/a11y/useSemanticElements: command palette listbox cannot use <select> */}
				{/* biome-ignore lint/a11y/useFocusableInteractive: listbox focus managed by keyboard event listener */}
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
												{...branchCallbacks(currentBranch)}
											/>
										</div>
										{/* Ahead/behind badges */}
										{status && (status.ahead > 0 || status.behind > 0) && (
											<div className="flex shrink-0 items-center gap-1 pr-2 text-[11px]">
												{status.ahead > 0 && (
													<span className="flex items-center gap-0.5 text-[var(--text-secondary)]">
														<svg
															aria-hidden="true"
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
															aria-hidden="true"
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
									<button
										type="button"
										onClick={() => fetchMutation.mutate({ projectId, cwd: cwd || undefined })}
										disabled={fetchMutation.isPending}
										className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--bg-overlay)] disabled:opacity-40"
									>
										{fetchMutation.isPending ? "Fetching…" : "Fetch All"}
									</button>
									<button
										type="button"
										onClick={() => pushMutation.mutate({ projectId, cwd: cwd || undefined })}
										disabled={pushMutation.isPending}
										className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--bg-overlay)] disabled:opacity-40"
									>
										{pushMutation.isPending ? "Pushing…" : "Push"}
									</button>
									<button
										type="button"
										onClick={() => pullMutation.mutate({ projectId, cwd: cwd || undefined })}
										disabled={pullMutation.isPending}
										className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--bg-overlay)] disabled:opacity-40"
									>
										{pullMutation.isPending ? "Pulling…" : "Pull"}
									</button>
								</div>
							)}
							<div className="mx-2 mb-2 h-px bg-[var(--border-subtle)]" />

							{/* Local branches */}
							{localBranches.length > 0 && (
								<div className="mb-1">
									<div className="mb-0.5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-quaternary)]">
										Local Branches
									</div>
									{localBranches.map((branch, i) => {
										const navIndex = (currentBranch ? 1 : 0) + i;
										return (
											<BranchRow
												key={branch.name}
												branch={branch}
												isSelected={selectedIndex === navIndex}
												{...branchCallbacks(branch)}
											/>
										);
									})}
								</div>
							)}

							{/* Remote branches — collapsible, shows all origin/* refs */}
							{allRemoteBranches.length > 0 && (
								<div>
									<button
										type="button"
										onClick={() => setRemoteCollapsed((c) => !c)}
										className="mb-0.5 flex w-full items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] transition-colors duration-[var(--transition-fast)]"
									>
										<svg
											aria-hidden="true"
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
										Remote Branches ({allRemoteBranches.length})
									</button>
									{!remoteCollapsed &&
										allRemoteBranches.map((branch, i) => {
											const navIndex = (currentBranch ? 1 : 0) + localBranches.length + i;
											return (
												<BranchRow
													key={`remote:${branch.name}`}
													branch={{ ...branch, name: `origin/${branch.name}`, ahead: 0, behind: 0 }}
													isSelected={selectedIndex === navIndex}
													{...branchCallbacks(branch, true)}
												/>
											);
										})}
								</div>
							)}

							{/* Empty state */}
							{!currentBranch && localBranches.length === 0 && allRemoteBranches.length === 0 && (
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
						<kbd className="rounded bg-[var(--bg-overlay)] px-1 py-0.5 font-mono text-[10px]">
							↑↓
						</kbd>
						navigate
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded bg-[var(--bg-overlay)] px-1 py-0.5 font-mono text-[10px]">
							↵
						</kbd>
						actions
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded bg-[var(--bg-overlay)] px-1 py-0.5 font-mono text-[10px]">
							esc
						</kbd>
						close
					</span>
				</div>
			</div>
		</div>
	);
}
