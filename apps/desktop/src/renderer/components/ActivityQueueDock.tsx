import { useEffect } from "react";
import { useActivityQueue } from "../hooks/useActivityQueue";
import { focusQueueDestination, openQueueTarget } from "../lib/activity-queue-navigation";
import { useActivityQueueStore } from "../stores/activity-queue-store";
import { ActivityQueuePanel } from "./ActivityQueuePanel";

/** Always mounted in the right utility panel; only its visible view is toggled. */
export function ActivityQueueDock() {
	const { query, acknowledge } = useActivityQueue();
	const { open, close, setSummary } = useActivityQueueStore();
	useEffect(() => {
		setSummary(query.data?.totalPending ?? null, query.isError);
	}, [query.data?.totalPending, query.isError, setSummary]);
	const refresh = query.refetch;
	useEffect(() => {
		if (open) void refresh();
	}, [open, refresh]);
	if (!open) return null;
	return (
		<ActivityQueuePanel
			data={query.data}
			loading={query.isLoading}
			refreshing={query.isFetching}
			error={query.error?.message}
			onRefresh={() => void query.refetch()}
			onClose={() => {
				close();
				requestAnimationFrame(() =>
					document.querySelector<HTMLButtonElement>("[data-queue-trigger]")?.focus()
				);
			}}
			onOpen={async (item) => {
				const destination = await openQueueTarget(item.target);
				focusQueueDestination(destination);
			}}
			onHandled={async (item) => {
				const result = await acknowledge.mutateAsync({ id: item.id, revision: item.revision });
				if (result.status === "conflict")
					throw new Error("New activity arrived. Review the updated item before handling it.");
				if (result.status === "not-found")
					throw new Error("This item is no longer available. The queue has been refreshed.");
				const refreshed = await query.refetch();
				if (refreshed.isError || !refreshed.data)
					throw new Error(
						"Item handled, but the queue could not refresh. Refresh before continuing."
					);
				return refreshed.data;
			}}
		/>
	);
}
