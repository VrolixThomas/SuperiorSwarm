export interface DaemonOwnerRecord {
	pid: number;
	startedAtMs: number;
	appDirHash: string;
}

export class DaemonOwnershipMismatchError extends Error {
	readonly code = "DAEMON_OWNERSHIP_MISMATCH" as const;

	constructor(
		readonly ownerRecord: DaemonOwnerRecord,
		readonly expectedAppDirHash: string
	) {
		super(
			`Refusing to reuse daemon socket owned by a different app instance (${ownerRecord.appDirHash})`
		);
		this.name = "DaemonOwnershipMismatchError";
	}
}

export function isDaemonOwnershipMismatchError(err: unknown): err is DaemonOwnershipMismatchError {
	return err instanceof DaemonOwnershipMismatchError;
}

export function parseOwnerRecord(raw: string): DaemonOwnerRecord | null {
	try {
		const parsed = JSON.parse(raw) as Partial<DaemonOwnerRecord>;
		if (
			typeof parsed.pid !== "number" ||
			!Number.isInteger(parsed.pid) ||
			parsed.pid <= 0 ||
			typeof parsed.startedAtMs !== "number" ||
			!Number.isFinite(parsed.startedAtMs) ||
			parsed.startedAtMs <= 0 ||
			typeof parsed.appDirHash !== "string" ||
			parsed.appDirHash.length === 0
		) {
			return null;
		}
		return {
			pid: parsed.pid,
			startedAtMs: parsed.startedAtMs,
			appDirHash: parsed.appDirHash,
		};
	} catch {
		return null;
	}
}

export function isPidAlive(
	pid: number,
	killFn: (pid: number, signal: number) => void = process.kill
): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}

	try {
		killFn(pid, 0);
		return true;
	} catch (err) {
		if (typeof err === "object" && err !== null && "code" in err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EPERM") {
				return true;
			}
			if (code === "ESRCH") {
				return false;
			}
		}
		return false;
	}
}

export function isOwnerRecordCurrent(record: DaemonOwnerRecord, nowMs = Date.now()): boolean {
	if (!Number.isFinite(record.startedAtMs) || record.startedAtMs <= 0) {
		return false;
	}

	const MAX_FUTURE_SKEW_MS = 60_000;
	if (record.startedAtMs > nowMs + MAX_FUTURE_SKEW_MS) {
		return false;
	}

	return true;
}
