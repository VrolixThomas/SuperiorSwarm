import { eq } from "drizzle-orm";
import { z } from "zod";
import {
	fetchReviewComments,
	markSessionFailed,
	startResolutionSession,
} from "../../ai-review/resolution-orchestrator";
import { pushAndReply, revertAll, revertGroup } from "../../ai-review/resolution-publisher";
import { getDb } from "../../db";
import {
	resolutionComments,
	resolutionGroups,
	resolutionSessions,
} from "../../db/schema-resolution";
import { publicProcedure, router } from "../index";

export const resolutionRouter = router({
	getSession: publicProcedure.input(z.object({ workspaceId: z.string() })).query(({ input }) => {
		const db = getDb();

		const session = db
			.select()
			.from(resolutionSessions)
			.where(eq(resolutionSessions.workspaceId, input.workspaceId))
			.all()
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

		if (!session) return null;

		const groups = db
			.select()
			.from(resolutionGroups)
			.where(eq(resolutionGroups.sessionId, session.id))
			.all();

		const comments = db
			.select()
			.from(resolutionComments)
			.where(eq(resolutionComments.sessionId, session.id))
			.all();

		return { ...session, groups, comments };
	}),

	startResolution: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				worktreePath: z.string(),
				prProvider: z.string(),
				prIdentifier: z.string(),
				prTitle: z.string(),
				prNumber: z.number(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			return startResolutionSession(input);
		}),

	fetchComments: publicProcedure
		.input(z.object({ provider: z.string(), prIdentifier: z.string() }))
		.query(async ({ input }) => {
			return fetchReviewComments(input.provider, input.prIdentifier);
		}),

	revertGroup: publicProcedure
		.input(z.object({ groupId: z.string(), worktreePath: z.string() }))
		.mutation(async ({ input }) => {
			await revertGroup(input.groupId, input.worktreePath);
			return { success: true };
		}),

	revertAll: publicProcedure
		.input(z.object({ sessionId: z.string(), worktreePath: z.string() }))
		.mutation(async ({ input }) => {
			await revertAll(input.sessionId, input.worktreePath);
			return { success: true };
		}),

	pushChanges: publicProcedure
		.input(
			z.object({
				sessionId: z.string(),
				groupId: z.string(),
				worktreePath: z.string(),
				replyBody: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			return pushAndReply(input);
		}),

	cancelSession: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(({ input }) => {
			markSessionFailed(input.sessionId);
			return { success: true };
		}),
});
