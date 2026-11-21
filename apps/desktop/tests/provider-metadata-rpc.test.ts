import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"provider RPC and auth use isolated DB and read-only fetch doubles"
	)
) {
	const { makeTestDb } = await import("./test-db");
	const db = makeTestDb();
	mock.module("../src/main/db", () => ({ getDb: () => db }));
	const originalFetch = globalThis.fetch;
	let handler: (url: string, options?: RequestInit) => Promise<Response>;
	globalThis.fetch = mock((input: string | URL | Request, options?: RequestInit) =>
		handler(String(input), options)
	) as unknown as typeof fetch;
	const ghAuth = await import("../src/main/github/auth");
	const bbAuth = await import("../src/main/atlassian/auth");
	const { githubRouter } = await import("../src/main/trpc/routers/github");
	const { atlassianRouter } = await import("../src/main/trpc/routers/atlassian");
	const { BitbucketAdapter } = await import("../src/main/providers/bitbucket-adapter");
	const scope = { host: "github.com", owner: "org", repo: "repo", accountId: "42" };
	beforeEach(() => {
		ghAuth.saveAuth({ accessToken: "test-gh", accountId: "42", displayName: "Not a login" });
		bbAuth.saveAuth({
			service: "bitbucket",
			accessToken: "test-bb",
			refreshToken: "test-refresh",
			expiresIn: 3600,
			accountId: "bb-account",
		});
		handler = async () => {
			throw new Error("Unexpected request");
		};
		globalThis.fetch = mock((input: string | URL | Request, options?: RequestInit) =>
			handler(String(input), options)
		) as unknown as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});
	const json = (body: unknown) => new Response(JSON.stringify(body));

	test("both existing RPC routers use actual user endpoints, scoped IDs, and clear on disconnect", async () => {
		handler = async (url, options) => {
			expect(options?.method ?? "GET").toBe("GET");
			if (url === "https://api.github.com/user") return json({ id: 42, login: "actual-login" });
			if (url === "https://api.bitbucket.org/2.0/user")
				return json({ account_id: "bb-account", uuid: "{bb-user}", display_name: "Not unique" });
			throw new Error("Unexpected endpoint");
		};
		const gh = githubRouter.createCaller({});
		const bb = atlassianRouter.createCaller({});
		expect(await gh.getCurrentReviewer(scope)).toMatchObject({
			status: "available",
			identity: { id: "42", login: "actual-login" },
		});
		const bbScope = { ...scope, host: "bitbucket.org", accountId: "bb-account" };
		expect(await bb.getCurrentReviewer(bbScope)).toMatchObject({
			status: "available",
			identity: { id: "{bb-user}", login: null },
		});
		await gh.disconnect();
		await bb.disconnect({ service: "bitbucket" });
		expect(await gh.getCurrentReviewer(scope)).toMatchObject({
			status: "unavailable",
			reason: "disconnected",
		});
		expect(await bb.getCurrentReviewer(bbScope)).toMatchObject({
			status: "unavailable",
			reason: "disconnected",
		});
	});

	test("late unauthorized GitHub response does not erase newly connected account", async () => {
		handler = async () => {
			ghAuth.saveAuth({ accessToken: "new-test-token", accountId: "99" });
			return new Response(null, { status: 401 });
		};
		expect(await githubRouter.createCaller({}).getCurrentReviewer(scope)).toMatchObject({
			status: "unavailable",
		});
		expect(ghAuth.getAuth()?.accountId).toBe("99");
	});

	test("GitHub query asks for and maps outdated/original lines and matching author IDs", async () => {
		handler = async (url, options) => {
			expect(url).toBe("https://api.github.com/graphql");
			const body = JSON.parse(String(options?.body));
			expect(body.query).toContain("isOutdated");
			expect(body.query).toContain("originalLine");
			expect(body.query).toContain("databaseId");
			expect(body.variables).toEqual({ owner: "org", repo: "repo", number: 1 });
			return json({
				data: {
					repository: {
						pullRequest: {
							title: "PR",
							body: "",
							state: "OPEN",
							isDraft: false,
							author: { login: "author", avatarUrl: "" },
							reviewDecision: null,
							commits: { nodes: [] },
							reviews: { nodes: [] },
							reviewRequests: { nodes: [] },
							comments: { nodes: [] },
							changedFiles: 0,
							files: {
								nodes: [],
								totalCount: 0,
								pageInfo: { hasNextPage: false, endCursor: null },
							},
							headRefName: "feature",
							baseRefName: "main",
							headRefOid: "a".repeat(40),
							baseRefOid: "b".repeat(40),
							reviewThreads: {
								nodes: [
									{
										id: "thread",
										path: "a.ts",
										isResolved: true,
										isOutdated: true,
										line: null,
										originalLine: 17,
										diffSide: "LEFT",
										comments: {
											nodes: [
												{
													id: "c",
													body: "old",
													author: { login: "actual-login", databaseId: 42, avatarUrl: "" },
													createdAt: "today",
												},
											],
										},
									},
								],
							},
						},
					},
				},
			});
		};
		const details = await githubRouter
			.createCaller({})
			.getPRDetails({ owner: "org", repo: "repo", number: 1 });
		expect(details.reviewThreads[0]).toMatchObject({
			line: null,
			originalLine: 17,
			isOutdated: true,
			isResolved: true,
			diffSide: "LEFT",
			comments: [{ authorId: "42", author: "actual-login" }],
		});
	});

	test("Bitbucket adapter verifies both exact revisions after reading files", async () => {
		let metadataReads = 0;
		handler = async (url, options) => {
			expect(options?.method ?? "GET").toBe("GET");
			if (url.endsWith("/pullrequests/1")) {
				metadataReads++;
				return json({
					source: { commit: { hash: "a".repeat(40) } },
					destination: { commit: { hash: "b".repeat(40) } },
				});
			}
			if (url.endsWith("/comments?pagelen=100"))
				return json({
					values: [
						{
							id: 1,
							content: { raw: "hi" },
							user: { uuid: "{bb-user}", display_name: "Not unique" },
							inline: { path: "a.ts", to: 2 },
							created_on: "today",
						},
					],
				});
			if (url.endsWith("/statuses?pagelen=100") || url.endsWith("/diffstat?pagelen=500"))
				return json({ values: [] });
			throw new Error("Unexpected endpoint");
		};
		const details = await new BitbucketAdapter().getPRDetails("org", "repo", 1);
		expect(metadataReads).toBe(2);
		expect(details).toMatchObject({
			headCommitOid: "a".repeat(40),
			baseCommitOid: "b".repeat(40),
			reviewThreads: [{ comments: [{ authorId: "{bb-user}" }] }],
		});
	});
}
