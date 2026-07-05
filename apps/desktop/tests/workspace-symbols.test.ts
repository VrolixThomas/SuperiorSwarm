import { describe, expect, test } from "bun:test";
import { MAX_SYMBOLS, normalizeWorkspaceSymbols } from "../src/main/lsp/workspace-symbols";

const REPO = "/Users/me/proj";

function sym(name: string, uri: string, line = 4, character = 2) {
	return {
		name,
		kind: 12,
		containerName: "Outer",
		location: { uri, range: { start: { line, character }, end: { line, character: 9 } } },
	};
}

describe("normalizeWorkspaceSymbols", () => {
	test("converts SymbolInformation to repo-relative 1-based hits", () => {
		const hits = normalizeWorkspaceSymbols([sym("doThing", `file://${REPO}/src/a.ts`)], REPO);
		expect(hits).toEqual([
			{ name: "doThing", kind: 12, path: "src/a.ts", line: 5, column: 3, container: "Outer" },
		]);
	});

	test("handles WorkspaceSymbol with location without range", () => {
		const hits = normalizeWorkspaceSymbols(
			[{ name: "X", kind: 5, location: { uri: `file://${REPO}/b.ts` } }],
			REPO
		);
		expect(hits).toEqual([{ name: "X", kind: 5, path: "b.ts", line: 1, column: 1 }]);
	});

	test("decodes URI escapes", () => {
		const hits = normalizeWorkspaceSymbols([sym("y", `file://${REPO}/my%20dir/c.ts`)], REPO);
		expect(hits[0]?.path).toBe("my dir/c.ts");
	});

	test("keeps absolute path when outside repo", () => {
		const hits = normalizeWorkspaceSymbols([sym("z", "file:///other/place/d.ts")], REPO);
		expect(hits[0]?.path).toBe("/other/place/d.ts");
	});

	test("keeps absolute path for sibling directories outside repo", () => {
		const hits = normalizeWorkspaceSymbols([sym("z", "file:///Users/me/other/d.ts")], REPO);
		expect(hits[0]?.path).toBe("/Users/me/other/d.ts");
	});

	test("keeps in-repo path segments that start with two dots repo-relative", () => {
		const hits = normalizeWorkspaceSymbols([sym("g", `file://${REPO}/..generated/a.ts`)], REPO);
		expect(hits[0]?.path).toBe("..generated/a.ts");
	});

	test("ignores range positions with malformed line or character values", () => {
		const hits = normalizeWorkspaceSymbols(
			[
				{
					name: "badLine",
					kind: 12,
					location: {
						uri: `file://${REPO}/bad-line.ts`,
						range: { start: { line: "4", character: 2 } },
					},
				},
				{
					name: "badCharacter",
					kind: 12,
					location: {
						uri: `file://${REPO}/bad-character.ts`,
						range: { start: { line: 4, character: "2" } },
					},
				},
			],
			REPO
		);
		expect(hits).toEqual([]);
	});

	test("ignores range positions with non-finite line or character values", () => {
		const hits = normalizeWorkspaceSymbols(
			[
				{
					name: "badLine",
					kind: 12,
					location: {
						uri: `file://${REPO}/bad-line.ts`,
						range: { start: { line: Number.NaN, character: 2 } },
					},
				},
				{
					name: "badCharacter",
					kind: 12,
					location: {
						uri: `file://${REPO}/bad-character.ts`,
						range: { start: { line: 4, character: Number.POSITIVE_INFINITY } },
					},
				},
			],
			REPO
		);
		expect(hits).toEqual([]);
	});

	test("does not dedup distinct symbols whose colon-delimited keys would collide", () => {
		const hits = normalizeWorkspaceSymbols(
			[sym("a:b", `file://${REPO}/c/d.ts`, 6), sym("a", `file://${REPO}/b:c/d.ts`, 6)],
			REPO
		);
		expect(hits.map((hit) => hit.name)).toEqual(["a:b", "a"]);
	});

	test("dedups by name+path+line and caps at MAX_SYMBOLS", () => {
		const raw = [
			sym("dup", `file://${REPO}/a.ts`),
			sym("dup", `file://${REPO}/a.ts`),
			...Array.from({ length: MAX_SYMBOLS + 20 }, (_, i) =>
				sym(`s${i}`, `file://${REPO}/f${i}.ts`)
			),
		];
		const hits = normalizeWorkspaceSymbols(raw, REPO);
		expect(hits.filter((h) => h.name === "dup").length).toBe(1);
		expect(hits.length).toBe(MAX_SYMBOLS);
	});

	test("ignores malformed entries", () => {
		expect(normalizeWorkspaceSymbols([null, {}, { name: "n" }], REPO)).toEqual([]);
	});
});
