import { z } from "zod";
import { getDb } from "../../db";
import { getGitProvider } from "../../providers/git-provider";
import { getViewed, setViewed, unsetViewed } from "../../review/viewed-ops";
import { publicProcedure, router } from "../index";

export const reviewRouter = router({
	getViewed: publicProcedure.input(z.object({ workspaceId: z.string() })).query(({ input }) => {
		const db = getDb();
		return getViewed(db, input.workspaceId);
	}),

	setViewed: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				filePath: z.string(),
				contentHash: z.string(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			setViewed(db, input);
			return { ok: true };
		}),

	unsetViewed: publicProcedure
		.input(z.object({ workspaceId: z.string(), filePath: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			unsetViewed(db, input);
			return { ok: true };
		}),

	createInlineComment: publicProcedure
		.input(
			z.object({
				provider: z.enum(["github", "bitbucket"]),
				owner: z.string(),
				repo: z.string(),
				prNumber: z.number(),
				body: z.string(),
				commitId: z.string().optional(),
				filePath: z.string(),
				line: z.number().optional(),
				side: z.enum(["LEFT", "RIGHT"]).optional(),
			})
		)
		.mutation(({ input }) => {
			const { provider, ...params } = input;
			return getGitProvider(provider).createInlineComment(params);
		}),

	submitReview: publicProcedure
		.input(
			z.object({
				provider: z.enum(["github", "bitbucket"]),
				owner: z.string(),
				repo: z.string(),
				prNumber: z.number(),
				verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
				body: z.string(),
			})
		)
		.mutation(({ input }) => {
			const { provider, ...params } = input;
			return getGitProvider(provider).submitReview(params);
		}),
});
