import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

function CheckboxButton({ checked, onClick }: { checked: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`shrink-0 h-[14px] w-[14px] rounded-[3px] flex items-center justify-center transition-all duration-100 ${
				checked
					? "bg-[var(--accent)] border border-[var(--accent)]"
					: "border border-[rgba(255,255,255,0.2)] hover:border-[rgba(255,255,255,0.45)]"
			}`}
		>
			{checked && (
				<svg width="8" height="6" viewBox="0 0 8 6" fill="none" aria-hidden="true">
					<path
						d="M1 3l2 2 4-4"
						stroke="white"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			)}
		</button>
	);
}

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
	selectedCandidates,
	toggleCandidate,
	expandedPaths,
	toggleExpanded,
	searchQuery,
}: {
	entry: CandidateEntry;
	depth: number;
	selectedCandidates: Set<string>;
	toggleCandidate: (path: string) => void;
	expandedPaths: Set<string>;
	toggleExpanded: (path: string) => void;
	searchQuery: string;
}) {
	if (entry.type === "file") {
		if (searchQuery && !hasAnyMatch(entry, searchQuery)) return null;
		return (
			<div
				className="flex items-center gap-2.5 border-b border-[rgba(255,255,255,0.05)] last:border-b-0 group hover:bg-[rgba(255,255,255,0.03)] transition-colors duration-75"
				style={{
					paddingTop: "7px",
					paddingBottom: "7px",
					paddingLeft: `${14 + depth * 16}px`,
					paddingRight: "12px",
				}}
			>
				<CheckboxButton
					checked={selectedCandidates.has(entry.relativePath)}
					onClick={() => toggleCandidate(entry.relativePath)}
				/>
				<span className="flex-1 truncate text-[11.5px] font-[var(--font-mono)] text-[rgba(255,255,255,0.62)] group-hover:text-[rgba(255,255,255,0.82)] transition-colors duration-75 leading-none">
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
				className="flex w-full items-center gap-2.5 border-b border-[rgba(255,255,255,0.05)] last:border-b-0 group hover:bg-[rgba(255,255,255,0.03)] transition-colors duration-75 cursor-pointer"
				style={{
					paddingTop: "7px",
					paddingBottom: "7px",
					paddingLeft: `${14 + depth * 16}px`,
					paddingRight: "12px",
				}}
				onClick={() => toggleExpanded(entry.relativePath)}
			>
				<svg
					aria-hidden="true"
					width="9"
					height="9"
					viewBox="0 0 9 9"
					className={`shrink-0 text-[rgba(255,255,255,0.28)] group-hover:text-[var(--accent)] transition-all duration-150 ${isExpanded ? "rotate-90" : ""}`}
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
				<span className="flex-1 truncate text-[11.5px] font-[var(--font-mono)] text-[rgba(255,255,255,0.82)] group-hover:text-white transition-colors duration-75 leading-none">
					{entry.name}/
				</span>
				<span className="shrink-0 rounded-[4px] bg-[rgba(10,132,255,0.1)] border border-[rgba(10,132,255,0.18)] px-[5px] py-[2px] text-[9.5px] tabular-nums text-[rgba(10,132,255,0.85)] font-medium leading-none">
					{fileCount}
				</span>
			</button>
			{isExpanded &&
				entry.children?.map((child) => (
					<CandidateNode
						key={child.relativePath}
						entry={child}
						depth={depth + 1}
						selectedCandidates={selectedCandidates}
						toggleCandidate={toggleCandidate}
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

	const [manualPath, setManualPath] = useState("");
	const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
	const [searchQuery, setSearchQuery] = useState("");
	const [confirmingAdd, setConfirmingAdd] = useState(false);
	const confirmTimerRef = useRef<number | undefined>(undefined);

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

	const addBatchMutation = trpc.sharedFiles.addBatch.useMutation({
		onSuccess: () => {
			setSelectedCandidates(new Set());
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

	// Reset state when panel opens for a different project
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets when projectId changes
	useEffect(() => {
		setManualPath("");
		setSelectedCandidates(new Set());
		setExpandedPaths(new Set());
		setSearchQuery("");
		setConfirmingAdd(false);
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

	// Cleanup confirm timer on unmount
	useEffect(() => {
		return () => clearTimeout(confirmTimerRef.current);
	}, []);

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

	function handleAddSelected() {
		if (!projectId || selectedCandidates.size === 0) return;
		if (!confirmingAdd) {
			setConfirmingAdd(true);
			confirmTimerRef.current = window.setTimeout(() => setConfirmingAdd(false), 3000);
			return;
		}
		clearTimeout(confirmTimerRef.current);
		setConfirmingAdd(false);
		addBatchMutation.mutate({
			projectId,
			relativePaths: [...selectedCandidates],
		});
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
				className="w-[540px] max-h-[82vh] flex flex-col rounded-[14px] bg-[#111114] border border-[rgba(255,255,255,0.1)]"
				style={{
					boxShadow: "0 32px 96px rgba(0,0,0,0.72), inset 0 0 0 0.5px rgba(255,255,255,0.04)",
				}}
			>
				{/* Header */}
				<div className="flex items-start justify-between px-5 pt-5 pb-[18px] shrink-0">
					<div className="min-w-0 pr-4">
						<h2
							className="text-[15px] font-semibold text-white leading-none"
							style={{ letterSpacing: "-0.012em" }}
						>
							Shared Files
						</h2>
						<p className="text-[11.5px] text-[rgba(255,255,255,0.38)] mt-[7px] leading-none font-[var(--font-mono)] truncate">
							{projectName}
						</p>
					</div>
					<button
						type="button"
						onClick={closePanel}
						className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[rgba(255,255,255,0.28)] hover:text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.08)] transition-all duration-100"
					>
						<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none">
							<path
								d="M1 1l9 9M10 1L1 10"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Description */}
				<div className="px-5 pb-[15px] border-b border-[rgba(255,255,255,0.06)] shrink-0">
					<p className="text-[11.5px] leading-[1.55] text-[rgba(255,255,255,0.32)]">
						Symlinked from the main repo into every worktree. Changes anywhere are reflected
						everywhere.
					</p>
				</div>

				{/* Scrollable content */}
				<div className="flex-1 overflow-y-auto">
					{/* Error display */}
					{(addMutation.isError ||
						addBatchMutation.isError ||
						removeMutation.isError ||
						syncMutation.isError) && (
						<div className="mx-4 mt-4 rounded-[8px] bg-[rgba(255,69,58,0.08)] border border-[rgba(255,69,58,0.22)] px-3 py-[9px]">
							<p className="text-[11.5px] text-[#ff453a]">
								{addMutation.error?.message ??
									addBatchMutation.error?.message ??
									removeMutation.error?.message ??
									syncMutation.error?.message}
							</p>
						</div>
					)}

					{/* Active shared files */}
					{activeFiles.length > 0 && (
						<div className="pt-4">
							<div className="flex items-center gap-2 px-5 pb-[10px]">
								<span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[rgba(255,255,255,0.3)]">
									Active
								</span>
								<span className="text-[9px] font-semibold tabular-nums rounded-[3px] px-[5px] py-[2px] leading-none text-[rgba(255,255,255,0.25)] bg-[rgba(255,255,255,0.06)]">
									{activeFiles.length}
								</span>
							</div>
							<div className="border-t border-[rgba(255,255,255,0.06)]">
								{activeFiles.map((file) => (
									<div
										key={file.id}
										className="flex items-center gap-2.5 px-5 py-2 group hover:bg-[rgba(255,255,255,0.03)] transition-colors duration-75 border-b border-[rgba(255,255,255,0.05)] last:border-b-0"
									>
										<svg
											aria-hidden="true"
											width="10"
											height="11"
											viewBox="0 0 10 11"
											fill="none"
											className="shrink-0 text-[rgba(255,255,255,0.18)]"
										>
											<path
												d="M1.5 1h5l3 3v6a.5.5 0 01-.5.5h-7A.5.5 0 011 10V1.5A.5.5 0 011.5 1z"
												fill="currentColor"
											/>
										</svg>
										<span className="flex-1 truncate text-[11.5px] font-[var(--font-mono)] leading-none text-[rgba(255,255,255,0.62)]">
											{file.relativePath}
										</span>
										<button
											type="button"
											onClick={() => removeMutation.mutate({ id: file.id })}
											className="shrink-0 h-5 w-5 rounded-[4px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-100 text-[rgba(255,255,255,0.2)] hover:text-[#ff453a] hover:bg-[rgba(255,69,58,0.12)]"
											title="Remove from shared files"
										>
											<svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" fill="none">
												<path
													d="M1 1l6 6M7 1L1 7"
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
							className={`pt-4${activeFiles.length > 0 ? " mt-2 border-t border-[rgba(255,255,255,0.06)]" : ""}`}
						>
							<div className="flex items-center justify-between px-5 pb-[10px]">
								<div className="flex items-center gap-2">
									<span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[rgba(255,255,255,0.3)]">
										Discovered
									</span>
									{totalDiscoveredFiles > 0 && (
										<span className="text-[9px] font-semibold tabular-nums rounded-[3px] px-[5px] py-[2px] leading-none text-[rgba(255,255,255,0.25)] bg-[rgba(255,255,255,0.06)]">
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
									className="h-[22px] w-24 rounded-[5px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2 text-[10.5px] font-[var(--font-mono)] text-[rgba(255,255,255,0.72)] placeholder:text-[rgba(255,255,255,0.2)] focus:border-[var(--accent)] focus:outline-none transition-colors duration-100"
								/>
							</div>
							<div className="border-t border-[rgba(255,255,255,0.06)] max-h-52 overflow-y-auto">
								{candidates.map((entry) => (
									<CandidateNode
										key={entry.relativePath}
										entry={entry}
										depth={0}
										selectedCandidates={selectedCandidates}
										toggleCandidate={toggleCandidate}
										expandedPaths={expandedPaths}
										toggleExpanded={toggleExpanded}
										searchQuery={searchQuery}
									/>
								))}
							</div>
							{selectedCandidates.size > 0 && (
								<div className="px-4 pt-2 pb-1">
									<button
										type="button"
										onClick={handleAddSelected}
										disabled={addBatchMutation.isPending}
										className={`w-full flex items-center justify-center gap-2 rounded-[8px] py-2 text-[12px] font-semibold transition-all duration-200 disabled:opacity-40 ${
											confirmingAdd
												? "bg-[rgba(48,209,88,0.12)] border border-[rgba(48,209,88,0.28)] text-[#30d158]"
												: "bg-[var(--accent)] border border-[rgba(255,255,255,0.1)] text-white hover:bg-[var(--accent-hover)]"
										}`}
									>
										{confirmingAdd ? (
											<>
												<svg
													aria-hidden="true"
													width="12"
													height="10"
													viewBox="0 0 12 10"
													fill="none"
												>
													<path
														d="M1 5l3.5 3.5 6.5-8"
														stroke="currentColor"
														strokeWidth="1.5"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
												Confirm — add {selectedCandidates.size}{" "}
												{selectedCandidates.size === 1 ? "file" : "files"}
											</>
										) : (
											<>
												Add {selectedCandidates.size}{" "}
												{selectedCandidates.size === 1 ? "file" : "files"} to shared
												<svg
													aria-hidden="true"
													width="11"
													height="10"
													viewBox="0 0 11 10"
													fill="none"
												>
													<path
														d="M1 5h9M6.5 1.5L10 5l-3.5 3.5"
														stroke="currentColor"
														strokeWidth="1.5"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
											</>
										)}
									</button>
								</div>
							)}
						</div>
					)}

					{/* No candidates empty state */}
					{candidates.length === 0 && !candidatesQuery.isLoading && (
						<div
							className={`pt-4 pb-3 px-5${activeFiles.length > 0 ? " mt-2 border-t border-[rgba(255,255,255,0.06)]" : ""}`}
						>
							<div className="flex items-center gap-2 pb-[10px]">
								<span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[rgba(255,255,255,0.3)]">
									Discovered
								</span>
							</div>
							<p className="text-[12px] text-[rgba(255,255,255,0.22)]">
								No additional gitignored files found.
							</p>
						</div>
					)}

					{/* Manual add */}
					<div className="pt-4 pb-4 px-5 mt-2 border-t border-[rgba(255,255,255,0.06)]">
						<div className="flex items-center gap-2 pb-3">
							<span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[rgba(255,255,255,0.3)]">
								Add Manually
							</span>
						</div>
						<form onSubmit={handleManualAdd} className="flex gap-2">
							<input
								type="text"
								value={manualPath}
								onChange={(e) => setManualPath(e.target.value)}
								placeholder="relative/path/to/file"
								className="flex-1 rounded-[7px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-[7px] text-[12px] font-[var(--font-mono)] text-[rgba(255,255,255,0.8)] placeholder:text-[rgba(255,255,255,0.2)] focus:border-[var(--accent)] focus:outline-none transition-colors duration-100"
							/>
							<button
								type="submit"
								disabled={!manualPath.trim() || addMutation.isPending}
								className="shrink-0 rounded-[7px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.07)] px-[14px] py-[7px] text-[12px] font-medium text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.12)] hover:text-[rgba(255,255,255,0.9)] transition-all duration-100 disabled:opacity-30"
							>
								Add
							</button>
						</form>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] px-5 py-3 shrink-0">
					<p className="text-[11px] text-[rgba(255,255,255,0.25)]">
						{syncMutation.isSuccess
							? `Synced ${syncMutation.data.synced} worktree${syncMutation.data.synced === 1 ? "" : "s"}`
							: "Symlinks created on worktree creation"}
					</p>
					<button
						type="button"
						onClick={handleSync}
						disabled={syncMutation.isPending || activeFiles.length === 0}
						className="rounded-[7px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] px-3 py-1.5 text-[11.5px] font-medium text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.09)] hover:text-[rgba(255,255,255,0.75)] transition-all duration-100 disabled:opacity-30"
					>
						{syncMutation.isPending ? "Syncing…" : "Sync All Worktrees"}
					</button>
				</div>
			</div>
		</div>
	);
}
