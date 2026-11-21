import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as pty from "node-pty";
import {
	readTerminalProcessEnvironment,
	readTerminalProcessIdentity,
} from "../../../src/daemon/terminal-process-identity";
const helper = process.argv[2];
if (!helper) throw Error("Missing isolated native helper");
const provider = process.argv[3];
if (!provider) throw Error("Missing synthetic provider");
const child = pty.spawn(provider, ["ARGV_ONLY_MARKER=not-environment"], {
	name: "xterm-256color",
	cols: 80,
	rows: 24,
	env: {
		PATH: "/usr/bin:/bin",
		QUEUE_AUTH_MARKER: "synthetic-credential",
		CODEX_HOME: "/synthetic-profile",
		AGENT_NOTIFY_TERMINAL_ID: "synthetic-terminal",
	},
});
child.onData(() => {});
try {
	let identity = readTerminalProcessIdentity(child.pid, helper);
	for (let i = 0; i < 40 && !identity; i++) {
		await new Promise((r) => setTimeout(r, 25));
		identity = readTerminalProcessIdentity(child.pid, helper);
	}
	assert.ok(identity);
	const environment = readTerminalProcessEnvironment(identity, helper);
	assert.ok(environment, "the verified process environment must be capturable");

	assert.equal(environment.QUEUE_AUTH_MARKER, "synthetic-credential");
	assert.equal(environment.CODEX_HOME, "/synthetic-profile");
	assert.equal(environment.AGENT_NOTIFY_TERMINAL_ID, "synthetic-terminal");
	assert.equal(environment.ARGV_ONLY_MARKER, undefined, "argv is not interpreted as environment");
	assert.equal(readTerminalProcessEnvironment({ ...identity, startedAt: "0:0" }, helper), null);
	const ordinary = JSON.parse(
		execFileSync(helper, [String(child.pid)], { encoding: "utf8", env: {} })
	);
	assert.equal(
		Object.hasOwn(ordinary, "environment"),
		false,
		"ordinary identity probing never reads environment"
	);
	console.log("native verified environment capture and identity-only isolation: PASS");
} finally {
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {}
	try {
		child.kill("SIGKILL");
	} catch {}
}
