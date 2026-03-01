export type CandidateEntry = {
	name: string;
	relativePath: string;
	type: "file" | "directory";
	children?: CandidateEntry[];
};

/**
 * Converts a flat sorted array of relative file paths into a tree structure.
 * At each level, files are sorted before directories (both alphabetically).
 */
export function buildCandidateTree(paths: string[]): CandidateEntry[] {
	if (paths.length === 0) return [];

	// Group by first path segment
	const groups = new Map<string, string[]>();
	const rootFiles: string[] = [];

	for (const p of paths) {
		const slashIdx = p.indexOf("/");
		if (slashIdx === -1) {
			rootFiles.push(p);
		} else {
			const dir = p.substring(0, slashIdx);
			const rest = p.substring(slashIdx + 1);
			let group = groups.get(dir);
			if (!group) {
				group = [];
				groups.set(dir, group);
			}
			group.push(rest);
		}
	}

	const result: CandidateEntry[] = [];

	// Files first, sorted
	for (const name of rootFiles.sort()) {
		result.push({ name, relativePath: name, type: "file" });
	}

	// Directories second, sorted
	const sortedDirs = [...groups.keys()].sort();
	for (const dir of sortedDirs) {
		const childPaths = groups.get(dir)!;
		const children = buildCandidateTree(childPaths);
		// Fix relativePaths: prepend parent dir
		fixRelativePaths(children, dir);
		result.push({
			name: dir,
			relativePath: dir,
			type: "directory",
			children,
		});
	}

	return result;
}

function fixRelativePaths(entries: CandidateEntry[], prefix: string): void {
	for (const entry of entries) {
		entry.relativePath = `${prefix}/${entry.relativePath}`;
		if (entry.children) {
			fixRelativePaths(entry.children, prefix);
		}
	}
}
