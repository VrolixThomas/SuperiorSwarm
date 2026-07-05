import { describe, expect, test } from "bun:test";
import { mergeAllResults } from "../src/renderer/utils/merge-all-results";

type Item = { type: "file"; path: string } | { type: "symbol"; name: string; path: string };

function file(path: string): Item {
	return { type: "file", path };
}

function symbol(name: string, path = "src/x.ts"): Item {
	return { type: "symbol", name, path };
}

describe("mergeAllResults", () => {
	test("exact filename beats exact symbol name", () => {
		const merged = mergeAllResults("store.ts", [file("src/store.ts")], [symbol("store.ts")], 10);
		expect(merged[0]).toEqual(file("src/store.ts"));
	});

	test("exact symbol beats fuzzy filename", () => {
		const merged = mergeAllResults(
			"openFile",
			[file("src/open-file-helpers.ts")],
			[symbol("openFile")],
			10
		);
		expect(merged[0]).toEqual(symbol("openFile"));
	});

	test("non-matching items are dropped", () => {
		const merged = mergeAllResults("zzz", [file("a.ts")], [symbol("b")], 10);
		expect(merged).toEqual([]);
	});

	test("caps at limit", () => {
		const files = Array.from({ length: 60 }, (_, i) => file(`src/store-${i}.ts`));
		const merged = mergeAllResults("store", files, [], 50);
		expect(merged.length).toBe(50);
	});
});
