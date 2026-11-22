import { useQueueTicketStore } from "../../stores/queue-ticket-store";
import { trpc } from "../../trpc/client";

/** Exact account/site view, independent of Tickets filters and the legacy unscoped cache. */
export function QueueTicketDetail() {
	const destination = useQueueTicketStore((state) => state.destination);
	const close = useQueueTicketStore((state) => state.close);
	if (!destination) return null;
	return <QueueTicketDetailBody destination={destination} close={close} />;
}
function QueueTicketDetailBody({
	destination,
	close,
}: {
	destination: NonNullable<ReturnType<typeof useQueueTicketStore.getState>["destination"]>;
	close: () => void;
}) {
	const detail = trpc.activityQueue.ticketDetail.useQuery(
		{
			sourceId: destination.sourceId,
			provider: destination.target.provider,
			accountId: destination.target.accountId,
			siteId: destination.target.siteId,
			ticketId: destination.target.ticketId,
		},
		{ staleTime: 0, refetchInterval: 30_000, retry: false }
	);
	const data = detail.data;
	return (
		<main className="h-full min-w-0 overflow-y-auto p-6">
			<div className="mx-auto flex max-w-3xl flex-col gap-5">
				<button type="button" onClick={close} className="self-start text-[var(--text-secondary)]">
					← Back to Tickets
				</button>
				{detail.isPending ? (
					<p>Loading ticket…</p>
				) : detail.error ? (
					<p role="alert">{detail.error.message}</p>
				) : data ? (
					<>
						<div className="text-sm text-[var(--text-secondary)]">
							{data.issue.provider === "linear" ? "Linear" : "Jira"} · {data.issue.groupName} ·{" "}
							{data.issue.identifier}
						</div>
						<h1 className="text-2xl font-semibold">{data.issue.title}</h1>
						<div>{data.issue.status.name}</div>
						<p className="whitespace-pre-wrap break-words">
							{data.description || "No description was provided."}
						</p>
						<button
							type="button"
							onClick={() => void window.electron.shell.openExternal(data.issue.url)}
							className="self-start rounded-lg border border-[var(--border)] px-4 py-2"
						>
							Open on {data.issue.provider === "linear" ? "Linear" : "Jira"}
						</button>
						<h2 className="text-lg font-medium">Comments</h2>
						{data.comments.length === 0 && (
							<p className="text-[var(--text-secondary)]">No comments yet.</p>
						)}
						{data.comments.map((comment) => (
							<article key={comment.id} className="rounded-lg border border-[var(--border)] p-4">
								<div className="mb-2 text-sm text-[var(--text-secondary)]">
									{comment.author} · {new Date(comment.createdAt).toLocaleString()}
								</div>
								<p className="whitespace-pre-wrap break-words">
									{comment.body || "This comment has no text."}
								</p>
							</article>
						))}
					</>
				) : (
					<p>Ticket details are unavailable.</p>
				)}
			</div>
		</main>
	);
}
