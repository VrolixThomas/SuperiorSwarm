import { useState } from "react";
import { useDiffStore } from "../stores/diff";
import { trpc } from "../trpc/client";
import { ExtensionManager } from "./ExtensionManager";
import { FileTree } from "./FileTreeNode";

export function FileTreePanel() {
	const { activeDiff } = useDiffStore();
	const [showExtensions, setShowExtensions] = useState(false);

	// Fetch the file list for the active diff context
	const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
		activeDiff?.type === "branch"
			? { repoPath: activeDiff.repoPath, baseBranch: activeDiff.baseBranch, headBranch: activeDiff.headBranch }
			: { repoPath: "", baseBranch: "", headBranch: "" },
		{ enabled: activeDiff?.type === "branch", staleTime: 30_000 },
	);

	const workingTreeQuery = trpc.diff.getWorkingTreeDiff.useQuery(
		{ repoPath: activeDiff?.repoPath ?? "" },
		{ enabled: activeDiff?.type === "working-tree", staleTime: 10_000 },
	);

	const prDiffQuery = trpc.diff.getPRDiff.useQuery(
		activeDiff?.type === "pr"
			? {
					repoPath: activeDiff.repoPath,
					prId: activeDiff.prId,
					workspaceSlug: activeDiff.workspaceSlug,
					repoSlug: activeDiff.repoSlug,
				}
			: { repoPath: "", prId: 0, workspaceSlug: "", repoSlug: "" },
		{ enabled: activeDiff?.type === "pr", staleTime: 60_000 },
	);

	const files =
		activeDiff?.type === "branch"
			? branchDiffQuery.data?.files
			: activeDiff?.type === "working-tree"
				? workingTreeQuery.data?.files
				: prDiffQuery.data?.files;

	const stats =
		activeDiff?.type === "branch"
			? branchDiffQuery.data?.stats
			: activeDiff?.type === "working-tree"
				? workingTreeQuery.data?.stats
				: prDiffQuery.data?.stats;

	const isLoading =
		branchDiffQuery.isLoading || workingTreeQuery.isLoading || prDiffQuery.isLoading;

	return (
		<div className="flex h-full flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-surface)]">
			{/* Header */}
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
				<span className="flex-1 text-[11px] font-medium text-[var(--text-quaternary)] uppercase tracking-wide">
					Changed Files
				</span>
				{stats && (
					<span className="text-[11px] text-[var(--text-quaternary)]">
						<span className="text-[var(--term-green)]">+{stats.added + stats.changed}</span>
						{" / "}
						<span className="text-[var(--term-red)]">-{stats.removed}</span>
					</span>
				)}
				<button
					type="button"
					onClick={() => setShowExtensions(true)}
					className="rounded p-0.5 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
					title="Manage extensions"
				>
					⚙
				</button>
			</div>

			{/* File list */}
			<div className="flex-1 overflow-y-auto py-1 px-1">
				{isLoading && (
					<div className="flex items-center justify-center py-4 text-[12px] text-[var(--text-quaternary)]">
						Loading…
					</div>
				)}
				{!isLoading && files && files.length > 0 && <FileTree files={files} />}
				{!isLoading && files && files.length === 0 && (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No changes</div>
				)}
			</div>

			{showExtensions && <ExtensionManager onClose={() => setShowExtensions(false)} />}
		</div>
	);
}
