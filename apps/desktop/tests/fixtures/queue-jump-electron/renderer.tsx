import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { registerCoreActions } from "../../../src/renderer/actions/core-actions";
import { MainContentArea } from "../../../src/renderer/components/MainContentArea";
import { MainLayout } from "../../../src/renderer/components/MainLayout";
import { NavRail } from "../../../src/renderer/components/NavRail";
import { Sidebar } from "../../../src/renderer/components/Sidebar";
import { QueueNavigationRuntime } from "../../../src/renderer/components/queue/QueueNavigationRuntime";
import { useShortcutListener } from "../../../src/renderer/hooks/useShortcutListener";
import { WorkspaceQueueSync } from "../../../src/renderer/hooks/useWorkspaceQueue";
import { useProjectStore } from "../../../src/renderer/stores/projects";
import { useQueueNavigationStore } from "../../../src/renderer/stores/queue-navigation-store";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
registerCoreActions();
useProjectStore.setState({ expandedProjectIds: new Set(["p1", "p2"]) });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
for (const id of ["w1", "w2", "w3"]) {
	const workspace = await trpcVanilla.workspaces.getById.query({ id });
	if (!workspace) throw Error("Missing native fixture workspace");
	useTabStore.getState().addTerminalTab(id, workspace.path, id, `terminal-${id}`);
	if (id !== "w3")
		useTabStore.getState().addTerminalTab(id, workspace.path, "Unrelated sibling", `sibling-${id}`);
}
useTabStore.getState().setSidebarSegment("queue");
// Read-only identity plus explicit test gestures; no replacement navigation or custom queue source.
Object.assign(window, {
	queueFixture: {
		refresh: () => client.invalidateQueries(),
		selectSibling: () => useTabStore.getState().setActiveTab("sibling-w1"),
		selectReporter: () => useTabStore.getState().setActiveTab("terminal-w1"),
		end: () => useQueueNavigationStore.getState().end(),
		state: () => ({
			workspace: useTabStore.getState().activeWorkspaceId,
			terminal: useTabStore.getState().getActiveTabId(),
			session: useQueueNavigationStore.getState().session,
		}),
		addCoordinator: (path: string) =>
			useTabStore.getState().addTerminalTab("xro-native", path, "Coordinator", "coordinator-chat"),
	},
});
function Surface() {
	useShortcutListener();
	return (
		<>
			<WorkspaceQueueSync />
			<QueueNavigationRuntime />
			<NavRail />
			<div className="ml-[72px] min-w-0">
				<MainLayout
					sidebar={(collapsed, onExpand) => <Sidebar collapsed={collapsed} onExpand={onExpand} />}
					diff={<aside>Repository tools</aside>}
				>
					<MainContentArea savedScrollback={{}} />
				</MainLayout>
			</div>
		</>
	);
}
const host = document.getElementById("root");
if (!host) throw Error("Missing fixture root");
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
