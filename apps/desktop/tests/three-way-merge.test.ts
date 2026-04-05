import { describe, expect, test } from "bun:test";
import {
	computeSideDiffs,
	computeThreeWayMerge,
	resolveHunk,
} from "../src/renderer/lib/three-way-merge";

describe("computeThreeWayMerge", () => {
	test("auto-merges non-conflicting changes on different lines", () => {
		// Changes need to be separated by at least one unchanged line for diff3 to auto-merge
		const base = "line1\nline2\nline3\nline4\nline5\n";
		const ours = "line1\nOURS\nline3\nline4\nline5\n";
		const theirs = "line1\nline2\nline3\nline4\nTHEIRS\n";

		const result = computeThreeWayMerge(base, ours, theirs);

		expect(result.hasConflicts).toBe(false);
		expect(result.mergedContent).toBe("line1\nOURS\nline3\nline4\nTHEIRS\n");
		expect(result.hunks.every((h) => h.status === "auto")).toBe(true);
	});

	test("detects conflict when same line changed on both sides", () => {
		const base = "line1\nshared\nline3\n";
		const ours = "line1\nours-change\nline3\n";
		const theirs = "line1\ntheirs-change\nline3\n";

		const result = computeThreeWayMerge(base, ours, theirs);

		expect(result.hasConflicts).toBe(true);
		expect(result.hunks.some((h) => h.type === "conflict")).toBe(true);
	});

	test("one side unchanged auto-merges the other", () => {
		const base = "alpha\nbeta\ngamma\n";
		const ours = "alpha\nbeta-modified\ngamma\n";
		const theirs = "alpha\nbeta\ngamma\n";

		const result = computeThreeWayMerge(base, ours, theirs);

		expect(result.hasConflicts).toBe(false);
		expect(result.mergedContent).toBe("alpha\nbeta-modified\ngamma\n");
	});

	test("reports correct line numbers for hunks", () => {
		// Use clearly separated changes so diff3 auto-merges them
		const base = "a\nb\nc\nd\ne\n";
		const ours = "a\nB\nc\nd\ne\n";
		const theirs = "a\nb\nc\nd\nE\n";

		const result = computeThreeWayMerge(base, ours, theirs);

		expect(result.hasConflicts).toBe(false);
		// All lines should be covered with sequential line numbers
		const allLines = result.hunks.flatMap((h) => h.resultLines);
		expect(allLines).toEqual(["a", "B", "c", "d", "E"]);
		// First hunk starts at line 1
		expect(result.hunks[0]?.startLine).toBe(1);
	});

	test("empty base (new file on both sides) produces conflict", () => {
		const base = "";
		const ours = "ours content\n";
		const theirs = "theirs content\n";

		const result = computeThreeWayMerge(base, ours, theirs);

		expect(result.hasConflicts).toBe(true);
	});

	test("identical changes on both sides auto-merge", () => {
		const base = "foo\nbar\n";
		const ours = "foo\nbaz\n";
		const theirs = "foo\nbaz\n";

		const result = computeThreeWayMerge(base, ours, theirs);

		expect(result.hasConflicts).toBe(false);
		expect(result.mergedContent).toBe("foo\nbaz\n");
	});
});

describe("resolveHunk", () => {
	function makeConflictResult() {
		const base = "line1\nconflict\nline3\n";
		const ours = "line1\nours-version\nline3\n";
		const theirs = "line1\ntheirs-version\nline3\n";
		return computeThreeWayMerge(base, ours, theirs);
	}

	test("resolving with 'theirs' replaces conflict lines with theirs", () => {
		const { hunks } = makeConflictResult();
		const conflictHunk = hunks.find((h) => h.type === "conflict");
		expect(conflictHunk).toBeDefined();

		const { hunks: updated } = resolveHunk(hunks, conflictHunk!.id, "theirs");
		const resolved = updated.find((h) => h.id === conflictHunk!.id);

		expect(resolved?.status).toBe("resolved");
		expect(resolved?.resultLines).toEqual(conflictHunk!.theirsLines);
	});

	test("resolving with 'ours' replaces conflict lines with ours", () => {
		const { hunks } = makeConflictResult();
		const conflictHunk = hunks.find((h) => h.type === "conflict");
		expect(conflictHunk).toBeDefined();

		const { hunks: updated } = resolveHunk(hunks, conflictHunk!.id, "ours");
		const resolved = updated.find((h) => h.id === conflictHunk!.id);

		expect(resolved?.status).toBe("resolved");
		expect(resolved?.resultLines).toEqual(conflictHunk!.oursLines);
	});

	test("resolving with 'both' concatenates theirs then ours", () => {
		const { hunks } = makeConflictResult();
		const conflictHunk = hunks.find((h) => h.type === "conflict");
		expect(conflictHunk).toBeDefined();

		const { hunks: updated } = resolveHunk(hunks, conflictHunk!.id, "both");
		const resolved = updated.find((h) => h.id === conflictHunk!.id);

		expect(resolved?.status).toBe("resolved");
		expect(resolved?.resultLines).toEqual([
			...conflictHunk!.theirsLines,
			...conflictHunk!.oursLines,
		]);
	});

	test("resolving with 'base' replaces conflict lines with base", () => {
		const { hunks } = makeConflictResult();
		const conflictHunk = hunks.find((h) => h.type === "conflict");
		expect(conflictHunk).toBeDefined();

		const { hunks: updated } = resolveHunk(hunks, conflictHunk!.id, "base");
		const resolved = updated.find((h) => h.id === conflictHunk!.id);

		expect(resolved?.status).toBe("resolved");
		expect(resolved?.resultLines).toEqual(conflictHunk!.baseLines);
	});

	test("resolveHunk recalculates line numbers after resolution", () => {
		const { hunks } = makeConflictResult();
		const conflictHunk = hunks.find((h) => h.type === "conflict");
		expect(conflictHunk).toBeDefined();

		const { hunks: updated, mergedContent } = resolveHunk(hunks, conflictHunk!.id, "theirs");

		// Line numbers should be sequential starting at 1
		let expectedStart = 1;
		for (const hunk of updated) {
			expect(hunk.startLine).toBe(expectedStart);
			expectedStart += hunk.resultLines.length;
		}

		// mergedContent should reflect resolved lines
		const allLines = updated.flatMap((h) => h.resultLines);
		expect(mergedContent).toBe(allLines.join("\n") + (allLines.length > 0 ? "\n" : ""));
	});
});

describe("computeSideDiffs", () => {
	test("detects added lines", () => {
		const base = "line1\nline2\n";
		const side = "line1\nline2\nnew-line\n";

		const diffs = computeSideDiffs(base, side);

		expect(diffs.length).toBeGreaterThan(0);
		expect(diffs.some((d) => d.type === "added")).toBe(true);
	});

	test("detects modified lines", () => {
		const base = "line1\noriginal\nline3\n";
		const side = "line1\nmodified\nline3\n";

		const diffs = computeSideDiffs(base, side);

		expect(diffs.length).toBeGreaterThan(0);
		expect(diffs.some((d) => d.type === "modified")).toBe(true);
	});

	test("returns empty array for identical content", () => {
		const content = "line1\nline2\nline3\n";

		const diffs = computeSideDiffs(content, content);

		expect(diffs).toHaveLength(0);
	});

	test("returned regions have valid startLine and endLine", () => {
		const base = "a\nb\nc\n";
		const side = "a\nB\nC\n";

		const diffs = computeSideDiffs(base, side);

		for (const diff of diffs) {
			expect(diff.startLine).toBeGreaterThanOrEqual(1);
			expect(diff.endLine).toBeGreaterThanOrEqual(diff.startLine);
		}
	});
});
