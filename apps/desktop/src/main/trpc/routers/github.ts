import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { githubBranchPrs, workspaces, worktrees } from "../../db/schema";
import { deleteAuth, getAuth } from "../../github/auth";
import { getMyPRs, getPRComments } from "../../github/github";
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
});
