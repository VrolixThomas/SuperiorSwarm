import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";
import type { CleanupJobRow } from "./job-store";

export class PermanentCleanupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PermanentCleanupError";
	}
}

async function rejectSymlink(path: string): Promise<void> {
	try {
		if ((await lstat(path)).isSymbolicLink()) {
			throw new PermanentCleanupError(`Refusing to delete symlinked worktree path: ${path}`);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export async function assertSafeCleanupJob(
	job: CleanupJobRow,
	options: { stagingOnly?: boolean } = {}
): Promise<void> {
	const original = resolve(job.original_path);
	const repo = resolve(job.repo_path);
	const staging = resolve(job.staging_path);
	const expectedStaging = resolve(join(dirname(original), ".superiorswarm-cleanup", job.id));

	if (original === parse(original).root || original === resolve(homedir())) {
		throw new PermanentCleanupError(`Refusing unsafe cleanup target: ${original}`);
	}
	if (original === repo) {
		throw new PermanentCleanupError(`Refusing to delete the main repository checkout: ${original}`);
	}
	if (!options.stagingOnly) {
		let originalRealPath: string | null = null;
		try {
			originalRealPath = await realpath(original);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (originalRealPath !== null) {
			try {
				if (originalRealPath === (await realpath(repo))) {
					throw new PermanentCleanupError(
						`Refusing to delete a path resolving to the main repository checkout: ${original}`
					);
				}
			} catch (error) {
				if (error instanceof PermanentCleanupError) throw error;
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "EACCES" && code !== "EPERM") {
					throw error;
				}
			}
		}
	}
	if (staging !== expectedStaging) {
		throw new PermanentCleanupError(`Unexpected cleanup staging path: ${staging}`);
	}
	const cleanupRoot = resolve(dirname(original), ".superiorswarm-cleanup");
	if (!staging.startsWith(`${cleanupRoot}${sep}`)) {
		throw new PermanentCleanupError(`Staging path escapes cleanup root: ${staging}`);
	}

	if (!options.stagingOnly) await rejectSymlink(original);
	await rejectSymlink(staging);
}
