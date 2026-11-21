import { z } from "zod";
import { ACTIVITY_QUEUE_KINDS } from "../../../shared/activity-queue";
import { reconcileAgentSources } from "../../activity-queue/agent-source";
import { listCurrentActivityQueue } from "../../activity-queue/current-items";
import { getActivityQueueService } from "../../activity-queue/service";
import {
	bringBack,
	later,
	listWorkspaceQueue,
	undoDone,
	workspaceAnswer,
	workspaceDone,
} from "../../activity-queue/workspace-queue";
import { publicProcedure, router } from "../index";

const workspaceRevision = z.object({
	members: z
		.array(z.object({ id: z.string().min(1), revision: z.number().int().positive() }))
		.max(10)
		.optional(),
	id: z.string().min(1),
	revision: z.number().int().positive(),
});

export const activityQueueRouter = router({
	workspaceList: publicProcedure
		.input(
			z
				.object({ view: z.enum(["pending", "later"]).optional(), projectId: z.string().optional() })
				.optional()
		)
		.query(({ input }) => listWorkspaceQueue(input)),
	workspaceAnswer: publicProcedure
		.input(
			workspaceRevision.extend({
				questionId: z.string().min(1),
				content: z.string().trim().min(1).max(16000),
			})
		)
		.mutation(({ input }) => workspaceAnswer(input)),
	workspaceDone: publicProcedure
		.input(workspaceRevision)
		.mutation(({ input }) => workspaceDone(input)),
	later: publicProcedure
		.input(
			workspaceRevision.extend({ until: z.number().int().optional(), untilChange: z.boolean() })
		)
		.mutation(({ input }) => later(input)),
	bringBack: publicProcedure.input(workspaceRevision).mutation(({ input }) => bringBack(input)),
	undoDone: publicProcedure.input(workspaceRevision).mutation(({ input }) => undoDone(input)),
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
