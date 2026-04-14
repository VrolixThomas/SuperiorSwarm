import { describe, expect, test } from "bun:test";
import { type DiffContext, refsForDiffContext } from "../src/shared/diff-types";

describe("refsForDiffContext", () => {
	test("working-tree: HEAD vs on-disk working tree (empty ref)", () => {
		const ctx: DiffContext = { type: "working-tree", repoPath: "/repo" };
		expect(refsForDiffContext(ctx)).toEqual({ originalRef: "HEAD", modifiedRef: "" });
	});

	test("branch: baseBranch vs headBranch", () => {
		const ctx: DiffContext = {
			type: "branch",
			repoPath: "/repo",
			baseBranch: "main",
			headBranch: "feature",
		};
		expect(refsForDiffContext(ctx)).toEqual({ originalRef: "main", modifiedRef: "feature" });
	});

	test("pr: targetBranch vs sourceBranch", () => {
		const ctx: DiffContext = {
			type: "pr",
			prId: 1,
			workspaceSlug: "ws",
			repoSlug: "repo",
			repoPath: "/repo",
			title: "t",
			sourceBranch: "feature",
			targetBranch: "main",
		};
		expect(refsForDiffContext(ctx)).toEqual({ originalRef: "main", modifiedRef: "feature" });
	});

	test("commit: <hash>~1 vs <hash>", () => {
		const ctx: DiffContext = {
			type: "commit",
			repoPath: "/repo",
			commitHash: "abc1234def",
		};
		expect(refsForDiffContext(ctx)).toEqual({
			originalRef: "abc1234def~1",
			modifiedRef: "abc1234def",
		});
	});
});
