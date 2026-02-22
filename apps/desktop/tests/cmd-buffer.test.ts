import { beforeEach, describe, expect, test } from "bun:test";
import { CmdBuffer } from "../src/shared/lib/cmd-buffer";

describe("CmdBuffer", () => {
	let buf: CmdBuffer;

	beforeEach(() => {
		buf = new CmdBuffer();
	});

	// ── Basic command tracking ──

	test("returns command on Enter", () => {
		expect(buf.feed("ls -la")).toBeNull();
		expect(buf.feed("\r")).toBe("ls -la");
	});

	test("returns null on empty Enter", () => {
		expect(buf.feed("\r")).toBeNull();
	});

	test("trims whitespace", () => {
		buf.feed("  git push  ");
		expect(buf.feed("\r")).toBe("git push");
	});

	test("resets buffer after Enter", () => {
		expect(buf.feed("first\r")).toBe("first");
		expect(buf.feed("second\r")).toBe("second");
	});

	test("backspace removes last character", () => {
		buf.feed("ls");
		buf.feed("\x7f"); // DEL
		expect(buf.feed("\r")).toBe("l");
	});

	test("BS (0x08) also removes last character", () => {
		buf.feed("ls");
		buf.feed("\x08");
		expect(buf.feed("\r")).toBe("l");
	});

	test("backspace on empty buffer is a no-op", () => {
		buf.feed("\x7f");
		expect(buf.feed("\r")).toBeNull();
	});

	test("Ctrl+C clears buffer", () => {
		buf.feed("some command");
		buf.feed("\x03");
		expect(buf.feed("\r")).toBeNull();
	});

	test("control characters below 0x20 are ignored", () => {
		buf.feed("a\x01\x02b");
		expect(buf.feed("\r")).toBe("ab");
	});

	// ── Escape sequence consumption ──

	test("CSI sequence (arrow key) does not pollute buffer", () => {
		buf.feed("ls");
		buf.feed("\x1b[D"); // left arrow
		buf.feed("x");
		expect(buf.feed("\r")).toBe("lsx");
	});

	test("Alt+key (ESC + printable) is consumed", () => {
		buf.feed("a");
		buf.feed("\x1ba"); // Alt+a
		buf.feed("b");
		expect(buf.feed("\r")).toBe("ab");
	});

	test("bare ESC is consumed", () => {
		buf.feed("a\x1bb");
		// ESC consumed, 'b' treated as the ESC dispatch byte, not added to buffer
		expect(buf.feed("\r")).toBe("a");
	});

	test("SS3 function key (e.g. F1) is consumed", () => {
		buf.feed("\x1bOP"); // F1
		expect(buf.feed("\r")).toBeNull();
	});

	test("SS2 is consumed like SS3", () => {
		buf.feed("a\x1bNXb");
		expect(buf.feed("\r")).toBe("ab");
	});

	test("OSC terminated by BEL is consumed", () => {
		buf.feed("\x1b]0;my title\x07hello");
		expect(buf.feed("\r")).toBe("hello");
	});

	test("OSC terminated by ST (ESC \\) is consumed", () => {
		buf.feed("\x1b]0;my title\x1b\\hello");
		expect(buf.feed("\r")).toBe("hello");
	});

	test("DCS sequence is consumed", () => {
		buf.feed("\x1bPsome data\x1b\\ok");
		expect(buf.feed("\r")).toBe("ok");
	});

	test("APC sequence is consumed", () => {
		buf.feed("\x1b_apc body\x07done");
		expect(buf.feed("\r")).toBe("done");
	});

	test("CSI with intermediate bytes is consumed", () => {
		buf.feed("a\x1b[?25hb"); // DECTCEM (show cursor)
		expect(buf.feed("\r")).toBe("ab");
	});

	// ── Bracketed paste ──

	test("bracketed paste content is discarded", () => {
		buf.feed("before");
		buf.feed("\x1b[200~pasted text\x1b[201~");
		expect(buf.feed("\r")).toBeNull(); // buffer cleared by paste end
	});

	test("typing after paste end is tracked", () => {
		buf.feed("\x1b[200~pasted\x1b[201~");
		buf.feed("after");
		expect(buf.feed("\r")).toBe("after");
	});

	// ── Bounds guards ──

	test("CSI params capped at 32 characters", () => {
		// Feed overlong CSI — params stop accumulating but parser stays in state 2.
		// 'A' (0x41) acts as the final byte, terminating the sequence.
		const longParams = "1".repeat(100);
		buf.feed(`\x1b[${longParams}A`);
		// Parser recovered — normal input works
		buf.feed("ok");
		expect(buf.feed("\r")).toBe("ok");
	});

	test("command buffer capped at 512 characters", () => {
		buf.feed("a".repeat(600));
		expect(buf.current.length).toBe(512);
		expect(buf.feed("\r")).toBe("a".repeat(512));
	});

	// ── Reset ──

	test("reset() clears all state", () => {
		buf.feed("partial");
		buf.feed("\x1b["); // start a CSI
		buf.reset();
		expect(buf.current).toBe("");
		buf.feed("clean");
		expect(buf.feed("\r")).toBe("clean");
	});

	// ── Mixed / integration ──

	test("interleaved sequences and typing", () => {
		buf.feed("g");
		buf.feed("\x1b[A"); // up arrow
		buf.feed("it");
		buf.feed("\x1b]0;title\x07"); // OSC title
		buf.feed(" push");
		expect(buf.feed("\r")).toBe("git push");
	});
});
