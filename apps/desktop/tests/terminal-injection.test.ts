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
});
