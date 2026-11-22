import "./preload-electron-mock";
import { beforeAll, expect, spyOn, test } from "bun:test";
import { getDb } from "../src/main/db";
import { githubAuth } from "../src/main/db/schema";
import { GitHubAdapter } from "../src/main/providers/github-adapter";
import { setupTestDb } from "./helpers/db";
beforeAll(setupTestDb);
test("production GitHub adapter reuses compact batches and distinguishes requested from reviewed-only", async () => {
	getDb()
		.insert(githubAuth)
		.values({ id: "github", accessToken: "test-only", accountId: "me" })
		.onConflictDoNothing()
		.run();
	const nodes = Array.from({ length: 26 }, (_, i) => ({
		id: i + 100,
		number: 1,
		title: `PR ${i}`,
		html_url: `https://github.com/o/r${i}/pull/1`,
		state: "open",
		draft: false,
		comments: 0,
		repository_url: `https://api.github.com/repos/o/r${i}`,
	}));
	let graphCalls = 0;
	let failGraph = false;
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith("/user")) return Response.json({ login: "me" });
				if (url.includes("/user/teams")) return Response.json([]);
				if (url.includes("/search/issues"))
					return Response.json({
						items: decodeURIComponent(url).includes("reviewed-by:") ? nodes : [],
					});
				if (url.endsWith("/graphql")) {
					graphCalls++;
					const { query } = JSON.parse(String(init?.body)) as { query: string };
					expect(query).toContain("headRefOid isDraft state");
					expect(query).toContain("reviewRequests(first: 100)");
					if (failGraph) return Response.json({ errors: [{ message: "unavailable" }] });
					const aliases = [...query.matchAll(/pr(\d+): repository\(owner: "o", name: "r(\d+)"/g)];
					expect(aliases.length).toBeLessThanOrEqual(25);
					return Response.json({
						data: Object.fromEntries(
							aliases.map((match) => [
								`pr${match[1]}`,
								{
									pullRequest: {
										headRefName: "feat",
										headRefOid: `sha${match[2]}`,
										state: "OPEN",
										isDraft: false,
										reviewRequests: {
											pageInfo: { hasNextPage: false },
											nodes: match[2] === "0" ? [{ requestedReviewer: { login: "me" } }] : [],
										},
										reviews: {
											totalCount: 1,
											nodes: [{ id: "review", state: "APPROVED", submittedAt: "2026-01-01" }],
										},
										comments: { totalCount: 0, nodes: [] },
									},
								},
							])
						),
					});
				}
				throw new Error(`Unexpected URL ${url}`);
			},
			{ preconnect: () => {} }
		)
	);
	try {
		const adapter = new GitHubAdapter();
		const prs = await adapter.getMyPRs();
		expect(prs).toHaveLength(26);
		expect(graphCalls).toBe(2);
		expect(prs[0]?.activity?.reviewRequested).toBe(true);
		expect(prs[1]?.role).toBe("reviewer");
		expect(prs[1]?.activity?.reviewRequested).toBe(false);
		expect(prs[1]?.headCommitSha).toBe("sha1");
		failGraph = true;
		const partial = await adapter.getMyPRs();
		expect(partial[0]?.activity).toEqual({ accountId: "me" });
		expect(partial[0]?.headCommitSha).toBe("");
	} finally {
		fetch.mockRestore();
		getDb().delete(githubAuth).run();
	}
});
