import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../logger";

interface CleanupDaemonClientOptions {
	/** Test-only process injection. */
	spawnProcess?: typeof spawn;
	/** Test-only retry scheduler injection. */
	scheduleRetry?: (callback: () => void, delayMs: number) => { unref(): void };
}

export class CleanupDaemonClient {
	private spawnScheduled = false;
	private activeChild: ChildProcess | null = null;
	private wakeRequestedWhileActive = false;
	private crashRetries = 0;
	private readonly spawnProcess: typeof spawn;
	private readonly scheduleRetry: (callback: () => void, delayMs: number) => { unref(): void };

	constructor(
		private readonly dbPath: string,
		private readonly scriptPath: string,
		private readonly logPath: string,
		options: CleanupDaemonClientOptions = {}
	) {
		this.spawnProcess = options.spawnProcess ?? spawn;
		this.scheduleRetry = options.scheduleRetry ?? setTimeout;
	}

	wake(): void {
		if (this.activeChild) {
			this.wakeRequestedWhileActive = true;
			return;
		}
		if (this.spawnScheduled) return;
		this.spawnScheduled = true;
		setImmediate(() => {
			this.spawnScheduled = false;
			try {
				this.spawnWorker();
			} catch (error) {
				log.error("[cleanup-daemon-client] failed to spawn worker", error);
				this.scheduleWorkerRetry();
			}
		});
	}

	private scheduleWorkerRetry(): void {
		if (this.crashRetries >= 5) {
			log.error("[cleanup-daemon-client] worker repeatedly crashed; recovery deferred");
			return;
		}
		// The job is durable, so bounded retries can recover transient process
		// creation failures without risking duplicate cleanup work.
		const delayMs = Math.min(1_000 * 2 ** this.crashRetries, 30_000);
		this.crashRetries += 1;
		const retry = this.scheduleRetry(() => this.wake(), delayMs);
		retry.unref();
	}

	private spawnWorker(): void {
		if (!existsSync(this.scriptPath)) {
			throw new Error(`Cleanup daemon script does not exist: ${this.scriptPath}`);
		}
		mkdirSync(dirname(this.logPath), { recursive: true });
		const logFd = openSync(this.logPath, "a");
		try {
			const child = this.spawnProcess(process.execPath, [this.scriptPath], {
				detached: true,
				stdio: ["ignore", logFd, logFd],
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					SUPERIORSWARM_DB_PATH: this.dbPath,
				},
			});
			this.activeChild = child;
			let outcomeHandled = false;
			const finish = (succeeded: boolean): void => {
				if (outcomeHandled) return;
				outcomeHandled = true;
				if (this.activeChild === child) this.activeChild = null;

				if (!succeeded) {
					this.wakeRequestedWhileActive = false;
					this.scheduleWorkerRetry();
					return;
				}

				this.crashRetries = 0;
				if (this.wakeRequestedWhileActive) {
					this.wakeRequestedWhileActive = false;
					this.wake();
				}
			};
			child.once("error", (error) => {
				if (outcomeHandled) return;
				log.error("[cleanup-daemon-client] worker process error", error);
				finish(false);
			});
			child.once("exit", (code, signal) => {
				if (outcomeHandled) return;
				// If the app is still alive, recover a crashed worker without waiting
				// for another user action. SQLite leases make duplicate workers safe.
				finish(code === 0 && signal === null);
			});
			child.unref();
		} finally {
			closeSync(logFd);
		}
	}
}
