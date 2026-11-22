import type { Pane } from "../../../shared/pane-types";
import { isReviewPathTerminal } from "../../../shared/terminal-create";
import { BrowserTab } from "../../browser/BrowserTab";
import { usePaneStore } from "../../stores/pane-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { CrossRepoOrchestratorCanvas } from "../CrossRepoOrchestratorCanvas";
import { DiffFileTab } from "../DiffFileTab";
import { FileEditor } from "../FileEditor";
import { MergeConflictPane } from "../MergeConflictPane";
import { PROverviewTab } from "../PROverviewTab";
import { PRReviewFileTab } from "../PRReviewFileTab";
import { SolveReviewTab } from "../SolveReviewTab";
import { Terminal } from "../Terminal";
import { ReviewAgentTab } from "../review-mode/ReviewAgentTab";
import { ReviewAgentTerminal } from "../review-mode/ReviewAgentTerminal";
import { ReviewWorkspace } from "../review-mode/ReviewWorkspace";
import { ReviewTab } from "../review/ReviewTab";

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

	const metadata = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const shellReady = metadata?.type !== "review" || !!metadata.reviewWorktreePath;
	const focused = usePaneStore((s) => s.focusedPaneId === pane.id);
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
					{isReviewPathTerminal(tab.id) ? (
						<ReviewAgentTerminal
							id={tab.id}
							cwd={tab.cwd}
							workspaceId={tab.workspaceId}
							initialContent={savedScrollback[tab.id]}
							active={tab.id === pane.activeTabId}
						/>
					) : shellReady ? (
						<Terminal
							id={tab.id}
							cwd={tab.kind === "terminal" ? tab.cwd : undefined}
							workspaceId={tab.workspaceId}
							initialContent={savedScrollback[tab.id]}
							active={tab.id === pane.activeTabId}
						/>
					) : (
						<p className="p-6 text-[13px] text-[var(--text-secondary)]">
							Start an agent to prepare an isolated review worktree before opening this shell.
						</p>
					)}
				</div>
			))}

			{pane.tabs
				.filter((t) => t.kind === "pr-review")
				.map(
					(tab) =>
						tab.kind === "pr-review" && (
							<div
								key={tab.id}
								className={`absolute inset-0 ${tab.id === pane.activeTabId ? "visible" : "invisible"}`}
								inert={tab.id !== pane.activeTabId}
							>
								<ReviewWorkspace
									active={{ workspaceId: tab.workspaceId, prCtx: tab.prCtx }}
									tabMode
									isActive={focused && tab.id === pane.activeTabId}
									paneId={pane.id}
								/>
							</div>
						)
				)}
			{pane.tabs
				.filter((t) => t.kind === "review-agent")
				.map(
					(tab) =>
						tab.kind === "review-agent" && (
							<div
								key={tab.id}
								className={`absolute inset-0 ${tab.id === pane.activeTabId ? "visible" : "invisible"}`}
								inert={tab.id !== pane.activeTabId}
							>
								<ReviewAgentTab
									workspaceId={workspaceId}
									jobId={tab.jobId}
									active={tab.id === pane.activeTabId}
									savedScrollback={savedScrollback}
									legacyTerminalId={tab.terminalId}
									legacyCwd={tab.cwd}
								/>
							</div>
						)
				)}
			{/* Other documents mount only when active. */}
			{activeTab?.kind === "browser" && (
				<div className="absolute inset-0">
					<BrowserTab key={activeTab.id} tab={activeTab} />
				</div>
			)}
			{activeTab?.kind === "diff-file" && (
				<div className="absolute inset-0">
					<DiffFileTab
						key={`${activeTab.diffCtx.repoPath}:${activeTab.filePath}`}
						diffCtx={activeTab.diffCtx}
						filePath={activeTab.filePath}
						language={activeTab.language}
						workspaceId={activeTab.workspaceId}
					/>
				</div>
			)}
			{activeTab?.kind === "file" && (
				<div className="absolute inset-0">
					<FileEditor
						key={`${activeTab.repoPath}:${activeTab.filePath}`}
						tabId={activeTab.id}
						workspaceId={activeTab.workspaceId}
						paneId={pane.id}
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
			{activeTab?.kind === "xro-canvas" && (
				<div className="absolute inset-0">
					<CrossRepoOrchestratorCanvas
						key={activeTab.orchestratorId}
						orchestratorId={activeTab.orchestratorId}
					/>
				</div>
			)}
			{activeTab?.kind === "review" && (
				<div className="absolute inset-0">
					<ReviewTab
						workspaceId={activeTab.workspaceId}
						repoPath={activeTab.repoPath}
						baseBranch={activeTab.baseBranch}
					/>
				</div>
			)}
		</div>
	);
}
