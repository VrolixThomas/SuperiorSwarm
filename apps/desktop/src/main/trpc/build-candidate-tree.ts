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

/** Recursively count all file entries under a CandidateEntry. */
export function countFiles(entry: CandidateEntry): number {
	if (entry.type === "file") return 1;
	if (!entry.children) return 0;
	return entry.children.reduce((sum, child) => sum + countFiles(child), 0);
}

/**
 * Like buildCandidateTree, but groups files under their topmost *gitignored*
 * ancestor directory. Files with no gitignored ancestor appear as root-level
 * file entries with their full relative path as the name.
 */
export function buildSmartCandidateTree(
	paths: string[],
	isIgnoredDir: (dirPath: string) => boolean,
): CandidateEntry[] {
	if (paths.length === 0) return [];

	const ignoredDirGroups = new Map<string, string[]>();
	const directFiles: string[] = [];

	for (const filePath of paths) {
		const parts = filePath.split("/");
		let foundRoot: string | null = null;
		for (let i = 1; i < parts.length; i++) {
			const prefix = parts.slice(0, i).join("/");
			if (isIgnoredDir(prefix)) {
				foundRoot = prefix;
				break;
			}
		}
		if (foundRoot !== null) {
			if (!ignoredDirGroups.has(foundRoot)) ignoredDirGroups.set(foundRoot, []);
			ignoredDirGroups.get(foundRoot)!.push(filePath);
		} else {
			directFiles.push(filePath);
		}
	}

	const result: CandidateEntry[] = [];

	// Direct files first (individually gitignored, parent dir is not ignored)
	for (const filePath of directFiles.sort()) {
		result.push({ name: filePath, relativePath: filePath, type: "file" });
	}

	// Gitignored directories second, sorted alphabetically
	for (const [ignoredDir, filePaths] of [...ignoredDirGroups.entries()].sort()) {
		const childPaths = filePaths.map((p) => p.slice(ignoredDir.length + 1));
		const children = buildCandidateTree(childPaths);
		fixRelativePaths(children, ignoredDir);
		const dirName = ignoredDir.split("/").pop()!;
		result.push({
			name: dirName,
			relativePath: ignoredDir,
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
