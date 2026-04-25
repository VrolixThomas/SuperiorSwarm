import { describe, expect, test } from "bun:test";
import { shouldSkipShortcutHandling } from "../src/renderer/hooks/useShortcutListener";

function evt(
	key: string,
	extras: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">> = {}
): KeyboardEvent {
	return {
		key,
		metaKey: extras.metaKey ?? false,
		ctrlKey: extras.ctrlKey ?? false,
		altKey: extras.altKey ?? false,
	} as KeyboardEvent;
}

function fakeElement(tag: "TEXTAREA" | "INPUT" | "DIV" | "SELECT"): HTMLElement {
	return {
		tagName: tag,
		classList: { contains: () => false },
		closest: () => null,
	} as unknown as HTMLElement;
}

describe("shouldSkipShortcutHandling", () => {
	test("plain Escape in a textarea IS skipped (Monaco handles its own Esc via onKeyDown)", () => {
		expect(shouldSkipShortcutHandling(evt("Escape"), fakeElement("TEXTAREA"))).toBe(true);
	});

	test("plain 'j' in a textarea IS skipped", () => {
		expect(shouldSkipShortcutHandling(evt("j"), fakeElement("TEXTAREA"))).toBe(true);
	});

	test("plain 'j' in an INPUT IS skipped", () => {
		expect(shouldSkipShortcutHandling(evt("j"), fakeElement("INPUT"))).toBe(true);
	});

	test("plain 'j' in a SELECT IS skipped", () => {
		expect(shouldSkipShortcutHandling(evt("j"), fakeElement("SELECT"))).toBe(true);
	});

	test("plain 'j' outside any input is NOT skipped", () => {
		expect(shouldSkipShortcutHandling(evt("j"), fakeElement("DIV"))).toBe(false);
	});

	test("Cmd+j in a textarea is NOT skipped (modifier shortcuts pass through)", () => {
		expect(shouldSkipShortcutHandling(evt("j", { metaKey: true }), fakeElement("TEXTAREA"))).toBe(
			false
		);
	});

	test("Ctrl+j in a textarea is NOT skipped (modifier shortcuts pass through)", () => {
		expect(shouldSkipShortcutHandling(evt("j", { ctrlKey: true }), fakeElement("TEXTAREA"))).toBe(
			false
		);
	});

	test("Alt+j in a textarea IS skipped (altKey alone does not bypass skip)", () => {
		expect(shouldSkipShortcutHandling(evt("j", { altKey: true }), fakeElement("TEXTAREA"))).toBe(
			true
		);
	});

	test("Escape with Cmd in a textarea is NOT skipped", () => {
		expect(
			shouldSkipShortcutHandling(evt("Escape", { metaKey: true }), fakeElement("TEXTAREA"))
		).toBe(false);
	});

	test("null target returns false (not skipped)", () => {
		expect(shouldSkipShortcutHandling(evt("j"), null)).toBe(false);
	});

	test("plain Escape outside input is NOT skipped", () => {
		expect(shouldSkipShortcutHandling(evt("Escape"), fakeElement("DIV"))).toBe(false);
	});
});
