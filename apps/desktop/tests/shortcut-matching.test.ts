import { describe, expect, test } from "bun:test";
import { matchesShortcut } from "../src/renderer/hooks/useShortcutListener";
import type { Shortcut } from "../src/renderer/stores/action-store";

function fakeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
	return {
		key: "",
		code: "",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...overrides,
	} as KeyboardEvent;
}

describe("matchesShortcut", () => {
	test("matches Cmd+K", () => {
		const shortcut: Shortcut = { key: "k", meta: true };
		const event = fakeEvent({ key: "k", metaKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("rejects when meta not pressed", () => {
		const shortcut: Shortcut = { key: "k", meta: true };
		const event = fakeEvent({ key: "k", metaKey: false });
		expect(matchesShortcut(event, shortcut)).toBe(false);
	});

	test("matches Cmd+Shift+B", () => {
		const shortcut: Shortcut = { key: "b", meta: true, shift: true };
		const event = fakeEvent({ key: "b", metaKey: true, shiftKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("rejects when shift not pressed", () => {
		const shortcut: Shortcut = { key: "b", meta: true, shift: true };
		const event = fakeEvent({ key: "b", metaKey: true, shiftKey: false });
		expect(matchesShortcut(event, shortcut)).toBe(false);
	});

	test("matches Cmd+Option+ArrowLeft", () => {
		const shortcut: Shortcut = { key: "ArrowLeft", meta: true, alt: true };
		const event = fakeEvent({ key: "ArrowLeft", metaKey: true, altKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("matches by e.code when key differs (Backslash)", () => {
		const shortcut: Shortcut = { key: "Backslash", meta: true };
		const event = fakeEvent({ key: "\\", code: "Backslash", metaKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("matches Ctrl as meta on non-macOS", () => {
		const shortcut: Shortcut = { key: "k", meta: true };
		const event = fakeEvent({ key: "k", ctrlKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("rejects extra alt when not expected", () => {
		const shortcut: Shortcut = { key: "k", meta: true };
		const event = fakeEvent({ key: "k", metaKey: true, altKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(false);
	});

	test("rejects extra shift when not expected", () => {
		const shortcut: Shortcut = { key: "k", meta: true };
		const event = fakeEvent({ key: "k", metaKey: true, shiftKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(false);
	});

	test("matches Cmd+Enter", () => {
		const shortcut: Shortcut = { key: "Enter", meta: true };
		const event = fakeEvent({ key: "Enter", metaKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("matches Cmd+, (comma)", () => {
		const shortcut: Shortcut = { key: ",", meta: true };
		const event = fakeEvent({ key: ",", metaKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("matches Cmd+1", () => {
		const shortcut: Shortcut = { key: "1", meta: true };
		const event = fakeEvent({ key: "1", metaKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});

	test("matches Cmd+Shift+] via code", () => {
		const shortcut: Shortcut = { key: "BracketRight", meta: true, shift: true };
		const event = fakeEvent({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true });
		expect(matchesShortcut(event, shortcut)).toBe(true);
	});
});
