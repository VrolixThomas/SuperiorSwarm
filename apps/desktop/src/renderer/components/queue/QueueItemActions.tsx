import type { WorkspaceQueueItem } from "../../../shared/activity-queue";
import { useQueueConversationActions } from "../../hooks/useQueueConversationActions";
import { QueueConversationReply } from "./QueueConversationReply";
/** Shared connected actions for jump/peek; all mutations retain the displayed receipt. */
export function QueueItemActions({
	item,
	disabled,
	refresh,
	onOpen: _onOpen,
}: {
	item: WorkspaceQueueItem;
	disabled?: boolean;
	refresh: () => Promise<unknown>;
	onOpen?: () => void;
}) {
	const actions = useQueueConversationActions();
	return (
		<QueueConversationReply item={item} available={!disabled} actions={actions} refresh={refresh} />
	);
}
