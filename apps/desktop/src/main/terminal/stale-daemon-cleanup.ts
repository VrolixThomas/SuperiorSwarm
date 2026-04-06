import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { SUPERIORSWARM_DIR, daemonPaths } from "../../shared/daemon-protocol";

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

		let pid: number;
		try {
			pid = Number(readFileSync(pidPath, "utf-8").trim());
			if (!pid || Number.isNaN(pid)) {
				cleanup(pidPath, socketPath, logPath);
				continue;
			}
		} catch {
			cleanup(pidPath, socketPath, logPath);
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
			cleanup(pidPath, socketPath, logPath);
		}
	}
}

function cleanup(...paths: string[]): void {
	for (const p of paths) {
		try {
			rmSync(p);
		} catch {}
	}
}
