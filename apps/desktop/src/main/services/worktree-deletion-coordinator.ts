import { isAbsolute, relative, resolve, sep } from "node:path";
import type { NewWorktreeCleanupJob } from "../db/schema";
import { resumeRepoWatching, suspendRepoWatching } from "../git/repo-watcher-instance";
import { log } from "../logger";
import { serverManager } from "../lsp/server-manager";
import { wakeCleanupDaemon } from "./cleanup-daemon-instance";
import { activateCleanupJob, createCleanupJob } from "./worktree-cleanup-job-store";

export interface RecoveredCleanupPath {
	originalPath: string;
	stagingPath: string;
}

interface CleanupTerminalClient {
	listSessionsStrict(): Promise<Array<{ id: string; cwd: string }>>;
	dispose(id: string): void;
}

function isWithinPath(path: string, root: string): boolean {
	const relativePath = relative(resolve(root), resolve(path));
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

/** Dispose detached PTYs that survived the DB-side half of a deletion. */
export async function disposeRecoveredCleanupTerminals(
	daemonClient: CleanupTerminalClient,
	jobs: readonly RecoveredCleanupPath[]
): Promise<string[]> {
	if (jobs.length === 0) return [];
	const cleanupRoots = jobs.flatMap((job) => [job.originalPath, job.stagingPath]);
	const isCleanupSession = (session: { cwd: string }) =>
		cleanupRoots.some((root) => isWithinPath(session.cwd, root));
	const sessions = (await daemonClient.listSessionsStrict()).filter(isCleanupSession);
	for (const session of sessions) daemonClient.dispose(session.id);

	if (sessions.length > 0) {
		// A list request is processed after the dispose frames on the same socket,
		// so this also acts as an acknowledgement before filesystem cleanup wakes.
		const remaining = (await daemonClient.listSessionsStrict()).filter(isCleanupSession);
		if (remaining.length > 0) {
			throw new Error(
				`Terminal daemon retained cleanup sessions: ${remaining.map((session) => session.id).join(", ")}`
			);
		}
	}
	return sessions.map((session) => session.id);
}

export function quiesceWorktreeServices(path: string, reason: string): void {
	void suspendRepoWatching(path, reason).catch((error) => {
		log.error("[worktree-deletion] watcher close failed", path, error);
	});
	void serverManager.shutdownRepo(path).catch((error) => {
		log.error("[worktree-deletion] LSP shutdown failed", path, error);
	});
}

/** Create a non-claimable job for insertion alongside the visible-row deletion. */
export async function prepareWorktreeDeletion(input: {
	repoPath: string;
	originalPath: string;
}): Promise<NewWorktreeCleanupJob> {
	return createCleanupJob(input);
}

/** Install runtime fences, activate the durable job, and wake the detached worker. */
export function startWorktreeDeletion(job: NewWorktreeCleanupJob): void {
	// Both managers install their tombstones synchronously. Keep the job
	// non-claimable until those fences exist, then let native teardown finish
	// in the background.
	quiesceWorktreeServices(job.originalPath, job.id);
	try {
		if (!activateCleanupJob(job.id)) {
			log.error("[worktree-deletion] pending cleanup job could not be activated", job.id);
			return;
		}
	} catch (error) {
		// The pending row is durable and startup recovery will activate it.
		log.error("[worktree-deletion] cleanup activation failed", job.id, error);
		return;
	}
	wakeCleanupDaemon();
}

export function resumeWorktreeServices(path: string): void {
	void resumeRepoWatching(path).catch((error) => {
		log.error("[worktree-deletion] watcher resume failed", path, error);
	});
	serverManager.resumeRepo(path);
}
