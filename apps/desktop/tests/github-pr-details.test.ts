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

		const result = mapPRDetails(raw as any);

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
		const result = mapPRDetails(raw as any);
		expect(result.ciState).toBeNull();
		expect(result.checks).toHaveLength(0);
	});
});
