// Standalone watchdog process. NO electron imports — this runs as a bare Node
// process (ELECTRON_RUN_AS_NODE=1). It waits `delayMs` then SIGKILLs `targetPid`,
// unless the parent dies first (in which case waiting is harmless and it exits).
//
// argv: [node, thisScript, <targetPid>, <delayMs>]
const targetPid = Number(process.argv[2]);
const delayMs = Number(process.argv[3]);

if (!Number.isInteger(targetPid) || targetPid <= 0 || !Number.isFinite(delayMs)) {
	console.error("[watchdog] bad args", process.argv.slice(2));
	process.exit(1);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

setTimeout(() => {
	if (isAlive(targetPid)) {
		console.error(`[watchdog] target ${targetPid} still alive after ${delayMs}ms — SIGKILL`);
		try {
			process.kill(targetPid, "SIGKILL");
		} catch (err) {
			console.error("[watchdog] SIGKILL failed", err);
		}
	}
	process.exit(0);
}, delayMs);
