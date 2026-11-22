import { beforeEach, expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "complete provider file manifests in isolation")) {
	let graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
	let bbFetch: (url: string) => Promise<Response>;
	mock.module("../src/main/github/auth", () => ({
		githubGraphQL: (query: string, variables: Record<string, unknown>) => graphql(query, variables),
		githubFetch: async () => {
			throw new Error("Unexpected REST request");
		},
		getValidToken: () => "test",
	}));
	mock.module("../src/main/atlassian/auth", () => ({
		atlassianFetch: (_service: string, url: string) => bbFetch(url),
		getAuth: () => null,
	}));
	const { getPRDetails } = await import("../src/main/github/github");
	const { BitbucketAdapter } = await import("../src/main/providers/bitbucket-adapter");
	const file = (i: number) => ({
		path: `src/${i}.ts`,
		additions: 1,
		deletions: 0,
		changeType: "ADDED",
	});
	const ghPage = (start: number, count: number, total: number, next: string | null) => ({
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
		reviewThreads: { nodes: [] },
		headRefName: "feature",
		baseRefName: "main",
		headRefOid: "a".repeat(40),
		baseRefOid: "b".repeat(40),
		changedFiles: total,
		files: {
			nodes: Array.from({ length: count }, (_, i) => file(start + i)),
			totalCount: total,
			pageInfo: { hasNextPage: next !== null, endCursor: next },
		},
	});
	const gh = (pr: unknown) => ({ repository: { pullRequest: pr } });
	const json = (body: unknown) => new Response(JSON.stringify(body));
	const bbBase = "https://api.bitbucket.org/2.0/repositories/org/repo/";
	const bbFile = (i: number) => ({
		new: { path: `src/${i}.ts` },
		status: "added",
		lines_added: 1,
		lines_removed: 0,
	});
	beforeEach(() => {
		graphql = async () => {
			throw new Error("Unexpected GraphQL request");
		};
		bbFetch = async () => {
			throw new Error("Unexpected Bitbucket request");
		};
	});
	test("GitHub fetches 101 files using cursor, preserving full provider revision and count", async () => {
		let calls = 0;
		graphql = async (query, vars) => {
			expect(query).toContain("pageInfo");
			expect(query).toContain("totalCount");
			expect(query).toContain("changedFiles");
			expect(vars).toMatchObject({ owner: "org", repo: "repo", number: 1 });
			calls++;
			if (calls === 1) return gh(ghPage(0, 100, 101, "cursor-1"));
			expect(vars["cursor"]).toBe("cursor-1");
			return gh(ghPage(100, 1, 101, null));
		};
		const result = await getPRDetails("org", "repo", 1);
		expect(result.filesComplete).toBe(true);
		expect(result.files).toHaveLength(101);
		expect(result.files[100]?.path).toBe("src/100.ts");
		expect(calls).toBe(2);
	});
	test("GitHub empty manifests are complete only with explicit zero counts and terminal page", async () => {
		graphql = async () => gh(ghPage(0, 0, 0, null));
		expect(await getPRDetails("org", "repo", 1)).toMatchObject({ files: [], filesComplete: true });
	});
	test.each([
		"failed-page",
		"head-drift",
		"base-drift",
		"missing-page-info",
		"count-mismatch",
		"duplicate-path",
		"cursor-loop",
		"null-node",
	])("GitHub refuses a partial or inconsistent manifest: %s", async (failure) => {
		let calls = 0;
		graphql = async () => {
			calls++;
			if (calls > 3) throw new Error("unbounded pagination");
			if (calls === 1) return gh(ghPage(0, 1, 2, "cursor-1"));
			if (failure === "failed-page") throw new Error("provider failed");
			const page = ghPage(failure === "duplicate-path" ? 0 : 1, 1, 2, null);
			if (failure === "head-drift") page.headRefOid = "c".repeat(40);
			if (failure === "base-drift") page.baseRefOid = "c".repeat(40);
			if (failure === "count-mismatch") page.files.totalCount = 3;
			if (failure === "cursor-loop")
				page.files.pageInfo = { hasNextPage: true, endCursor: "cursor-1" };
			if (failure === "missing-page-info")
				return gh({ ...page, files: { nodes: page.files.nodes, totalCount: 2 } });
			if (failure === "null-node") return gh({ ...page, files: { ...page.files, nodes: [null] } });
			return gh(page);
		};
		await expect(getPRDetails("org", "repo", 1)).rejects.toThrow();
	});
	test("Bitbucket follows every successful page", async () => {
		bbFetch = async (url) =>
			url.endsWith("page=2")
				? json({ values: [bbFile(1)], size: 2 })
				: json({ values: [bbFile(0)], size: 2, next: `${bbBase}pullrequests/1/diffstat?page=2` });
		expect(await new BitbucketAdapter().getPRFiles("org", "repo", 1)).toHaveLength(2);
	});
	test.each([
		"first-error",
		"later-error",
		"missing-values",
		"count-mismatch",
		"duplicate-path",
		"wrong-repo",
		"wrong-host",
		"cursor-loop",
		"malformed-next",
	])("Bitbucket never returns a partial manifest: %s", async (failure) => {
		let calls = 0;
		const next = `${bbBase}pullrequests/1/diffstat?page=2`;
		bbFetch = async (url) => {
			calls++;
			if (calls > 3) throw new Error("unbounded pagination");
			if (failure === "first-error" || (failure === "later-error" && calls === 2))
				return new Response(null, { status: 503 });
			if (failure === "wrong-host" || failure === "wrong-repo") {
				expect(calls).toBe(1);
				return json({
					values: [bbFile(0)],
					next:
						failure === "wrong-host"
							? "https://other.example/page2"
							: "https://api.bitbucket.org/2.0/repositories/other/repo/diffstat?page=2",
				});
			}
			if (calls === 1) return json({ values: [bbFile(0)], size: 2, next });
			if (failure === "missing-values") return json({});
			return json({
				values: [bbFile(failure === "duplicate-path" ? 0 : 1)],
				size: failure === "count-mismatch" ? 3 : 2,
				...(failure === "cursor-loop"
					? { next: url }
					: failure === "malformed-next"
						? { next: 42 }
						: {}),
			});
		};
		await expect(new BitbucketAdapter().getPRFiles("org", "repo", 1)).rejects.toThrow();
	});
	test("Bitbucket getPRDetails marks complete only after successful pages and stable revisions", async () => {
		let metadataReads = 0;
		bbFetch = async (url) => {
			if (url.endsWith("/pullrequests/1")) {
				metadataReads++;
				return json({
					source: { commit: { hash: "a".repeat(40) } },
					destination: { commit: { hash: "b".repeat(40) } },
				});
			}
			return json({ values: [] });
		};
		expect((await new BitbucketAdapter().getPRDetails("org", "repo", 1)).filesComplete).toBe(true);
		expect(metadataReads).toBe(2);
	});
	test("Bitbucket revision drift cannot certify a complete manifest for the previous revision", async () => {
		let metadataReads = 0;
		bbFetch = async (url) => {
			if (url.endsWith("/pullrequests/1")) {
				metadataReads++;
				return json({
					source: { commit: { hash: (metadataReads === 1 ? "a" : "c").repeat(40) } },
					destination: { commit: { hash: "b".repeat(40) } },
				});
			}
			return json({ values: [] });
		};
		await expect(new BitbucketAdapter().getPRDetails("org", "repo", 1)).rejects.toThrow();
	});
}
