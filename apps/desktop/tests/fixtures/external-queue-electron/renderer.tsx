import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { QueueView } from "../../../src/renderer/components/queue/QueueView";
import { WorkspaceQueueSync } from "../../../src/renderer/hooks/useWorkspaceQueue";
import { useActivityQueueStore } from "../../../src/renderer/stores/activity-queue-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
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
