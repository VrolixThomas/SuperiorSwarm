import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { KeepAwakeState } from "../../shared/keep-awake";
import {
	KEEP_AWAKE_LOCK,
	buildKeepAwakeAppleScript,
	buildKeepAwakeCommand,
	isSleepDisabled,
} from "./keep-awake-guard";

const execFileAsync = promisify(execFile);

interface KeepAwakeDependencies {
	platform: string;
	createLease: () => string;
	removeLease: (path: string) => void;
	authorize: (lease: string) => Promise<void>;
	readSleepDisabled: () => Promise<boolean>;
	guardExists: () => boolean;
	wait: () => Promise<void>;
}

const dependencies: KeepAwakeDependencies = {
	platform: process.platform,
	createLease: () => mkdtempSync(join(tmpdir(), "superiorswarm-keep-awake-")),
	removeLease: (path) => {
		if (existsSync(path)) rmdirSync(path);
	},
	authorize: async (lease) => {
		const script = buildKeepAwakeAppleScript(buildKeepAwakeCommand(process.pid, lease));
		let output: string;
		try {
			const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
				timeout: 120_000,
				maxBuffer: 16 * 1024,
			});
			output = stdout.trim();
		} catch (error) {
			if (error instanceof Error && /-128|User canceled/i.test(error.message)) {
				throw new Error("Administrator approval was canceled. Keep awake is still off.");
			}
			throw new Error(
				"macOS could not authorize keep awake. Try again and approve the administrator prompt."
			);
		}
		if (output !== "SUPERIORSWARM_KEEP_AWAKE_READY") {
			throw new Error(output || "macOS could not enable closed-lid operation.");
		}
	},
	readSleepDisabled: async () => {
		const { stdout } = await execFileAsync("/usr/bin/pmset", ["-g"], { timeout: 5_000 });
		return isSleepDisabled(stdout);
	},
	guardExists: () => existsSync(KEEP_AWAKE_LOCK),
	wait: () => delay(250),
};

/** Session-scoped by design: launching the app never prompts for admin access. */
export class KeepAwakeService {
	private lease: string | null = null;
	private enabled = false;
	private busy = false;
	private disposed = false;
	private error: string | null = null;

	constructor(private readonly deps: KeepAwakeDependencies = dependencies) {}

	getState(): KeepAwakeState {
		return {
			supported: this.deps.platform === "darwin",
			enabled: this.enabled,
			busy: this.busy,
			error: this.error,
		};
	}

	async getCurrentState(): Promise<KeepAwakeState> {
		const lease = this.lease;
		if (this.enabled && lease && !this.busy && !this.disposed) {
			const disabled = await this.deps.readSleepDisabled();
			// A setting change may have started while the power query was running.
			if (this.lease === lease && !this.busy && !this.disposed) {
				if (!disabled) {
					this.releaseLease();
					this.enabled = false;
					this.error = "The macOS sleep override was removed. Enable keep awake again if needed.";
				} else if (!this.deps.guardExists()) {
					this.error =
						"The keep-awake helper stopped unexpectedly. Turn this off to restore sleep.";
				}
			}
		}
		return this.getState();
	}

	async setEnabled(enabled: boolean): Promise<KeepAwakeState> {
		if (this.deps.platform !== "darwin") throw new Error("Closed-lid keep awake requires macOS.");
		if (this.disposed) throw new Error("SuperiorSwarm is quitting.");
		if (this.busy) throw new Error("A keep-awake change is already in progress.");
		if (this.enabled === enabled && !this.lease) return this.getState();
		if (this.enabled && enabled) return this.getState();

		this.busy = true;
		this.error = null;
		try {
			if (enabled) {
				if (await this.deps.readSleepDisabled()) {
					throw new Error(
						"Sleep is already disabled by another app or system setting. Turn that off first."
					);
				}
				if (this.disposed) throw new Error("SuperiorSwarm is quitting.");
				this.lease = this.deps.createLease();
				await this.deps.authorize(this.lease);
				if (this.disposed) throw new Error("SuperiorSwarm is quitting.");
				if (!(await this.deps.readSleepDisabled())) {
					throw new Error("macOS did not enable closed-lid operation. Keep awake is still off.");
				}
				this.enabled = true;
			} else {
				this.releaseLease();
				await this.waitForRestore();
				this.enabled = false;
			}
		} catch (error) {
			if (enabled) this.releaseLease();
			this.error = error instanceof Error ? error.message : "Could not change keep awake.";
			throw new Error(this.error);
		} finally {
			this.busy = false;
		}
		return this.getState();
	}

	private releaseLease(): void {
		if (!this.lease) return;
		this.deps.removeLease(this.lease);
		this.lease = null;
	}

	private async waitForRestore(): Promise<void> {
		for (let attempt = 0; attempt < 40; attempt++) {
			if (!this.deps.guardExists() && !(await this.deps.readSleepDisabled())) return;
			await this.deps.wait();
		}
		throw new Error(
			"Sleep has not been restored yet. Retry turning this off. If it persists, run sudo pmset disablesleep 0 in Terminal."
		);
	}

	/** Synchronous lease release works during quit; the guardian also watches our PID. */
	dispose(): void {
		this.disposed = true;
		this.releaseLease();
	}
}

export const keepAwakeService = new KeepAwakeService();
