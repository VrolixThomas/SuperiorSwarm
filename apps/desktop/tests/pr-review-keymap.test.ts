import { describe, expect, test } from "bun:test";
import { mapKey, type PRReviewAction } from "../src/renderer/lib/pr-review-keymap";

function ev(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
	return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("pr-review-keymap", () => {
	test("j and k map to file nav", () => {
		expect(mapKey(ev({ key: "j" }))).toBe("file-next");
		expect(mapKey(ev({ key: "k" }))).toBe("file-prev");
	});

	test("n and N map to thread nav", () => {
		expect(mapKey(ev({ key: "n" }))).toBe("thread-next");
		expect(mapKey(ev({ key: "N", shiftKey: true }))).toBe("thread-prev");
	});

	test("v toggles viewed", () => {
		expect(mapKey(ev({ key: "v" }))).toBe("toggle-viewed");
	});

	test("c starts new comment", () => {
		expect(mapKey(ev({ key: "c" }))).toBe("new-comment");
	});

	test("r and R differ", () => {
		expect(mapKey(ev({ key: "r" }))).toBe("reply");
		expect(mapKey(ev({ key: "R", shiftKey: true }))).toBe("resolve");
	});

	test("a, d, e map to AI thread actions", () => {
		expect(mapKey(ev({ key: "a" }))).toBe("ai-accept");
		expect(mapKey(ev({ key: "d" }))).toBe("ai-decline");
		expect(mapKey(ev({ key: "e" }))).toBe("ai-edit");
	});

	test("Escape clears active state", () => {
		expect(mapKey(ev({ key: "Escape" }))).toBe("escape");
	});

	test("S opens overview", () => {
		expect(mapKey(ev({ key: "S", shiftKey: true }))).toBe("open-overview");
	});

	test("Cmd+Enter submits, plain Enter does not", () => {
		expect(mapKey(ev({ key: "Enter", metaKey: true }))).toBe("submit-review");
		expect(mapKey(ev({ key: "Enter" }))).toBeNull();
	});

	test("? toggles shortcut overlay", () => {
		expect(mapKey(ev({ key: "?", shiftKey: true }))).toBe("toggle-shortcuts");
	});

	test("unmapped key returns null", () => {
		expect(mapKey(ev({ key: "x" }))).toBeNull();
		expect(mapKey(ev({ key: "j", metaKey: true }))).toBeNull();
		expect(mapKey(ev({ key: "j", ctrlKey: true }))).toBeNull();
		expect(mapKey(ev({ key: "j", altKey: true }))).toBeNull();
	});

	const _exhaustive: PRReviewAction = "file-next";
	void _exhaustive;
});
