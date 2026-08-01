import { getRepoWatcherManager } from "../git/repo-watcher-instance";
import { log } from "../logger";
import { serverManager } from "../lsp/server-manager";
import type { DaemonClient } from "../terminal/daemon-client";
import { CleanupDaemonClient } from "./cleanup-daemon-client";
import { setCleanupDaemonClient } from "./cleanup-daemon-instance";
import {
	activatePendingCleanupJobs,
	listJobsNeedingCleanupQuiescence,
} from "./worktree-cleanup-job-store";
import { disposeRecoveredCleanupTerminals } from "./worktree-deletion-coordinator";

export interface WorktreeCleanupControllerOptions {
	dbPath: string;
	workerScriptPath: string;
	logPath: string;
	terminalDaemon: DaemonClient;
}

export class WorktreeCleanupController {
	private enabled = false;
	private enablePromise: Promise<void> | null = null;

	constructor(
		private readonly daemon: CleanupDaemonClient,
		private readonly terminalDaemon: DaemonClient,
		private readonly recoveredJobs: ReturnType<typeof listJobsNeedingCleanupQuiescence>
	) {}

	get isEnabled(): boolean {
		return this.enabled;
	}

	get requiresTerminalRecovery(): boolean {
		return this.recoveredJobs.length > 0;
	}

	async enable(): Promise<void> {
		if (this.enabled) return;
		if (this.enablePromise) return this.enablePromise;

		const attempt = (async () => {
			const disposedIds = await disposeRecoveredCleanupTerminals(
				this.terminalDaemon,
				this.recoveredJobs
			);
			if (disposedIds.length > 0) {
				log.info("[cleanup-recovery] disposed detached terminal sessions", disposedIds);
			}
			activatePendingCleanupJobs();
			setCleanupDaemonClient(this.daemon);
			this.enabled = true;
			this.daemon.wake();
		})();
		this.enablePromise = attempt;
		try {
			await attempt;
		} finally {
			if (this.enablePromise === attempt) this.enablePromise = null;
		}
	}
}

export async function initializeWorktreeCleanup(
	options: WorktreeCleanupControllerOptions
): Promise<WorktreeCleanupController> {
	const recoveredJobs = listJobsNeedingCleanupQuiescence();
	for (const job of recoveredJobs) {
		// Reconstruct deletion tombstones before any renderer can subscribe.
		await Promise.all([
			getRepoWatcherManager()
				.suspend(job.originalPath, `startup-recovery:${job.id}`)
				.catch((error) => log.error("[cleanup-recovery] watcher close failed", job.id, error)),
			serverManager
				.shutdownRepo(job.originalPath)
				.catch((error) => log.error("[cleanup-recovery] LSP shutdown failed", job.id, error)),
		]);
	}

	return new WorktreeCleanupController(
		new CleanupDaemonClient(options.dbPath, options.workerScriptPath, options.logPath),
		options.terminalDaemon,
		recoveredJobs
	);
}
