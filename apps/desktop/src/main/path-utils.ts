import { lstatSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Throws if `relativePath` resolves to a location outside `repoPath`.
 * Guards against `..` traversal and absolute paths in untrusted input.
 */
export function assertPathInsideRepo(repoPath: string, relativePath: string): void {
	const root = resolve(repoPath);
	const resolved = resolve(root, relativePath);
	if (!resolved.startsWith(`${root}/`) && resolved !== root) {
		throw new Error("Path must be inside the repository");
	}
}

/**
 * Returns "file" or "directory" for the given absolute path, or null if the path does not exist.
 * Uses lstatSync so symlinks are classified by their own type, not their target's.
 */
export function detectPathType(fullPath: string): "file" | "directory" | null {
	try {
		return lstatSync(fullPath).isDirectory() ? "directory" : "file";
	} catch {
		return null;
	}
}
