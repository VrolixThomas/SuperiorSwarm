import Database from "better-sqlite3";
import {
	CLEANUP_LEASE_MS,
	CLEANUP_MAX_ATTEMPTS,
	type WorktreeCleanupPhase,
} from "../shared/worktree-cleanup";

export interface CleanupJobRow {
	id: string;
	repo_path: string;
	original_path: string;
	original_path_identity: string | null;
	staging_path: string;
	status: "pending" | "queued" | "running" | "retry_wait" | "completed" | "failed";
	phase: WorktreeCleanupPhase;
	attempts: number;
	worker_id: string | null;
	lease_expires_at: number | null;
	next_attempt_at: number | null;
	last_error: string | null;
	path_reusable_at: number | null;
	created_at: number;
	updated_at: number;
	completed_at: number | null;
}

export class CleanupLeaseLostError extends Error {
	constructor(
		readonly jobId: string,
		readonly workerId: string
	) {
		super(`Cleanup lease lost for job ${jobId}`);
		this.name = "CleanupLeaseLostError";
	}
}

export class CleanupJobStore {
	readonly db: Database.Database;

	constructor(dbPath: string | Database.Database) {
		this.db = typeof dbPath === "string" ? new Database(dbPath) : dbPath;
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("busy_timeout = 5000");
	}

	claimNext(workerId: string, now = Date.now()): CleanupJobRow | null {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db
				.prepare(
					`UPDATE worktree_cleanup_jobs
						 SET status = 'failed', worker_id = NULL,
					     lease_expires_at = NULL, next_attempt_at = NULL, updated_at = ?,
					     last_error = 'Cleanup worker lease expired after reaching the retry limit'
					 WHERE status = 'running' AND lease_expires_at IS NOT NULL
					   AND lease_expires_at <= ? AND attempts >= ?`
				)
				.run(now, now, CLEANUP_MAX_ATTEMPTS);
			this.db
				.prepare(
					`UPDATE worktree_cleanup_jobs
						 SET status = 'retry_wait', worker_id = NULL,
					     lease_expires_at = NULL, next_attempt_at = ?, updated_at = ?,
					     last_error = COALESCE(last_error, 'Cleanup worker lease expired')
					 WHERE status = 'running' AND lease_expires_at IS NOT NULL
					   AND lease_expires_at <= ? AND attempts < ?`
				)
				.run(now, now, now, CLEANUP_MAX_ATTEMPTS);

			const active = this.db
				.prepare(
					`SELECT id FROM worktree_cleanup_jobs
					 WHERE status = 'running' AND lease_expires_at > ? LIMIT 1`
				)
				.get(now);
			if (active) {
				this.db.exec("COMMIT");
				return null;
			}

			const candidate = this.db
				.prepare(
					`SELECT id FROM worktree_cleanup_jobs
					 WHERE status IN ('queued', 'retry_wait')
					   AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
					 ORDER BY created_at ASC LIMIT 1`
				)
				.get(now) as { id: string } | undefined;
			if (!candidate) {
				this.db.exec("COMMIT");
				return null;
			}

			this.db
				.prepare(
					`UPDATE worktree_cleanup_jobs
						 SET status = 'running', worker_id = ?, attempts = attempts + 1,
						     lease_expires_at = ?, next_attempt_at = NULL, updated_at = ?
						 WHERE id = ?`
				)
				.run(workerId, now + CLEANUP_LEASE_MS, now, candidate.id);
			const job = this.get(candidate.id);
			this.db.exec("COMMIT");
			return job;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	get(id: string): CleanupJobRow {
		const job = this.db.prepare("SELECT * FROM worktree_cleanup_jobs WHERE id = ?").get(id) as
			| CleanupJobRow
			| undefined;
		if (!job) throw new Error(`Cleanup job disappeared: ${id}`);
		return job;
	}

	heartbeat(id: string, workerId: string, now = Date.now()): void {
		const result = this.db
			.prepare(
				`UPDATE worktree_cleanup_jobs
					 SET lease_expires_at = ?, updated_at = ?
				 WHERE id = ? AND worker_id = ? AND status = 'running'
				   AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
			)
			.run(now + CLEANUP_LEASE_MS, now, id, workerId, now);
		this.requireOwnedUpdate(result.changes, id, workerId);
	}

	setPhase(id: string, workerId: string, phase: WorktreeCleanupPhase): void {
		const now = Date.now();
		const result = this.db
			.prepare(
				`UPDATE worktree_cleanup_jobs SET phase = ?, updated_at = ?
				 WHERE id = ? AND worker_id = ? AND status = 'running'
				   AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
			)
			.run(phase, now, id, workerId, now);
		this.requireOwnedUpdate(result.changes, id, workerId);
	}

	markPathReusable(id: string, workerId: string): void {
		const now = Date.now();
		const result = this.db
			.prepare(
				`UPDATE worktree_cleanup_jobs
				 SET path_reusable_at = COALESCE(path_reusable_at, ?), updated_at = ?
				 WHERE id = ? AND worker_id = ? AND status = 'running'
				   AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
			)
			.run(now, now, id, workerId, now);
		this.requireOwnedUpdate(result.changes, id, workerId);
	}

	complete(id: string, workerId: string): void {
		const now = Date.now();
		const result = this.db
			.prepare(
				`UPDATE worktree_cleanup_jobs
					 SET status = 'completed', phase = 'verifying', path_reusable_at = COALESCE(path_reusable_at, ?),
					     completed_at = ?, updated_at = ?, worker_id = NULL,
					     lease_expires_at = NULL, last_error = NULL
				 WHERE id = ? AND worker_id = ? AND status = 'running'
				   AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
			)
			.run(now, now, now, id, workerId, now);
		this.requireOwnedUpdate(result.changes, id, workerId);
	}

	fail(id: string, workerId: string, error: unknown, permanent = false): void {
		const now = Date.now();
		const job = this.db
			.prepare(
				`SELECT attempts FROM worktree_cleanup_jobs
				 WHERE id = ? AND worker_id = ? AND status = 'running'
				   AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
			)
			.get(id, workerId, now) as { attempts: number } | undefined;
		if (!job) throw new CleanupLeaseLostError(id, workerId);
		const message = error instanceof Error ? error.message : String(error);
		const exhausted = job.attempts >= CLEANUP_MAX_ATTEMPTS;
		if (permanent || exhausted) {
			const result = this.db
				.prepare(
					`UPDATE worktree_cleanup_jobs
						 SET status = 'failed', last_error = ?, updated_at = ?, worker_id = NULL,
						     lease_expires_at = NULL, next_attempt_at = NULL
					 WHERE id = ? AND worker_id = ? AND status = 'running'
					   AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
				)
				.run(message, now, id, workerId, now);
			this.requireOwnedUpdate(result.changes, id, workerId);
			return;
		}

		const delayMs = Math.min(2 ** Math.max(0, job.attempts - 1) * 1_000, 60_000);
		const result = this.db
			.prepare(
				`UPDATE worktree_cleanup_jobs
					 SET status = 'retry_wait', last_error = ?, updated_at = ?, worker_id = NULL,
					     lease_expires_at = NULL, next_attempt_at = ?
				 WHERE id = ? AND worker_id = ? AND status = 'running'
				   AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
			)
			.run(message, now, now + delayMs, id, workerId, now);
		this.requireOwnedUpdate(result.changes, id, workerId);
	}

	nextWakeDelay(now = Date.now()): number | null {
		const row = this.db
			.prepare(
				`SELECT MIN(next_at) AS next_at
				 FROM (
				   SELECT next_attempt_at AS next_at FROM worktree_cleanup_jobs
				    WHERE status = 'retry_wait' AND next_attempt_at IS NOT NULL
				   UNION ALL
				   SELECT lease_expires_at AS next_at FROM worktree_cleanup_jobs
				    WHERE status = 'running' AND lease_expires_at IS NOT NULL
				 )`
			)
			.get() as { next_at: number | null };
		return row.next_at === null ? null : Math.max(0, row.next_at - now);
	}

	private requireOwnedUpdate(changes: number | bigint, id: string, workerId: string): void {
		if (changes !== 1 && changes !== 1n) throw new CleanupLeaseLostError(id, workerId);
	}

	pruneCompletedHistory(cutoffMs: number): void {
		this.db
			.prepare(
				`DELETE FROM worktree_cleanup_jobs
				 WHERE status = 'completed' AND completed_at IS NOT NULL AND completed_at < ?`
			)
			.run(cutoffMs);
	}

	close(): void {
		this.db.close();
	}
}
