import { expect, mock, test } from "bun:test";
mock.module("../src/main/github/auth", () => ({
	githubFetch: async () => Response.json([]),
	githubGraphQL: async () => ({
		repository: {
			pullRequest: {
				reviewThreads: {
					nodes: [
						{
							id: "thread",
							isResolved: false,
							path: "src/old.ts",
							line: 9,
							diffSide: "LEFT",
							comments: {
								nodes: [
									{
										id: "comment",
										author: { login: "reviewer", databaseId: 2 },
										body: "Deleted line",
										createdAt: "2026-11-22",
									},
								],
								pageInfo: { hasNextPage: false },
							},
						},
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		},
	}),
}));
mock.module("../src/main/atlassian/auth", () => ({
	atlassianFetch: async (_service: string, url: string) =>
		url.includes("/comments?")
			? Response.json({
					values: [
						{
							id: 7,
							content: { raw: "Please correct this expression" },
							user: { account_id: "reviewer", display_name: "Reviewer" },
							created_on: "2026-11-22",
							inline: { path: "src/api.ts", to: 42 },
						},
					],
				})
			: Response.json({ participants: [] }),
}));
const { fetchPRFeedback } = await import("../src/main/activity-queue/pr-feedback-fetch");
test("Bitbucket inline feedback retains source file and line for queue solver", async () => {
	const events = await fetchPRFeedback("bitbucket", "owner", "repo", 7);
	expect(events[0]).toMatchObject({
		id: "comment:7",
		authorId: "reviewer",
		threadId: "7",
		filePath: "src/api.ts",
		lineNumber: 42,
	});
});

test("GitHub left-side feedback retains thread, path and side", async () => {
	const events = await fetchPRFeedback("github", "owner", "repo", 7);
	expect(events[0]).toMatchObject({
		id: "thread:comment",
		threadId: "thread",
		filePath: "src/old.ts",
		lineNumber: 9,
		side: "LEFT",
	});
});
