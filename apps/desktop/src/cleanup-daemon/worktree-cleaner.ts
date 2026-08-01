import type { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, rename } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { BoundedProcessError, runBoundedProcess } from "../node/bounded-process";
import {
	CLEANUP_DELETE_TERMINATE_GRACE_MS,
	CLEANUP_DELETE_TIMEOUT_MS,
	CLEANUP_GIT_TERMINATE_GRACE_MS,
	CLEANUP_GIT_TIMEOUT_MS,
	type WorktreePathIdentity,
	decodeWorktreePathIdentity,
	encodeWorktreePathIdentity,
} from "../shared/worktree-cleanup";
import type { CleanupJobRow, CleanupJobStore } from "./job-store";
import { PermanentCleanupError, assertSafeCleanupJob } from "./path-safety";

type GitFailureKind = "spawn" | "exit" | "timeout";

export class CleanupGitError extends Error {
	constructor(
		message: string,
		readonly kind: GitFailureKind,
		readonly stderr = ""
	) {
		super(message);
		this.name = "CleanupGitError";
	}
}

export interface RunGitOptions {
	allowFailure?: boolean;
	timeoutMs?: number;
	terminateGraceMs?: number;
	/** Test-only process injection. */
	spawnProcess?: typeof spawn;
}

type DeleteFailureKind = "spawn" | "exit" | "timeout";

export class CleanupFilesystemError extends Error {
	constructor(
		message: string,
		readonly kind: DeleteFailureKind,
		readonly stderr = ""
	) {
		super(message);
		this.name = "CleanupFilesystemError";
	}
}

export interface RemoveTreeOptions {
	timeoutMs?: number;
	terminateGraceMs?: number;
	/** Test-only process injection. */
	spawnProcess?: typeof spawn;
}

const DELETE_IDENTITY_MISMATCH_EXIT_CODE = 42;
const ISOLATED_REMOVE_SCRIPT = String.raw`
const { lstat, rm } = require("node:fs/promises");

async function main() {
  const target = process.env.SUPERIORSWARM_DELETE_PATH;
  const encodedIdentity = process.env.SUPERIORSWARM_DELETE_IDENTITY;
  if (!target || !encodedIdentity) throw new Error("Missing isolated cleanup input");
  const expected = JSON.parse(encodedIdentity);
  let stat;
  try {
    stat = await lstat(target, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  const actual = {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
  if (
    !stat.isDirectory() ||
    actual.device !== expected.device ||
    actual.inode !== expected.inode ||
    actual.birthtimeNs !== expected.birthtimeNs
  ) {
    console.error("Cleanup path identity changed before isolated removal");
    process.exitCode = ${DELETE_IDENTITY_MISMATCH_EXIT_CODE};
    return;
  }
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
`.trim();

export function removeTreeIsolated(
	path: string,
	expectedIdentity: WorktreePathIdentity,
	options: RemoveTreeOptions = {}
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? CLEANUP_DELETE_TIMEOUT_MS;
	const terminateGraceMs = options.terminateGraceMs ?? CLEANUP_DELETE_TERMINATE_GRACE_MS;
	return runBoundedProcess(process.execPath, ["-e", ISOLATED_REMOVE_SCRIPT], {
		timeoutMs,
		terminateGraceMs,
		description: `Isolated cleanup for ${path}`,
		captureStdout: false,
		spawnProcess: options.spawnProcess,
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			SUPERIORSWARM_DELETE_PATH: path,
			SUPERIORSWARM_DELETE_IDENTITY: encodeWorktreePathIdentity(expectedIdentity),
		},
	}).then(
		() => undefined,
		(error: unknown) => {
			if (error instanceof BoundedProcessError) {
				if (error.kind === "exit" && error.exitCode === DELETE_IDENTITY_MISMATCH_EXIT_CODE) {
					throw new PermanentCleanupError(
						`Refusing isolated removal because the cleanup path identity changed: ${path}`
					);
				}
				throw new CleanupFilesystemError(error.message, error.kind, error.stderr);
			}
			throw error;
		}
	);
}

export function runGit(
	repoPath: string,
	args: string[],
	options: RunGitOptions = {}
): Promise<string> {
	const timeoutMs = options.timeoutMs ?? CLEANUP_GIT_TIMEOUT_MS;
	const terminateGraceMs = options.terminateGraceMs ?? CLEANUP_GIT_TERMINATE_GRACE_MS;
	return runBoundedProcess("git", ["-C", repoPath, ...args], {
		timeoutMs,
		terminateGraceMs,
		description: `git ${args.join(" ")}`,
		allowNonZeroExit: options.allowFailure,
		spawnProcess: options.spawnProcess,
	}).then(
		(result) => result.stdout,
		(error: unknown) => {
			if (error instanceof BoundedProcessError) {
				throw new CleanupGitError(error.message, error.kind, error.stderr);
			}
			throw error;
		}
	);
}

function listedWorktreePaths(output: string): string[] {
	return output
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => resolve(line.slice("worktree ".length)));
}

async function canonicalWorktreePath(path: string): Promise<string> {
	const absolute = resolve(path);
	let existingAncestor = absolute;
	const missingSegments: string[] = [];

	while (true) {
		try {
			return resolve(await realpath(existingAncestor), ...missingSegments);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(existingAncestor);
			if (parent === existingAncestor) return absolute;
			missingSegments.unshift(basename(existingAncestor));
			existingAncestor = parent;
		}
	}
}

async function readPathIdentity(path: string): Promise<WorktreePathIdentity | null> {
	try {
		const stat = await lstat(path, { bigint: true });
		if (!stat.isDirectory()) {
			throw new PermanentCleanupError(`Cleanup target is not a directory: ${path}`);
		}
		return {
			device: stat.dev.toString(),
			inode: stat.ino.toString(),
			birthtimeNs: stat.birthtimeNs.toString(),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function identitiesMatch(left: WorktreePathIdentity, right: WorktreePathIdentity): boolean {
	return (
		left.device === right.device &&
		left.inode === right.inode &&
		left.birthtimeNs === right.birthtimeNs
	);
}

function expectedIdentity(job: CleanupJobRow): WorktreePathIdentity | null {
	if (job.original_path_identity === null) return null;
	try {
		return decodeWorktreePathIdentity(job.original_path_identity);
	} catch (error) {
		throw new PermanentCleanupError(
			`Invalid cleanup identity for ${job.id}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function requiredExpectedIdentity(job: CleanupJobRow): WorktreePathIdentity {
	const identity = expectedIdentity(job);
	if (!identity) {
		throw new PermanentCleanupError(`Cleanup job ${job.id} has no persisted path identity`);
	}
	return identity;
}

async function assertQueuedPathIdentity(job: CleanupJobRow, path: string): Promise<void> {
	const expected = expectedIdentity(job);
	const actual = await readPathIdentity(path);
	if (!actual) throw new Error(`Cleanup target disappeared before it could be fenced: ${path}`);
	if (!expected || !identitiesMatch(expected, actual)) {
		throw new PermanentCleanupError(
			`Refusing to touch a replacement path whose identity differs from cleanup job ${job.id}: ${path}`
		);
	}
}

function gitMetadataUnavailable(error: unknown): boolean {
	if (!(error instanceof CleanupGitError) || error.kind !== "exit") return false;
	return /not a git repository|cannot change to|no such file or directory|permission denied/i.test(
		error.stderr
	);
}

function gitWorktreeAlreadyLocked(error: unknown): boolean {
	return (
		error instanceof CleanupGitError &&
		error.kind === "exit" &&
		/already locked/i.test(error.stderr)
	);
}

async function readTextFileIfPresent(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EISDIR") return null;
		throw error;
	}
}

async function gitCommonDirectory(repo: string): Promise<string> {
	const output = await runGit(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	return canonicalWorktreePath(resolve(repo, output.trim()));
}

async function findWorktreeAdminPath(
	repo: string,
	worktreePaths: readonly string[]
): Promise<string | null> {
	const commonDirectory = await gitCommonDirectory(repo);
	const worktreesDirectory = await canonicalWorktreePath(join(commonDirectory, "worktrees"));
	const expectedGitDirs = new Set<string>();
	for (const worktreePath of worktreePaths) {
		expectedGitDirs.add(await canonicalWorktreePath(join(worktreePath, ".git")));
	}

	const candidates = new Set<string>();
	for (const worktreePath of worktreePaths) {
		const dotGitPath = join(worktreePath, ".git");
		const pointer = await readTextFileIfPresent(dotGitPath);
		const match = pointer?.match(/^gitdir:\s*(.+?)\s*$/m);
		if (match?.[1])
			candidates.add(await canonicalWorktreePath(resolve(dirname(dotGitPath), match[1])));
	}

	try {
		for (const entry of await readdir(worktreesDirectory, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const adminPath = await canonicalWorktreePath(join(worktreesDirectory, entry.name));
			const gitDir = await readTextFileIfPresent(join(adminPath, "gitdir"));
			if (!gitDir) continue;
			const registeredGitDir = await canonicalWorktreePath(resolve(adminPath, gitDir.trim()));
			if (expectedGitDirs.has(registeredGitDir)) candidates.add(adminPath);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	const safeCandidates = [...candidates].filter(
		(candidate) => dirname(candidate) === worktreesDirectory
	);
	if (safeCandidates.length > 1) {
		throw new PermanentCleanupError(
			`Multiple Git administrative entries match cleanup paths: ${safeCandidates.join(", ")}`
		);
	}
	if (safeCandidates.length === 0) return null;
	return safeCandidates[0] ?? null;
}

interface LockedWorktreeAdmin {
	path: string;
	identity: WorktreePathIdentity;
	reason: string;
}

async function lockWorktreeAdmin(
	repo: string,
	registrationPath: string,
	worktreePaths: readonly string[],
	jobId: string
): Promise<LockedWorktreeAdmin> {
	const reason = `SuperiorSwarm cleanup ${jobId}`;
	try {
		await runGit(repo, ["worktree", "lock", "--reason", reason, registrationPath]);
	} catch (error) {
		if (!gitWorktreeAlreadyLocked(error)) throw error;
		const existingAdminPath = await findWorktreeAdminPath(repo, worktreePaths);
		const existingReason = existingAdminPath
			? (await readTextFileIfPresent(join(existingAdminPath, "locked")))?.trim()
			: null;
		if (existingReason !== reason) {
			await runGit(repo, ["worktree", "unlock", registrationPath]);
			await runGit(repo, ["worktree", "lock", "--reason", reason, registrationPath]);
		}
	}

	const adminPath = await findWorktreeAdminPath(repo, worktreePaths);
	if (!adminPath) {
		throw new Error(`Could not identify Git metadata for worktree ${registrationPath}`);
	}
	const actualReason = (await readTextFileIfPresent(join(adminPath, "locked")))?.trim();
	if (actualReason !== reason) {
		throw new PermanentCleanupError(
			`Refusing to remove Git metadata without cleanup lock ownership: ${adminPath}`
		);
	}
	const identity = await readPathIdentity(adminPath);
	if (!identity) throw new Error(`Locked Git metadata disappeared: ${adminPath}`);
	return { path: adminPath, identity, reason };
}

async function removeLockedWorktreeAdmin(admin: LockedWorktreeAdmin): Promise<void> {
	const actualReason = (await readTextFileIfPresent(join(admin.path, "locked")))?.trim();
	if (actualReason !== admin.reason) {
		throw new PermanentCleanupError(
			`Cleanup lost its Git metadata lock before removal: ${admin.path}`
		);
	}
	await removeTreeIsolated(admin.path, admin.identity, {
		timeoutMs: CLEANUP_GIT_TIMEOUT_MS,
		terminateGraceMs: CLEANUP_GIT_TERMINATE_GRACE_MS,
	});
	if ((await readPathIdentity(admin.path)) !== null) {
		throw new Error(`Git metadata cleanup verification failed: ${admin.path}`);
	}
}

export async function cleanWorktree(
	job: CleanupJobRow,
	store: CleanupJobStore,
	workerId: string
): Promise<void> {
	const stagingOnly = job.path_reusable_at !== null;
	await assertSafeCleanupJob(job, { stagingOnly });
	const fence = () => store.heartbeat(job.id, workerId);

	const original = resolve(job.original_path);
	const staging = resolve(job.staging_path);
	const repo = resolve(job.repo_path);
	fence();

	// A durable reusable flag transfers ownership of the original path to future
	// work. The old job may only verify and remove its UUID-scoped staging path.
	if (stagingOnly) {
		if ((await readPathIdentity(staging)) !== null) {
			await assertQueuedPathIdentity(job, staging);
			fence();
			store.setPhase(job.id, workerId, "deleting_files");
			fence();
			await removeTreeIsolated(staging, requiredExpectedIdentity(job));
		}
		store.setPhase(job.id, workerId, "verifying");
		if ((await readPathIdentity(staging)) !== null) {
			throw new Error(`Cleanup verification failed for ${staging}`);
		}
		store.complete(job.id, workerId);
		return;
	}
	const gitOriginal = await canonicalWorktreePath(original);
	const gitStaging = await canonicalWorktreePath(staging);

	const originalIdentity = await readPathIdentity(original);
	const stagingIdentity = await readPathIdentity(staging);
	const queuedIdentity = expectedIdentity(job);
	const originalIsQueuedPath =
		originalIdentity !== null &&
		queuedIdentity !== null &&
		identitiesMatch(queuedIdentity, originalIdentity);
	const stagingIsQueuedPath =
		stagingIdentity !== null &&
		queuedIdentity !== null &&
		identitiesMatch(queuedIdentity, stagingIdentity);

	if (originalIsQueuedPath && stagingIsQueuedPath) {
		throw new PermanentCleanupError(
			`The queued worktree exists at both original and staging paths; manual inspection required for ${job.id}`
		);
	}
	if (stagingIdentity && !stagingIsQueuedPath) {
		throw new PermanentCleanupError(
			`Refusing to touch a replacement staging path for cleanup job ${job.id}: ${staging}`
		);
	}
	if (originalIdentity && !originalIsQueuedPath && !stagingIsQueuedPath) {
		throw new PermanentCleanupError(
			`Refusing to touch a replacement path for cleanup job ${job.id}: ${original}`
		);
	}

	let gitAvailable = true;
	let before: string[] = [];
	try {
		before = listedWorktreePaths(await runGit(repo, ["worktree", "list", "--porcelain"]));
	} catch (error) {
		if (!gitMetadataUnavailable(error)) throw error;
		gitAvailable = false;
	}
	if (gitAvailable && before[0] === gitOriginal) {
		throw new PermanentCleanupError(`Refusing to remove the main worktree: ${original}`);
	}

	let lockedAdmin: LockedWorktreeAdmin | null = null;
	if (gitAvailable) {
		const noQueuedDirectory = originalIdentity === null && stagingIdentity === null;
		let registrationToLock: string | null = null;
		if (before.includes(gitStaging) && (stagingIsQueuedPath || noQueuedDirectory)) {
			registrationToLock = gitStaging;
		} else if (
			before.includes(gitOriginal) &&
			(originalIsQueuedPath ||
				(originalIdentity === null && (stagingIsQueuedPath || noQueuedDirectory)))
		) {
			registrationToLock = gitOriginal;
		}

		if (registrationToLock) {
			fence();
			try {
				lockedAdmin = await lockWorktreeAdmin(
					repo,
					registrationToLock,
					[registrationToLock],
					job.id
				);
			} catch (error) {
				if (!gitMetadataUnavailable(error)) throw error;
				gitAvailable = false;
			}
		}
	}

	if (originalIsQueuedPath) {
		await mkdir(dirname(staging), { recursive: true });
		fence();
		if ((await readPathIdentity(staging)) !== null) {
			throw new PermanentCleanupError(
				`Cleanup staging path appeared before rename; manual inspection required for ${job.id}`
			);
		}
		await assertQueuedPathIdentity(job, original);
		await rename(original, staging);
		await assertQueuedPathIdentity(job, staging);
	}
	store.setPhase(job.id, workerId, "renamed");

	if (lockedAdmin) {
		fence();
		await removeLockedWorktreeAdmin(lockedAdmin);
	}
	if (gitAvailable) {
		store.setPhase(job.id, workerId, "git_pruned");
	}
	store.markPathReusable(job.id, workerId);

	if ((await readPathIdentity(staging)) !== null) {
		await assertQueuedPathIdentity(job, staging);
		fence();
		store.setPhase(job.id, workerId, "deleting_files");
		fence();
		await removeTreeIsolated(staging, requiredExpectedIdentity(job));
	}

	store.setPhase(job.id, workerId, "verifying");
	if ((await readPathIdentity(staging)) !== null) {
		throw new Error(`Cleanup verification failed for ${staging}`);
	}
	store.complete(job.id, workerId);
}
