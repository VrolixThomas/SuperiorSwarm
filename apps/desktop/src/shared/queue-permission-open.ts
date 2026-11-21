import type { WorkspaceQueueItem, WorkspaceQueueRevisionInput } from "./activity-queue";
import type {
	QueuePermissionCapability,
	QueuePermissionDecisionInput,
	QueuePermissionDecisionResult,
} from "./queue-permissions";
/** Explicit Open releases only the displayed live request; it never approves or dismisses. */
export async function releaseQueuePermissionForOpen(
	item: WorkspaceQueueItem,
	actions: {
		capability: (input: WorkspaceQueueRevisionInput) => Promise<QueuePermissionCapability>;
		decide: (input: QueuePermissionDecisionInput) => Promise<QueuePermissionDecisionResult>;
	}
): Promise<void> {
	if (!item.permission) return;
	const input = { id: item.id, revision: item.revision, members: item.members };
	const capability = await actions.capability(input);
	if (
		capability.capability !== "hook-response" ||
		capability.state !== "waiting" ||
		!capability.requestId
	)
		return;
	const result = await actions.decide({
		...input,
		requestId: capability.requestId,
		action: "open",
	});
	if (result.status !== "opened" && result.status !== "unavailable") throw Error(result.detail);
}
