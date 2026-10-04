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
				timeout: 1000,
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
