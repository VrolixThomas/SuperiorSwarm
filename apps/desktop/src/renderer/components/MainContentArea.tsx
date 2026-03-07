import { useShallow } from "zustand/react/shallow";
import { useTabStore } from "../stores/tab-store";
import { DiffFileTab } from "./DiffFileTab";
import { FileEditor } from "./FileEditor";
import { PRReviewFileTab } from "./PRReviewFileTab";
import { TabBar } from "./TabBar";
import { Terminal } from "./Terminal";

interface MainContentAreaProps {
	savedScrollback: Record<string, string>;
}

export function MainContentArea({ savedScrollback }: MainContentAreaProps) {
	const visibleTabs = useTabStore(useShallow((s) => s.getVisibleTabs()));
	const activeTabId = useTabStore((s) => s.activeTabId);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? null;
	const terminalTabs = visibleTabs.filter((t) => t.kind === "terminal");

	return (
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
			<TabBar />
			<div className="relative flex-1 overflow-hidden">
				{/* Empty state: no workspace selected */}
				{!activeWorkspaceId && (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Select a workspace to open a terminal
					</div>
				)}

				{/* Empty state: workspace selected but no tabs */}
				{activeWorkspaceId && visibleTabs.length === 0 && (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						No terminals open — click + to create one
					</div>
				)}

				{/* Terminal tabs: ALWAYS mounted, toggled visible/invisible via CSS */}
				{terminalTabs.map((tab) => (
					<div
						key={tab.id}
						className={`absolute inset-0 ${tab.id === activeTabId ? "visible" : "invisible"}`}
					>
						<Terminal
							id={tab.id}
							cwd={tab.kind === "terminal" ? tab.cwd : undefined}
							initialContent={savedScrollback[tab.id]}
						/>
					</div>
				))}

				{/* Non-terminal tabs: only the active one renders */}
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
			</div>
		</main>
	);
}
