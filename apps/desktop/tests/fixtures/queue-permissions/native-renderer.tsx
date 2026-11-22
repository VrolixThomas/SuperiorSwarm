import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { QueueItemActions } from "../../../src/renderer/components/queue/QueueItemActions";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Surface() {
	const query = trpc.activityQueue.workspaceList.useQuery(undefined, { refetchInterval: 250 });
	return (
		<main className="p-8">
			<h1>Permission response verification</h1>
			<p>Production connected actions and router · native UI · provider stand-ins</p>
			{(query.data?.items ?? []).map((item) => (
				<div
					key={item.id}
					data-provider={item.context.provider}
					data-terminal={item.target.type === "terminal" ? item.target.terminalId : ""}
				>
					<h2>{item.context.provider}</h2>
					<QueueItemActions
						item={item}
						disabled={query.data?.agentStatusAvailable === false}
						refresh={() => query.refetch()}
						onOpen={() => {
							document.body.dataset["openedTerminal"] =
								item.target.type === "terminal" ? item.target.terminalId : "";
						}}
					/>
				</div>
			))}
		</main>
	);
}
const host = document.getElementById("root");
if (!host) throw Error("Missing native fixture root");
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={queryClient}>
		<QueryClientProvider client={queryClient}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
