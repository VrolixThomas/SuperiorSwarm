import type { WorkspaceQueueItem } from "../../shared/activity-queue";
import { releaseQueuePermissionForOpen } from "../../shared/queue-permission-open";
import { trpcVanilla } from "../trpc/client";
import { openQueueTarget } from "./activity-queue-navigation";
/** Explicit row/shortcut/bar Open, as distinct from selection and passive viewing. */
export async function openQueueItem(item: WorkspaceQueueItem) {
	await releaseQueuePermissionForOpen(item, {
		capability: (input) => trpcVanilla.activityQueue.workspacePermissionCapability.query(input),
		decide: (input) => trpcVanilla.activityQueue.workspacePermissionDecision.mutate(input),
	});
	return openQueueTarget(item.target);
}
