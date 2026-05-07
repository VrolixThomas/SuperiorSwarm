import { describe, expect, mock, test } from "bun:test";

const mockAtlassianFetch = mock(async (_service: string, _url: string) => {
	throw new Error("not configured");
});

mock.module("../src/main/atlassian/auth", () => ({
	atlassianFetch: mockAtlassianFetch,
	getAuth: mock(() => null),
}));

const { getBitbucketPRComments } = await import("../src/main/atlassian/bitbucket");

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("getBitbucketPRComments", () => {
	test("reads author from comment.user.display_name", async () => {
		mockAtlassianFetch.mockImplementationOnce(async () =>
			jsonResponse({
				values: [
					{
						id: 1,
						content: { raw: "hello" },
						user: { display_name: "Alice", nickname: "alice" },
						created_on: "2026-04-01T00:00:00Z",
						inline: { path: "src/x.ts", to: 10 },
					},
				],
			})
		);

		const result = await getBitbucketPRComments("ws", "repo", 42);

		expect(result).toEqual([
			{
				id: 1,
				body: "hello",
				author: "Alice",
				filePath: "src/x.ts",
				lineNumber: 10,
				createdAt: "2026-04-01T00:00:00Z",
			},
		]);
	});

	test("falls back to nickname when display_name missing", async () => {
		mockAtlassianFetch.mockImplementationOnce(async () =>
			jsonResponse({
				values: [
					{
						id: 2,
						content: { raw: "hi" },
						user: { nickname: "bob" },
						created_on: "2026-04-02T00:00:00Z",
					},
				],
			})
		);

		const [comment] = await getBitbucketPRComments("ws", "repo", 42);
		expect(comment?.author).toBe("bob");
	});

	test("falls back to Unknown when user object is null", async () => {
		mockAtlassianFetch.mockImplementationOnce(async () =>
			jsonResponse({
				values: [
					{
						id: 3,
						content: { raw: "no user" },
						user: null,
						created_on: "2026-04-03T00:00:00Z",
					},
				],
			})
		);

		const [comment] = await getBitbucketPRComments("ws", "repo", 42);
		expect(comment?.author).toBe("Unknown");
	});

	test("ignores legacy author field shape from prior buggy parse", async () => {
		mockAtlassianFetch.mockImplementationOnce(async () =>
			jsonResponse({
				values: [
					{
						id: 4,
						content: { raw: "x" },
						author: { display_name: "ShouldBeIgnored" },
						user: { display_name: "Carol" },
						created_on: "2026-04-04T00:00:00Z",
					},
				],
			})
		);

		const [comment] = await getBitbucketPRComments("ws", "repo", 42);
		expect(comment?.author).toBe("Carol");
	});

	test("follows pagination via next link", async () => {
		mockAtlassianFetch
			.mockImplementationOnce(async () =>
				jsonResponse({
					values: [
						{
							id: 10,
							content: { raw: "first" },
							user: { display_name: "Alice" },
							created_on: "2026-04-01T00:00:00Z",
						},
					],
					next: "https://api.bitbucket.org/2.0/page2",
				})
			)
			.mockImplementationOnce(async () =>
				jsonResponse({
					values: [
						{
							id: 11,
							content: { raw: "second" },
							user: { display_name: "Bob" },
							created_on: "2026-04-02T00:00:00Z",
						},
					],
				})
			);

		const result = await getBitbucketPRComments("ws", "repo", 42);
		expect(result.map((c) => c.author)).toEqual(["Alice", "Bob"]);
	});
});
