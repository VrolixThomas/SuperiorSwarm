import "./preload-electron-mock";
import { beforeAll, expect, spyOn, test } from "bun:test";
import { observeScopedPRPoll } from "../src/main/activity-queue/pr-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { githubAuth } from "../src/main/db/schema";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import { GitHubAdapter } from "../src/main/providers/github-adapter";
import { prIdentity } from "../src/main/providers/pr-activity";
import type { CachedPR } from "../src/shared/review-types";
import { setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);

test("bot-authored review requests reach the scoped queue; unknown authors remain unconfirmed", async () => {
	getDb()
		.insert(githubAuth)
		.values({ id: "github", accountId: "me", accessToken: "test-only" })
		.run();
	const nodes = ["dependabot[bot]", "unknown-author"].map((login, index) => ({
		id: 100 + index,
		number: 7 + index,
		title: `Update dependency ${index}`,
		html_url: `https://github.com/fixture/repo/pull/${7 + index}`,
		state: "open",
		draft: false,
		comments: 0,
		user: { login, avatar_url: "" },
		repository_url: "https://api.github.com/repos/fixture/repo",
	}));
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith("/user")) return Response.json({ login: "me" });
				if (url.includes("/user/teams")) return Response.json([]);
				if (url.includes("/search/issues"))
					return Response.json({
						items: decodeURIComponent(url).includes("review-requested:") ? nodes : [],
					});
				if (url.endsWith("/graphql")) {
					const { query } = JSON.parse(String(init?.body)) as { query: string };
					// GraphQL returns no User-fragment fields for a Bot actor.
					const selectsBotIdentity = /\.\.\.\s+on\s+Bot\s*\{\s*databaseId\s*\}/.test(query);
					return Response.json({
						data: Object.fromEntries(
							nodes.map((_, index) => [
								`pr${index}`,
								{
									pullRequest: {
										headRefName: "dependency-update",
										baseRefName: "main",
										headRefOid: `sha${index}`,
										state: "OPEN",
										isDraft: false,
										author: index === 0 && selectsBotIdentity ? { databaseId: 9001 } : {},
										reviewRequests: {
											pageInfo: { hasNextPage: false },
											nodes: [{ requestedReviewer: { login: "me" } }],
										},
										reviews: { totalCount: 0, nodes: [] },
										comments: { totalCount: 0, nodes: [] },
									},
								},
							])
						),
					});
				}
				throw Error(`Unexpected provider request: ${url}`);
			},
			{ preconnect: () => {} }
		)
	);
	try {
		const normalized = await new GitHubAdapter().getMyPRs();
		expect(normalized).toHaveLength(2);
		const prs: CachedPR[] = normalized.map((pr) => ({
			provider: "github",
			identifier: `${pr.repoOwner}/${pr.repoName}#${pr.id}`,
			number: pr.id,
			title: pr.title,
			state: "open",
			sourceBranch: pr.sourceBranch,
			targetBranch: pr.targetBranch,
			author: { login: pr.author, avatarUrl: "" },
			reviewers: [],
			ciStatus: null,
			commentCount: 0,
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			updatedAt: "",
			repoOwner: pr.repoOwner,
			repoName: pr.repoName,
			projectId: "",
			role: pr.role,
			headCommitSha: pr.headCommitSha,
		}));
		await observeScopedPRPoll(
			prs,
			new Map(
				normalized.map((pr) => [
					prIdentity("github", pr.repoOwner, pr.repoName, pr.id),
					pr.activity ?? {},
				])
			),
			new Map()
		);
		const items = new ActivityQueueService().list().items;
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			kind: "pr-review",
			target: { type: "pr", provider: "github", number: 7, accountId: "me" },
		});
		expect(normalized[0]?.activity?.authorAccountId).toBe("9001");
		expect(normalized[1]?.activity?.authorAccountId).toBeUndefined();
	} finally {
		fetch.mockRestore();
		getDb().delete(activityQueueSources).run();
		getDb().delete(githubAuth).run();
	}
});
