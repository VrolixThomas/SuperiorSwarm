import { useMemo } from "react";
import type { QueuePermissionActionsAPI } from "../components/queue/QueuePermissionActions";
import { trpc } from "../trpc/client";
export function useQueuePermissionActions(): QueuePermissionActionsAPI {
	const utils = trpc.useUtils();
	const mutation = trpc.activityQueue.workspacePermissionDecision.useMutation();
	return useMemo(
		() => ({
			capability: (input) => utils.activityQueue.workspacePermissionCapability.fetch(input),
			decide: (input) => mutation.mutateAsync(input),
		}),
		[utils, mutation.mutateAsync]
	);
}
