// Actual application renderer, with controlled account/project backend data.
// Browser IPC, the webview host, panes, sidebar, dialogs and terminal components are production code.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App";
import { ErrorBoundary } from "../../src/renderer/components/ErrorBoundary";
import { useActionStore } from "../../src/renderer/stores/action-store";
import { usePaneStore } from "../../src/renderer/stores/pane-store";
import { useProjectStore } from "../../src/renderer/stores/projects";
import { useTabStore } from "../../src/renderer/stores/tab-store";
import { trpc } from "../../src/renderer/trpc/client";

const url = new URL(location.href).searchParams.get("url") ?? "";
const workspace = {
	id: "workspace-a",
	projectId: "project-a",
	type: "folder",
	name: "Browser acceptance",
	folderPath: "/tmp",
	worktreePath: null,
	currentPhase: "idle",
	isOrchestrator: false,
	sortOrder: 0,
};
const project = {
	id: "project-a",
	name: "Browser acceptance",
	repoPath: "/tmp",
	kind: "folder",
	defaultBranch: "main",
	sortOrder: 0,
};
const tabs = [
	{
		kind: "terminal",
		id: "terminal-a",
		workspaceId: "workspace-a",
		title: "Terminal 1",
		cwd: "/tmp",
	},
	{
		kind: "terminal",
		id: "terminal-b",
		workspaceId: "workspace-a",
		title: "Terminal 2",
		cwd: "/tmp",
	},
	{
		kind: "browser",
		id: "browser-test",
		workspaceId: "workspace-a",
		title: "Browser",
		url,
		viewport: "desktop",
	},
];
function response(path: string, input: unknown) {
	if (path === "auth.getSession")
		return { user: { id: "browser-test-user", email: "browser-test@example.invalid" } };
	if (path === "terminalSessions.restore")
		return {
			sessions: tabs.filter((tab) => tab.kind === "terminal"),
			state: {
				activeWorkspaceId: workspace.id,
				activeWorkspaceCwd: "/tmp",
				sidebarSegment: "repos",
				activeTabId: "browser-test",
				expandedProjectIds: JSON.stringify([project.id]),
			},
			paneLayouts: {
				[workspace.id]: JSON.stringify({
					type: "pane",
					id: "pane-1",
					tabs,
					activeTabId: "browser-test",
				}),
			},
			workspaceMeta: { [workspace.id]: workspace },
		};
	if (path === "projects.list") return [project];
	if (path === "projects.getById") return project;
	if (path === "workspaces.getById") return workspace;
	if (path === "workspaces.listByProject") return { orchestrators: [], loose: [workspace] };
	if (path === "updates.getStatus")
		return {
			currentVersion: "0.23.4",
			revision: 0,
			recovery: "none",
			message: null,
			updateAvailable: false,
			updateVersion: null,
			downloadProgress: null,
			updateDownloaded: false,
			phase: "idle",
			dismissedUpdateVersion: null,
			pendingNotification: null,
		};
	if (path === "updates.getReleaseNotes") return { version: "0.23.4", body: null };
	if (path === "settings.getTheme") return "dark";
	if (path === "settings.getFont") return { family: "system-ui", size: 13 };
	if (path === "settings.getDebugMode") return false;
	if (path === "settings.getAgentSleep")
		return { enabled: false, idleMinutes: 15, keepOrchestratorsAwake: true };
	if (path === "settings.getTerminalSettings") return {};
	if (path === "settings.getCliPresets") return [];
	if (path === "atlassian.getStatus")
		return { jira: { connected: false }, bitbucket: { connected: false } };
	if (path === "linear.getStatus") return { connected: false };
	if (path === "tickets.getDefaultNavigation") return null;
	if (path === "branches.getStatus")
		return { current: "main", ahead: 0, behind: 0, hasUpstream: false };
	if (path === "diff.getWorkingTreeStatus")
		return {
			stagedFiles: [],
			unstagedFiles: [],
			untrackedFiles: [],
			staged: [],
			unstaged: [],
			untracked: [],
		};
	if (path === "diff.getDefaultBranch") return "main";
	if (path === "agentSessions.getStatus") return null;
	if (path === "terminalSessions.save") return { success: true };
	if (/list|getReviewDrafts|getCachedPRs|getPresets|getSharedFiles|cloneProgress/.test(path))
		return [];
	if (path.startsWith("settings.")) return null;
	console.debug("[app-fixture]", path, typeof input);
	return null;
}
const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, refetchOnWindowFocus: false },
		mutations: { retry: false },
	},
});
const client = trpc.createClient({
	links: [
		() =>
			({ op }) =>
				observable((observer) => {
					observer.next({ result: { data: response(op.path, op.input) } });
					observer.complete();
				}),
	],
});
Object.assign(window, {
	browserFixture: {
		close: () => usePaneStore.getState().clearLayout(workspace.id),
		selectOriginal: () => useTabStore.getState().setActiveTab("browser-test"),
		selectTerminal: () => useTabStore.getState().setActiveTab("terminal-a"),
		paletteOpen: () => useActionStore.getState().isPaletteOpen,
		closePalette: () => useActionStore.getState().closePalette(),
		openDialog: () => useProjectStore.getState().openAddModal(),
		closeDialog: () => useProjectStore.getState().closeAddModal(),
		split: () => {
			const panes = usePaneStore.getState();
			const pane = panes.findPaneForTab(workspace.id, "browser-test");
			const tab = pane?.tabs.find((tab) => tab.id === "browser-test");
			if (pane && tab) panes.splitPane(workspace.id, pane.id, "horizontal", tab);
		},
	},
});
const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<trpc.Provider client={client} queryClient={queryClient}>
				<QueryClientProvider client={queryClient}>
					<ErrorBoundary>
						<App />
					</ErrorBoundary>
				</QueryClientProvider>
			</trpc.Provider>
		</StrictMode>
	);
