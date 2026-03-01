import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ExtensionManager } from "./ExtensionManager";
import { FileTree } from "./FileTreeNode";

interface FileTreeContentProps {
	diffCtx: DiffContext;
	workspaceId: string;
}

export function FileTreeContent({ diffCtx, workspaceId }: FileTreeContentProps) {
	const [showExtensions, setShowExtensions] = useState(false);
	const closeDiff = useTabStore((s) => s.closeDiff);

	const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
		diffCtx.type === "branch"
			? {
					repoPath: diffCtx.repoPath,
					baseBranch: diffCtx.baseBranch,
					headBranch: diffCtx.headBranch,
				}
			: { repoPath: "", baseBranch: "", headBranch: "" },
		{ enabled: diffCtx.type === "branch", staleTime: 30_000 }
	);

	const workingTreeQuery = trpc.diff.getWorkingTreeDiff.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ enabled: diffCtx.type === "working-tree", staleTime: 10_000 }
	);

	const prDiffQuery = trpc.diff.getPRDiff.useQuery(
		diffCtx.type === "pr"
			? {
					repoPath: diffCtx.repoPath,
					prId: diffCtx.prId,
					workspaceSlug: diffCtx.workspaceSlug,
					repoSlug: diffCtx.repoSlug,
				}
			: { repoPath: "", prId: 0, workspaceSlug: "", repoSlug: "" },
		{ enabled: diffCtx.type === "pr", staleTime: 60_000 }
	);

	const files =
		diffCtx.type === "branch"
			? branchDiffQuery.data?.files
			: diffCtx.type === "working-tree"
				? workingTreeQuery.data?.files
				: prDiffQuery.data?.files;

	const stats =
		diffCtx.type === "branch"
			? branchDiffQuery.data?.stats
			: diffCtx.type === "working-tree"
				? workingTreeQuery.data?.stats
				: prDiffQuery.data?.stats;

	const isLoading =
		branchDiffQuery.isLoading || workingTreeQuery.isLoading || prDiffQuery.isLoading;

	return (
		<div className="flex h-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{/* Header */}
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
				<span className="flex-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
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
					onClick={() => closeDiff(workspaceId, diffCtx.repoPath)}
					className="rounded p-0.5 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
					title="Close diff"
				>
					<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
						<path
							d="M2 2l5 5M7 2l-5 5"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					onClick={() => setShowExtensions(true)}
					className="rounded p-0.5 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
					title="Manage extensions"
				>
					<svg
						aria-hidden="true"
						width="11"
						height="11"
						viewBox="0 0 16 16"
						fill="none"
						className="text-[var(--text-quaternary)]"
					>
						<path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.3" />
						<path
							d="M13.5 8a5.5 5.5 0 01-.4 2M2.5 8a5.5 5.5 0 01.4-2M8 2.5a5.5 5.5 0 012 .4M8 13.5a5.5 5.5 0 01-2-.4"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</div>

			{/* File list */}
			<div className="flex-1 overflow-y-auto px-1 py-1">
				{isLoading && (
					<div className="flex items-center justify-center py-4 text-[12px] text-[var(--text-quaternary)]">
						Loading...
					</div>
				)}
				{!isLoading && files && files.length > 0 && (
					<FileTree files={files} diffCtx={diffCtx} workspaceId={workspaceId} />
				)}
				{!isLoading && files && files.length === 0 && (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No changes</div>
				)}
			</div>

			{showExtensions && <ExtensionManager onClose={() => setShowExtensions(false)} />}
		</div>
	);
}
