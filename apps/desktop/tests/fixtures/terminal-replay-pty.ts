import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Terminal } from "@xterm/headless";
import { PtyManager } from "../../src/daemon/pty-manager";
import { decodeTerminalReplay } from "../../src/shared/terminal-replay";

// Run under Node, whose libuv loop delivers node-pty output reliably.
const manager = new PtyManager();
let output = "";
let final = "";
const receive = (data: string) => {
	output += data;
};
async function until(predicate: () => boolean) {
	for (let i = 0; i < 500; i++) {
		if (predicate()) return;
		await delay(10);
	}
	throw Error("Timed out waiting for isolated PTY output");
}
try {
	manager.create(
		"test",
		tmpdir(),
		receive,
		(_code, data) => {
			final = data;
		},
		"first"
	);
	const script =
		'import sys; sys.stdout.write("\\x1bc" + "".join(f"line {i}\\r\\n" for i in range(300)) + "\\x1b[?2026h\\x1b[24;1Hstatus\\x1b[?2026l" * 7000 + chr(95)*2 + "DONE" + chr(95)*2); sys.stdout.flush()';
	manager.write("test", `python3 -c '${script.replaceAll("'", "'\\''")}'\r`);
	await until(() => output.includes("__DONE__"));
	manager.detachSession("first", "test");
	output = "";
	const attached = manager.attach(
		"test",
		receive,
		(_code, data) => {
			final = data;
		},
		"second",
		true
	);
	assert(attached);
	const snapshot = decodeTerminalReplay(attached.buffer);
	assert(snapshot);
	const restored = new Terminal({
		allowProposedApi: true,
		cols: snapshot.cols,
		rows: snapshot.rows,
		scrollback: 10000,
	});
	try {
		await new Promise<void>((resolve) => restored.write(snapshot.data, resolve));
		assert.equal(restored.buffer.active.getLine(0)?.translateToString(true), "line 0");
		assert(restored.buffer.active.baseY >= 277);
	} finally {
		restored.dispose();
	}
	manager.resize("test", 120, 32);
	manager.write("test", "printf '\\137\\137NEXT\\137\\137\\n'\r");
	await until(() => output.includes("__NEXT__"));
	assert.equal(decodeTerminalReplay(manager.getBuffer("test"))?.cols, 120);
	manager.write("test", "printf '\\137\\137FINAL\\137\\137\\n'; exit\r");
	await until(() => !!final);
	assert(decodeTerminalReplay(final)?.data.includes("__FINAL__"));
	assert.equal(manager.has("test"), false);
	console.log("history survived redraws, detach/attach, resize, live output and exit");
} finally {
	manager.disposeAll();
}
