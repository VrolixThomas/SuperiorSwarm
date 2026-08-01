import { randomUUID } from "node:crypto";
import { setPriority } from "node:os";
import { CLEANUP_HEARTBEAT_MS } from "../shared/worktree-cleanup";
import { CleanupJobStore, CleanupLeaseLostError } from "./job-store";
import { PermanentCleanupError } from "./path-safety";
import { cleanWorktree } from "./worktree-cleaner";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCleanupWorker(dbPath: string): Promise<void> {
	try {
		setPriority(0, 10);
	} catch {
		// Background priority is best-effort and is not supported equally on every OS.
	}

	const workerId = `${process.pid}-${randomUUID()}`;
	const store = new CleanupJobStore(dbPath);
	try {
		store.pruneCompletedHistory(Date.now() - 30 * 24 * 60 * 60 * 1_000);
		for (;;) {
			const job = store.claimNext(workerId);
			if (!job) {
				const wakeDelay = store.nextWakeDelay();
				if (wakeDelay === null) return;
				await delay(Math.min(Math.max(wakeDelay, 100), 60_000));
				continue;
			}

			const heartbeat = setInterval(() => {
				try {
					store.heartbeat(job.id, workerId);
				} catch (error) {
					clearInterval(heartbeat);
					if (!(error instanceof CleanupLeaseLostError)) {
						console.error(`[cleanup-daemon] job=${job.id} heartbeat failed:`, error);
					}
				}
			}, CLEANUP_HEARTBEAT_MS);
			try {
				console.log(`[cleanup-daemon] job=${job.id} path=${job.original_path} started`);
				await cleanWorktree(job, store, workerId);
				console.log(`[cleanup-daemon] job=${job.id} completed`);
			} catch (error) {
				if (error instanceof CleanupLeaseLostError) {
					console.warn(`[cleanup-daemon] job=${job.id} ownership transferred`);
					continue;
				}
				const permanent = error instanceof PermanentCleanupError;
				console.error(`[cleanup-daemon] job=${job.id} failed:`, error);
				try {
					store.fail(job.id, workerId, error, permanent);
				} catch (failError) {
					if (!(failError instanceof CleanupLeaseLostError)) throw failError;
					console.warn(
						`[cleanup-daemon] job=${job.id} ownership transferred before failure update`
					);
				}
			} finally {
				clearInterval(heartbeat);
			}
		}
	} finally {
		store.close();
	}
}
