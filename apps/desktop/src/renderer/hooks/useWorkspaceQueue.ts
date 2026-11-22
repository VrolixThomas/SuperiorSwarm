import { useEffect } from "react";
import { useActivityQueueStore } from "../stores/activity-queue-store";
import { trpc } from "../trpc/client";

export function useWorkspaceQueue(view: "pending" | "later" = "pending") {
	return trpc.activityQueue.viewList.useQuery(
		{ view },
		{
			refetchInterval: 10_000,
			staleTime: 5_000,
			refetchOnMount: "always",
			refetchOnWindowFocus: "always",
			refetchOnReconnect: "always",
		}
	);
}
/** One application-level subscription keeps the rail badge current on every route. */
export function WorkspaceQueueSync() {
	const query = useWorkspaceQueue();
	const utils = trpc.useUtils();
	const setSummary = useActivityQueueStore((s) => s.setSummary);
	useEffect(() => {
		setSummary(
			query.data?.totalPending ?? null,
			query.isError || query.data?.agentStatusAvailable === false
		);
	}, [query.data, query.isError, setSummary]);
	useEffect(() => {
		const invalidate = () => {
			void utils.activityQueue.viewList.invalidate();
		};
		const offAlert = window.electron?.agentAlert?.onAlert(invalidate);
		const offDaemon = window.electron?.daemon?.onStatus(() => invalidate());
		return () => {
			offAlert?.();
			offDaemon?.();
		};
	}, [utils]);
	return null;
}
