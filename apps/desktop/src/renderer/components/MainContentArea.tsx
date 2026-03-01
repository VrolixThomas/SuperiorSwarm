import { useShallow } from "zustand/react/shallow";
import { useTabsStore } from "../stores/tabs";
import { useTerminalStore } from "../stores/terminal";
import { DiffFileTab } from "./DiffFileTab";
import { FileEditor } from "./FileEditor";
import { TabBar } from "./TabBar";
import { Terminal } from "./Terminal";

interface MainContentAreaProps {
	savedScrollback: Record<string, string>;
}

export function MainContentArea({ savedScrollback }: MainContentAreaProps) {
	const visibleTabs = useTerminalStore(useShallow((s) => s.getVisibleTabs()));
	const activeTerminalTabId = useTerminalStore((s) => s.activeTabId);
	const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId);
	const { fileTabs, activePane } = useTabsStore();

	const activeFileTab =
		activePane.kind === "file"
			? fileTabs.find((t) => t.id === activePane.tabId)
			: null;

	const showTerminal = activePane.kind === "terminal";

	return (
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
			<TabBar />
			<div className="relative flex-1 overflow-hidden">
				{/* Terminal layer — always mounted to preserve PTY state; hidden when file tab is active */}
				<div
					className={`absolute inset-0 flex flex-col ${showTerminal ? "" : "invisible pointer-events-none"}`}
				>
					{!activeWorkspaceId && showTerminal && (
						<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
							Select a workspace to open a terminal
						</div>
					)}
					{activeWorkspaceId && visibleTabs.length === 0 && showTerminal && (
						<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
							No terminals open — click + to create one
						</div>
					)}
					{visibleTabs.map((tab) => (
						<div
							key={tab.id}
							className={`absolute inset-0 ${tab.id === activeTerminalTabId ? "visible" : "invisible"}`}
						>
							<Terminal
								id={tab.id}
								cwd={tab.cwd || undefined}
								initialContent={savedScrollback[tab.id]}
							/>
						</div>
					))}
				</div>

				{/* File/diff layer — rendered on top when a file tab is active */}
				{activeFileTab && (
					<div className="absolute inset-0">
						{activeFileTab.type === "diff-file" && (
							<DiffFileTab
								key={`${activeFileTab.diffCtx.repoPath}:${activeFileTab.filePath}`}
								diffCtx={activeFileTab.diffCtx}
								filePath={activeFileTab.filePath}
								language={activeFileTab.language}
							/>
						)}
						{activeFileTab.type === "file" && (
							<FileEditor
								key={`${activeFileTab.repoPath}:${activeFileTab.filePath}`}
								repoPath={activeFileTab.repoPath}
								filePath={activeFileTab.filePath}
								language={activeFileTab.language}
							/>
						)}
					</div>
				)}

				{/* Empty state when file tab active but no tab found */}
				{!showTerminal && !activeFileTab && (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Select a file from the file tree
					</div>
				)}
			</div>
		</main>
	);
}
