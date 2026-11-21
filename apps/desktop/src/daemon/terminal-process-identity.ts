import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { type TerminalProcessIdentity, hasUnsafeTerminalText } from "../shared/terminal-files";

export function readTerminalProcessIdentity(
	shellPid: number,
	helper = join(__dirname.replace("app.asar/", "app.asar.unpacked/"), "terminal-process-info")
): TerminalProcessIdentity | null {
	if (process.platform !== "darwin" || !Number.isSafeInteger(shellPid) || shellPid <= 0)
		return null;
	try {
		const value: unknown = JSON.parse(
			execFileSync(helper, [String(shellPid)], {
				encoding: "utf8",
				// Cold helper launches on macOS can exceed one second. Keep this
				// bounded below the daemon client's three-second file request timeout.
				timeout: 2000,
				maxBuffer: 16 * 1024,
				stdio: ["ignore", "pipe", "ignore"],
				env: {},
			})
		);
		if (!value || typeof value !== "object") return null;
		const row = value as Record<string, unknown>;
		if (
			!Number.isSafeInteger(row["pid"]) ||
			(row["pid"] as number) <= 0 ||
			typeof row["startedAt"] !== "string" ||
			!/^\d+:\d+$/.test(row["startedAt"]) ||
			typeof row["name"] !== "string" ||
			typeof row["executable"] !== "string" ||
			!row["executable"].startsWith("/") ||
			hasUnsafeTerminalText(row["executable"])
		)
			return null;
		return {
			pid: row["pid"] as number,
			startedAt: row["startedAt"],
			name: row["name"],
			executable: row["executable"],
		};
	} catch {
		return null;
	}
}

/** Daemon-private, bounded environment snapshot. Never logged, persisted or returned over IPC. */
export function readTerminalProcessEnvironment(
	expected: TerminalProcessIdentity,
	helper = join(__dirname.replace("app.asar/", "app.asar.unpacked/"), "terminal-process-info")
): Record<string, string> | null {
	if (process.platform !== "darwin") return null;
	try {
		const bytes = execFileSync(helper, [String(expected.pid), "--environment"], {
			timeout: 2000,
			maxBuffer: 256 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
			env: {},
		});
		const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		if (!value || typeof value !== "object") return null;
		const row = value as Record<string, unknown>;
		if (
			row["pid"] !== expected.pid ||
			row["startedAt"] !== expected.startedAt ||
			row["executable"] !== expected.executable ||
			!Array.isArray(row["environment"]) ||
			row["environment"].length === 0 ||
			row["environment"].length > 2048
		)
			return null;
		const result: Record<string, string> = Object.create(null);
		for (const entry of row["environment"]) {
			if (typeof entry !== "string" || entry.includes("\0")) return null;
			const index = entry.indexOf("=");
			if (index <= 0) return null;
			const key = entry.slice(0, index);
			if (Object.hasOwn(result, key)) return null;
			result[key] = entry.slice(index + 1);
		}
		return result;
	} catch {
		return null;
	}
}
