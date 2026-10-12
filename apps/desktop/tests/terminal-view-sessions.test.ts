import { expect, test } from "bun:test";
import headless from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";
import { TerminalViewSessions } from "../src/main/terminal/view-sessions";
import { writeTerminalReplay } from "../src/renderer/components/terminal-replay";
import type { TerminalDataMeta } from "../src/shared/daemon-protocol";
import { decodeTerminalReplay, encodeTerminalReplay } from "../src/shared/terminal-replay";

import { type Data, LegacyDaemon } from "./fixtures/legacy-terminal-daemon";

async function until(condition: () => boolean) {
	for (let i = 0; i < 300; i++) {
		if (condition()) return;
		await Bun.sleep(10);
	}
	throw Error("Terminal view did not reach the expected state");
}

function view() {
	const terminal = new headless.Terminal({
		allowProposedApi: true,
		cols: 80,
		rows: 24,
		scrollback: 10000,
	});
	const frames: Array<{ data: string; meta?: TerminalDataMeta }> = [];
	const exits: number[] = [];
	const onData: Data = (data, meta) => {
		frames.push({ data, meta });
		if (meta?.replay) writeTerminalReplay(terminal as unknown as Terminal, data, () => {});
		else terminal.write(data);
	};
	return { terminal, frames, exits, onData, onExit: (code: number) => exits.push(code) };
}

test("returning to a chat preserves full-screen mouse mode on a legacy daemon", async () => {
	const daemon = new LegacyDaemon();
	const sessions = new TerminalViewSessions(daemon);
	let pane = view();
	try {
		await sessions.create("chat", "/tmp", pane.onData, pane.onExit);
		daemon.emit(`${"history\r\n".repeat(100)}\x1b[?1049h\x1b[?1003h\x1b[?1006hREADY`);
		await until(() => pane.terminal.modes.mouseTrackingMode === "any");
		for (let i = 0; i < 3; i++) {
			const redraw = "\x1b[?2026h\x1b[24;1Hstatus\x1b[?25h\x1b[?2026l".repeat(6000);
			daemon.emit(`${redraw}\x1b[1;1HBEFORE ${i}`);
			await until(
				() =>
					pane.terminal.buffer.active
						.getLine(0)
						?.translateToString(true)
						.startsWith(`BEFORE ${i}`) === true
			);
			expect(daemon.raw).not.toContain("\x1b[?1049h");
			expect(daemon.raw).not.toContain("\x1b[?1006h");
			sessions.detach("chat");
			pane.terminal.dispose();
			daemon.emit(`${redraw}\x1b[1;1HAWAY ${i}`);
			pane = view();
			await sessions.attach("chat", pane.onData, pane.onExit, "/tmp");
			await until(
				() =>
					pane.terminal.buffer.active
						.getLine(0)
						?.translateToString(true)
						.startsWith(`AWAY ${i}`) === true
			);
			expect(pane.terminal.buffer.active.type).toBe("alternate");
			expect(pane.terminal.modes.mouseTrackingMode).toBe("any");
			expect(pane.terminal.buffer.normal.baseY).toBe(77);
			expect(pane.frames.some((frame) => frame.data.includes("\x1b[?1006h"))).toBe(true);
		}
		expect(daemon.attaches).toBe(0);
		expect(daemon.detaches).toBe(0);
	} finally {
		pane.terminal.dispose();
		sessions.dispose("chat");
	}
});

test("a returning view gets one snapshot followed by only newer live output", async () => {
	const daemon = new LegacyDaemon();
	const sessions = new TerminalViewSessions(daemon);
	const first = view();
	const second = view();
	try {
		await sessions.create("chat", "/tmp", first.onData, first.onExit);
		daemon.emit("before\r\n");
		sessions.detach("chat");
		const attachment = sessions.attach("chat", second.onData, second.onExit);
		daemon.emit("after\r\n");
		await attachment;
		await until(() => second.terminal.buffer.active.cursorY === 2);
		expect(second.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("before");
		expect(second.terminal.buffer.active.getLine(1)?.translateToString(true)).toBe("after");
		expect(second.frames[0]?.meta?.replay).toBe(true);
		expect(second.frames[1]?.data).toBe("after\r\n");
		expect(first.frames).toEqual([]);
	} finally {
		first.terminal.dispose();
		second.terminal.dispose();
		sessions.dispose("chat");
	}
});

test("closing a view during queued restoration cannot resurrect its callbacks", async () => {
	const daemon = new LegacyDaemon();
	const sessions = new TerminalViewSessions(daemon);
	const pane = view();
	try {
		await sessions.create("chat", "/tmp", pane.onData, pane.onExit);
		daemon.emit("queued output\r\n");
		sessions.detach("chat");
		const pending = sessions.attach("chat", pane.onData, pane.onExit);
		await Promise.resolve(); // Let parsing start before the tab is closed.
		sessions.dispose("chat");
		await pending;
		expect(pane.frames).toEqual([]);
		expect(daemon.disposals).toBe(1);
	} finally {
		pane.terminal.dispose();
	}
});

test("resize and final output are ordered before the snapshot and exit", async () => {
	const daemon = new LegacyDaemon();
	const sessions = new TerminalViewSessions(daemon);
	const pane = view();
	try {
		await sessions.create("chat", "/tmp", pane.onData, pane.onExit);
		daemon.emit("before\r\n");
		sessions.resize("chat", 120, 40);
		sessions.detach("chat");
		await sessions.attach("chat", pane.onData, pane.onExit);
		const snapshot = decodeTerminalReplay(pane.frames[0]?.data ?? "");
		expect([snapshot?.cols, snapshot?.rows]).toEqual([120, 40]);
		daemon.emit("final\r\n");
		daemon.onExit?.(0);
		await until(() => pane.exits.length === 1);
		expect(pane.frames.at(-1)?.data).toBe("final\r\n");
		expect(pane.exits).toEqual([0]);
		expect(daemon.disposals).toBe(0);
	} finally {
		pane.terminal.dispose();
		sessions.dispose("chat");
	}
});

test("shell replay clears stale modes in the retained state", async () => {
	const daemon = new LegacyDaemon();
	const sessions = new TerminalViewSessions(daemon);
	const pane = view();
	daemon.raw = `${"history\r\n".repeat(100)}\x1b[?1049h\x1b[?1003h\x1b[?1006hprompt`;
	daemon.foreground = "zsh";
	try {
		await sessions.attach("chat", pane.onData, pane.onExit);
		await until(() => pane.frames.length === 1);
		sessions.detach("chat");
		await sessions.attach("chat", pane.onData, pane.onExit);
		await until(() => pane.terminal.buffer.normal.baseY === 77);
		expect(pane.terminal.buffer.active.type).toBe("normal");
		expect(pane.terminal.modes.mouseTrackingMode).toBe("none");
	} finally {
		pane.terminal.dispose();
		sessions.dispose("chat");
	}
});

test("snapshot-capable daemons retain their existing attach/detach behavior", async () => {
	const daemon = new LegacyDaemon();
	daemon.supportsTerminalSnapshots = true;
	const sessions = new TerminalViewSessions(daemon);
	const pane = view();
	daemon.raw = encodeTerminalReplay("modern snapshot", 80, 24);
	try {
		await sessions.attach("chat", pane.onData, pane.onExit);
		sessions.detach("chat");
		await sessions.attach("chat", pane.onData, pane.onExit);
		expect(daemon.attaches).toBe(2);
		expect(daemon.detaches).toBe(1);
		expect(pane.frames.map((f) => f.data)).toEqual([daemon.raw, daemon.raw]);
	} finally {
		pane.terminal.dispose();
		sessions.dispose("chat");
	}
});
