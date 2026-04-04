import { diff3Merge } from "node-diff3";

export type MergeResolution = "ours" | "theirs" | "both" | "base";

export interface MergeHunk {
	id: string;
	type: "ok" | "conflict";
	status: "auto" | "pending" | "resolved";
	startLine: number;
	resultLines: string[];
	// Only populated for conflict hunks
	oursLines: string[];
	theirsLines: string[];
	baseLines: string[];
}

export interface MergeResult {
	mergedContent: string;
	hunks: MergeHunk[];
	hasConflicts: boolean;
}

export interface DiffRegion {
	startLine: number;
	endLine: number;
	type: "added" | "modified";
}

let hunkCounter = 0;

function nextId(): string {
	return `hunk-${++hunkCounter}`;
}

function splitLines(text: string): string[] {
	if (text === "") return [];
	// Strip trailing newline so we don't get a spurious empty element
	const stripped = text.endsWith("\n") ? text.slice(0, -1) : text;
	return stripped.split("\n");
}

function buildMergedContent(hunks: MergeHunk[]): string {
	const lines = hunks.flatMap((h) => h.resultLines);
	return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

function recalcLineNumbers(hunks: MergeHunk[]): MergeHunk[] {
	let cursor = 1;
	return hunks.map((hunk) => {
		const updated = { ...hunk, startLine: cursor };
		cursor += hunk.resultLines.length;
		return updated;
	});
}

export function computeThreeWayMerge(base: string, ours: string, theirs: string): MergeResult {
	const baseLines = splitLines(base);
	const oursLines = splitLines(ours);
	const theirsLines = splitLines(theirs);

	const sections = diff3Merge(oursLines, baseLines, theirsLines);

	const hunks: MergeHunk[] = [];
	let hasConflicts = false;

	for (const section of sections) {
		if ("ok" in section) {
			hunks.push({
				id: nextId(),
				type: "ok",
				status: "auto",
				startLine: 0, // recalculated below
				resultLines: section.ok,
				oursLines: [],
				theirsLines: [],
				baseLines: [],
			});
		} else {
			hasConflicts = true;
			const { a: sectionOurs, o: sectionBase, b: sectionTheirs } = section.conflict;
			hunks.push({
				id: nextId(),
				type: "conflict",
				status: "pending",
				startLine: 0,
				// Use ours as placeholder in merged content (matches spec)
				resultLines: [...sectionOurs],
				oursLines: [...sectionOurs],
				theirsLines: [...sectionTheirs],
				baseLines: [...sectionBase],
			});
		}
	}

	const numbered = recalcLineNumbers(hunks);
	const mergedContent = buildMergedContent(numbered);

	return { mergedContent, hunks: numbered, hasConflicts };
}

export function resolveHunk(
	hunks: MergeHunk[],
	hunkId: string,
	resolution: MergeResolution,
): { hunks: MergeHunk[]; mergedContent: string } {
	const updated = hunks.map((hunk) => {
		if (hunk.id !== hunkId) return hunk;

		let resultLines: string[];
		switch (resolution) {
			case "ours":
				resultLines = [...hunk.oursLines];
				break;
			case "theirs":
				resultLines = [...hunk.theirsLines];
				break;
			case "both":
				resultLines = [...hunk.theirsLines, ...hunk.oursLines];
				break;
			case "base":
				resultLines = [...hunk.baseLines];
				break;
		}

		return { ...hunk, resultLines, status: "resolved" as const };
	});

	const numbered = recalcLineNumbers(updated);
	const mergedContent = buildMergedContent(numbered);

	return { hunks: numbered, mergedContent };
}

// Simple LCS-based diff to find changed regions in `side` relative to `base`.
export function computeSideDiffs(base: string, side: string): DiffRegion[] {
	const baseLines = splitLines(base);
	const sideLines = splitLines(side);

	if (baseLines.length === 0 && sideLines.length === 0) return [];

	// Build LCS table
	const m = baseLines.length;
	const n = sideLines.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (baseLines[i - 1] === sideLines[j - 1]) {
				dp[i]![j] = dp[i - 1]![j - 1]! + 1;
			} else {
				dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
			}
		}
	}

	// Backtrack to classify each side line as unchanged, added, or modified
	// We produce an edit script: for each line in sideLines, mark it.
	// Strategy: walk the dp table to find which side lines are in the LCS.
	const inLcs = new Set<number>(); // indices into sideLines that are in LCS
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		if (baseLines[i - 1] === sideLines[j - 1]) {
			inLcs.add(j - 1);
			i--;
			j--;
		} else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
			i--;
		} else {
			j--;
		}
	}

	// Similarly find which base lines are in the LCS (to detect deletions = potential modifications)
	const baseInLcs = new Set<number>();
	i = m;
	j = n;
	while (i > 0 && j > 0) {
		if (baseLines[i - 1] === sideLines[j - 1]) {
			baseInLcs.add(i - 1);
			i--;
			j--;
		} else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
			i--;
		} else {
			j--;
		}
	}

	// Count deleted base lines (not in LCS) and added side lines (not in LCS).
	// We classify added side lines: if there are also deleted base lines nearby,
	// label them "modified"; otherwise "added".
	const deletedCount = baseLines.filter((_, idx) => !baseInLcs.has(idx)).length;

	// Build regions for consecutive non-LCS runs in sideLines
	const regions: DiffRegion[] = [];
	let runStart: number | null = null;

	for (let k = 0; k < sideLines.length; k++) {
		const isChanged = !inLcs.has(k);
		if (isChanged) {
			if (runStart === null) runStart = k;
		} else {
			if (runStart !== null) {
				const type = deletedCount > 0 ? "modified" : "added";
				regions.push({ startLine: runStart + 1, endLine: k, type });
				runStart = null;
			}
		}
	}
	if (runStart !== null) {
		const type = deletedCount > 0 ? "modified" : "added";
		regions.push({ startLine: runStart + 1, endLine: sideLines.length, type });
	}

	return regions;
}
