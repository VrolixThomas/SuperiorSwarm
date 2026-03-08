import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import { type PanelMode, useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CommittedStack } from "./CommittedStack";
import { DraftCommitCard } from "./DraftCommitCard";
import { PRReviewPanel } from "./PRReviewPanel";
import { RepoFileTree } from "./RepoFileTree";
import { SmartHeaderBar } from "./SmartHeaderBar";

function PanelHeader({
	mode,
	stats,
	onSetMode,
}: {
	mode: PanelMode;
	stats?: { added: number; removed: number; changed: number };
	onSetMode: (mode: PanelMode) => void;
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
			{/* Segmented control */}
			<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				<button
					type="button"
					onClick={() => onSetMode("diff")}
					className={[
						"rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
						mode === "diff"
							? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
							: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
					].join(" ")}
				>
					Changes
				</button>
				<button
					type="button"
					onClick={() => onSetMode("explorer")}
					className={[
						"rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
						mode === "explorer"
							? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
							: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
					].join(" ")}
				>
					Files
				</button>
			</div>

			<div className="flex-1" />

			{stats && (
				<div className="flex items-center rounded-full bg-[var(--bg-base)] px-2 py-0.5 text-[11px]">
					<span className="text-[var(--term-green)]">+{stats.added + stats.changed}</span>
					<span className="mx-1 text-[var(--text-quaternary)]">/</span>
					<span className="text-[var(--term-red)]">-{stats.removed}</span>
				</div>
			)}
		</div>
	);
}

function DiffPanelContent({ diffCtx }: { diffCtx: DiffContext }) {
	const togglePanelMode = useTabStore((s) => s.togglePanelMode);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const [baseBranch, setBaseBranch] = useState<string | null>(null);

	const utils = trpc.useUtils();

	// Fetch default branch to use as initial base
	const defaultBranchQuery = trpc.diff.getDefaultBranch.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ staleTime: 60_000 }
	);

	const effectiveBaseBranch = baseBranch ?? defaultBranchQuery.data?.branch ?? "main";

	// Working tree status (staged/unstaged split)
	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ enabled: diffCtx.type === "working-tree", staleTime: 5_000 }
	);

	// Working tree diff (for stats)
	const workingTreeQuery = trpc.diff.getWorkingTreeDiff.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ enabled: diffCtx.type === "working-tree", staleTime: 10_000 }
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

	const invalidateWorkingTree = () => {
		utils.diff.getWorkingTreeDiff.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getWorkingTreeStatus.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getCommitsAhead.invalidate({
			repoPath: diffCtx.repoPath,
			baseBranch: effectiveBaseBranch,
		});
	};

	const stageMutation = trpc.diff.stageFiles.useMutation({
		onSuccess: invalidateWorkingTree,
	});

	const unstageMutation = trpc.diff.unstageFiles.useMutation({
		onSuccess: invalidateWorkingTree,
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
			/>

			{/* Smart header bar — only for working-tree mode */}
			{diffCtx.type === "working-tree" && currentBranch && (
				<SmartHeaderBar
					repoPath={diffCtx.repoPath}
					currentBranch={currentBranch}
					baseBranch={effectiveBaseBranch}
					onBaseBranchChange={setBaseBranch}
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
								onUnstage={(paths) => unstageMutation.mutate({ repoPath: diffCtx.repoPath, paths })}
								onInvalidate={invalidateWorkingTree}
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
					</>
				)}
			</div>
		</div>
	);
}

function ExplorerPanelContent() {
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
			/>
			<div className="flex-1 overflow-y-auto px-1 py-1">
				{!activeWorkspaceId && (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
						Select a workspace
					</div>
				)}
				{activeWorkspaceId && activeWorkspaceCwd && (
					<RepoFileTree repoPath={activeWorkspaceCwd} workspaceId={activeWorkspaceId} />
				)}
			</div>
		</div>
	);
}

export function DiffPanel() {
	const rightPanel = useTabStore((s) => s.rightPanel);

	if (!rightPanel.open) return null;

	if (rightPanel.mode === "pr-review" && rightPanel.prCtx) {
		return (
			<div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
				<PRReviewPanel prCtx={rightPanel.prCtx} />
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{rightPanel.mode === "diff" && rightPanel.diffCtx ? (
				<DiffPanelContent diffCtx={rightPanel.diffCtx} />
			) : rightPanel.mode === "explorer" ? (
				<ExplorerPanelContent />
			) : (
				<>
					<PanelHeader mode="diff" onSetMode={() => {}} />
					<div className="flex flex-1 items-center justify-center">
						<span className="text-[12px] text-[var(--text-quaternary)]">Select a workspace</span>
					</div>
				</>
			)}
		</div>
	);
}
