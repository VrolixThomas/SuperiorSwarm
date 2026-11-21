import type { QueueEntity } from "../../../shared/activity-queue";
import { useWorkspaceQueue } from "../../hooks/useWorkspaceQueue";
import { pendingQueueItems } from "../../lib/queue-navigation-session";
import { useQueueNavigationStore } from "../../stores/queue-navigation-store";
import { queueButton } from "./QueuePanel";

export function QueueWorkspacePending({ entity }: { entity: QueueEntity }) {
	const query = useWorkspaceQueue();
	const count = pendingQueueItems(query.data?.items ?? []).filter(
		(item) => item.context.entity?.kind === entity.kind && item.context.entity.id === entity.id
	).length;
	if (!count) return null;
	return (
		<button
			type="button"
			className={`${queueButton} app-no-drag shrink-0`}
			title={
				query.isError
					? "Queue refresh failed; showing the last known count"
					: "View pending activity in this workspace"
			}
			onClick={() => useQueueNavigationStore.getState().peek(entity)}
		>
			{count} in the queue
		</button>
	);
}
