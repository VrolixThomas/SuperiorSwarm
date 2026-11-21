import "./preload-electron-mock";
// apps/desktop/tests/github-pr-details.test.ts
import { describe, expect, test } from "bun:test";
import { mapPRDetails } from "../src/main/github/github";

describe("mapPRDetails", () => {
	test("maps a GraphQL PR response to GitHubPRDetails", () => {
		const raw = {
			title: "Fix auth bug",
			body: "This fixes #123",
			state: "OPEN",
			isDraft: false,
			author: { login: "alice", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
			reviewDecision: "REVIEW_REQUIRED",
			commits: {
				nodes: [
					{
						commit: {
							statusCheckRollup: {
								state: "SUCCESS",
								contexts: {
									nodes: [
										{
											__typename: "CheckRun",
											name: "CI / build",
											status: "COMPLETED",
											conclusion: "SUCCESS",
											detailsUrl: "https://github.com/actions/runs/1",
										},
									],
								},
							},
						},
					},
				],
			},
			reviewRequests: { nodes: [] },
			reviews: {
				nodes: [
					{ author: { login: "bob", avatarUrl: "https://example.com/bob" }, state: "APPROVED" },
				],
			},
			reviewThreads: {
				nodes: [
					{
						id: "RT_1",
						isResolved: false,
						path: "src/auth.ts",
						line: 42,
						diffSide: "RIGHT",
						comments: {
							nodes: [
								{
									id: "C_1",
									body: "This is wrong",
									author: { login: "bob", avatarUrl: "https://example.com/bob" },
									createdAt: "2026-03-01T10:00:00Z",
								},
							],
						},
					},
				],
			},
			comments: { nodes: [] },
			files: {
				nodes: [{ path: "src/auth.ts", additions: 5, deletions: 2, changeType: "MODIFIED" }],
			},
			headRefName: "fix-auth",
			baseRefName: "main",
		};

		const result = mapPRDetails(raw as unknown as Parameters<typeof mapPRDetails>[0]);

		expect(result.title).toBe("Fix auth bug");
		expect(result.reviewDecision).toBe("REVIEW_REQUIRED");
		expect(result.ciState).toBe("SUCCESS");
		expect(result.checks).toHaveLength(1);
		expect(result.checks[0]?.name).toBe("CI / build");
		expect(result.reviewThreads).toHaveLength(1);
		expect(result.reviewThreads[0]?.path).toBe("src/auth.ts");
		expect(result.reviewThreads[0]?.comments).toHaveLength(1);
		expect(result.files).toHaveLength(1);
		expect(result.sourceBranch).toBe("fix-auth");
		expect(result.targetBranch).toBe("main");
	});

	test("handles missing statusCheckRollup (no CI)", () => {
		const raw = {
			title: "Docs update",
			body: "",
			state: "OPEN",
			isDraft: false,
			author: { login: "alice", avatarUrl: "" },
			reviewDecision: null,
			commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
			reviewRequests: { nodes: [] },
			reviews: { nodes: [] },
			reviewThreads: { nodes: [] },
			comments: { nodes: [] },
			files: { nodes: [] },
			headRefName: "docs",
			baseRefName: "main",
		};
		const result = mapPRDetails(raw as unknown as Parameters<typeof mapPRDetails>[0]);
		expect(result.ciState).toBeNull();
		expect(result.checks).toHaveLength(0);
	});
});

test("preserves provider revision OIDs without substituting a branch or stale commit node", () => {
	const raw = {
		title: "Pinned",
		body: "",
		state: "OPEN",
		isDraft: false,
		author: { login: "alice", avatarUrl: "" },
		reviewDecision: null,
		commits: { nodes: [{ commit: { oid: "c".repeat(40), statusCheckRollup: null } }] },
		reviewRequests: { nodes: [] },
		reviews: { nodes: [] },
		reviewThreads: { nodes: [] },
		comments: { nodes: [] },
		files: { nodes: [] },
		headRefName: "feature",
		baseRefName: "main",
		headRefOid: "a".repeat(40),
		baseRefOid: "b".repeat(40),
	};
	const result = mapPRDetails(raw as unknown as Parameters<typeof mapPRDetails>[0]);
	expect(result.headCommitOid).toBe(raw.headRefOid);
	expect(result.baseCommitOid).toBe(raw.baseRefOid);
	expect(
		mapPRDetails({ ...raw, baseRefOid: undefined } as unknown as Parameters<typeof mapPRDetails>[0])
			.baseCommitOid
	).toBeUndefined();
});

test("preserves outdated current-null versus original lines and side", () => {
	const raw = {
		title: "Threads",
		body: "",
		state: "OPEN",
		isDraft: false,
		author: { login: "alice", avatarUrl: "" },
		reviewDecision: null,
		commits: { nodes: [] },
		reviewRequests: { nodes: [] },
		reviews: { nodes: [] },
		comments: { nodes: [] },
		files: { nodes: [] },
		headRefName: "feature",
		baseRefName: "main",
		reviewThreads: {
			nodes: [
				{
					id: "outdated",
					isResolved: true,
					isOutdated: true,
					line: null,
					originalLine: 112,
					diffSide: "LEFT",
					path: "x.ts",
					comments: { nodes: [{ id: "c", body: "old", author: null, createdAt: "today" }] },
				},
				{
					id: "current",
					isResolved: false,
					isOutdated: false,
					line: 32,
					originalLine: 29,
					diffSide: "RIGHT",
					path: "x.ts",
					comments: { nodes: [] },
				},
				{
					id: "file",
					isResolved: false,
					line: null,
					diffSide: "RIGHT",
					path: "x.ts",
					comments: { nodes: [] },
				},
			],
		},
	};
	const result = mapPRDetails(raw as unknown as Parameters<typeof mapPRDetails>[0]);
	expect(result.reviewThreads[0]).toMatchObject({
		isOutdated: true,
		isResolved: true,
		line: null,
		originalLine: 112,
		diffSide: "LEFT",
		comments: [{ author: "Unknown" }],
	});
	expect(result.reviewThreads[1]).toMatchObject({
		isOutdated: false,
		line: 32,
		originalLine: 29,
		diffSide: "RIGHT",
	});
	expect(result.reviewThreads[2]?.isOutdated).toBeUndefined();
});
