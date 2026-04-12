import type { Pane } from "../../../shared/pane-types";
import { trpc } from "../../trpc/client";
import { CommentFixFileTab } from "../CommentFixFileTab";
import { DiffFileTab } from "../DiffFileTab";
import { FileEditor } from "../FileEditor";
import { MergeConflictPane } from "../MergeConflictPane";
import { PROverviewTab } from "../PROverviewTab";
import { PRReviewFileTab } from "../PRReviewFileTab";
import { ReviewWorkspaceTab } from "../ReviewWorkspaceTab";
import { SolveReviewTab } from "../SolveReviewTab";
import { Terminal } from "../Terminal";

export function PaneContent({
	pane,
	workspaceId,
	savedScrollback,
}: {
	pane: Pane;
	workspaceId: string;
	savedScrollback: Record<string, string>;
}) {
	const workspaceQuery = trpc.workspaces.getById.useQuery(
		{ id: workspaceId },
		{ staleTime: 60_000 }
	);
	const projectId = workspaceQuery.data?.projectId ?? null;

	const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
	const terminalTabs = pane.tabs.filter((t) => t.kind === "terminal");

	return (
		<div className="relative flex-1 overflow-hidden">
			{pane.tabs.length === 0 && (
				<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
					Empty pane — press + to create a terminal
				</div>
			)}

			{/* Terminal tabs: always mounted, CSS visibility toggled */}
			{terminalTabs.map((tab) => (
				<div
					key={tab.id}
					className={`absolute inset-0 ${tab.id === pane.activeTabId ? "visible" : "invisible"}`}
				>
					<Terminal
						id={tab.id}
						cwd={tab.kind === "terminal" ? tab.cwd : undefined}
						workspaceId={tab.workspaceId}
						initialContent={savedScrollback[tab.id]}
					/>
				</div>
			))}

			{/* Non-terminal: mount only if active */}
			{activeTab?.kind === "diff-file" && (
				<div className="absolute inset-0">
					<DiffFileTab
						key={`${activeTab.diffCtx.repoPath}:${activeTab.filePath}`}
						diffCtx={activeTab.diffCtx}
						filePath={activeTab.filePath}
						language={activeTab.language}
					/>
				</div>
			)}
			{activeTab?.kind === "file" && (
				<div className="absolute inset-0">
					<FileEditor
						key={`${activeTab.repoPath}:${activeTab.filePath}`}
						tabId={activeTab.id}
						repoPath={activeTab.repoPath}
						filePath={activeTab.filePath}
						language={activeTab.language}
						initialPosition={activeTab.initialPosition}
					/>
				</div>
			)}
			{activeTab?.kind === "pr-review-file" && (
				<div className="absolute inset-0">
					<PRReviewFileTab
						key={`${activeTab.prCtx.owner}/${activeTab.prCtx.repo}#${activeTab.prCtx.number}:${activeTab.filePath}`}
						prCtx={activeTab.prCtx}
						filePath={activeTab.filePath}
						language={activeTab.language}
					/>
				</div>
			)}
			{activeTab?.kind === "pr-overview" && (
				<div className="absolute inset-0">
					<PROverviewTab
						key={`${activeTab.prCtx.owner}/${activeTab.prCtx.repo}#${activeTab.prCtx.number}`}
						prCtx={activeTab.prCtx}
					/>
				</div>
			)}
			{activeTab?.kind === "comment-fix-file" && (
				<div className="absolute inset-0">
					<CommentFixFileTab
						key={`${activeTab.groupId}:${activeTab.filePath}`}
						repoPath={activeTab.repoPath}
						filePath={activeTab.filePath}
						commitHash={activeTab.commitHash}
						language={activeTab.language}
					/>
				</div>
			)}
			{activeTab?.kind === "merge-conflict" && projectId && (
				<div className="absolute inset-0">
					<MergeConflictPane
						key={activeTab.id}
						projectId={projectId}
						mergeType={activeTab.mergeType}
						sourceBranch={activeTab.sourceBranch}
						targetBranch={activeTab.targetBranch}
					/>
				</div>
			)}
			{activeTab?.kind === "solve-review" && (
				<div className="absolute inset-0">
					<SolveReviewTab
						workspaceId={activeTab.workspaceId}
						solveSessionId={activeTab.solveSessionId}
					/>
				</div>
			)}
			{activeTab?.kind === "review-workspace" && (
				<div className="absolute inset-0">
					<ReviewWorkspaceTab
						workspaceId={activeTab.workspaceId}
						draftId={activeTab.draftId}
					/>
				</div>
			)}
		</div>
	);
}
