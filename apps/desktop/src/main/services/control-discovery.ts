import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ControlDiscovery {
	port: number;
	token: string;
	pid: number;
	updatedAt: string;
}

export function controlFilePath(userDataDir: string): string {
	return join(userDataDir, "control.json");
}

export function writeControlDiscovery(
	userDataDir: string,
	value: { port: number; token: string; pid: number }
): void {
	if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });
	const file = controlFilePath(userDataDir);
	const payload: ControlDiscovery = { ...value, updatedAt: new Date().toISOString() };
	writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
	if (process.platform !== "win32") chmodSync(file, 0o600);
}

export function readControlDiscovery(userDataDir: string): ControlDiscovery | null {
	const file = controlFilePath(userDataDir);
	if (!existsSync(file)) return null;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as ControlDiscovery;
		if (
			typeof parsed.port !== "number" ||
			typeof parsed.token !== "string" ||
			typeof parsed.pid !== "number"
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function deleteControlDiscovery(userDataDir: string): void {
	try {
		const file = controlFilePath(userDataDir);
		if (existsSync(file)) unlinkSync(file);
	} catch {}
}
