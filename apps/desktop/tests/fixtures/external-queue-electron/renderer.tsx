import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { QueueView } from "../../../src/renderer/components/queue/QueueView";
import { WorkspaceQueueSync } from "../../../src/renderer/hooks/useWorkspaceQueue";
import { useActivityQueueStore } from "../../../src/renderer/stores/activity-queue-store";
import { useProjectStore } from "../../../src/renderer/stores/projects";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
// Reproduce normal persisted segment history before opening another project's hook.
useProjectStore.setState({ selectedProjectId: "unrelated-project" });
useTabStore.setState({
	activeWorkspaceId: null,
	activeWorkspaceCwd: "",
	sidebarSegment: "queue",
	activeWorkspaceBySegment: { repos: { id: "unrelated-workspace", cwd: "/synthetic/unrelated" } },
});
Object.assign(window, {
	externalQueueNavigationProbe: () => ({
		projectId: useProjectStore.getState().selectedProjectId,
		workspaceId: useTabStore.getState().activeWorkspaceId,
		cwd: useTabStore.getState().activeWorkspaceCwd,
		segment: useTabStore.getState().sidebarSegment,
	}),
});
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Surface() {
	const count = useActivityQueueStore((s) => s.pendingCount);
	return (
		<div style={{ height: "100vh" }}>
			<WorkspaceQueueSync />
			<output data-queue-count>{count}</output>
			<QueueView />
		</div>
	);
}
createRoot(document.getElementById("root")!).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
