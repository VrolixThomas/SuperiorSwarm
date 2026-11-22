import type { QueueViewItem } from "../../shared/activity-queue";
import { releaseQueuePermissionForOpen } from "../../shared/queue-permission-open";
import { useProjectStore } from "../stores/projects";
import { openTicketQueueTarget } from "../stores/queue-ticket-store";
import { useReviewModeStore } from "../stores/review-mode-store";
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
			useTabStore.getState().setSidebarSegment("repos", { restoreWorkspace: false });
		}
		return null;
	}
	if (item.target.type === "pr") {
		const destination = await openQueueTarget(item.target);
		const active = useReviewModeStore.getState().active;
		if (
			active?.workspaceId === destination.workspaceId &&
			active.prCtx.provider === item.target.provider &&
			active.prCtx.owner === item.target.owner &&
			active.prCtx.repo === item.target.repo &&
			active.prCtx.number === item.target.number
		)
			useReviewModeStore.getState().setQueueOrigin({
				id: item.id,
				revision: item.revision,
				workspaceId: destination.workspaceId,
			});
		return destination;
	}
	return openQueueTarget(item.target);
}
