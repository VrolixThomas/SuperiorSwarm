import { describe, expect, test } from "bun:test";
import { buildInlineCommentsPrompt } from "../src/shared/inline-comment-prompt";

describe("buildInlineCommentsPrompt", () => {
	test("single-line comment renders file:line header, quoted snippet, comment body", () => {
		const prompt = buildInlineCommentsPrompt([
			{
				filePath: "src/bar.ts",
				startLine: 10,
				endLine: 10,
				codeSnapshot: "const x = 1;",
				body: "use a descriptive name",
			},
		]);
		expect(prompt).toContain("Address the following review comments on your current changes:");
		expect(prompt).toContain("## src/bar.ts:10");
		expect(prompt).not.toContain("## src/bar.ts:10-10");
		expect(prompt).toContain("> const x = 1;");
		expect(prompt).toContain("Comment: use a descriptive name");
	});

	test("multi-line range renders start-end header and quotes every snapshot line", () => {
		const prompt = buildInlineCommentsPrompt([
			{
				filePath: "apps/desktop/src/foo.ts",
				startLine: 42,
				endLine: 45,
				codeSnapshot: "line a\nline b",
				body: "rename this, unclear",
			},
		]);
		expect(prompt).toContain("## apps/desktop/src/foo.ts:42-45");
		expect(prompt).toContain("> line a\n> line b");
	});

	test("comments are sorted by filePath then startLine", () => {
		const prompt = buildInlineCommentsPrompt([
			{ filePath: "b.ts", startLine: 5, endLine: 5, codeSnapshot: "b5", body: "second file" },
			{ filePath: "a.ts", startLine: 9, endLine: 9, codeSnapshot: "a9", body: "later line" },
			{ filePath: "a.ts", startLine: 2, endLine: 2, codeSnapshot: "a2", body: "early line" },
		]);
		const iA2 = prompt.indexOf("## a.ts:2");
		const iA9 = prompt.indexOf("## a.ts:9");
		const iB5 = prompt.indexOf("## b.ts:5");
		expect(iA2).toBeGreaterThan(-1);
		expect(iA2).toBeLessThan(iA9);
		expect(iA9).toBeLessThan(iB5);
	});

	test("outdated comment gets a note after the header", () => {
		const prompt = buildInlineCommentsPrompt([
			{
				filePath: "gone.ts",
				startLine: 3,
				endLine: 3,
				codeSnapshot: "old code",
				body: "still relevant",
				outdated: true,
			},
		]);
		expect(prompt).toContain(
			"Note: the commented code was not found at this location anymore; the comment may refer to an earlier version."
		);
	});
});
