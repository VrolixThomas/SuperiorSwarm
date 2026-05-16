import { join } from "node:path";

export function memoryRoot(userDataPath: string): string {
	return join(userDataPath, "memory");
}

export function projectMemoryRoot(userDataPath: string, projectId: string): string {
	return join(memoryRoot(userDataPath), projectId);
}

export function journalDir(userDataPath: string, projectId: string): string {
	return join(projectMemoryRoot(userDataPath, projectId), "journal");
}

export function journalFileName(startedAt: Date, sessionId: string): string {
	const yyyy = startedAt.getUTCFullYear();
	const mm = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(startedAt.getUTCDate()).padStart(2, "0");
	const hh = String(startedAt.getUTCHours()).padStart(2, "0");
	const mi = String(startedAt.getUTCMinutes()).padStart(2, "0");
	const ss = String(startedAt.getUTCSeconds()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}-${sessionId}.md`;
}
