import { afterEach, describe, expect, test } from "bun:test";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
	KEEP_AWAKE_LOCK,
	buildKeepAwakeAppleScript,
	buildKeepAwakeCommand,
} from "../src/main/services/keep-awake-guard";

const exec = promisify(execFile);
const directories: string[] = [];

async function eventually(condition: () => boolean) {
	for (let attempt = 0; attempt < 60; attempt++) {
		if (condition()) return;
		await delay(50);
	}
	throw new Error("Guardian did not reach the expected state");
}

function fixture(ownerPid = process.pid) {
	const dir = mkdtempSync("/tmp/superiorswarm-guard-test-");
	directories.push(dir);
	const lease = mkdtempSync(join(dir, "lease ' $(false) "));
	const lock = join(dir, "lock");
	const state = join(dir, "state");
	const calls = join(dir, "calls");
	const pmset = join(dir, "pmset");
	writeFileSync(state, "0");
	writeFileSync(calls, "");
	writeFileSync(
		pmset,
		`#!/bin/sh
if [ "$1" = "-g" ]; then
  echo "System-wide power settings:"
  echo " SleepDisabled $(/bin/cat ${state})"
else
  echo "$*" >> ${calls}
  if [ "$2" = 1 ] && [ -f ${dir}/fail-enable ]; then exit 1; fi
  if [ "$2" = 0 ] && [ -f ${dir}/fail-restore ]; then exit 1; fi
  echo "$2" > ${state}
fi
`,
		{ mode: 0o700 }
	);
	// Exercise the actual guardian as an unprivileged process. Every power write
	// goes to this fake pmset, and its lock is isolated in the fixture directory.
	const command = buildKeepAwakeCommand(ownerPid, lease)
		.replaceAll("/usr/bin/pmset", pmset)
		.replaceAll(KEEP_AWAKE_LOCK, lock);
	expect(command).not.toContain("/usr/bin/pmset");
	expect(command).not.toContain("/var/run/");
	return { dir, lease, lock, state, calls, command };
}

afterEach(async () => {
	for (const dir of directories.splice(0)) {
		// Removing leases also releases any helper left behind by a failed test.
		rmSync(join(dir, "fail-restore"), { force: true });
		for (const name of readdirSync(dir)) {
			if (name.startsWith("lease")) rmSync(join(dir, name), { recursive: true, force: true });
		}
		await eventually(() => !existsSync(join(dir, "lock")));
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("closed-lid power guardian", () => {
	test("returns readiness, handles quoted paths, and restores sleep on disable", async () => {
		const f = fixture();
		const { stdout } = await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
		expect(stdout.trim()).toBe("SUPERIORSWARM_KEEP_AWAKE_READY");
		expect(readFileSync(f.state, "utf8").trim()).toBe("1");
		rmSync(f.lease, { recursive: true });
		await eventually(() => !existsSync(f.lock));
		expect(readFileSync(f.calls, "utf8")).toBe("disablesleep 1\ndisablesleep 0\n");
	});

	test("survives an abrupt app exit and restores sleep independently", async () => {
		const owner = spawn("/bin/sleep", ["30"]);
		try {
			const f = fixture(owner.pid);
			await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
			owner.kill("SIGKILL");
			await eventually(() => !existsSync(f.lock));
			expect(readFileSync(f.state, "utf8").trim()).toBe("0");
		} finally {
			owner.kill();
		}
	});

	test("never enables after quit while administrator approval was pending", async () => {
		const f = fixture();
		rmSync(f.lease, { recursive: true });
		const { stdout } = await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
		expect(stdout).not.toContain("READY");
		expect(readFileSync(f.calls, "utf8")).toBe("");
		expect(existsSync(f.lock)).toBe(false);
	});

	test("rolls back a failed enable and releases its lock", async () => {
		const f = fixture();
		writeFileSync(join(f.dir, "fail-enable"), "");
		const { stdout } = await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
		expect(stdout).not.toContain("READY");
		expect(readFileSync(f.calls, "utf8")).toBe("disablesleep 1\ndisablesleep 0\n");
		expect(existsSync(f.lock)).toBe(false);
	});

	test("retains ownership and retries when restoring sleep temporarily fails", async () => {
		const f = fixture();
		await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
		writeFileSync(join(f.dir, "fail-restore"), "");
		rmSync(f.lease, { recursive: true });
		await eventually(() => readFileSync(f.calls, "utf8").includes("disablesleep 0"));
		expect(existsSync(f.lock)).toBe(true);
		expect(readFileSync(f.state, "utf8").trim()).toBe("1");
		rmSync(join(f.dir, "fail-restore"));
		await eventually(() => !existsSync(f.lock));
		expect(readFileSync(f.state, "utf8").trim()).toBe("0");
	});

	test("does not undo an existing override", async () => {
		const f = fixture();
		writeFileSync(f.state, "1");
		const { stdout } = await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
		expect(stdout).toContain("another app");
		expect(readFileSync(f.calls, "utf8")).toBe("");
		expect(readFileSync(f.state, "utf8")).toBe("1");
	});

	test("serializes concurrent SuperiorSwarm instances", async () => {
		const f = fixture();
		await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
		const second = await exec("/bin/sh", ["-c", f.command], { timeout: 3_000 });
		expect(second.stdout).toContain("Another SuperiorSwarm");
		expect(readFileSync(f.calls, "utf8")).toBe("disablesleep 1\n");
		rmSync(f.lease, { recursive: true });
		await eventually(() => !existsSync(f.lock));
	});

	test.skipIf(process.platform !== "darwin")(
		"AppleScript releases its stdout pipe after readiness",
		async () => {
			const f = fixture();
			// Do NOT request administrator access: only the unprivileged stub is run.
			const script = buildKeepAwakeAppleScript(f.command).split(
				" with administrator privileges"
			)[0];
			if (!script) throw new Error("Missing AppleScript");
			const { stdout } = await exec("/usr/bin/osascript", ["-e", script], { timeout: 3_000 });
			expect(stdout.trim()).toBe("SUPERIORSWARM_KEEP_AWAKE_READY");
			rmSync(f.lease, { recursive: true });
			await eventually(() => !existsSync(f.lock));
		}
	);
});
