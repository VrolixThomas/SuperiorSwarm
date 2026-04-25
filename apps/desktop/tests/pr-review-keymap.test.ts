import { describe, expect, test } from "bun:test";
import { type PRReviewAction, mapKey } from "../src/renderer/lib/pr-review-keymap";

function ev(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
	return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("pr-review-keymap", () => {
	test("j and k map to file nav", () => {
		expect(mapKey(ev({ key: "j" }))).toBe("file-next");
		expect(mapKey(ev({ key: "k" }))).toBe("file-prev");
	});

	test("v toggles viewed", () => {
		expect(mapKey(ev({ key: "v" }))).toBe("toggle-viewed");
	});

	test("c starts new comment", () => {
		expect(mapKey(ev({ key: "c" }))).toBe("new-comment");
	});

	test("Escape clears active state", () => {
		expect(mapKey(ev({ key: "Escape" }))).toBe("escape");
	});

	test("unmapped key returns null", () => {
		expect(mapKey(ev({ key: "x" }))).toBeNull();
		expect(mapKey(ev({ key: "n" }))).toBeNull();
		expect(mapKey(ev({ key: "r" }))).toBeNull();
		expect(mapKey(ev({ key: "e" }))).toBeNull();
		expect(mapKey(ev({ key: "S", shiftKey: true }))).toBeNull();
		expect(mapKey(ev({ key: "Enter", metaKey: true }))).toBeNull();
		expect(mapKey(ev({ key: "j", metaKey: true }))).toBeNull();
		expect(mapKey(ev({ key: "j", ctrlKey: true }))).toBeNull();
		expect(mapKey(ev({ key: "j", altKey: true }))).toBeNull();
	});

	// Compile-time exhaustiveness: a `never` assignment in the default arm
	// fails the build if any `PRReviewAction` variant is unhandled here.
	test("every PRReviewAction has a label (exhaustive at compile time)", () => {
		const label = (a: PRReviewAction): string => {
			switch (a) {
				case "file-next":
				case "file-prev":
				case "toggle-viewed":
				case "new-comment":
				case "escape":
					return a;
				default: {
					const _never: never = a;
					return _never;
				}
			}
		};
		expect(label("file-next")).toBe("file-next");
	});
});
