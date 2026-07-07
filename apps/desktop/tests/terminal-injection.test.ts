import { describe, expect, test } from "bun:test";
import { bracketedPasteSubmit } from "../src/shared/terminal-injection";

describe("bracketedPasteSubmit", () => {
	test("wraps text in bracketed paste sequences and appends a single CR", () => {
		expect(bracketedPasteSubmit("hello")).toBe("\x1b[200~hello\x1b[201~\r");
	});

	test("interior newlines stay inside the paste block (no premature submit)", () => {
		const out = bracketedPasteSubmit("line1\nline2");
		expect(out).toBe("\x1b[200~line1\nline2\x1b[201~\r");
		expect(out.indexOf("\r")).toBe(out.length - 1);
	});

	test("raw paste-end sequence embedded in text cannot terminate the paste early", () => {
		const malicious = "before\x1b[201~after";
		const out = bracketedPasteSubmit(malicious);
		// Exactly one occurrence of the paste-end marker: the wrapper's own, at the end.
		expect(out.split("\x1b[201~").length - 1).toBe(1);
		expect(out.endsWith("\x1b[201~\r")).toBe(true);
		expect(out).toBe("\x1b[200~before[201~after\x1b[201~\r");
	});

	test("raw ESC and BEL bytes are stripped while printable content is preserved", () => {
		const out = bracketedPasteSubmit("a\x1bb\x07c");
		expect(out).toBe("\x1b[200~abc\x1b[201~\r");
	});

	test("empty-string input returns just the wrapper and trailing CR", () => {
		expect(bracketedPasteSubmit("")).toBe("\x1b[200~\x1b[201~\r");
	});
});
