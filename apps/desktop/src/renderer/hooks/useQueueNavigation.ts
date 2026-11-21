import { useEffect, useRef, useState } from "react";
import type { WorkspaceQueueItem } from "../../shared/activity-queue";
import { focusQueueDestination, openQueueTarget } from "../lib/activity-queue-navigation";
import {
	nextPendingItem,
	pendingQueueItems,
	queueOccurrenceKey,
} from "../lib/queue-navigation-session";
import { useQueueNavigationStore } from "../stores/queue-navigation-store";
import { useWorkspaceQueue } from "./useWorkspaceQueue";

/** Only explicit gestures navigate. Cache updates never advance a session. */
export function useQueueNavigation() {
	const query = useWorkspaceQueue();
	const request = useQueueNavigationStore((s) => s.jumpRequest);
	const running = useRef(false);
	const seen = useRef(request);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const open = async (requested?: WorkspaceQueueItem) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setMessage(null);
		try {
			const fresh = await query.refetch();
			if (fresh.isError || !fresh.data || fresh.data.agentStatusAvailable === false)
				throw new Error("Queue unavailable. Refresh and try again.");
			const rows = pendingQueueItems(fresh.data.items);
			const item = requested
				? rows.find((row) => queueOccurrenceKey(row) === queueOccurrenceKey(requested))
				: nextPendingItem(rows, useQueueNavigationStore.getState().session);
			if (!item) {
				setMessage(
					requested
						? "This item changed or cleared. Select its latest occurrence."
						: "That's everything."
				);
				return;
			}
			if (item.stale)
				throw new Error("This activity could not be confirmed. Refresh and try again.");
			const destination = await openQueueTarget(item.target);
			useQueueNavigationStore.getState().select(item, rows);
			useQueueNavigationStore.getState().closePeek(false);
			focusQueueDestination(destination);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Could not open this queue item.");
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const latestOpen = useRef(open);
	latestOpen.current = open;
	useEffect(() => {
		if (seen.current === request) return;
		seen.current = request;
		void latestOpen.current(useQueueNavigationStore.getState().requestedItem ?? undefined);
	}, [request]);
	return { query, open, busy, message, clearMessage: () => setMessage(null) };
}
