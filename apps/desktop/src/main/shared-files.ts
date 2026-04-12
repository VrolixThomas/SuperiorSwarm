import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertPathInsideRepo } from "./path-utils";

export interface SharedFileEntry {
	relativePath: string;
	type: "file" | "directory";
}

export interface SymlinkResult {
	relativePath: string;
	status: "created" | "source_missing" | "target_exists" | "error";
	error?: string;
}

export async function symlinkSharedFiles(
	repoPath: string,
	worktreePath: string,
	entries: SharedFileEntry[]
): Promise<SymlinkResult[]> {
	const results: SymlinkResult[] = [];

	for (const entry of entries) {
		try {
			assertPathInsideRepo(repoPath, entry.relativePath);
		} catch (err) {
			results.push({
				relativePath: entry.relativePath,
				status: "error",
				error: err instanceof Error ? err.message : String(err),
			});
			continue;
		}

		const source = join(repoPath, entry.relativePath);
		const target = join(worktreePath, entry.relativePath);

		if (!existsSync(source)) {
			results.push({ relativePath: entry.relativePath, status: "source_missing" });
			continue;
		}

		// Check if target already exists (file, symlink, or directory)
		try {
			lstatSync(target);
			results.push({ relativePath: entry.relativePath, status: "target_exists" });
			continue;
		} catch {
			// target does not exist — proceed
		}

		try {
			const targetDir = dirname(target);
			if (!existsSync(targetDir)) {
				mkdirSync(targetDir, { recursive: true });
			}
			symlinkSync(source, target);
			results.push({ relativePath: entry.relativePath, status: "created" });
		} catch (err) {
			results.push({
				relativePath: entry.relativePath,
				status: "error",
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return results;
}
