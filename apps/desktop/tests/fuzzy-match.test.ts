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

	test("filename starts-with beats filename substring regardless of path length", () => {
		const longStartsWith = `${"deep/".repeat(300)}store.ts`;
		const shortSubstring = "tab-store.ts";
		expect(fuzzyScore("store", longStartsWith)).toBeGreaterThan(
			fuzzyScore("store", shortSubstring)
		);
		expect(fuzzyFilterPaths("store", [shortSubstring, longStartsWith], 2)).toEqual([
			longStartsWith,
			shortSubstring,
		]);
	});

	test("filename substring beats path substring", () => {
		expect(fuzzyScore("store", "a/tab-store.ts")).toBeGreaterThan(
			fuzzyScore("store", "stores/index.ts")
		);
	});

	test("filename substring beats path substring regardless of path length", () => {
		const longFilenameSubstring = `${"deep/".repeat(300)}tab-store.ts`;
		const shortPathSubstring = "stores/index.ts";
		expect(fuzzyScore("store", longFilenameSubstring)).toBeGreaterThan(
			fuzzyScore("store", shortPathSubstring)
		);
		expect(fuzzyFilterPaths("store", [shortPathSubstring, longFilenameSubstring], 2)).toEqual([
			longFilenameSubstring,
			shortPathSubstring,
		]);
	});

	test("subsequence on filename matches", () => {
		expect(fuzzyScore("sep", "components/SearchEverywherePopup.tsx")).toBeGreaterThan(-1);
	});

	test("backslash separates filename", () => {
		expect(fuzzyScore("store", "dir\\store.ts")).toBeGreaterThan(
			fuzzyScore("store", "tab-store.ts")
		);
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

	test("valid match does not collide with no-match sentinel", () => {
		const path = `a/${"x".repeat(197)}/z`;
		expect(path.length).toBe(201);
		expect(fuzzyScore("az", path)).not.toBe(-1);
		expect(fuzzyFilterPaths("az", [path], 10)).toEqual([path]);
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

	test("includes long matches with bounded positive scores", () => {
		const path = `${"deep/".repeat(130)}SearchEverywherePopup.tsx`;
		expect(fuzzyScore("sep", path)).toBeGreaterThan(0);
		expect(fuzzyFilterPaths("sep", [path], 10)).toEqual([path]);
	});

	test("sorts same-band ties by shorter path length", () => {
		const shortPath = "src/store.ts";
		const longPath = `${"deep/".repeat(20)}store.ts`;
		expect(fuzzyScore("store", shortPath)).toBeGreaterThan(fuzzyScore("store", longPath));
		expect(fuzzyFilterPaths("store", [longPath, shortPath], 10)).toEqual([shortPath, longPath]);
	});
});
