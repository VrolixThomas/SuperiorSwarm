import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Resolve the absolute path to the MCP standalone server (server.mjs).
 *
 * Dev: app.getAppPath() = project root → mcp-standalone/server.mjs
 * Production: app.getAppPath() ends with app.asar → app.asar.unpacked/mcp-standalone/server.mjs
 */
export function getMcpServerPath(): string {
	const appPath = app.getAppPath();

	if (appPath.endsWith("app.asar")) {
		const unpackedPath = join(
			appPath.replace("app.asar", "app.asar.unpacked"),
			"mcp-standalone",
			"server.mjs"
		);
		if (existsSync(unpackedPath)) return unpackedPath;
	}

	const devPath = join(appPath, "mcp-standalone", "server.mjs");
	if (existsSync(devPath)) return devPath;

	throw new Error(
		`MCP server not found. Checked:\n  ${join(appPath, "mcp-standalone", "server.mjs")}`
	);
}
