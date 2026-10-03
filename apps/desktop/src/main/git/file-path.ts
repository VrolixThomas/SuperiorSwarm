import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

/** Registered root aliases are allowed; callers must opt in to returning a leaf symlink. */
export async function resolveWorkspaceFilePath(
	repoPath: string,
	filePath: string,
	{ allowRoot = false, allowMissing = false, allowLeafSymlink = false } = {}
): Promise<string> {
	if (isAbsolute(filePath) || filePath.split(/[\\/]/).includes("..")) {
		throw new Error("Invalid workspace-relative path");
	}
	const base = await realpath(repoPath);
	const full = resolve(base, filePath);
	if (full === base) {
		if (allowRoot) return base;
		throw new Error("A file or directory path is required");
	}
	if (!full.startsWith(`${base}${sep}`)) throw new Error("Invalid workspace-relative path");
	let current = base;
	for (const part of full.slice(base.length + 1).split(sep)) {
		current = resolve(current, part);
		try {
			const entry = await lstat(current);
			if (entry.isSymbolicLink()) {
				if (allowLeafSymlink && current === full) return full;
				throw new Error("Workspace symlink traversal is not supported");
			}
			if (!entry.isDirectory() && !entry.isFile())
				throw new Error("Unsupported workspace file type");
		} catch (error) {
			if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") break;
			throw error;
		}
	}
	return full;
}
