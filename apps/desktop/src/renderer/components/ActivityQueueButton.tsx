import { useEffect, useRef } from "react";
import { useActivityQueue } from "../hooks/useActivityQueue";
import { focusQueueDestination, openQueueTarget } from "../lib/activity-queue-navigation";
import { useActivityQueueStore } from "../stores/activity-queue-store";
import { ActivityQueuePanel, queueControlClass } from "./ActivityQueuePanel";

export function ActivityQueueButton({ compact = false }: { compact?: boolean }) {
	const { query, acknowledge } = useActivityQueue();
	const open = useActivityQueueStore((s) => s.open);
	const show = useActivityQueueStore((s) => s.show);
	const close = useActivityQueueStore((s) => s.close);
	const trigger = useRef<HTMLButtonElement>(null);
	const refresh = query.refetch;
	useEffect(() => {
		if (open) void refresh();
	}, [open, refresh]);
	const count = query.data?.totalPending;
	const label =
		count === undefined
			? query.isError
				? "Queue unavailable"
				: "Queue loading"
			: `Queue ${count}`;
	return (
		<>
			<button
				ref={trigger}
				type="button"
				aria-label={label}
				aria-haspopup="dialog"
				aria-controls={open ? "activity-queue-panel" : undefined}
				aria-expanded={open}
				title={label}
				onClick={show}
				className={`${queueControlClass} ${compact ? "mx-1 mb-2 flex shrink-0 flex-col items-center" : "mx-2 mb-1 flex shrink-0 items-center justify-between"} border border-[var(--border)] bg-[var(--bg-elevated)] py-2 font-medium`}
			>
				<span>Queue</span>
				<span className="text-[var(--text-secondary)]">{count ?? (query.isError ? "!" : "…")}</span>
			</button>
			{open && (
				<ActivityQueuePanel
					data={query.data}
					loading={query.isLoading}
					refreshing={query.isFetching}
					error={query.error?.message}
					onRefresh={() => void query.refetch()}
					onClose={() => {
						close();
						requestAnimationFrame(() => trigger.current?.focus());
					}}
					onOpen={async (item) => {
						const destination = await openQueueTarget(item.target);
						close();
						focusQueueDestination(destination);
					}}
					onHandled={async (item) => {
						const result = await acknowledge.mutateAsync({ id: item.id, revision: item.revision });
						if (result.status === "conflict")
							throw new Error(
								"New activity arrived. The newer occurrence remains pending; review it before marking it handled."
							);
						if (result.status === "not-found")
							throw new Error("This item is no longer available. The queue has been refreshed.");
					}}
				/>
			)}
		</>
	);
}
