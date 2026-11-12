import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { ActivityQueueButton } from "../../../src/renderer/components/ActivityQueueButton";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<ActivityQueueButton />
		</QueryClientProvider>
	</trpc.Provider>
);
