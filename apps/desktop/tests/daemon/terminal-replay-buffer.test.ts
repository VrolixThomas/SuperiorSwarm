import { describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import { TerminalReplayBuffer } from "../../src/daemon/terminal-replay-buffer";
import { decodeTerminalReplay } from "../../src/shared/terminal-replay";

const write = (buffer: TerminalReplayBuffer, data: string) =>
	new Promise<string>((resolve) => buffer.write(data, resolve));
const terminalWrite = (terminal: Terminal, data: string) =>
	new Promise<void>((resolve) => terminal.write(data, resolve));
async function restore(buffer: TerminalReplayBuffer) {
	const snapshot = decodeTerminalReplay(buffer.snapshot());
	if (!snapshot) throw Error("Missing snapshot");
	const terminal = new Terminal({
		allowProposedApi: true,
		cols: snapshot.cols,
		rows: snapshot.rows,
		scrollback: 10_000,
	});
	await terminalWrite(terminal, snapshot.data);
	return terminal;
}

describe("rendered terminal replay", () => {
	test("prompt redraws cannot evict conversation history", async () => {
		const buffer = new TerminalReplayBuffer();
		try {
			await write(buffer, Array.from({ length: 300 }, (_, i) => `message ${i}\r\n`).join(""));
			await write(buffer, "\x1b[?2026h\x1b[24;1Hstatus\x1b[?25h\x1b[?2026l".repeat(6000));
			const restored = await restore(buffer);
			try {
				expect(restored.buffer.active.baseY).toBe(277);
				expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe("message 0");
				expect(restored.buffer.active.getLine(299)?.translateToString(true)).toBe("message 299");
				expect(buffer.snapshot().length).toBeLessThan(10_000);
			} finally {
				restored.dispose();
			}
		} finally {
			buffer.dispose();
		}
	});

	test("history is bounded by rendered rows instead of raw redraw traffic", async () => {
		const buffer = new TerminalReplayBuffer();
		try {
			await write(buffer, Array.from({ length: 11_000 }, (_, i) => `line ${i}\r\n`).join(""));
			const restored = await restore(buffer);
			try {
				expect(restored.buffer.active.baseY).toBe(10_000);
				expect(restored.buffer.active.length).toBe(10_024);
				expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe("line 977");
			} finally {
				restored.dispose();
			}
		} finally {
			buffer.dispose();
		}
	});

	test("a snapshot followed by queued live output contains each line exactly once", async () => {
		const buffer = new TerminalReplayBuffer();
		try {
			await write(buffer, "before\r\n");
			const next = write(buffer, "after\r\n");
			const restored = await restore(buffer);
			try {
				await terminalWrite(restored, await next);
				expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe("before");
				expect(restored.buffer.active.getLine(1)?.translateToString(true)).toBe("after");
				expect(restored.buffer.active.cursorY).toBe(2);
			} finally {
				restored.dispose();
			}
		} finally {
			buffer.dispose();
		}
	});

	test("resize is ordered between output chunks and stored with the snapshot", async () => {
		const buffer = new TerminalReplayBuffer();
		try {
			const first = write(buffer, "A".repeat(80));
			buffer.resize(100, 30);
			await first;
			await write(buffer, "B".repeat(20));
			const restored = await restore(buffer);
			try {
				expect([restored.cols, restored.rows]).toEqual([100, 30]);
				expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe(
					"A".repeat(80) + "B".repeat(20)
				);
			} finally {
				restored.dispose();
			}
		} finally {
			buffer.dispose();
		}
	});

	test("alternate screen, normal history, cursor and input modes survive replay", async () => {
		const buffer = new TerminalReplayBuffer();
		try {
			await write(buffer, "saved history\r\n".repeat(100));
			await write(
				buffer,
				"\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[?1h\x1b[?25l\x1b[4;8Heditor"
			);
			const restored = await restore(buffer);
			try {
				expect(restored.buffer.active.type).toBe("alternate");
				expect(restored.buffer.normal.baseY).toBe(77);
				expect(restored.buffer.active.cursorY).toBe(3);
				expect(restored.buffer.active.cursorX).toBe(13);
				expect(restored.modes.mouseTrackingMode).toBe("vt200");
				expect(restored.modes.applicationCursorKeysMode).toBe(true);
				expect(restored.modes.bracketedPasteMode).toBe(true);
				expect(buffer.snapshot()).toEndWith("\x1b[?1006h\x1b[?25l");
				await terminalWrite(restored, "\x1b[?1049l");
				expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe("saved history");
			} finally {
				restored.dispose();
			}
		} finally {
			buffer.dispose();
		}
	});

	test.each([
		["\x1b[31", "mred", "red"],
		["\x1b]0;title", "\x07text", "text"],
		["\x1bPignored", "\x1b\\text", "text"],
		["\ud83d", "\ude80", "🚀"],
	])("attach between control/Unicode fragments: %j", async (prefix, suffix, text) => {
		const buffer = new TerminalReplayBuffer();
		try {
			await write(buffer, "before\r\n");
			expect(await write(buffer, prefix)).toBe("");
			const restored = await restore(buffer);
			try {
				await terminalWrite(restored, await write(buffer, suffix));
				expect(restored.buffer.active.getLine(1)?.translateToString(true)).toBe(text);
			} finally {
				restored.dispose();
			}
		} finally {
			buffer.dispose();
		}
	});

	test("device-query answers are never emitted as live PTY output", async () => {
		const buffer = new TerminalReplayBuffer();
		try {
			expect(await write(buffer, "\x1b[6n")).toBe("\x1b[6n");
			expect(buffer.snapshot()).not.toContain("\x1b[1;1R");
		} finally {
			buffer.dispose();
		}
	});

	test("live output after replay respects the application's scrolling region", async () => {
		const buffer = new TerminalReplayBuffer();
		try {
			await write(
				buffer,
				Array.from({ length: 24 }, (_, i) => `\x1b[${i + 1};1Hrow ${i}`).join("")
			);
			await write(buffer, "\x1b[2;10r\x1b[10;1H");
			const restored = await restore(buffer);
			try {
				await terminalWrite(restored, "\n");
				expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe("row 0");
				expect(restored.buffer.active.getLine(1)?.translateToString(true)).toBe("row 2");
				expect(restored.buffer.active.getLine(10)?.translateToString(true)).toBe("row 10");
			} finally {
				restored.dispose();
			}
		} finally {
			buffer.dispose();
		}
	});
});
