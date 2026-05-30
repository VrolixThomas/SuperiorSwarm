import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let spawned = false;

interface WatchdogLogger {
	info: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

/** Pure arg builder, unit-testable without spawning or importing electron. */
export function buildWatchdogArgs(
	entryScript: string,
	targetPid: number,
	delayMs: number
): string[] {
	return [entryScript, String(targetPid), String(delayMs)];
}

/**
 * Spawn a detached process that SIGKILLs us after `delayMs`. Safe to call once;
 * repeated calls are ignored. This is the only guard that survives a frozen main
 * thread (e.g. the fsevents teardown deadlock), because an in-process JS timer
 * cannot fire once Node's environment is being destroyed.
 *
 * `appPath` and `log` are injected by the caller (which already holds them) so
 * this module imports neither electron nor the logger - importing electron's
 * `app` at module scope would crash unit tests, and a relative `require("./logger")`
 * does not resolve inside the single-file electron-vite bundle.
 */
export function armKillWatchdog(appPath: string, log: WatchdogLogger, delayMs = 5000): void {
	if (spawned) return;
	spawned = true;
	const entryScript = join(appPath, "out", "main", "process-watchdog-entry.js");
	if (!existsSync(entryScript)) {
		log.error("[quit] kill-watchdog entry script not found - skipping");
		return;
	}
	try {
		const child = spawn(process.execPath, buildWatchdogArgs(entryScript, process.pid, delayMs), {
			detached: true,
			stdio: "ignore",
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		});
		child.unref();
		log.info(`[quit] kill-watchdog armed (pid ${process.pid}, +${delayMs}ms)`);
	} catch (err) {
		log.error("[quit] failed to arm kill-watchdog", err);
	}
}
