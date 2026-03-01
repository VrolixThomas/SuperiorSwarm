import { useState } from "react";
import type { DiffContext, DiffFile } from "../../shared/diff-types";
import { type PanelMode, useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ExtensionManager } from "./ExtensionManager";
import { FileSection, FileTree } from "./FileTreeNode";
import { RepoFileTree } from "./RepoFileTree";
import { WorkingTreeCommitBar } from "./WorkingTreeCommitBar";

function WorkingTreeSections({
	statusData,
	diffCtx,
	workspaceId,
	onStage,
	onUnstage,
}: {
	statusData: { stagedFiles: DiffFile[]; unstagedFiles: DiffFile[] };
	diffCtx: DiffContext;
	workspaceId: string;
	onStage: (paths: string[]) => void;
	onUnstage: (paths: string[]) => void;
}) {
	const { stagedFiles, unstagedFiles } = statusData;

	if (stagedFiles.length === 0 && unstagedFiles.length === 0) {
		return <div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No changes</div>;
	}

	return (
		<>
			<FileSection
				label="Staged Changes"
				files={stagedFiles}
				diffCtx={diffCtx}
				workspaceId={workspaceId}
				actionButton={{
					icon: "−",
					title: "Unstage file",
					onClick: (path) => onUnstage([path]),
				}}
				bulkAction={{
					icon: "−",
					title: "Unstage all",
					onClick: () => onUnstage(stagedFiles.map((f) => f.path)),
				}}
			/>
			<FileSection
				label="Changes"
				files={unstagedFiles}
				diffCtx={diffCtx}
				workspaceId={workspaceId}
				actionButton={{
					icon: "+",
					title: "Stage file",
					onClick: (path) => onStage([path]),
				}}
				bulkAction={{
					icon: "+",
					title: "Stage all",
					onClick: () => onStage(unstagedFiles.map((f) => f.path)),
				}}
			/>
		</>
	);
}

function PanelHeader({
	title,
	mode,
	hasDiffCtx,
	stats,
	onToggleMode,
	onClose,
	extraButtons,
}: {
	title: string;
	mode: PanelMode;
	hasDiffCtx: boolean;
	stats?: { added: number; removed: number; changed: number };
	onToggleMode: () => void;
	onClose: () => void;
	extraButtons?: React.ReactNode;
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
			{/* Mode toggle buttons */}
			<div className="flex gap-0.5">
				<button
					type="button"
					onClick={() => {
						if (mode !== "diff") onToggleMode();
					}}
					disabled={!hasDiffCtx}
					className={[
						"rounded p-0.5 transition-colors",
						mode === "diff"
							? "text-[var(--text-secondary)]"
							: hasDiffCtx
								? "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
								: "text-[var(--text-quaternary)] opacity-30 cursor-default",
					].join(" ")}
					title="Diff view"
				>
					<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
						<path
							d="M5 3v10M11 3v10M2 8h12"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					onClick={() => {
						if (mode !== "explorer") onToggleMode();
					}}
					className={[
						"rounded p-0.5 transition-colors",
						mode === "explorer"
							? "text-[var(--text-secondary)]"
							: "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]",
					].join(" ")}
					title="File explorer"
				>
					<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
						<path
							d="M2 3h5l1.5 2H14v8H2V3z"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
			</div>

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

			{extraButtons}

			<button
				type="button"
				onClick={onClose}
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
	);
}

function DiffPanelContent({ diffCtx }: { diffCtx: DiffContext }) {
	const [showExtensions, setShowExtensions] = useState(false);
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);
	const togglePanelMode = useTabStore((s) => s.togglePanelMode);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const utils = trpc.useUtils();

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

	// Background query for staged/unstaged split (only for working-tree)
	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ enabled: diffCtx.type === "working-tree", staleTime: 5_000 }
	);

	const invalidateWorkingTree = () => {
		utils.diff.getWorkingTreeDiff.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getWorkingTreeStatus.invalidate({ repoPath: diffCtx.repoPath });
	};

	const stageMutation = trpc.diff.stageFiles.useMutation({
		onSuccess: invalidateWorkingTree,
	});

	const unstageMutation = trpc.diff.unstageFiles.useMutation({
		onSuccess: invalidateWorkingTree,
	});

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
		(diffCtx.type === "branch" && branchDiffQuery.isFetching) ||
		(diffCtx.type === "working-tree" && workingTreeQuery.isFetching) ||
		(diffCtx.type === "pr" && prDiffQuery.isFetching);

	// When status query has resolved, use its staged/unstaged split
	const hasStatusData = diffCtx.type === "working-tree" && statusQuery.data != null;

	const title =
		diffCtx.type === "pr"
			? diffCtx.title
			: diffCtx.type === "branch"
				? `${diffCtx.baseBranch}..${diffCtx.headBranch}`
				: "Working Tree";

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PanelHeader
				title={title}
				mode="diff"
				hasDiffCtx={true}
				stats={stats ?? undefined}
				onToggleMode={togglePanelMode}
				onClose={closeDiffPanel}
				extraButtons={
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
						>
							<path
								d="M8 10a2 2 0 100-4 2 2 0 000 4z"
								stroke="currentColor"
								strokeWidth="1.3"
							/>
							<path
								d="M13.5 8a5.5 5.5 0 01-.4 2M2.5 8a5.5 5.5 0 01.4-2M8 2.5a5.5 5.5 0 012 .4M8 13.5a5.5 5.5 0 01-2-.4"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				}
			/>

			{/* Working-tree commit bar */}
			{diffCtx.type === "working-tree" && activeWorkspaceId && (
				<WorkingTreeCommitBar diffCtx={diffCtx} />
			)}

			{/* File list */}
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
				{!isLoading && activeWorkspaceId && hasStatusData && (
					<WorkingTreeSections
						statusData={statusQuery.data}
						diffCtx={diffCtx}
						workspaceId={activeWorkspaceId}
						onStage={(paths) => stageMutation.mutate({ repoPath: diffCtx.repoPath, paths })}
						onUnstage={(paths) =>
							unstageMutation.mutate({ repoPath: diffCtx.repoPath, paths })
						}
					/>
				)}
				{!isLoading && activeWorkspaceId && !hasStatusData && files && files.length > 0 && (
					<FileTree
						files={files}
						diffCtx={diffCtx}
						workspaceId={activeWorkspaceId}
						actionButton={
							diffCtx.type === "working-tree"
								? {
										icon: "+",
										title: "Stage file",
										onClick: (path) =>
											stageMutation.mutate({
												repoPath: diffCtx.repoPath,
												paths: [path],
											}),
									}
								: undefined
						}
					/>
				)}
				{!isLoading && activeWorkspaceId && !hasStatusData && files && files.length === 0 && (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
						No changes
					</div>
				)}
			</div>

			{showExtensions && <ExtensionManager onClose={() => setShowExtensions(false)} />}
		</div>
	);
}

function ExplorerPanelContent() {
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);
	const rightPanel = useTabStore((s) => s.rightPanel);
	const togglePanelMode = useTabStore((s) => s.togglePanelMode);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PanelHeader
				title="Explorer"
				mode="explorer"
				hasDiffCtx={rightPanel.open ? rightPanel.diffCtx !== null : false}
				onToggleMode={togglePanelMode}
				onClose={closeDiffPanel}
			/>
			<div className="flex-1 overflow-y-auto px-1 py-1">
				{!activeWorkspaceId && (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
						Select a workspace
					</div>
				)}
				{activeWorkspaceId && activeWorkspaceCwd && (
					<RepoFileTree
						repoPath={activeWorkspaceCwd}
						workspaceId={activeWorkspaceId}
					/>
				)}
			</div>
		</div>
	);
}

export function DiffPanel() {
	const rightPanel = useTabStore((s) => s.rightPanel);

	if (!rightPanel.open) return null;

	return (
		<aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			{rightPanel.mode === "diff" && rightPanel.diffCtx ? (
				<DiffPanelContent diffCtx={rightPanel.diffCtx} />
			) : (
				<ExplorerPanelContent />
			)}
		</aside>
	);
}
