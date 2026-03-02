import { useEffect, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

type CandidateEntry = {
	name: string;
	relativePath: string;
	type: "file" | "directory";
	children?: CandidateEntry[];
};

function countFiles(entry: CandidateEntry): number {
	if (entry.type === "file") return 1;
	if (!entry.children) return 0;
	return entry.children.reduce((sum, child) => sum + countFiles(child), 0);
}

function hasAnyMatch(entry: CandidateEntry, q: string): boolean {
	if (q === "") return true;
	const lower = q.toLowerCase();
	if (entry.type === "file") return entry.relativePath.toLowerCase().includes(lower);
	return (entry.children ?? []).some((child) => hasAnyMatch(child, q));
}

function CandidateNode({
	entry,
	depth,
	onAdd,
	isAdding,
	expandedPaths,
	toggleExpanded,
	searchQuery,
}: {
	entry: CandidateEntry;
	depth: number;
	onAdd: (path: string) => void;
	isAdding: boolean;
	expandedPaths: Set<string>;
	toggleExpanded: (path: string) => void;
	searchQuery: string;
}) {
	if (entry.type === "file") {
		if (searchQuery && !hasAnyMatch(entry, searchQuery)) return null;
		return (
			<div
				className="flex items-center gap-3 border-b border-[rgba(255,255,255,0.05)] last:border-b-0 group/row hover:bg-[rgba(255,255,255,0.03)] transition-colors duration-75"
				style={{
					paddingTop: "11px",
					paddingBottom: "11px",
					paddingLeft: `${22 + depth * 22}px`,
					paddingRight: "20px",
				}}
			>
				{/* Immediate-add checkbox — hover preview shows ghost checkmark */}
				<button
					type="button"
					onClick={() => onAdd(entry.relativePath)}
					disabled={isAdding}
					className="group/add shrink-0 h-[18px] w-[18px] rounded-[4px] flex items-center justify-center border border-[rgba(255,255,255,0.22)] hover:border-[var(--accent)] hover:bg-[rgba(10,132,255,0.12)] transition-all duration-100 disabled:opacity-40"
					aria-label={`Add ${entry.name} to shared files`}
				>
					<svg
						width="10"
						height="8"
						viewBox="0 0 10 8"
						fill="none"
						aria-hidden="true"
						className="opacity-0 group-hover/add:opacity-60 transition-opacity duration-100"
					>
						<path
							d="M1 4l3 3 5-6"
							stroke="var(--accent)"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<span className="flex-1 truncate text-[13px] font-[var(--font-mono)] text-[rgba(255,255,255,0.65)] group-hover/row:text-[rgba(255,255,255,0.88)] transition-colors duration-75 leading-none">
					{entry.name}
				</span>
			</div>
		);
	}

	const matchesSearch = hasAnyMatch(entry, searchQuery);
	if (searchQuery && !matchesSearch) return null;

	const isExpanded = expandedPaths.has(entry.relativePath) || (searchQuery !== "" && matchesSearch);
	const fileCount = countFiles(entry);

	return (
		<>
			<button
				type="button"
				className="flex w-full items-center gap-3 border-b border-[rgba(255,255,255,0.05)] last:border-b-0 group/dir hover:bg-[rgba(255,255,255,0.03)] transition-colors duration-75 cursor-pointer"
				style={{
					paddingTop: "11px",
					paddingBottom: "11px",
					paddingLeft: `${22 + depth * 22}px`,
					paddingRight: "20px",
				}}
				onClick={() => toggleExpanded(entry.relativePath)}
			>
				{/* Chevron in same-width container as checkbox for column alignment */}
				<div className="shrink-0 w-[18px] flex items-center justify-center">
					<svg
						aria-hidden="true"
						width="9"
						height="9"
						viewBox="0 0 9 9"
						className={`text-[rgba(255,255,255,0.3)] group-hover/dir:text-[var(--accent)] transition-all duration-150 ${isExpanded ? "rotate-90" : ""}`}
					>
						<path
							d="M2.5 1.5l4 3-4 3"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</div>
				<span className="flex-1 truncate text-[13px] font-[var(--font-mono)] text-[rgba(255,255,255,0.82)] group-hover/dir:text-white transition-colors duration-75 leading-none">
					{entry.name}/
				</span>
				<span className="shrink-0 rounded-[4px] bg-[rgba(10,132,255,0.1)] border border-[rgba(10,132,255,0.18)] px-[6px] py-[3px] text-[10.5px] tabular-nums text-[rgba(10,132,255,0.85)] font-semibold leading-none">
					{fileCount}
				</span>
			</button>
			{isExpanded &&
				entry.children?.map((child) => (
					<CandidateNode
						key={child.relativePath}
						entry={child}
						depth={depth + 1}
						onAdd={onAdd}
						isAdding={isAdding}
						expandedPaths={expandedPaths}
						toggleExpanded={toggleExpanded}
						searchQuery={searchQuery}
					/>
				))}
		</>
	);
}

export function SharedFilesPanel() {
	const projectId = useProjectStore((s) => s.sharedFilesProjectId);
	const closePanel = useProjectStore((s) => s.closeSharedFilesPanel);

	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
	const [searchQuery, setSearchQuery] = useState("");
	const [pickerError, setPickerError] = useState<string | null>(null);

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
			setPickerError(null);
			utils.sharedFiles.list.invalidate();
			utils.sharedFiles.discoverCandidates.invalidate();
		},
		onError: (err) => {
			setPickerError(err.message);
		},
	});

	const removeMutation = trpc.sharedFiles.remove.useMutation({
		onSuccess: () => {
			utils.sharedFiles.list.invalidate();
			utils.sharedFiles.discoverCandidates.invalidate();
		},
	});

	const syncMutation = trpc.sharedFiles.sync.useMutation();

	// Reset state when panel opens for a different project
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets when projectId changes
	useEffect(() => {
		setExpandedPaths(new Set());
		setSearchQuery("");
		setPickerError(null);
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

	function toggleExpanded(path: string) {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}

	function handleQuickAdd(relativePath: string) {
		if (!projectId || addMutation.isPending) return;
		addMutation.mutate({ projectId, relativePath });
	}

	async function handleFilePicker() {
		if (!projectId || addMutation.isPending) return;
		const repoPath = projectQuery.data?.repoPath;
		if (!repoPath) return;
		setPickerError(null);
		const absolutePath = await window.electron.dialog.openFile({ defaultPath: repoPath });
		if (!absolutePath) return;
		const prefix = repoPath.endsWith("/") ? repoPath : `${repoPath}/`;
		if (!absolutePath.startsWith(prefix)) {
			setPickerError("File must be inside the repository.");
			return;
		}
		const relativePath = absolutePath.slice(prefix.length);
		addMutation.mutate({ projectId, relativePath });
	}

	function handleSync() {
		if (!projectId) return;
		syncMutation.mutate({ projectId });
	}

	const projectName = projectQuery.data?.name ?? "Project";
	const candidates = candidatesQuery.data ?? [];
	const activeFiles = sharedFilesQuery.data ?? [];
	const totalDiscoveredFiles = candidates.reduce((sum, entry) => sum + countFiles(entry), 0);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/[0.62] backdrop-blur-[4px]"
			onClick={(e) => {
				if (e.target === e.currentTarget) closePanel();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div
				className="w-[580px] max-h-[86vh] flex flex-col rounded-[16px] bg-[#111114] border border-[rgba(255,255,255,0.1)]"
				style={{
					boxShadow: "0 40px 100px rgba(0,0,0,0.75), inset 0 0 0 0.5px rgba(255,255,255,0.04)",
				}}
			>
				{/* Header */}
				<div className="flex items-start justify-between px-6 pt-6 pb-5 shrink-0">
					<div className="min-w-0 pr-4">
						<h2
							className="text-[16px] font-semibold text-white leading-none"
							style={{ letterSpacing: "-0.014em" }}
						>
							Shared Files
						</h2>
						<p className="text-[12px] text-[rgba(255,255,255,0.38)] mt-[8px] leading-none font-[var(--font-mono)] truncate">
							{projectName}
						</p>
					</div>
					<button
						type="button"
						onClick={closePanel}
						className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-[rgba(255,255,255,0.28)] hover:text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.08)] transition-all duration-100"
					>
						<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
							<path
								d="M1 1l10 10M11 1L1 11"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Description */}
				<div className="px-6 pb-5 border-b border-[rgba(255,255,255,0.06)] shrink-0">
					<p className="text-[12.5px] leading-[1.6] text-[rgba(255,255,255,0.35)]">
						Symlinked from the main repo into every worktree. Changes anywhere are reflected
						everywhere.
					</p>
				</div>

				{/* Scrollable content */}
				<div className="flex-1 overflow-y-auto">
					{/* Error display */}
					{(addMutation.isError ||
						removeMutation.isError ||
						syncMutation.isError ||
						pickerError) && (
						<div className="mx-5 mt-5 rounded-[10px] bg-[rgba(255,69,58,0.08)] border border-[rgba(255,69,58,0.22)] px-4 py-3">
							<p className="text-[12.5px] text-[#ff453a]">
								{pickerError ??
									addMutation.error?.message ??
									removeMutation.error?.message ??
									syncMutation.error?.message}
							</p>
						</div>
					)}

					{/* Active shared files */}
					{activeFiles.length > 0 && (
						<div className="pt-5">
							<div className="flex items-center gap-2 px-6 pb-3">
								<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.3)]">
									Active
								</span>
								<span className="text-[10px] font-semibold tabular-nums rounded-[4px] px-[6px] py-[2px] leading-none text-[rgba(255,255,255,0.25)] bg-[rgba(255,255,255,0.07)]">
									{activeFiles.length}
								</span>
							</div>
							<div className="border-t border-[rgba(255,255,255,0.06)]">
								{activeFiles.map((file) => (
									<div
										key={file.id}
										className="flex items-center gap-3 px-6 py-[11px] group/active hover:bg-[rgba(255,255,255,0.03)] transition-colors duration-75 border-b border-[rgba(255,255,255,0.05)] last:border-b-0"
									>
										<svg
											aria-hidden="true"
											width="12"
											height="14"
											viewBox="0 0 12 14"
											fill="none"
											className="shrink-0 text-[rgba(255,255,255,0.2)]"
										>
											<path
												d="M1.5 1h7l3 3v8.5a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-11A.5.5 0 011.5 1z"
												fill="currentColor"
											/>
										</svg>
										<span className="flex-1 truncate text-[13px] font-[var(--font-mono)] leading-none text-[rgba(255,255,255,0.7)]">
											{file.relativePath}
										</span>
										<button
											type="button"
											onClick={() => removeMutation.mutate({ id: file.id })}
											className="shrink-0 h-6 w-6 rounded-[5px] flex items-center justify-center opacity-0 group-hover/active:opacity-100 transition-all duration-100 text-[rgba(255,255,255,0.25)] hover:text-[#ff453a] hover:bg-[rgba(255,69,58,0.12)]"
											title="Remove from shared files"
										>
											<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
												<path
													d="M1 1l7 7M8 1L1 8"
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
						<div
							className={`pt-5${activeFiles.length > 0 ? " mt-3 border-t border-[rgba(255,255,255,0.06)]" : ""}`}
						>
							<div className="flex items-center justify-between px-6 pb-3">
								<div className="flex items-center gap-2">
									<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.3)]">
										Discovered
									</span>
									{totalDiscoveredFiles > 0 && (
										<span className="text-[10px] font-semibold tabular-nums rounded-[4px] px-[6px] py-[2px] leading-none text-[rgba(255,255,255,0.25)] bg-[rgba(255,255,255,0.07)]">
											{totalDiscoveredFiles}
										</span>
									)}
								</div>
								<input
									type="search"
									aria-label="Filter discovered files"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Filter…"
									className="h-[26px] w-32 rounded-[6px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 text-[12px] font-[var(--font-mono)] text-[rgba(255,255,255,0.72)] placeholder:text-[rgba(255,255,255,0.2)] focus:border-[var(--accent)] focus:outline-none transition-colors duration-100"
								/>
							</div>
							<div className="border-t border-[rgba(255,255,255,0.06)] max-h-56 overflow-y-auto">
								{candidates.map((entry) => (
									<CandidateNode
										key={entry.relativePath}
										entry={entry}
										depth={0}
										onAdd={handleQuickAdd}
										isAdding={addMutation.isPending}
										expandedPaths={expandedPaths}
										toggleExpanded={toggleExpanded}
										searchQuery={searchQuery}
									/>
								))}
							</div>
						</div>
					)}

					{/* No candidates empty state */}
					{candidates.length === 0 && !candidatesQuery.isLoading && (
						<div
							className={`pt-5 pb-4 px-6${activeFiles.length > 0 ? " mt-3 border-t border-[rgba(255,255,255,0.06)]" : ""}`}
						>
							<div className="flex items-center gap-2 pb-3">
								<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.3)]">
									Discovered
								</span>
							</div>
							<p className="text-[13px] text-[rgba(255,255,255,0.22)]">
								No additional gitignored files found.
							</p>
						</div>
					)}

					{/* File picker — replaces manual text input */}
					<div className="pt-5 pb-5 px-6 mt-3 border-t border-[rgba(255,255,255,0.06)]">
						<div className="flex items-center gap-2 pb-4">
							<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.3)]">
								Add File
							</span>
						</div>
						<button
							type="button"
							onClick={handleFilePicker}
							disabled={addMutation.isPending || !projectQuery.data}
							className="w-full flex items-center gap-4 rounded-[10px] px-5 py-4 border border-dashed border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.35)] hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[rgba(255,255,255,0.65)] transition-all duration-150 disabled:opacity-30 group/picker"
						>
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 18 18"
								fill="none"
								className="shrink-0 group-hover/picker:text-[var(--accent)] transition-colors duration-150"
							>
								<path
									d="M2 3.5A1.5 1.5 0 013.5 2h4.086a1.5 1.5 0 011.06.44l1.415 1.414A1.5 1.5 0 0011.12 4.5H14.5A1.5 1.5 0 0116 6v8.5A1.5 1.5 0 0114.5 16h-11A1.5 1.5 0 012 14.5V3.5z"
									stroke="currentColor"
									strokeWidth="1.25"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
								<path
									d="M9 8v5M6.5 10.5L9 8l2.5 2.5"
									stroke="currentColor"
									strokeWidth="1.25"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<span className="text-[13px] font-medium">
								{addMutation.isPending ? "Adding…" : "Choose a file from the repository…"}
							</span>
						</button>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] px-6 py-4 shrink-0">
					<p className="text-[12px] text-[rgba(255,255,255,0.25)]">
						{syncMutation.isSuccess
							? `Synced ${syncMutation.data.synced} worktree${syncMutation.data.synced === 1 ? "" : "s"}`
							: "Symlinks created on worktree creation"}
					</p>
					<button
						type="button"
						onClick={handleSync}
						disabled={syncMutation.isPending || activeFiles.length === 0}
						className="rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] px-4 py-2 text-[12px] font-medium text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.09)] hover:text-[rgba(255,255,255,0.75)] transition-all duration-100 disabled:opacity-30"
					>
						{syncMutation.isPending ? "Syncing…" : "Sync All Worktrees"}
					</button>
				</div>
			</div>
		</div>
	);
}
