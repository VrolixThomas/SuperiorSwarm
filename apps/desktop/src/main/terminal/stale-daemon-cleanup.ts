import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SUPERIORSWARM_DIR } from "../../shared/daemon-protocol";

/**
 * Kill stale daemon processes from previous sessions.
 * Scans ~/.superiorswarm/daemon-*.pid files. For each:
 * - If the process is dead: clean up PID/socket/log files
 * - If the process is alive but NOT our own instance: kill it and clean up
 *
 * Skips our own daemon (matching ownInstanceId) so we don't kill ourselves.
 */
export function cleanupStaleDaemons(ownInstanceId: string): void {
	if (!existsSync(SUPERIORSWARM_DIR)) return;

	let files: string[];
	try {
		files = readdirSync(SUPERIORSWARM_DIR);
	} catch {
		return;
	}

	const pidFiles = files.filter((f) => /^daemon-[a-f0-9]+\.pid$/.test(f));

	for (const pidFile of pidFiles) {
		const match = pidFile.match(/^daemon-([a-f0-9]+)\.pid$/);
		if (!match) continue;
		const instanceId = match[1];

		// Never kill our own daemon
		if (instanceId === ownInstanceId) continue;

		const pidPath = join(SUPERIORSWARM_DIR, pidFile);
		const socketPath = join(SUPERIORSWARM_DIR, `daemon-${instanceId}.sock`);
		const logPath = join(SUPERIORSWARM_DIR, `daemon-${instanceId}.log`);

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

		// Check if process is alive
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
		} else {
			console.log(`[stale-cleanup] killing stale daemon ${instanceId} (pid ${pid})`);
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// Can't kill it — leave it
				}
			}
			setTimeout(() => cleanup(pidPath, socketPath, logPath), 2_000);
		}
	}
}

function cleanup(...paths: string[]): void {
	for (const p of paths) {
		try {
			if (existsSync(p)) rmSync(p);
		} catch {}
	}
}
