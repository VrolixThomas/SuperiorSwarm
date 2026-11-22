import type { QueueViewItem } from "../../shared/activity-queue";
import { releaseQueuePermissionForOpen } from "../../shared/queue-permission-open";
import { useProjectStore } from "../stores/projects";
import { openTicketQueueTarget } from "../stores/queue-ticket-store";
import { useTabStore } from "../stores/tab-store";
import { trpcVanilla } from "../trpc/client";
import { openQueueTarget } from "./activity-queue-navigation";
/** Explicit row/shortcut/bar Open, as distinct from selection and passive viewing. */
export async function openQueueItem(item: QueueViewItem) {
	if (item.category === "agents")
		await releaseQueuePermissionForOpen(item, {
			capability: (input) => trpcVanilla.activityQueue.workspacePermissionCapability.query(input),
			decide: (input) => trpcVanilla.activityQueue.workspacePermissionDecision.mutate(input),
		});
	if (item.target.type === "ticket") {
		const prepared = await trpcVanilla.activityQueue.ticketPrepare.mutate({
			id: item.id,
			revision: item.revision,
			action: "open",
		});
		openTicketQueueTarget(item.id, prepared.target);
		return null;
	}
	if (item.target.type === "project-hook") {
		const prepared = await trpcVanilla.queueHooks.open.mutate({
			id: item.id,
			revision: item.revision,
		});
		if (prepared.url) await window.electron.shell.openExternal(prepared.url);
		else {
			useProjectStore.getState().selectProject(prepared.projectId);
			useTabStore.getState().setSidebarSegment("repos");
		}
		return null;
	}
	return openQueueTarget(item.target);
}
