import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
	BLOCKING_WORKTREE_CLEANUP_STATUSES,
	type WorktreeCleanupStatus,
	encodeWorktreePathIdentity,
} from "../../shared/worktree-cleanup";
import { getDb } from "../db";
import { type NewWorktreeCleanupJob, worktreeCleanupJobs } from "../db/schema";

export class WorktreeCleanupInProgressError extends Error {
	constructor(readonly worktreePath: string) {
		super(`A previous cleanup is still preparing this worktree path: ${worktreePath}`);
		this.name = "WorktreeCleanupInProgressError";
	}
}

export function normalizeWorktreePath(path: string): string {
	return resolve(path);
}

export function stagingPathForJob(originalPath: string, jobId: string): string {
	return join(dirname(normalizeWorktreePath(originalPath)), ".superiorswarm-cleanup", jobId);
}

export async function captureWorktreePathIdentity(path: string): Promise<string | null> {
	try {
		const stat = await lstat(path, { bigint: true });
		if (!stat.isDirectory()) throw new Error(`Cleanup target is not a directory: ${path}`);
		return encodeWorktreePathIdentity({
			device: stat.dev.toString(),
			inode: stat.ino.toString(),
			birthtimeNs: stat.birthtimeNs.toString(),
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export async function createCleanupJob(input: {
	repoPath: string;
	originalPath: string;
}): Promise<NewWorktreeCleanupJob> {
	const id = randomUUID();
	const now = new Date();
	const originalPath = normalizeWorktreePath(input.originalPath);
	return {
		id,
		repoPath: normalizeWorktreePath(input.repoPath),
		originalPath,
		originalPathIdentity: await captureWorktreePathIdentity(originalPath),
		stagingPath: stagingPathForJob(originalPath, id),
		status: "pending",
		phase: "preparing",
		attempts: 0,
		createdAt: now,
		updatedAt: now,
	};
}

export function getBlockingCleanupJob(originalPath: string) {
	return getDb()
		.select()
		.from(worktreeCleanupJobs)
		.where(
			and(
				eq(worktreeCleanupJobs.originalPath, normalizeWorktreePath(originalPath)),
				inArray(worktreeCleanupJobs.status, [...BLOCKING_WORKTREE_CLEANUP_STATUSES]),
				isNull(worktreeCleanupJobs.pathReusableAt)
			)
		)
		.get();
}

export function assertWorktreePathAvailable(originalPath: string): void {
	if (getBlockingCleanupJob(originalPath)) {
		throw new WorktreeCleanupInProgressError(normalizeWorktreePath(originalPath));
	}
}

export function activateCleanupJob(id: string): boolean {
	const now = new Date();
	const result = getDb()
		.update(worktreeCleanupJobs)
		.set({ status: "queued", updatedAt: now })
		.where(and(eq(worktreeCleanupJobs.id, id), eq(worktreeCleanupJobs.status, "pending")))
		.run();
	return result.changes === 1;
}

export function activatePendingCleanupJobs(): number {
	const result = getDb()
		.update(worktreeCleanupJobs)
		.set({ status: "queued", updatedAt: new Date() })
		.where(eq(worktreeCleanupJobs.status, "pending"))
		.run();
	return Number(result.changes);
}

export function listJobsNeedingCleanupQuiescence(): Array<{
	id: string;
	originalPath: string;
	stagingPath: string;
	status: WorktreeCleanupStatus;
}> {
	return getDb()
		.select({
			id: worktreeCleanupJobs.id,
			originalPath: worktreeCleanupJobs.originalPath,
			stagingPath: worktreeCleanupJobs.stagingPath,
			status: worktreeCleanupJobs.status,
		})
		.from(worktreeCleanupJobs)
		.where(
			and(
				inArray(worktreeCleanupJobs.status, [...BLOCKING_WORKTREE_CLEANUP_STATUSES]),
				isNull(worktreeCleanupJobs.pathReusableAt)
			)
		)
		.all();
}
