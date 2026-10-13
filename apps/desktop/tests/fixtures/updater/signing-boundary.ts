import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Disposable Mach-O fixtures only. No app launch, updater, Keychain, identities,
// credentials, Gatekeeper changes, or installed bundle access.
if (process.platform !== "darwin") throw new Error("This harness requires macOS codesign");
const directory = mkdtempSync(join(tmpdir(), "superiorswarm-signing-boundary-"));
try {
	const installed = join(directory, "installed");
	const candidate = join(directory, "candidate");
	const compatible = join(directory, "identical-code");
	for (const [path, version] of [
		[installed, 1],
		[candidate, 2],
	] as const) {
		const source = `${path}.c`;
		writeFileSync(source, `int main(void) { return ${version}; }\n`);
		execFileSync("/usr/bin/clang", [source, "-o", path], { stdio: "pipe" });
		execFileSync(
			"/usr/bin/codesign",
			[
				"--force",
				"--sign",
				"-",
				"--timestamp=none",
				"--identifier",
				"org.superiorswarm.disposable-fixture",
				path,
			],
			{ stdio: "pipe" }
		);
		execFileSync("/usr/bin/codesign", ["--verify", "--strict", path], { stdio: "pipe" });
	}
	const display = spawnSync("/usr/bin/codesign", ["--display", "-r-", installed], {
		encoding: "utf8",
	});
	if (display.status !== 0) throw new Error(display.stderr);
	const requirement = `${display.stdout}\n${display.stderr}`.match(/designated => (.+)/)?.[1];
	if (!requirement?.includes("cdhash"))
		throw new Error("Expected a code-hash-bound designated requirement");
	copyFileSync(installed, compatible);
	execFileSync("/usr/bin/codesign", ["--verify", "--strict", "-R", `=${requirement}`, compatible], {
		stdio: "pipe",
	});
	const mismatch = spawnSync(
		"/usr/bin/codesign",
		["--verify", "--strict", "-R", `=${requirement}`, candidate],
		{ encoding: "utf8" }
	);
	if (
		mismatch.status === 0 ||
		!mismatch.stderr.includes("code failed to satisfy specified code requirement")
	) {
		throw new Error(`Expected requirement rejection: ${mismatch.stderr}`);
	}
	if (readFileSync(installed).equals(readFileSync(candidate)))
		throw new Error("Fixture code should differ");
	console.log(
		"PASS: both ad-hoc fixtures pass strict verification; identical code meets the installed requirement; different code fails it."
	);
	console.log(
		"This proves the requirement boundary, not Developer ID compatibility or an install/relaunch."
	);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
