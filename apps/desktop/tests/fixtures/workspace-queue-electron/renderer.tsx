import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MainLayout } from "../../../src/renderer/components/MainLayout";
import { NavRail } from "../../../src/renderer/components/NavRail";
import { QueueView } from "../../../src/renderer/components/queue/QueueView";
import { WorkspaceQueueSync } from "../../../src/renderer/hooks/useWorkspaceQueue";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
for (const id of ["w1", "w2", "w3"])
	useTabStore.getState().addTerminalTab(id, "/tmp", id, `terminal-${id}`);
localStorage.setItem(
	"react-resizable-panels:app-layout",
	JSON.stringify({ sidebar: 21, main: 54, diff: 25 })
);
useTabStore.getState().setSidebarSegment("repos");
useTabStore.getState().setActiveWorkspace("w1", "/tmp");
useTabStore.getState().setSidebarSegment("queue");
function Surface() {
	const segment = useTabStore((s) => s.sidebarSegment);
	const workspace = useTabStore((s) => s.activeWorkspaceId);
	return (
		<>
			<WorkspaceQueueSync />
			<NavRail />
			<div className="ml-[72px] min-w-0">
				<MainLayout
					sidebar={() => <div data-workspace-sidebar>Workspace list</div>}
					diff={<aside data-workspace-diff>Repository tools</aside>}
				>
					{segment === "queue" ? (
						<QueueView />
					) : (
						<main data-queue-workspace={workspace} tabIndex={-1} className="p-8">
							<h1>Workspace</h1>
							<div data-terminal-id={`terminal-${workspace}`}>
								<textarea aria-label="Agent input" className="xterm-helper-textarea" />
							</div>
						</main>
					)}
				</MainLayout>
			</div>
		</>
	);
}
const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
