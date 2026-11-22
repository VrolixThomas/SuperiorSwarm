import { chmod, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuild } from "@electron/rebuild";
import { electronRuntimeABI } from "./electron-runtime-abi.mjs";

const require = createRequire(import.meta.url);
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = electronRuntimeABI();
console.log(
	`[native] rebuilding SQLite and PTY for Electron ${runtime.version}, ABI ${runtime.abi}`
);
await rebuild({
	buildPath: desktopDir,
	electronVersion: runtime.version,
	forceABI: runtime.abi,
	onlyModules: ["better-sqlite3", "node-pty"],
	force: true,
});
async function fixHelperModes(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory() && entry.name !== "node_modules") await fixHelperModes(path);
		else if (entry.isFile() && entry.name === "spawn-helper") await chmod(path, 0o755);
	}
}
await fixHelperModes(dirname(require.resolve("node-pty/package.json")));
