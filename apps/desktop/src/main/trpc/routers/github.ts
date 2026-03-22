import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import {
	githubBranchPrs,
	githubPrFileViewed,
	projects,
	workspaces,
	worktrees,
} from "../../db/schema";
import { deleteAuth, getAuth } from "../../github/auth";
import {
	addReviewThreadReply,
	createReviewThread,
	getMyPRs,
	getPRComments,
	getPRDetails,
	getPRListEnrichment,
	resolveThread,
	submitReview,
} from "../../github/github";
import { connectGitHub } from "../../github/oauth-flow";
import { publicProcedure, router } from "../index";

export const githubRouter = router({
	getStatus: publicProcedure.query(() => {
		const auth = getAuth();
		return auth
			? { connected: true as const, displayName: auth.displayName, accountId: auth.accountId }
			: { connected: false as const };
	}),

	connect: publicProcedure.mutation(async () => {
		await connectGitHub();
		const auth = getAuth();
		return auth
			? { connected: true as const, displayName: auth.displayName }
			: { connected: false as const };
	}),

	disconnect: publicProcedure.mutation(() => {
		deleteAuth();
	}),

	getMyPRs: publicProcedure.query(async () => {
		return getMyPRs();
	}),

	getPRComments: publicProcedure
		.input(z.object({ owner: z.string(), repo: z.string(), number: z.number() }))
		.query(async ({ input }) => {
			return getPRComments(input.owner, input.repo, input.number);
		}),

	getProjectsByRepo: publicProcedure
		.input(z.object({ owner: z.string(), repo: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			return db
				.select()
				.from(projects)
				.where(and(eq(projects.githubOwner, input.owner), eq(projects.githubRepo, input.repo)))
				.all();
		}),

	linkPR: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				owner: z.string(),
				repo: z.string(),
				number: z.number(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			db.insert(githubBranchPrs)
				.values({
					id: crypto.randomUUID(),
					workspaceId: input.workspaceId,
					prRepoOwner: input.owner,
					prRepoName: input.repo,
					prNumber: input.number,
					createdAt: new Date(),
				})
				.onConflictDoNothing()
				.run();
		}),

	getLinkedPRs: publicProcedure.query(() => {
		const db = getDb();
		return db
			.select({
				prRepoOwner: githubBranchPrs.prRepoOwner,
				prRepoName: githubBranchPrs.prRepoName,
				prNumber: githubBranchPrs.prNumber,
				workspaceId: githubBranchPrs.workspaceId,
				workspaceName: workspaces.name,
				worktreePath: worktrees.path,
			})
			.from(githubBranchPrs)
			.leftJoin(workspaces, eq(workspaces.id, githubBranchPrs.workspaceId))
			.leftJoin(worktrees, eq(worktrees.id, workspaces.worktreeId))
			.all();
	}),

	getPRDetails: publicProcedure
		.input(z.object({ owner: z.string(), repo: z.string(), number: z.number() }))
		.query(({ input }) => {
			return getPRDetails(input.owner, input.repo, input.number);
		}),

	getViewedFiles: publicProcedure
		.input(z.object({ owner: z.string(), repo: z.string(), number: z.number() }))
		.query(({ input }) => {
			const db = getDb();
			const rows = db
				.select({ filePath: githubPrFileViewed.filePath })
				.from(githubPrFileViewed)
				.where(
					and(
						eq(githubPrFileViewed.prOwner, input.owner),
						eq(githubPrFileViewed.prRepo, input.repo),
						eq(githubPrFileViewed.prNumber, input.number)
					)
				)
				.all();
			return rows.map((r) => r.filePath);
		}),

	markFileViewed: publicProcedure
		.input(
			z.object({
				owner: z.string(),
				repo: z.string(),
				number: z.number(),
				filePath: z.string(),
				viewed: z.boolean(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			if (input.viewed) {
				db.insert(githubPrFileViewed)
					.values({
						id: crypto.randomUUID(),
						prOwner: input.owner,
						prRepo: input.repo,
						prNumber: input.number,
						filePath: input.filePath,
						viewedAt: new Date(),
					})
					.onConflictDoNothing()
					.run();
			} else {
				db.delete(githubPrFileViewed)
					.where(
						and(
							eq(githubPrFileViewed.prOwner, input.owner),
							eq(githubPrFileViewed.prRepo, input.repo),
							eq(githubPrFileViewed.prNumber, input.number),
							eq(githubPrFileViewed.filePath, input.filePath)
						)
					)
					.run();
			}
		}),

	submitReview: publicProcedure
		.input(
			z.object({
				owner: z.string(),
				repo: z.string(),
				prNumber: z.number(),
				verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
				body: z.string(),
			})
		)
		.mutation(({ input }) => {
			return submitReview(input);
		}),

	resolveThread: publicProcedure.input(z.object({ threadId: z.string() })).mutation(({ input }) => {
		return resolveThread(input.threadId);
	}),

	addReviewComment: publicProcedure
		.input(z.object({ threadId: z.string(), body: z.string() }))
		.mutation(({ input }) => {
			return addReviewThreadReply(input);
		}),

	createReviewThread: publicProcedure
		.input(
			z.object({
				owner: z.string(),
				repo: z.string(),
				prNumber: z.number(),
				body: z.string(),
				commitId: z.string(),
				path: z.string(),
				line: z.number().optional(),
				side: z.enum(["LEFT", "RIGHT"]).optional(),
			})
		)
		.mutation(({ input }) => {
			return createReviewThread(input);
		}),

	getPRListEnrichment: publicProcedure
		.input(
			z.object({
				prs: z.array(
					z.object({
						owner: z.string(),
						repo: z.string(),
						number: z.number(),
					})
				),
			})
		)
		.query(async ({ input }) => {
			const auth = getAuth();
			if (!auth) return [];
			return getPRListEnrichment(input.prs);
		}),
});
