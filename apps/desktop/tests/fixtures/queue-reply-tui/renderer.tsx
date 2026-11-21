import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { QueueView } from "../../../src/renderer/components/queue/QueueView";
import { useActivityQueueStore } from "../../../src/renderer/stores/activity-queue-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
const client = new QueryClient({
	defaultOptions: { queries: { retry: false, refetchInterval: 250 } },
});
Object.assign(window, {
	queueReplyProbe: {
		refresh: () => client.invalidateQueries(),
		select: (id: string) => useActivityQueueStore.setState({ selectedWorkspaceItemId: id }),
	},
});
const host = document.getElementById("root");
if (!host) throw Error("Missing root");
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<QueueView />
		</QueryClientProvider>
	</trpc.Provider>
);
