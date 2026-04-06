import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { AIFixesTab } from "./AIFixesTab";
import { BranchChanges } from "./BranchChanges";
import { CommentsOverviewTab } from "./CommentsOverviewTab";
import { CommittedStack } from "./CommittedStack";
import { DraftCommitCard } from "./DraftCommitCard";
import { PRControlRail } from "./PRControlRail";
import { RepoFileTree } from "./RepoFileTree";
import { SmartHeaderBar } from "./SmartHeaderBar";
import { Tooltip } from "./Tooltip";
import { changesIcon, commentsIcon, filesIcon, sparkleIcon } from "./panel-icons";

type DiffPanelTab = "changes" | "files" | "comments" | "ai-fixes";

const panelTabIcons: Record<DiffPanelTab, React.ReactNode> = {
	changes: changesIcon,
	files: filesIcon,
	comments: commentsIcon,
	"ai-fixes": sparkleIcon,
};

function PanelHeader({
	activeTab,
	onSetTab,
	onClose,
}: {
	activeTab: DiffPanelTab;
	onSetTab: (tab: DiffPanelTab) => void;
	onClose?: () => void;
}) {
	const tabs: { key: DiffPanelTab; label: string }[] = [
		{ key: "changes", label: "Changes" },
		{ key: "files", label: "Files" },
		{ key: "comments", label: "Comments" },
		{ key: "ai-fixes", label: "Fixes" },
	];

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
			<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				{tabs.map((t) => (
					<Tooltip key={t.key} label={t.label}>
						<button
							type="button"
							onClick={() => onSetTab(t.key)}
							className={[
								"flex items-center gap-1 rounded-[4px] px-2 py-1 transition-all duration-[120ms]",
								activeTab === t.key
									? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
							].join(" ")}
						>
							{panelTabIcons[t.key]}
						</button>
					</Tooltip>
				))}
			</div>
			<div className="flex-1" />
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
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
	const setBaseBranch = useTabStore((s) => s.setBaseBranch);
	const storedBaseBranch = useTabStore((s) =>
		activeWorkspaceId ? s.baseBranchByWorkspace[activeWorkspaceId] : undefined
	);
	const utils = trpc.useUtils();

	// Fetch default branch to use as initial base
	const defaultBranchQuery = trpc.diff.getDefaultBranch.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ staleTime: 60_000 }
	);

	// Resolve projectId from repoPath so we can pass it down to BranchChip
	const projectsQuery = trpc.projects.list.useQuery(undefined, { staleTime: 60_000 });
	const projectId = projectsQuery.data?.find((p) => p.repoPath === diffCtx.repoPath)?.id ?? null;

	const effectiveBaseBranch = storedBaseBranch ?? defaultBranchQuery.data?.branch ?? "main";

	// Working tree status (staged/unstaged split)
	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ enabled: diffCtx.type === "working-tree", staleTime: 30_000 }
	);

	const branchStatusQuery = trpc.branches.getStatus.useQuery(
		{ projectId: projectId ?? "", cwd: activeWorkspaceCwd || undefined },
		{ enabled: !!projectId, refetchInterval: 10_000 }
	);

	const invalidateAll = () => {
		utils.diff.getWorkingTreeDiff.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getWorkingTreeStatus.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getCommitsAhead.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getBranchDiff.invalidate();
		utils.branches.getStatus.invalidate();
	};

	const stageMutation = trpc.diff.stageFiles.useMutation({
		onSuccess: invalidateAll,
	});

	const unstageMutation = trpc.diff.unstageFiles.useMutation({
		onSuccess: invalidateAll,
	});

	const currentBranch = statusQuery.data?.branch ?? "";
	const hasStatusData = diffCtx.type === "working-tree" && statusQuery.data != null;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PanelHeader activeTab={activeTab} onSetTab={setActiveTab} onClose={onClose} />

			{activeTab === "comments" && activeWorkspaceId ? (
				<CommentsOverviewTab workspaceId={activeWorkspaceId} />
			) : activeTab === "ai-fixes" && activeWorkspaceId ? (
				<AIFixesTab workspaceId={activeWorkspaceId} />
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
							projectId={projectId}
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
										unpushedCommits={branchStatusQuery.data?.ahead ?? 0}
										hasTrackingBranch={branchStatusQuery.data?.tracking != null}
									/>
								)}

								{/* Branch changes — full diff vs base */}
								{currentBranch && (
									<div className="mt-3">
										<BranchChanges
											repoPath={diffCtx.repoPath}
											baseBranch={effectiveBaseBranch}
											currentBranch={currentBranch}
											diffCtx={diffCtx}
											workspaceId={activeWorkspaceId}
										/>
									</div>
								)}

								{/* Committed stack */}
								<div className="mt-1 mb-4">
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
				</>
			)}
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
					<PanelHeader activeTab="changes" onSetTab={() => {}} onClose={onClose} />
					<div className="flex flex-1 items-center justify-center">
						<span className="text-[12px] text-[var(--text-quaternary)]">Select a workspace</span>
					</div>
				</>
			)}
		</div>
	);
}
