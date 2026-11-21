import { expect, test } from "bun:test";
import { requireCompleteChangedFiles } from "../src/main/review-path/metadata";
test("unknown or partial provider coverage never becomes a complete reading path", () => {
	expect(() => requireCompleteChangedFiles({ files: [{ path: "a.ts" }] })).toThrow("unverified");
	expect(() => requireCompleteChangedFiles({ files: [], filesComplete: false })).toThrow(
		"unverified"
	);
	expect(requireCompleteChangedFiles({ files: [{ path: "a.ts" }], filesComplete: true })).toEqual([
		"a.ts",
	]);
	expect(requireCompleteChangedFiles({ files: [], filesComplete: true })).toEqual([]);
});
