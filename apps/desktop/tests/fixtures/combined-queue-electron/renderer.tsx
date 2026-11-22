import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { registerCoreActions } from "../../../src/renderer/actions/core-actions";
import { NavRail } from "../../../src/renderer/components/NavRail";
import { QueueBar } from "../../../src/renderer/components/queue/QueueBar";
import { QueueNavigationRuntime } from "../../../src/renderer/components/queue/QueueNavigationRuntime";
import { QueueView } from "../../../src/renderer/components/queue/QueueView";
import { useShortcutListener } from "../../../src/renderer/hooks/useShortcutListener";
import { WorkspaceQueueSync } from "../../../src/renderer/hooks/useWorkspaceQueue";
import { useProjectStore } from "../../../src/renderer/stores/projects";
import { useQueueNavigationStore } from "../../../src/renderer/stores/queue-navigation-store";
import { useQueueTicketStore } from "../../../src/renderer/stores/queue-ticket-store";
import { useReviewModeStore } from "../../../src/renderer/stores/review-mode-store";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
registerCoreActions();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
for (const id of ["w-repo", "w-folder", "w-orchestrator"]) {
	const workspace = await trpcVanilla.workspaces.getById.query({ id });
	if (!workspace) throw Error("Missing workspace");
	useTabStore.getState().addTerminalTab(id, workspace.path, id, `terminal-${id}`);
}
useTabStore.getState().setSidebarSegment("queue");
Object.assign(window, {
	mixedQueue: {
		refresh: () => client.invalidateQueries(),
		jump: async (id: string) => {
			const item = (await trpcVanilla.activityQueue.viewList.query()).items.find(
				(i) => i.id === id
			);
			if (!item) throw Error("Missing item");
			useQueueNavigationStore.getState().openItem(item);
		},
		peek: () => useQueueNavigationStore.getState().peek(),
		end: () => useQueueNavigationStore.getState().end(),
		state: () => {
			const tab = useTabStore.getState();
			return {
				workspace: tab.activeWorkspaceId,
				terminal: tab.getActiveTabId(),
				segment: tab.sidebarSegment,
				project: useProjectStore.getState().selectedProjectId,
				ticket: useQueueTicketStore.getState().destination?.target.ticketId,
				pr: useReviewModeStore.getState().active?.prCtx.number,
				intent: tab.terminalCreateIntents[tab.getActiveTabId() ?? ""],
				sessionId: useQueueNavigationStore.getState().session?.item.id,
			};
		},
	},
});
function Surface() {
	useShortcutListener();
	const segment = useTabStore((s) => s.sidebarSegment);
	const workspace = useTabStore((s) => s.activeWorkspaceId);
	return (
		<>
			<WorkspaceQueueSync />
			<QueueNavigationRuntime />
			<NavRail />
			<div className="ml-[72px]" style={{ height: "100vh" }}>
				{segment === "queue" ? (
					<main data-mixed-queue style={{ height: "100%" }}>
						<QueueView />
					</main>
				) : (
					<section>
						<QueueBar entity={workspace ? { kind: "workspace", id: workspace } : null} />
						<h1>Verified fixture destination</h1>
						<output>{workspace ?? segment}</output>
					</section>
				)}
			</div>
		</>
	);
}
createRoot(document.getElementById("root")!).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
