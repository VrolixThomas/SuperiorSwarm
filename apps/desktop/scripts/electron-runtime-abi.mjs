import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export function electronRuntimeABI() {
	const executable = require("electron");
	const installed = require("electron/package.json").version;
	const runtime = JSON.parse(
		execFileSync(
			executable,
			[
				"-p",
				"JSON.stringify({version:process.versions.electron,abi:Number(process.versions.modules)})",
			],
			{ encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }
		)
	);
	if (runtime.version !== installed || !Number.isInteger(runtime.abi))
		throw new Error(
			"Installed Electron binary does not match its package. Reinstall Electron before rebuilding native modules."
		);
	return runtime;
}
