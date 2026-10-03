import type { Dirent } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import simpleGit from "simple-git";

import { isExcludedBrowserEntry } from "../../shared/file-browser-policy";
import type { FileEntry, FileListingOptions, FlatEntry } from "../../shared/file-browser-types";
import { resolveWorkspaceFilePath } from "./file-path";

export type { FileEntry, FlatEntry } from "../../shared/file-browser-types";

export async function listDirectory(
	repoPath: string,
	dirPath = "",
	options: FileListingOptions = {}
): Promise<FileEntry[]> {
	const base = resolve(repoPath);
	const fullDir =
		options.mode === "browser"
			? await browserDirectory(base, dirPath)
			: dirPath
				? resolve(repoPath, dirPath)
				: base;

	// Prevent path traversal: resolved dir must be within repoPath
	if (options.mode !== "browser" && fullDir !== base && !fullDir.startsWith(`${base}/`)) {
		throw new Error(`Path traversal attempt: ${dirPath}`);
	}

	const ignoredPaths = await getIgnoredPaths(repoPath, options);

	const dirents = await readdir(fullDir, { withFileTypes: true });

	const entries: FileEntry[] = [];
	for (const dirent of dirents) {
		// Always skip .git
		if (dirent.name === ".git") continue;
		if (options.mode === "browser" && isExcludedBrowserEntry(dirent.name, dirent.isDirectory()))
			continue;

		const relativePath = dirPath ? `${dirPath}/${dirent.name}` : dirent.name;

		// Skip gitignored entries
		if (ignoredPaths.has(relativePath) || ignoredPaths.has(`${relativePath}/`)) continue;

		if (options.mode === "browser" && dirent.isSymbolicLink()) {
			entries.push({ name: dirent.name, path: relativePath, type: "symlink" });
		} else if (dirent.isDirectory()) {
			entries.push({
				name: dirent.name,
				path: relativePath,
				type: "directory",
			});
		} else if (dirent.isFile()) {
			try {
				const fileStat = await (options.mode === "browser" ? lstat : stat)(
					resolve(fullDir, dirent.name)
				);
				if (options.mode === "browser" && !fileStat.isFile()) continue;
				entries.push({
					name: dirent.name,
					path: relativePath,
					type: "file",
					size: fileStat.size,
				});
			} catch {
				if (options.mode === "browser") throw new Error("Unable to list workspace files");
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
		if ((a.type === "directory") !== (b.type === "directory"))
			return a.type === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return entries;
}

/**
 * Recursively list metadata. The default respects Git ignores; browser mode uses explicit exclusions.
 * Returns flat entries with their type so the client can build a tree that
 * includes empty directories (which `git ls-files` would miss).
 */
export async function listAllEntries(
	repoPath: string,
	options: FileListingOptions = {}
): Promise<FlatEntry[]> {
	const base = resolve(repoPath);
	const ignoredPaths = await getIgnoredPaths(repoPath, options);

	const results: FlatEntry[] = [];

	async function walk(dirRelative: string) {
		const fullDir = dirRelative ? resolve(base, dirRelative) : base;
		let dirents: Dirent[];
		try {
			dirents = await readdir(
				options.mode === "browser" ? await browserDirectory(base, dirRelative) : fullDir,
				{ withFileTypes: true }
			);
		} catch {
			if (options.mode === "browser") throw new Error("Unable to list workspace files");
			return;
		}

		for (const dirent of dirents) {
			if (dirent.name === ".git") continue;
			if (options.mode === "browser" && isExcludedBrowserEntry(dirent.name, dirent.isDirectory()))
				continue;

			const relativePath = dirRelative ? `${dirRelative}/${dirent.name}` : dirent.name;

			if (ignoredPaths.has(relativePath) || ignoredPaths.has(`${relativePath}/`)) continue;

			if (options.mode === "browser" && dirent.isSymbolicLink()) {
				results.push({ path: relativePath, type: "symlink" });
			} else if (dirent.isDirectory()) {
				results.push({ path: relativePath, type: "directory" });
				await walk(relativePath);
			} else if (dirent.isFile()) {
				results.push({ path: relativePath, type: "file" });
			}
		}
	}

	await walk("");
	results.sort((a, b) => a.path.localeCompare(b.path));
	return results;
}

async function getIgnoredPaths(
	repoPath: string,
	options: FileListingOptions
): Promise<Set<string>> {
	if (options.mode === "browser") return new Set();
	const git = simpleGit(repoPath);
	try {
		const status = await git.status(["--ignored"]);
		return new Set(status.ignored ?? []);
	} catch {
		return new Set();
	}
}

async function browserDirectory(base: string, path: string): Promise<string> {
	if (path.split("/").some((part) => isExcludedBrowserEntry(part, true))) {
		throw new Error("Directory is excluded from the Files browser");
	}
	return resolveWorkspaceFilePath(base, path, { allowRoot: true });
}
