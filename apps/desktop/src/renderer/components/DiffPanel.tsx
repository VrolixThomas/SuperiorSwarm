import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ExtensionManager } from "./ExtensionManager";
import { FileTree } from "./FileTreeNode";
import { WorkingTreePanel } from "./WorkingTreePanel";

function DiffPanelContent({ diffCtx }: { diffCtx: DiffContext }) {
	const [showExtensions, setShowExtensions] = useState(false);
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

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
			: diffCtx.type === "pr"
				? prDiffQuery.data?.files
				: undefined;

	const stats =
		diffCtx.type === "branch"
			? branchDiffQuery.data?.stats
			: diffCtx.type === "pr"
				? prDiffQuery.data?.stats
				: undefined;

	const isLoading =
		(diffCtx.type === "branch" && branchDiffQuery.isFetching) ||
		(diffCtx.type === "pr" && prDiffQuery.isFetching);

	const title =
		diffCtx.type === "pr"
			? diffCtx.title
			: diffCtx.type === "branch"
				? `${diffCtx.baseBranch}..${diffCtx.headBranch}`
				: "Working Tree";

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Header */}
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
				<span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
					{title}
				</span>
				{stats && (
					<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">
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
					<svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none">
						<path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.3" />
						<path
							d="M13.5 8a5.5 5.5 0 01-.4 2M2.5 8a5.5 5.5 0 01.4-2M8 2.5a5.5 5.5 0 012 .4M8 13.5a5.5 5.5 0 01-2-.4"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					onClick={closeDiffPanel}
					className="rounded p-0.5 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
					title="Close panel"
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
			</div>

			{/* Body — branch on context type */}
			{diffCtx.type === "working-tree" ? (
				activeWorkspaceId ? (
					<WorkingTreePanel diffCtx={diffCtx} workspaceId={activeWorkspaceId} />
				) : (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
						Select a workspace
					</div>
				)
			) : (
				<div className="flex-1 overflow-y-auto px-1 py-1">
					{isLoading && (
						<div className="flex items-center justify-center py-4 text-[12px] text-[var(--text-quaternary)]">
							Loading...
						</div>
					)}
					{!isLoading && !activeWorkspaceId && (
						<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
							Select a workspace
						</div>
					)}
					{!isLoading && activeWorkspaceId && files && files.length > 0 && (
						<FileTree files={files} diffCtx={diffCtx} workspaceId={activeWorkspaceId} />
					)}
					{!isLoading && activeWorkspaceId && files && files.length === 0 && (
						<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No changes</div>
					)}
				</div>
			)}

			{showExtensions && <ExtensionManager onClose={() => setShowExtensions(false)} />}
		</div>
	);
}

export function DiffPanel() {
	const diffPanel = useTabStore((s) => s.diffPanel);

	if (!diffPanel.open) return null;

	return (
		<aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<DiffPanelContent diffCtx={diffPanel.diffCtx} />
		</aside>
	);
}
