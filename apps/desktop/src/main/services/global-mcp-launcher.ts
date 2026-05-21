import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function shQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

export function launcherPath(userDataDir: string): string {
	const name = process.platform === "win32" ? "superiorswarm-mcp.cmd" : "superiorswarm-mcp";
	return join(userDataDir, "bin", name);
}

export function writeLauncherScript(
	userDataDir: string,
	electronPath: string,
	serverPath: string
): string {
	const path = launcherPath(userDataDir);
	const dir = join(userDataDir, "bin");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	if (process.platform === "win32") {
		const body = [
			"@echo off",
			"set ELECTRON_RUN_AS_NODE=1",
			`"${electronPath}" "${serverPath}" %*`,
			"",
		].join("\r\n");
		writeFileSync(path, body, "utf-8");
	} else {
		const body = [
			"#!/usr/bin/env bash",
			`ELECTRON_RUN_AS_NODE=1 exec ${shQuote(electronPath)} ${shQuote(serverPath)} "$@"`,
			"",
		].join("\n");
		writeFileSync(path, body, "utf-8");
		chmodSync(path, 0o755);
	}
	return path;
}
