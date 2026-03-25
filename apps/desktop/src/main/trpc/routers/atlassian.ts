import { z } from "zod";
import { deleteAuth, getAuth } from "../../atlassian/auth";
import {
	getMyPullRequests,
	getReviewRequests,
	replyToPRComment,
	resolvePRComment,
} from "../../atlassian/bitbucket";
import {
	getIssueDetail,
	getIssueTransitions,
	getMyIssues,
	updateIssueStatus,
} from "../../atlassian/jira";
import { connectAll, connectBitbucket, connectJira } from "../../atlassian/oauth-flow";
import { publicProcedure, router } from "../index";

export const atlassianRouter = router({
	getStatus: publicProcedure.query(() => {
		const jira = getAuth("jira");
		const bitbucket = getAuth("bitbucket");
		return {
			jira: jira
				? { connected: true as const, displayName: jira.displayName, accountId: jira.accountId }
				: { connected: false as const },
			bitbucket: bitbucket
				? {
						connected: true as const,
						displayName: bitbucket.displayName,
						accountId: bitbucket.accountId,
					}
				: { connected: false as const },
		};
	}),

	connect: publicProcedure
		.input(z.object({ service: z.enum(["jira", "bitbucket", "all"]).optional().default("all") }))
		.mutation(async ({ input }) => {
			if (input.service === "jira") {
				await connectJira();
			} else if (input.service === "bitbucket") {
				await connectBitbucket();
			} else {
				await connectAll();
			}
			const jira = getAuth("jira");
			const bitbucket = getAuth("bitbucket");
			return {
				jira: jira
					? { connected: true as const, displayName: jira.displayName }
					: { connected: false as const },
				bitbucket: bitbucket
					? { connected: true as const, displayName: bitbucket.displayName }
					: { connected: false as const },
			};
		}),

	disconnect: publicProcedure
		.input(z.object({ service: z.enum(["jira", "bitbucket", "all"]) }))
		.mutation(({ input }) => {
			if (input.service === "all") {
				deleteAuth("jira");
				deleteAuth("bitbucket");
			} else {
				deleteAuth(input.service);
			}
		}),

	getMyPullRequests: publicProcedure.query(async () => {
		return getMyPullRequests();
	}),

	getReviewRequests: publicProcedure.query(async () => {
		return getReviewRequests();
	}),

	getMyIssues: publicProcedure.query(async () => {
		return getMyIssues();
	}),

	getIssueDetail: publicProcedure
		.input(z.object({ issueKey: z.string() }))
		.query(async ({ input }) => {
			return getIssueDetail(input.issueKey);
		}),

	getIssueTransitions: publicProcedure
		.input(z.object({ issueKey: z.string() }))
		.query(async ({ input }) => {
			return getIssueTransitions(input.issueKey);
		}),

	updateIssueStatus: publicProcedure
		.input(z.object({ issueKey: z.string(), transitionId: z.string() }))
		.mutation(async ({ input }) => {
			return updateIssueStatus(input.issueKey, input.transitionId);
		}),

	replyToPRComment: publicProcedure
		.input(
			z.object({
				workspace: z.string(),
				repoSlug: z.string(),
				prId: z.number(),
				parentCommentId: z.number(),
				body: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			return replyToPRComment(
				input.workspace,
				input.repoSlug,
				input.prId,
				input.parentCommentId,
				input.body
			);
		}),

	resolvePRComment: publicProcedure
		.input(
			z.object({
				workspace: z.string(),
				repoSlug: z.string(),
				prId: z.number(),
				commentId: z.number(),
				resolved: z.boolean(),
			})
		)
		.mutation(async ({ input }) => {
			return resolvePRComment(
				input.workspace,
				input.repoSlug,
				input.prId,
				input.commentId,
				input.resolved
			);
		}),
});
