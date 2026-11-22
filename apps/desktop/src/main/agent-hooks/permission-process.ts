import { execFileSync } from "node:child_process";

export interface PermissionProcess {
	pid: number;
	parent: number;
	started: string;
	command: string;
}
/** Fixed argv, no shell, bounded output/time. PID alone cannot distinguish process reuse. */
export function inspectPermissionProcess(pid: number): PermissionProcess | null {
	if (!["darwin", "linux"].includes(process.platform) || !Number.isSafeInteger(pid) || pid < 2)
		return null;
	try {
		const output = execFileSync("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,lstart=,comm="], {
			encoding: "utf8",
			timeout: 400,
			maxBuffer: 4096,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		const match = output.match(
			/^(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/
		);
		if (!match || Number(match[1]) !== pid) return null;
		return { pid, parent: Number(match[2]), started: match[3] ?? "", command: match[4] ?? "" };
	} catch {
		return null;
	}
}
export function findPermissionProviderProcess(provider: string): PermissionProcess | null {
	let pid = process.ppid;
	for (let depth = 0; depth < 6; depth++) {
		const entry = inspectPermissionProcess(pid);
		if (!entry) return null;
		if (
			entry.command === provider ||
			entry.command.endsWith(`/${provider}`) ||
			(provider === "claude" && entry.command.includes("/claude/versions/"))
		)
			return entry;
		pid = entry.parent;
	}
	return null;
}
export function permissionProcessAlive(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const proof = value as PermissionProcess;
	const current = inspectPermissionProcess(proof.pid);
	return (
		!!current &&
		current.parent === proof.parent &&
		current.started === proof.started &&
		current.command === proof.command
	);
}

/** Cheap periodic exit detection; exact fingerprint is still checked immediately before decisions. */
export function permissionProcessExists(value: unknown): boolean {
	const pid = (value as { pid?: unknown } | null)?.pid;
	if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 2) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
