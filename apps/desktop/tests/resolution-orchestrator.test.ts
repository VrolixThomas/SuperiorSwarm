import { describe, expect, test } from "bun:test";
import { buildResolutionPrompt } from "../src/main/ai-review/resolution-orchestrator";

describe("buildResolutionPrompt", () => {
	test("includes all comments in the prompt", () => {
		const prompt = buildResolutionPrompt({
			prNumber: 42,
			prTitle: "Add auth middleware",
			sourceBranch: "feat/auth",
			targetBranch: "main",
			comments: [
				{
					id: "c1",
					author: "reviewer1",
					filePath: "auth.ts",
					lineNumber: 10,
					body: "Add null check",
				},
				{
					id: "c2",
					author: "reviewer2",
					filePath: null,
					lineNumber: null,
					body: "Consider rate limiting",
				},
			],
		});
		expect(prompt).toContain("PR #42");
		expect(prompt).toContain("Add auth middleware");
		expect(prompt).toContain("reviewer1 on auth.ts:10");
		expect(prompt).toContain("Add null check");
		expect(prompt).toContain("reviewer2 (general)");
		expect(prompt).toContain("resolve_and_commit");
		expect(prompt).toContain("skip_comment");
		expect(prompt).toContain("finish_resolution");
	});

	test("handles empty comments list", () => {
		const prompt = buildResolutionPrompt({
			prNumber: 1,
			prTitle: "Fix typo",
			sourceBranch: "fix/typo",
			targetBranch: "main",
			comments: [],
		});
		expect(prompt).toContain("PR #1");
		expect(prompt).toContain("Fix typo");
		expect(prompt).toContain("No review comments to resolve");
	});

	test("includes branch info", () => {
		const prompt = buildResolutionPrompt({
			prNumber: 10,
			prTitle: "Update config",
			sourceBranch: "feat/config",
			targetBranch: "develop",
			comments: [
				{
					id: "c1",
					author: "reviewer",
					filePath: "config.ts",
					lineNumber: 5,
					body: "Use env var",
				},
			],
		});
		expect(prompt).toContain("feat/config");
		expect(prompt).toContain("develop");
	});
});
