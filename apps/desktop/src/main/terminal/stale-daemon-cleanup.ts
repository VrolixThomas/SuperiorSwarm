import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { SUPERIORSWARM_DIR, daemonPaths } from "../../shared/daemon-protocol";

/** Read and validate a daemon pid file. Returns null for missing/garbage/non-positive pids. */
export function readPidFile(pidPath: string): number | null {
	try {
		const pid = Number(readFileSync(pidPath, "utf-8").trim());
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/** Best-effort removal of daemon housekeeping files; missing files are ignored. */
export function removeFiles(...paths: string[]): void {
	for (const p of paths) {
		try {
			rmSync(p);
		} catch {}
	}
}

/**
 * Clean up stale daemon files from previous sessions.
 * Scans ~/.superiorswarm/daemon-*.pid files. For each:
 * - If the process is dead: remove PID/socket/log files
 * - If the process is alive: leave it alone (could be the production app
 *   or another dev instance still in use)
 *
 * Skips our own daemon (matching ownInstanceId).
 * Never kills live processes — use Settings > Terminals to manage those.
 */
export function cleanupStaleDaemons(ownInstanceId: string): void {
	if (!existsSync(SUPERIORSWARM_DIR)) return;

	let files: string[];
	try {
		files = readdirSync(SUPERIORSWARM_DIR);
	} catch {
		return;
	}

	const pidPattern = /^daemon-([a-f0-9]+)\.pid$/;

	for (const file of files) {
		const match = pidPattern.exec(file);
		if (!match) continue;
		const instanceId = match[1] ?? "";

		// Skip our own daemon
		if (!instanceId || instanceId === ownInstanceId) continue;

		const { pidPath, socketPath, logPath } = daemonPaths(instanceId);

		const pid = readPidFile(pidPath);
		if (pid === null) {
			removeFiles(pidPath, socketPath, logPath);
			continue;
		}

		// Only clean up files for dead processes — never kill live ones,
		// as they may belong to the production app or another active session
		let alive = false;
		try {
			process.kill(pid, 0);
			alive = true;
		} catch {
			// Process is dead
		}

		if (!alive) {
			console.log(`[stale-cleanup] removing dead daemon ${instanceId} (pid ${pid})`);
			removeFiles(pidPath, socketPath, logPath);
		}
	}
}
