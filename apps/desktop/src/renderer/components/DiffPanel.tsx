import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import { type PanelMode, useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { AIFixesTab } from "./AIFixesTab";
import { BranchChanges } from "./BranchChanges";
import { CommentsOverviewTab } from "./CommentsOverviewTab";
import { CommittedStack } from "./CommittedStack";
import { DraftCommitCard } from "./DraftCommitCard";
import { PRControlRail } from "./PRControlRail";
import { RepoFileTree } from "./RepoFileTree";
import { SmartHeaderBar } from "./SmartHeaderBar";

type DiffPanelTab = "changes" | "files" | "comments" | "ai-fixes";

function PanelHeader({
	mode,
	stats,
	onSetMode,
	onClose,
	hasPR,
	activeTab,
	onSetTab,
	commentCount,
}: {
	mode: PanelMode;
	stats?: { added: number; removed: number; changed: number };
	onSetMode: (mode: PanelMode) => void;
	onClose?: () => void;
	hasPR?: boolean;
	activeTab?: DiffPanelTab;
	onSetTab?: (tab: DiffPanelTab) => void;
	commentCount?: number;
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
			{/* Segmented control */}
			<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				{onSetTab && activeTab ? (
					<>
						<button
							type="button"
							onClick={() => onSetTab("changes")}
							className={[
								"rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
								activeTab === "changes"
									? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
							].join(" ")}
						>
							Changes
						</button>
						<button
							type="button"
							onClick={() => onSetTab("files")}
							className={[
								"rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
								activeTab === "files"
									? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
							].join(" ")}
						>
							Files
						</button>
						<button
							type="button"
							onClick={() => onSetTab("comments")}
							className={[
								"flex items-center rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
								activeTab === "comments"
									? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
							].join(" ")}
						>
							Comments
							{commentCount != null && commentCount > 0 && (
								<span className="rounded-full bg-[rgba(255,255,255,0.15)] px-1.5 text-[10px] ml-1">
									{commentCount}
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => onSetTab("ai-fixes")}
							className={[
								"rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
								activeTab === "ai-fixes"
									? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
							].join(" ")}
						>
							AI Fixes
						</button>
					</>
				) : null}
			</div>

			<div className="flex-1" />

			{stats && (
				<div className="flex items-center rounded-full bg-[var(--bg-base)] px-2 py-0.5 text-[11px]">
					<span className="text-[var(--term-green)]">+{stats.added + stats.changed}</span>
					<span className="mx-1 text-[var(--text-quaternary)]">/</span>
					<span className="text-[var(--term-red)]">-{stats.removed}</span>
				</div>
			)}

			{onClose && (
				<button
					type="button"
					onClick={onClose}
					className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					title="Close panel"
				>
					<svg
						width="10"
						height="10"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M1 1l8 8M9 1l-8 8" />
					</svg>
				</button>
			)}
		</div>
	);
}

function DiffPanelContent({ diffCtx, onClose }: { diffCtx: DiffContext; onClose?: () => void }) {
	const [activeTab, setActiveTab] = useState<DiffPanelTab>("changes");
	const togglePanelMode = useTabStore((s) => s.togglePanelMode);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
	const setBaseBranch = useTabStore((s) => s.setBaseBranch);
	const storedBaseBranch = useTabStore((s) =>
		activeWorkspaceId ? s.baseBranchByWorkspace[activeWorkspaceId] : undefined
	);
	const meta = useTabStore((s) =>
		activeWorkspaceId ? s.workspaceMetadata[activeWorkspaceId] : undefined
	);
	const hasPR = !!meta?.prProvider;

	const utils = trpc.useUtils();

	const commentsQuery = trpc.commentSolver.getWorkspaceComments.useQuery(
		{ workspaceId: activeWorkspaceId ?? "" },
		{ enabled: hasPR && !!activeWorkspaceId, staleTime: 30_000 }
	);
	const commentCount = commentsQuery.data?.length ?? 0;

	// Fetch default branch to use as initial base
	const defaultBranchQuery = trpc.diff.getDefaultBranch.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ staleTime: 60_000 }
	);

	const effectiveBaseBranch = storedBaseBranch ?? defaultBranchQuery.data?.branch ?? "main";

	// Working tree status (staged/unstaged split)
	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ enabled: diffCtx.type === "working-tree", staleTime: 30_000 }
	);

	// Working tree diff (for stats)
	const workingTreeQuery = trpc.diff.getWorkingTreeDiff.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ enabled: diffCtx.type === "working-tree", staleTime: 30_000 }
	);

	// Branch diff (for non-working-tree contexts)
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

	const invalidateAll = () => {
		utils.diff.getWorkingTreeDiff.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getWorkingTreeStatus.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getCommitsAhead.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getBranchDiff.invalidate();
	};

	const stageMutation = trpc.diff.stageFiles.useMutation({
		onSuccess: invalidateAll,
	});

	const unstageMutation = trpc.diff.unstageFiles.useMutation({
		onSuccess: invalidateAll,
	});

	const stats =
		diffCtx.type === "working-tree"
			? workingTreeQuery.data?.stats
			: diffCtx.type === "branch"
				? branchDiffQuery.data?.stats
				: prDiffQuery.data?.stats;

	const currentBranch = statusQuery.data?.branch ?? "";
	const hasStatusData = diffCtx.type === "working-tree" && statusQuery.data != null;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PanelHeader
				mode="diff"
				stats={stats ?? undefined}
				onSetMode={(m) => {
					if (m !== "diff") togglePanelMode();
				}}
				onClose={onClose}
				hasPR={hasPR}
				activeTab={activeTab}
				onSetTab={setActiveTab}
				commentCount={commentCount}
			/>

			{activeTab === "comments" && activeWorkspaceId ? (
				<div className="flex flex-1 flex-col min-h-0 overflow-hidden">
					<CommentsOverviewTab workspaceId={activeWorkspaceId} />
				</div>
			) : activeTab === "ai-fixes" && activeWorkspaceId ? (
				<div className="flex flex-1 flex-col min-h-0 overflow-hidden">
					<AIFixesTab workspaceId={activeWorkspaceId} />
				</div>
			) : activeTab === "files" && activeWorkspaceId && activeWorkspaceCwd ? (
				<div className="flex flex-1 flex-col min-h-0 overflow-hidden">
					<RepoFileTree repoPath={activeWorkspaceCwd} workspaceId={activeWorkspaceId} />
				</div>
			) : (
				<>
					{/* Smart header bar — only for working-tree mode */}
					{diffCtx.type === "working-tree" && currentBranch && (
						<SmartHeaderBar
							repoPath={diffCtx.repoPath}
							currentBranch={currentBranch}
							baseBranch={effectiveBaseBranch}
							onBaseBranchChange={(branch) => {
								if (activeWorkspaceId) {
									setBaseBranch(activeWorkspaceId, branch);
									// Force refetch of all queries that depend on baseBranch
									utils.diff.getBranchDiff.invalidate();
									utils.diff.getCommitsAhead.invalidate();
								}
							}}
						/>
					)}

					{/* Scrollable timeline content */}
					<div className="flex-1 overflow-y-auto">
						{!activeWorkspaceId && (
							<div className="px-3 py-4 text-[12px] text-[var(--text-quaternary)]">
								Select a workspace
							</div>
						)}

						{activeWorkspaceId && diffCtx.type === "working-tree" && (
							<>
								{/* Draft commit card */}
								{hasStatusData && (
									<DraftCommitCard
										diffCtx={diffCtx}
										stagedFiles={statusQuery.data.stagedFiles}
										unstagedFiles={statusQuery.data.unstagedFiles}
										onStage={(paths) => stageMutation.mutate({ repoPath: diffCtx.repoPath, paths })}
										onUnstage={(paths) =>
											unstageMutation.mutate({ repoPath: diffCtx.repoPath, paths })
										}
										onInvalidate={invalidateAll}
									/>
								)}

								{/* Committed stack */}
								<div className="mt-3">
									<CommittedStack
										repoPath={diffCtx.repoPath}
										baseBranch={effectiveBaseBranch}
										diffCtx={diffCtx}
										workspaceId={activeWorkspaceId}
									/>
								</div>

								{/* Branch changes — full diff vs base */}
								{currentBranch && (
									<div className="mt-1 mb-4">
										<BranchChanges
											repoPath={diffCtx.repoPath}
											baseBranch={effectiveBaseBranch}
											currentBranch={currentBranch}
											diffCtx={diffCtx}
											workspaceId={activeWorkspaceId}
										/>
									</div>
								)}
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}

function ExplorerPanelContent({ onClose }: { onClose?: () => void }) {
	const togglePanelMode = useTabStore((s) => s.togglePanelMode);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PanelHeader
				mode="explorer"
				onSetMode={(m) => {
					if (m !== "explorer") togglePanelMode();
				}}
				onClose={onClose}
			/>
			{!activeWorkspaceId ? (
				<div className="flex flex-1 items-center justify-center">
					<span className="text-[12px] text-[var(--text-quaternary)]">Select a workspace</span>
				</div>
			) : activeWorkspaceCwd ? (
				<RepoFileTree repoPath={activeWorkspaceCwd} workspaceId={activeWorkspaceId} />
			) : null}
		</div>
	);
}

function PanelEdgeClose({ onClose }: { onClose: () => void }) {
	return (
		<button
			type="button"
			onClick={onClose}
			className="absolute top-1/2 left-0 z-10 -translate-x-1/2 -translate-y-1/2 rounded-l-md border border-r-0 border-[var(--border)] bg-[var(--bg-surface)] px-1 py-5 text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
			title="Close panel"
		>
			<svg
				width="8"
				height="14"
				viewBox="0 0 8 14"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M1 1l6 6-6 6" />
			</svg>
		</button>
	);
}

export function DiffPanel({ onClose }: { onClose?: () => void }) {
	const rightPanel = useTabStore((s) => s.rightPanel);

	if (!rightPanel.open) return null;

	if (rightPanel.mode === "pr-review" && rightPanel.prCtx) {
		return (
			<div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
				{onClose && <PanelEdgeClose onClose={onClose} />}
				<PRControlRail prCtx={rightPanel.prCtx} />
			</div>
		);
	}

	return (
		<div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{onClose && <PanelEdgeClose onClose={onClose} />}
			{rightPanel.diffCtx ? (
				<DiffPanelContent diffCtx={rightPanel.diffCtx} onClose={onClose} />
			) : (
				<>
					<PanelHeader mode="diff" onSetMode={() => {}} onClose={onClose} />
					<div className="flex flex-1 items-center justify-center">
						<span className="text-[12px] text-[var(--text-quaternary)]">Select a workspace</span>
					</div>
				</>
			)}
		</div>
	);
}
