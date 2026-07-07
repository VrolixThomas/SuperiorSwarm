import { describe, expect, test } from "bun:test";
import { reanchorComment } from "../src/shared/comment-anchor";

const content = ["alpha", "beta", "gamma", "delta", "beta", "epsilon"].join("\n");

describe("reanchorComment", () => {
	test("exact match at stored line is returned unchanged", () => {
		expect(reanchorComment(content, 3, 3, "gamma")).toEqual({
			startLine: 3,
			endLine: 3,
			outdated: false,
		});
	});

	test("snapshot that moved is found at its new location", () => {
		// "delta" stored at line 2, now lives at line 4
		expect(reanchorComment(content, 2, 2, "delta")).toEqual({
			startLine: 4,
			endLine: 4,
			outdated: false,
		});
	});

	test("duplicate snapshot resolves to occurrence nearest the stored line", () => {
		// "beta" occurs at 2 and 5; stored at 6 → nearest is 5
		expect(reanchorComment(content, 6, 6, "beta")).toEqual({
			startLine: 5,
			endLine: 5,
			outdated: false,
		});
	});

	test("multi-line snapshot matches as a block and preserves range length", () => {
		expect(reanchorComment(content, 1, 2, "gamma\ndelta")).toEqual({
			startLine: 3,
			endLine: 4,
			outdated: false,
		});
	});

	test("missing snapshot is outdated, clamped to file length", () => {
		expect(reanchorComment(content, 40, 42, "vanished code")).toEqual({
			startLine: 6,
			endLine: 6,
			outdated: true,
		});
	});
});
