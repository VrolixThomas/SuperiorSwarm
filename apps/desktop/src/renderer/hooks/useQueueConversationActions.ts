import { useMemo } from "react";
import type { QueueConversationActions } from "../components/queue/QueueConversationReply";
import { trpc } from "../trpc/client";
export function useQueueConversationActions(): QueueConversationActions {
	const utils = trpc.useUtils();
	const mutation = trpc.activityQueue.workspaceReply.useMutation();
	return useMemo(
		() => ({
			receipt: (requestId) => utils.activityQueue.workspaceReplyReceipt.fetch({ requestId }),
			capability: (input) => utils.activityQueue.workspaceReplyCapability.fetch(input),
			reply: (input) => mutation.mutateAsync(input),
		}),
		[utils, mutation.mutateAsync]
	);
}
