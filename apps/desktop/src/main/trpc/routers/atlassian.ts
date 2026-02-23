import { z } from "zod";
import { deleteAuth, getAuth } from "../../atlassian/auth";
import { getMyPullRequests, getReviewRequests } from "../../atlassian/bitbucket";
import { getMyIssues } from "../../atlassian/jira";
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
				? { connected: true as const, displayName: bitbucket.displayName, accountId: bitbucket.accountId }
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
});
