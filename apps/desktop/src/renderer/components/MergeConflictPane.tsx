import { keepPreviousData } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { shouldSkipShortcutHandling } from "../hooks/useShortcutListener";
import { useActionStore } from "../stores/action-store";
import { useBranchStore } from "../stores/branch-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ConflictFileSidebar } from "./ConflictFileSidebar";
import { ConflictHintBar, type ConflictZone } from "./ConflictHintBar";
import { ThreeWayDiffEditor } from "./ThreeWayDiffEditor";

interface Props {
	projectId: string;
	mergeType: "merge" | "rebase";
	sourceBranch: string;
	targetBranch: string;
}

export function MergeConflictPane({ projectId, mergeType, sourceBranch, targetBranch }: Props) {
	const cwd = useTabStore((s) => s.activeWorkspaceCwd) || undefined;
	const mergeState = useBranchStore((s) => s.mergeState);
	const setActiveConflictFile = useBranchStore((s) => s.setActiveConflictFile);
	const markFileResolved = useBranchStore((s) => s.markFileResolved);
	const clearMergeState = useBranchStore((s) => s.clearMergeState);
	const setMergeState = useBranchStore((s) => s.setMergeState);

	// Close the merge-conflict tab from the pane system
	function closeMergeTab() {
		const tabStore = useTabStore.getState();
		const allTabs = tabStore.getAllTabs();
		const mergeTab = allTabs.find((t) => t.kind === "merge-conflict");
		if (mergeTab) {
			tabStore.removeTab(mergeTab.id);
		}
	}

	const [commitMessage, setCommitMessage] = useState(
		mergeType === "merge"
			? `Merge branch '${sourceBranch}'`
			: `Rebase ${targetBranch} onto ${sourceBranch}`
	);
	const [zone, setZone] = useState<ConflictZone>("sidebar");

	const utils = trpc.useUtils();

	const activeFile = mergeState?.activeFilePath ?? null;

	const conflictQuery = trpc.merge.getFileConflict.useQuery(
		{ projectId, filePath: activeFile ?? "", cwd },
		{ enabled: !!activeFile, placeholderData: keepPreviousData }
	);

	const resolveMutation = trpc.merge.resolveFile.useMutation({
		onSuccess: (_data, variables) => {
			markFileResolved(variables.filePath);
			utils.merge.getConflicts.invalidate({ projectId });
			// Auto-advance: markFileResolved has already updated the store synchronously above
			const updatedConflicts = useBranchStore.getState().mergeState?.conflicts ?? [];
			const next = updatedConflicts.find((f) => f.status === "conflicting");
			if (next) {
				setActiveConflictFile(next.path);
				setZone("nav");
			} else {
				// All resolved: clear editor and show the all-resolved empty state
				setActiveConflictFile(null);
				setZone("sidebar");
			}
		},
	});

	const abortMerge = trpc.merge.abort.useMutation({
		onSuccess: () => {
			clearMergeState();
			utils.branches.getStatus.invalidate();
			// Close the merge-conflict tab
			closeMergeTab();
		},
	});

	const abortRebase = trpc.rebase.abort.useMutation({
		onSuccess: () => {
			clearMergeState();
			utils.branches.getStatus.invalidate();
			closeMergeTab();
		},
	});

	const applyAndCommit = trpc.merge.applyAndCommit.useMutation({
		onSuccess: () => {
			clearMergeState();
			utils.branches.getStatus.invalidate();
			closeMergeTab();
		},
	});

	const rebaseContinue = trpc.rebase.continue.useMutation({
		onSuccess: (result) => {
			if (result.status === "conflict" && result.files) {
				// More commits to rebase — update conflicts and stay in the pane
				utils.branches.getStatus.invalidate();
				setMergeState({
					type: "rebase",
					sourceBranch,
					targetBranch,
					conflicts: result.files.map((path) => ({ path, status: "conflicting" as const })),
					activeFilePath: result.files[0] ?? null,
					rebaseProgress: result.progress ?? null,
				});
				setZone("sidebar");
			} else {
				clearMergeState();
				utils.branches.getStatus.invalidate();
				closeMergeTab();
			}
		},
	});

	const applyAndCommitRef = useRef(applyAndCommit);
	applyAndCommitRef.current = applyAndCommit;
	const rebaseContinueRef = useRef(rebaseContinue);
	rebaseContinueRef.current = rebaseContinue;

	const files = mergeState?.conflicts ?? [];

	// Register conflict resolution shortcuts in the command palette for discoverability.
	// Uses displayShortcut (not shortcut) so useShortcutListener doesn't intercept events.
	useEffect(() => {
		const store = useActionStore.getState();
		const noop = () => {};
		const cat = "Conflict Resolution" as const;

		store.registerMany([
			// Sidebar zone
			{
				id: "conflict.navigate",
				label: "Navigate Files",
				category: cat,
				displayShortcut: { key: "j" },
				execute: noop,
			},
			{
				id: "conflict.open",
				label: "Open File in Editor",
				category: cat,
				displayShortcut: { key: "Enter" },
				execute: noop,
			},
			{
				id: "conflict.nextConflict",
				label: "Next Conflicting File",
				category: cat,
				displayShortcut: { key: "n" },
				execute: noop,
			},
			{
				id: "conflict.prevConflict",
				label: "Previous Conflicting File",
				category: cat,
				displayShortcut: { key: "p" },
				execute: noop,
			},
			// Nav zone
			{
				id: "conflict.acceptTheirs",
				label: "Accept Theirs",
				category: cat,
				displayShortcut: { key: "t" },
				execute: noop,
			},
			{
				id: "conflict.acceptOurs",
				label: "Accept Ours",
				category: cat,
				displayShortcut: { key: "b" },
				execute: noop,
			},
			{
				id: "conflict.acceptBoth",
				label: "Accept Both",
				category: cat,
				displayShortcut: { key: "+" },
				execute: noop,
			},
			{
				id: "conflict.edit",
				label: "Edit Mode",
				category: cat,
				displayShortcut: { key: "e" },
				execute: noop,
			},
			{
				id: "conflict.undo",
				label: "Undo Resolution",
				category: cat,
				displayShortcut: { key: "z", meta: true },
				execute: noop,
			},
			// Shared
			{
				id: "conflict.back",
				label: "Back / Exit Zone",
				category: cat,
				displayShortcut: { key: "Escape" },
				execute: noop,
			},
		]);

		return () => {
			store.unregisterMany([
				"conflict.navigate",
				"conflict.open",
				"conflict.nextConflict",
				"conflict.prevConflict",
				"conflict.acceptTheirs",
				"conflict.acceptOurs",
				"conflict.acceptBoth",
				"conflict.edit",
				"conflict.undo",
				"conflict.back",
			]);
		};
	}, []);

	const allResolved = files.length > 0 && files.every((f) => f.status === "resolved");
	const conflictCount = files.filter((f) => f.status === "conflicting").length;

	const isAborting = abortMerge.isPending || abortRebase.isPending;
	const isApplying = applyAndCommit.isPending || rebaseContinue.isPending;

	function handleAbort() {
		if (mergeType === "merge") {
			abortMerge.mutate({ projectId, cwd });
		} else {
			abortRebase.mutate({ projectId, cwd });
		}
	}

	const handleApply = useCallback(() => {
		if (mergeType === "merge") {
			applyAndCommitRef.current.mutate({ projectId, message: commitMessage, cwd });
		} else {
			rebaseContinueRef.current.mutate({ projectId, cwd });
		}
	}, [mergeType, projectId, commitMessage, cwd]);

	function handleResolve(resolvedContent: string) {
		if (!activeFile) return;
		resolveMutation.mutate({ projectId, filePath: activeFile, content: resolvedContent, cwd });
	}

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (shouldSkipShortcutHandling(e, target) || target.isContentEditable) return;

			if (e.key === "Escape" && zone === "nav") {
				setZone("sidebar");
				return;
			}
			if (e.key === "Enter" && zone === "sidebar" && allResolved && !isApplying) {
				e.preventDefault();
				handleApply();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [zone, allResolved, isApplying, handleApply]);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Top bar */}
			<div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2">
				{/* Merge/rebase badge */}
				<span
					className={[
						"rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
						mergeType === "merge"
							? "bg-[var(--danger-subtle)] text-[var(--color-danger)]"
							: "bg-[var(--warning-subtle)] text-[var(--color-warning)]",
					].join(" ")}
				>
					{mergeType}
				</span>

				{/* Branch indicator */}
				<div className="flex items-center gap-1.5 text-[13px]">
					<span className="font-medium text-[var(--text)]">{sourceBranch}</span>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--text-quaternary)"
						strokeWidth="2"
					>
						<path d="M5 12h14" />
						<path d="m12 5 7 7-7 7" />
					</svg>
					<span className="font-medium text-[var(--text)]">{targetBranch}</span>
				</div>

				{/* Conflict count badge */}
				{conflictCount > 0 ? (
					<span className="rounded bg-[var(--warning-subtle)] px-2 py-0.5 text-[11px] text-[var(--color-warning)]">
						{conflictCount} conflict{conflictCount !== 1 ? "s" : ""} remaining
					</span>
				) : files.length > 0 ? (
					<span className="rounded bg-[var(--success-subtle)] px-2 py-0.5 text-[11px] text-[var(--color-success)]">
						All resolved
					</span>
				) : null}

				<div className="flex-1" />

				{/* Commit message input (merge only) */}
				{mergeType === "merge" && (
					<input
						type="text"
						value={commitMessage}
						onChange={(e) => setCommitMessage(e.target.value)}
						placeholder="Commit message…"
						className="w-[280px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
					/>
				)}

				{/* Abort button */}
				<button
					type="button"
					onClick={handleAbort}
					disabled={isAborting}
					className="rounded-[var(--radius-sm)] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.08)] px-3 py-1 text-[12px] font-medium text-[var(--color-danger)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--danger-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isAborting ? "Aborting…" : "Abort"}
				</button>

				{/* Apply & commit / Continue rebase button */}
				<button
					type="button"
					onClick={handleApply}
					disabled={!allResolved || isApplying || (mergeType === "merge" && !commitMessage.trim())}
					className={[
						"rounded-[var(--radius-sm)] border px-3 py-1 text-[12px] font-medium transition-all duration-[var(--transition-fast)] disabled:cursor-not-allowed disabled:opacity-40",
						allResolved
							? "border-[rgba(48,209,88,0.4)] bg-[rgba(48,209,88,0.2)] text-[var(--color-success)] shadow-[0_0_10px_rgba(48,209,88,0.15)]"
							: "border-[rgba(48,209,88,0.15)] bg-[rgba(48,209,88,0.04)] text-[rgba(48,209,88,0.4)]",
					].join(" ")}
				>
					{isApplying
						? "Applying…"
						: mergeType === "merge"
							? `Apply & Commit${allResolved ? " ↵" : ""}`
							: `Continue Rebase${allResolved ? " ↵" : ""}`}
				</button>
			</div>

			{/* Rebase progress bar — only shown for rebase when progress data is available */}
			{mergeType === "rebase" && mergeState?.rebaseProgress && (
				<div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[rgba(255,159,10,0.04)] px-4 py-1.5">
					<span className="text-[9px] uppercase tracking-wider text-[var(--text-quaternary)]">
						Rebase progress
					</span>
					<div
						className="flex-1 overflow-hidden rounded-full"
						style={{ height: 3, background: "rgba(255,255,255,0.06)" }}
					>
						<div
							className="h-full rounded-full transition-all duration-300"
							style={{
								width: `${(mergeState.rebaseProgress.current / mergeState.rebaseProgress.total) * 100}%`,
								background: "rgba(255,159,10,0.7)",
							}}
						/>
					</div>
					<span className="shrink-0 text-[10px] font-medium text-[var(--color-warning)]">
						commit {mergeState.rebaseProgress.current} / {mergeState.rebaseProgress.total}
					</span>
				</div>
			)}

			{/* Body: sidebar + editor area */}
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<ConflictFileSidebar
					files={files}
					activeFile={activeFile}
					onSelectFile={(path) => {
						setActiveConflictFile(path);
						setZone("nav");
					}}
					zone={zone}
					onFocusEditor={() => setZone("nav")}
				/>

				{/* Editor area */}
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{!activeFile && (
						<div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--text-quaternary)]">
							{allResolved ? (
								<>
									<svg
										width="28"
										height="28"
										viewBox="0 0 24 24"
										fill="none"
										stroke="var(--color-success)"
										strokeWidth="1.5"
										aria-hidden="true"
									>
										<circle cx="12" cy="12" r="10" />
										<path d="m9 12 2 2 4-4" />
									</svg>
									<span className="text-[14px] font-medium text-[var(--color-success)]">
										All conflicts resolved
									</span>
									<span className="text-[12px]">
										Press{" "}
										<code className="rounded bg-[var(--bg-overlay)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
											↵
										</code>{" "}
										or click the button to{" "}
										{mergeType === "merge" ? "apply & commit" : "continue rebase"}
									</span>
								</>
							) : (
								<span className="text-[13px]">Select a conflicting file to resolve it</span>
							)}
						</div>
					)}
					{activeFile && conflictQuery.isLoading && (
						<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
							Loading conflict…
						</div>
					)}
					{activeFile && conflictQuery.isError && (
						<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
							Failed to load conflict content
						</div>
					)}
					{activeFile && conflictQuery.data && (
						<ThreeWayDiffEditor
							filePath={activeFile}
							content={conflictQuery.data}
							sourceBranch={sourceBranch}
							targetBranch={targetBranch}
							onResolve={handleResolve}
							zone={zone}
							onZoneChange={setZone}
						/>
					)}
				</div>
			</div>
			<ConflictHintBar zone={zone} allResolved={allResolved} mergeType={mergeType} />
		</div>
	);
}
