import { useEffect } from "react";
import { trpc } from "../trpc/client";

/** Local projection polling only; opening the Queue never starts provider polling. */
export function useActivityQueue() {
	const utils = trpc.useUtils();
	const query = trpc.activityQueue.list.useQuery(
		{ includeAcknowledged: true },
		{
			refetchInterval: 10_000,
			staleTime: 5_000,
			refetchOnMount: "always",
			refetchOnReconnect: "always",
			refetchOnWindowFocus: "always",
		}
	);
	const acknowledge = trpc.activityQueue.acknowledge.useMutation({
		onSettled: () => utils.activityQueue.list.invalidate(),
	});
	useEffect(() => {
		const invalidate = () => {
			void utils.activityQueue.list.invalidate();
		};
		const offAlert = window.electron?.agentAlert?.onAlert(invalidate);
		const offDaemon = window.electron?.daemon?.onStatus((connected) => {
			if (connected) invalidate();
		});
		return () => {
			offAlert?.();
			offDaemon?.();
		};
	}, [utils]);
	return { query, acknowledge };
}
