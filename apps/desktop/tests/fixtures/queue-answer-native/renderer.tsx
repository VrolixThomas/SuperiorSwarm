import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { QueueQuestionReply } from "../../../src/renderer/components/queue/QueueQuestionReply";
import { useQueueAnswerContinuationActions } from "../../../src/renderer/hooks/useQueueAnswerContinuationActions";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Surface() {
	const query = trpc.activityQueue.workspaceList.useQuery(undefined, { refetchInterval: 150 });
	const actions = useQueueAnswerContinuationActions();
	const save = trpc.activityQueue.workspaceAnswer.useMutation();
	return (
		<main className="p-6">
			<h1>Saved-answer continuation verification</h1>
			<p>Production UI, router and SQL admission · controlled daemon and provider callback</p>
			{(query.data?.items ?? [])
				.filter((item) => item.question)
				.map((item) => (
					<section
						key={item.id}
						data-terminal={item.target.type === "terminal" ? item.target.terminalId : ""}
					>
						<h2>{item.context.terminalTitle}</h2>
						<QueueQuestionReply
							item={item}
							inputId={`answer-${item.id}`}
							available={query.data?.agentStatusAvailable !== false}
							answer={(input) => save.mutateAsync(input)}
							continuationActions={actions}
							refresh={() => query.refetch()}
						/>
					</section>
				))}
		</main>
	);
}
const host = document.getElementById("root");
if (!host) throw Error("Missing native root");
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={queryClient}>
		<QueryClientProvider client={queryClient}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
