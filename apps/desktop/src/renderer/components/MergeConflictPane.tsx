import { useState } from "react";
import { useBranchStore } from "../stores/branch-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ConflictFileSidebar } from "./ConflictFileSidebar";
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

	const utils = trpc.useUtils();

	const activeFile = mergeState?.activeFilePath ?? null;

	const conflictQuery = trpc.merge.getFileConflict.useQuery(
		{ projectId, filePath: activeFile ?? "", cwd },
		{ enabled: !!activeFile }
	);

	const resolveMutation = trpc.merge.resolveFile.useMutation({
		onSuccess: (_data, variables) => {
			markFileResolved(variables.filePath);
			utils.merge.getConflicts.invalidate({ projectId });
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
		onSuccess: () => {
			clearMergeState();
			utils.branches.getStatus.invalidate();
			closeMergeTab();
		},
	});

	const files = mergeState?.conflicts ?? [];
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

	function handleApply() {
		if (mergeType === "merge") {
			applyAndCommit.mutate({ projectId, message: commitMessage, cwd });
		} else {
			rebaseContinue.mutate({ projectId, cwd });
		}
	}

	function handleResolve(resolvedContent: string) {
		if (!activeFile) return;
		resolveMutation.mutate({ projectId, filePath: activeFile, content: resolvedContent, cwd });
	}

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Top bar */}
			<div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2">
				{/* Merge/rebase badge */}
				<span
					className={[
						"rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
						mergeType === "merge"
							? "bg-[rgba(255,69,58,0.12)] text-[var(--color-danger)]"
							: "bg-[rgba(255,159,10,0.12)] text-[var(--color-warning)]",
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
					<span className="rounded bg-[rgba(255,159,10,0.12)] px-2 py-0.5 text-[11px] text-[var(--color-warning)]">
						{conflictCount} conflict{conflictCount !== 1 ? "s" : ""} remaining
					</span>
				) : files.length > 0 ? (
					<span className="rounded bg-[rgba(48,209,88,0.12)] px-2 py-0.5 text-[11px] text-[var(--color-success)]">
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
						className="w-[280px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
					/>
				)}

				{/* Abort button */}
				<button
					type="button"
					onClick={handleAbort}
					disabled={isAborting}
					className="rounded-[var(--radius-sm)] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.08)] px-3 py-1 text-[12px] font-medium text-[var(--color-danger)] transition-all duration-[var(--transition-fast)] hover:bg-[rgba(255,69,58,0.15)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isAborting ? "Aborting…" : "Abort"}
				</button>

				{/* Apply & commit / Continue rebase button */}
				<button
					type="button"
					onClick={handleApply}
					disabled={!allResolved || isApplying || (mergeType === "merge" && !commitMessage.trim())}
					className="rounded-[var(--radius-sm)] border border-[rgba(48,209,88,0.3)] bg-[rgba(48,209,88,0.08)] px-3 py-1 text-[12px] font-medium text-[var(--color-success)] transition-all duration-[var(--transition-fast)] hover:bg-[rgba(48,209,88,0.15)] disabled:cursor-not-allowed disabled:opacity-40"
				>
					{isApplying ? "Applying…" : mergeType === "merge" ? "Apply & Commit" : "Continue Rebase"}
				</button>
			</div>

			{/* Body: sidebar + editor area */}
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<ConflictFileSidebar
					files={files}
					activeFile={activeFile}
					onSelectFile={setActiveConflictFile}
				/>

				{/* Editor area */}
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{!activeFile && (
						<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
							Select a conflicting file to resolve it
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
							key={activeFile}
							filePath={activeFile}
							content={conflictQuery.data}
							sourceBranch={sourceBranch}
							targetBranch={targetBranch}
							onResolve={handleResolve}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
