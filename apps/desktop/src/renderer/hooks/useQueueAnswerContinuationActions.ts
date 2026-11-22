import { useMemo } from "react";
import type { QueueAnswerContinuationActions } from "../components/queue/QueueQuestionReply";
import { trpc } from "../trpc/client";

export function useQueueAnswerContinuationActions(): QueueAnswerContinuationActions {
	const utils = trpc.useUtils();
	const mutation = trpc.activityQueue.workspaceAnswerAndContinue.useMutation();
	return useMemo(
		() => ({
			capability: (input) => utils.activityQueue.workspaceAnswerContinuationCapability.fetch(input),
			continue: (input) => mutation.mutateAsync(input),
			receipt: (input) => utils.activityQueue.workspaceAnswerContinuationReceipt.fetch(input),
		}),
		[utils, mutation.mutateAsync]
	);
}
