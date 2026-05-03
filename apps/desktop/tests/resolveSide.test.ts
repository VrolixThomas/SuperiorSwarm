import { describe, expect, test } from "bun:test";
import { resolveSide } from "../src/renderer/components/solve/useSolveCommentZones";
import type { SolveCommentInfo } from "../src/shared/solve-types";

function comment(partial: Partial<SolveCommentInfo>): SolveCommentInfo {
	return {
		id: "c",
		platformCommentId: "p",
		author: "u",
		body: "",
		filePath: "f",
		lineNumber: null,
		side: null,
		threadId: null,
		status: "open",
		commitSha: null,
		groupId: null,
		followUpText: null,
		reply: null,
		...partial,
	};
}

interface FakeModel {
	getLineCount(): number;
}

const model = (n: number): FakeModel => ({ getLineCount: () => n });

describe("resolveSide", () => {
	test("explicit LEFT wins", () => {
		expect(resolveSide(comment({ side: "LEFT", lineNumber: 5 }), model(100), model(100))).toBe(
			"LEFT"
		);
	});

	test("explicit RIGHT wins", () => {
		expect(resolveSide(comment({ side: "RIGHT", lineNumber: 5 }), model(100), model(100))).toBe(
			"RIGHT"
		);
	});

	test("null side + null lineNumber → RIGHT (file-level)", () => {
		expect(resolveSide(comment({ side: null, lineNumber: null }), model(100), model(100))).toBe(
			"RIGHT"
		);
	});

	test("null side + line beyond modified count → LEFT (deleted line)", () => {
		expect(resolveSide(comment({ side: null, lineNumber: 50 }), model(10), model(100))).toBe(
			"LEFT"
		);
	});

	test("null side + line within both → RIGHT (default to new)", () => {
		expect(resolveSide(comment({ side: null, lineNumber: 5 }), model(100), model(100))).toBe(
			"RIGHT"
		);
	});

	test("case-insensitive side strings", () => {
		expect(resolveSide(comment({ side: "left", lineNumber: 5 }), model(100), model(100))).toBe(
			"LEFT"
		);
	});

	test("null models behave like 0 line counts", () => {
		expect(resolveSide(comment({ side: null, lineNumber: 5 }), null, null)).toBe("RIGHT");
	});
});
