import type { DiffFile } from "../../shared/diff-types";

function topLevelDir(path: string): string {
	const parts = path.split("/");
	return parts.length > 1 ? (parts[0] ?? ".") : ".";
}

const BY_DIR_THEN_PATH = (a: DiffFile, b: DiffFile) => {
	const groupCmp = topLevelDir(a.path).localeCompare(topLevelDir(b.path));
	if (groupCmp !== 0) return groupCmp;
	return a.path.localeCompare(b.path);
};

// Canonical working-tree file list shared by ReviewTab and DraftCommitCard.
// Staged entries win when a file is both staged and modified-after-staging
// (otherwise the same path would appear twice and break j/k navigation).
export function buildWorkingFileList(status: {
	stagedFiles: DiffFile[];
	unstagedFiles: DiffFile[];
}): DiffFile[] {
	const seen = new Set<string>();
	const out: DiffFile[] = [];
	for (const f of status.stagedFiles) {
		if (seen.has(f.path)) continue;
		seen.add(f.path);
		out.push(f);
	}
	for (const f of status.unstagedFiles) {
		if (seen.has(f.path)) continue;
		seen.add(f.path);
		out.push(f);
	}
	return out.sort(BY_DIR_THEN_PATH);
}
