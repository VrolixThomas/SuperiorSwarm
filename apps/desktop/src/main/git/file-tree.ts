import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import simpleGit from "simple-git";

export interface FileEntry {
	name: string;
	path: string;
	type: "file" | "directory";
	size?: number;
}

export async function listDirectory(repoPath: string, dirPath = ""): Promise<FileEntry[]> {
	const fullDir = dirPath ? join(repoPath, dirPath) : repoPath;

	const git = simpleGit(repoPath);
	let ignoredPaths: Set<string>;
	try {
		const statusResult = await git.status();
		ignoredPaths = new Set(statusResult.ignored ?? []);
	} catch {
		ignoredPaths = new Set();
	}

	const dirents = await readdir(fullDir, { withFileTypes: true });

	const entries: FileEntry[] = [];
	for (const dirent of dirents) {
		// Always skip .git
		if (dirent.name === ".git") continue;

		const relativePath = dirPath ? `${dirPath}/${dirent.name}` : dirent.name;

		// Skip gitignored entries
		if (ignoredPaths.has(relativePath) || ignoredPaths.has(`${relativePath}/`)) continue;

		if (dirent.isDirectory()) {
			entries.push({
				name: dirent.name,
				path: relativePath,
				type: "directory",
			});
		} else if (dirent.isFile()) {
			try {
				const fileStat = await stat(join(fullDir, dirent.name));
				entries.push({
					name: dirent.name,
					path: relativePath,
					type: "file",
					size: fileStat.size,
				});
			} catch {
				entries.push({
					name: dirent.name,
					path: relativePath,
					type: "file",
				});
			}
		}
	}

	// Sort: directories first, then alphabetical
	entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return entries;
}
