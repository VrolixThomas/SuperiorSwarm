import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import {
	createComment,
	deleteComment,
	listPendingComments,
	markCommentsSent,
	updateCommentBody,
} from "../../inline-comments/comment-ops";
import { publicProcedure, router } from "../index";

export const inlineCommentsRouter = router({
	list: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(({ input }) => listPendingComments(getDb(), input.workspaceId)),

	create: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				repoPath: z.string(),
				filePath: z.string(),
				startLine: z.number().int().min(1),
				endLine: z.number().int().min(1),
				codeSnapshot: z.string(),
				body: z.string().min(1),
			})
		)
		.mutation(({ input }) => {
			const id = nanoid();
			createComment(getDb(), { id, ...input });
			return { id };
		}),

	update: publicProcedure
		.input(z.object({ id: z.string(), body: z.string().min(1) }))
		.mutation(({ input }) => {
			updateCommentBody(getDb(), input);
			return { ok: true };
		}),

	delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
		deleteComment(getDb(), input.id);
		return { ok: true };
	}),

	markSent: publicProcedure.input(z.object({ ids: z.array(z.string()) })).mutation(({ input }) => {
		markCommentsSent(getDb(), input.ids);
		return { ok: true };
	}),
});
