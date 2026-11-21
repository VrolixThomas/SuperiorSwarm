import { z } from "zod";
import { ACTIVITY_QUEUE_KINDS } from "../../../shared/activity-queue";
import { reconcileAgentSources } from "../../activity-queue/agent-source";
import {
	workspaceReply,
	workspaceReplyCapability,
} from "../../activity-queue/conversation-replies";
import { listCurrentActivityQueue } from "../../activity-queue/current-items";
import { linkedWorkForEntity } from "../../activity-queue/linked-context";
import { getActivityQueueService } from "../../activity-queue/service";
import {
	bringBack,
	currentQueueAction,
	later,
	listWorkspaceQueue,
	undoDone,
	workspaceAnswer,
	workspaceDone,
} from "../../activity-queue/workspace-queue";
import {
	decideQueuePermission,
	getQueuePermissionCapability,
} from "../../agent-hooks/permission-runtime";
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
	workspacePermissionCapability: publicProcedure
		.input(workspaceRevision)
		.query(async ({ input }) => {
			const item = await currentQueueAction(input);
			return item
				? getQueuePermissionCapability(item)
				: {
						capability: "unavailable" as const,
						detail: "This queue update changed. Refresh before responding.",
					};
		}),
	workspacePermissionDecision: publicProcedure
		.input(
			workspaceRevision.extend({
				requestId: z.string().min(1).max(256),
				action: z.enum(["allow-once", "deny", "open"]),
			})
		)
		.mutation(({ input }) => decideQueuePermission(input)),
	workspaceLinkedContext: publicProcedure
		.input(z.object({ kind: z.enum(["workspace", "coordinator"]), id: z.string().min(1) }))
		.query(({ input }) => linkedWorkForEntity(input)),
	workspaceReplyCapability: publicProcedure
		.input(workspaceRevision)
		.query(({ input }) => workspaceReplyCapability(input)),
	workspaceReply: publicProcedure
		.input(
			workspaceRevision.extend({
				requestId: z.string().min(1).max(128),
				content: z.string().min(1).max(16000),
			})
		)
		.mutation(({ input }) => workspaceReply(input)),
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
