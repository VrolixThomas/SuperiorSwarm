import { z } from "zod";
import { ACTIVITY_QUEUE_KINDS } from "../../../shared/activity-queue";
import { reconcileAgentSources } from "../../activity-queue/agent-source";
import { listCurrentActivityQueue } from "../../activity-queue/current-items";
import { getActivityQueueService } from "../../activity-queue/service";
import { publicProcedure, router } from "../index";

export const activityQueueRouter = router({
	list: publicProcedure
		.input(
			z
				.object({
					projectId: z.string().optional(),
					kinds: z.array(z.enum(ACTIVITY_QUEUE_KINDS)).optional(),
					includeAcknowledged: z.boolean().optional(),
				})
				.optional()
		)
		.query(({ input }) => {
			reconcileAgentSources();
			return listCurrentActivityQueue(input);
		}),
	acknowledge: publicProcedure
		.input(z.object({ id: z.string().min(1), revision: z.number().int().positive() }))
		.mutation(({ input }) => {
			reconcileAgentSources();
			return getActivityQueueService().acknowledge(input);
		}),
});
