import { describe, expect, test } from "bun:test";
import {
	type PreviousCommentContext,
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
