import { describe, expect, test } from "bun:test";
import { fuzzyFilterPaths, fuzzyScore } from "../src/renderer/utils/fuzzy-match";

describe("fuzzyScore", () => {
	test("exact filename beats starts-with", () => {
		expect(fuzzyScore("app", "src/app.ts")).toBeGreaterThan(fuzzyScore("app", "src/apple.ts"));
	});

	test("filename starts-with beats filename substring", () => {
		expect(fuzzyScore("store", "src/store.ts")).toBeGreaterThan(
			fuzzyScore("store", "src/tab-store.ts")
		);
	});

	test("filename substring beats path substring", () => {
		expect(fuzzyScore("store", "a/tab-store.ts")).toBeGreaterThan(
			fuzzyScore("store", "stores/index.ts")
		);
	});

	test("subsequence on filename matches", () => {
		expect(fuzzyScore("sep", "components/SearchEverywherePopup.tsx")).toBeGreaterThan(-1);
	});

	test("no match returns -1", () => {
		expect(fuzzyScore("zzz", "src/app.ts")).toBe(-1);
	});

	test("shorter path wins ties", () => {
		expect(fuzzyScore("app", "app.ts")).toBeGreaterThan(fuzzyScore("app", "deep/nested/app.ts"));
	});

	test("case-insensitive", () => {
		expect(fuzzyScore("APP", "src/App.tsx")).toBeGreaterThan(-1);
	});

	test("empty query scores 0", () => {
		expect(fuzzyScore("", "src/app.ts")).toBe(0);
	});
});

describe("fuzzyFilterPaths", () => {
	test("sorts best-first and applies limit", () => {
		const paths = ["stores/index.ts", "src/tab-store.ts", "src/store.ts", "unrelated.md"];
		const result = fuzzyFilterPaths("store", paths, 2);
		expect(result).toEqual(["src/store.ts", "src/tab-store.ts"]);
	});

	test("excludes non-matches", () => {
		expect(fuzzyFilterPaths("zzz", ["a.ts", "b.ts"], 10)).toEqual([]);
	});
});
