import { describe, expect, test } from "bun:test";
import {
	type PreviousCommentContext,
	buildSolveFollowUpContextBlock,
	formatPreviousCommentLines,
} from "../src/shared/prompt-preview";

describe("formatPreviousCommentLines", () => {
	test("formats line, status, truncates body over 100 chars", () => {
		const comments: PreviousCommentContext[] = [
			{
				id: "abc",
				filePath: "src/foo.ts",
				lineNumber: 42,
				body: "short comment",
				platformStatus: "open",
			},
			{
				id: "def",
				filePath: "src/bar.ts",
				lineNumber: null,
				body: "x".repeat(150),
				platformStatus: "resolved-on-platform",
			},
		];
		const out = formatPreviousCommentLines(comments);
		expect(out).toBe(
			[
				`1. [src/foo.ts:42] "short comment" -- STATUS: still on PR (id: abc)`,
				`2. [src/bar.ts] "${"x".repeat(100)}..." -- STATUS: resolved by author on platform (id: def)`,
			].join("\n")
		);
	});

	test("returns empty string for empty input", () => {
		expect(formatPreviousCommentLines([])).toBe("");
	});
});

describe("buildSolveFollowUpContextBlock", () => {
	test("renders all fields in the expected layout", () => {
		const block = buildSolveFollowUpContextBlock({
			prTitle: "Add foo",
			sessionId: "sess-1",
			sourceBranch: "feat/foo",
			targetBranch: "main",
			groupLabel: "rename helper",
			commitHash: "abc1234",
			commentAuthor: "alice",
			commentLocation: "src/foo.ts:42",
			commentBody: "rename to bar",
			commentStatus: "fixed",
			followUpText: "actually call it baz",
		});
		expect(block).toContain("PR: Add foo");
		expect(block).toContain("Session ID: sess-1");
		expect(block).toContain("Source: feat/foo → Target: main");
		expect(block).toContain(`Group: "rename helper" (commit abc1234)`);
		expect(block).toContain(`Original comment by @alice at src/foo.ts:42:`);
		expect(block).toContain(`"rename to bar"`);
		expect(block).toContain("marked this comment as: fixed");
		expect(block).toContain(`"actually call it baz"`);
		expect(block.startsWith("<pr_context>")).toBe(true);
		expect(block.endsWith("</pr_context>")).toBe(true);
	});
});
