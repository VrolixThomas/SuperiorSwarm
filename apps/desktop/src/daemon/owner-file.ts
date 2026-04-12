import { rmSync, writeFileSync } from "node:fs";

export interface DaemonOwnerPayload {
	pid: number;
	startedAtMs: number;
	appDirHash: string;
}

export function writeOwnerFile(
	ownerPath: string | undefined,
	appDirHash: string | undefined,
	pid: number,
	startedAtMs: number
): DaemonOwnerPayload | null {
	if (!ownerPath || !appDirHash) {
		return null;
	}

	const payload: DaemonOwnerPayload = {
		pid,
		startedAtMs,
		appDirHash,
	};

	try {
		writeFileSync(ownerPath, JSON.stringify(payload));
		return payload;
	} catch {
		return null;
	}
}

export function removeOwnerFile(ownerPath: string | undefined): void {
	if (!ownerPath) {
		return;
	}

	try {
		rmSync(ownerPath);
	} catch {}
}
