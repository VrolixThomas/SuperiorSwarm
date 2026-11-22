import { describe, expect, mock, test } from "bun:test";

const mockAtlassianFetch = mock(async (_service: string, _url: string) => {
	throw new Error("not configured");
});

mock.module("../src/main/atlassian/auth", () => ({
	atlassianFetch: mockAtlassianFetch,
	getAuth: mock(() => null),
}));

const { getBitbucketPRComments, normalizeBitbucketDescription } = await import(
	"../src/main/atlassian/bitbucket"
);

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("normalizeBitbucketDescription", () => {
	test("removes Atlassian layout attribute lines without changing normal Markdown", () => {
		const input = [
			"# Summary",
			"",
			"{ data-layout='center' }",
			"Useful description",
			'{: data-layout="wide" }',
		].join("\n");

		expect(normalizeBitbucketDescription(input)).toBe("# Summary\n\nUseful description");
	});

	test("leaves inline text mentioning data-layout untouched", () => {
		const input = "Document `{ data-layout='center' }` when discussing the source.";
		expect(normalizeBitbucketDescription(input)).toBe(input);
	});

	test("removes Bitbucket layout and inline-card attributes beside real description text and links", () => {
		const input = [
			"## Description",
			"Allow free spins for multiple games. {: data-layout='center' }",
			"",
			"[PI-3205](https://example.atlassian.net/browse/PI-3205){: data-inline-card='' }",
			'[Design notes](https://example.com/notes) {: data-inline-card="" }',
			"Keep this {: data-layout='wide' } paragraph and its **emphasis**.",
			"{: data-inline-card='' }",
		].join("\n");
		expect(normalizeBitbucketDescription(input)).toBe(
			[
				"## Description",
				"Allow free spins for multiple games.",
				"",
				"[PI-3205](https://example.atlassian.net/browse/PI-3205)",
				"[Design notes](https://example.com/notes)",
				"Keep this paragraph and its **emphasis**.",
			].join("\n")
		);
	});

	test("preserves fenced and indented code examples including whitespace", () => {
		const input = [
			"```markdown",
			"{: data-layout='center' }",
			"[link](https://example.com){: data-inline-card='' }",
			"",
			"",
			"```",
			"",
			"~~~text",
			"{ data-layout='wide' }",
			"~~~",
			"",
			"    {: data-layout='center' }",
			"\t{: data-inline-card='' }",
			"",
			"> ~~~markdown",
			"> {: data-inline-card='' }",
			"> ~~~",
			">     {: data-layout='wide' }",
		].join("\n");
		expect(normalizeBitbucketDescription(input)).toBe(input);
	});

	test("preserves variable-length and multiline inline code spans and escaped markers", () => {
		const input = [
			"Use `{: data-layout='center' }` or ``a ` tick {: data-inline-card='' }``.",
			"A `multiline example",
			"{: data-layout='wide' }",
			"ends here` with text.",
			"Literal \\{: data-inline-card='' } and { data-layout='center' } in prose.",
		].join("\n");
		expect(normalizeBitbucketDescription(input)).toBe(input);
	});

	test("keeps normal Markdown and unrelated attributes unchanged", () => {
		const input =
			"[link](https://example.com/path?q=1#section)  \nNext paragraph\n\n{: custom='value' }\n{: data-layout='unknown' }\n";
		expect(normalizeBitbucketDescription(input)).toBe(input);
	});
});

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

		expect(result).toMatchObject([
			{
				id: 1,
				body: "hello",
				author: "Alice",
				authorId: null,
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
					next: "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/42/comments?page=2",
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

test("PR revisions come from the same metadata response and stay missing when unavailable", async () => {
	const { getBitbucketPRDetails } = await import("../src/main/atlassian/bitbucket");
	mockAtlassianFetch.mockImplementationOnce(async () =>
		jsonResponse({
			source: { branch: { name: "feature" }, commit: { hash: "a".repeat(40) } },
			destination: { branch: { name: "main" }, commit: { hash: "b".repeat(40) } },
		})
	);
	expect(await getBitbucketPRDetails("ws", "repo", 42)).toMatchObject({
		headCommitOid: "a".repeat(40),
		baseCommitOid: "b".repeat(40),
	});
	mockAtlassianFetch.mockImplementationOnce(async () =>
		jsonResponse({
			source: { branch: { name: "feature" } },
			destination: { branch: { name: "main" } },
		})
	);
	const missing = await getBitbucketPRDetails("ws", "repo", 42);
	expect(missing.headCommitOid).toBe("");
	expect(missing.baseCommitOid).toBeUndefined();
});

test("preserves stable author UUID independently of duplicate display names", async () => {
	mockAtlassianFetch.mockImplementationOnce(async () =>
		jsonResponse({
			values: [
				{
					id: 1,
					content: { raw: "mine" },
					user: { uuid: "{alice}", display_name: "Same Name" },
					created_on: "today",
				},
				{
					id: 2,
					content: { raw: "other" },
					user: { uuid: "{bob}", display_name: "Same Name" },
					created_on: "today",
				},
				{
					id: 3,
					content: { raw: "unknown" },
					user: { display_name: "Same Name" },
					created_on: "today",
				},
			],
		})
	);
	const comments = await getBitbucketPRComments("ws", "repo", 42);
	expect(comments.map((c) => c.authorId)).toEqual(["{alice}", "{bob}", null]);
});
