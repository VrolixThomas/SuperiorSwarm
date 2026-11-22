import { useState } from "react";
import type { WorkspaceQueueItem } from "../../../shared/activity-queue";
import { useQueueConversationActions } from "../../hooks/useQueueConversationActions";
import { useQueuePermissionActions } from "../../hooks/useQueuePermissionActions";
import { focusQueueDestination } from "../../lib/activity-queue-navigation";
import { openQueueItem } from "../../lib/queue-item-open";
import { QueueConversationReply } from "./QueueConversationReply";
import { QueuePermissionActions } from "./QueuePermissionActions";
/** Shared connected actions for jump/peek; all mutations retain the displayed receipt. */
export function QueueItemActions({
	item,
	disabled,
	refresh,
	onOpen,
}: {
	item: WorkspaceQueueItem;
	disabled?: boolean;
	refresh: () => Promise<unknown>;
	onOpen?: () => void;
}) {
	const actions = useQueueConversationActions();
	const permissions = useQueuePermissionActions();
	const [openError, setOpenError] = useState<string>();
	const open =
		onOpen ??
		(() => {
			void openQueueItem(item)
				.then((destination) => {
					if (destination) focusQueueDestination(destination);
				})
				.catch(() =>
					setOpenError("The chat could not be opened. Refresh the queue and try again.")
				);
		});
	return (
		<>
			{openError && <p role="alert">{openError}</p>}
			<QueuePermissionActions
				item={item}
				available={!disabled}
				actions={permissions}
				refresh={refresh}
				onOpen={open}
			/>
			<QueueConversationReply
				item={item}
				available={!disabled}
				actions={actions}
				refresh={refresh}
			/>
		</>
	);
}
