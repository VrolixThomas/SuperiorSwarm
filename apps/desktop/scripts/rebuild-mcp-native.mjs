#!/usr/bin/env node
/**
 * Rebuild mcp-standalone/node_modules/better-sqlite3 against Electron's
 * Node ABI.
 *
 * Background: the MCP standalone server (mcp-standalone/server.mjs) is
 * launched at runtime via Electron's own embedded Node
 * (ELECTRON_RUN_AS_NODE=1 + process.execPath). For that to load the
 * native better-sqlite3 binding, the .node file must be compiled against
 * Electron's NODE_MODULE_VERSION, not the CI runner's system Node.
 *
 * This script runs after `cd mcp-standalone && npm install` in postinstall
 * and rewrites the binary to the correct ABI. If anything here throws we
 * want the install to fail loudly — a silent failure here means every
 * downstream `.dmg` would ship a broken MCP server.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuild } from "@electron/rebuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const mcpDir = join(desktopDir, "mcp-standalone");

const pkg = JSON.parse(await readFile(join(desktopDir, "package.json"), "utf-8"));
const electronSpec = pkg.devDependencies?.electron;
if (!electronSpec) {
	console.error("[rebuild-mcp-native] electron is not a devDependency in apps/desktop/package.json");
	process.exit(1);
}

const electronVersion = electronSpec.replace(/^[\^~]/, "");

console.log(
	`[rebuild-mcp-native] rebuilding better-sqlite3 in ${mcpDir} against electron@${electronVersion}`
);

await rebuild({
	buildPath: mcpDir,
	electronVersion,
	onlyModules: ["better-sqlite3"],
	force: true,
});

console.log("[rebuild-mcp-native] done");
