import { describe, expect, test } from "bun:test";
import { mapReviewKey } from "../src/renderer/lib/review-keymap";

const ev = (
	key: string,
	mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}
) => ({
	key,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	...mods,
});

describe("mapReviewKey", () => {
	test("view switching everywhere", () => {
		expect(mapReviewKey(ev("1"), "changes")).toBe("view-overview");
		expect(mapReviewKey(ev("2"), "overview")).toBe("view-changes");
		expect(mapReviewKey(ev("3"), "comments")).toBe("view-comments");
	});
	test("j/k are contextual", () => {
		expect(mapReviewKey(ev("j"), "changes")).toBe("next");
		expect(mapReviewKey(ev("k"), "comments")).toBe("prev");
	});
	test("changes-only keys", () => {
		expect(mapReviewKey(ev("v"), "changes")).toBe("toggle-viewed");
		expect(mapReviewKey(ev("c"), "changes")).toBe("new-comment");
		expect(mapReviewKey(ev("n"), "changes")).toBe("next-thread");
		expect(mapReviewKey(ev("p"), "changes")).toBe("prev-thread");
		expect(mapReviewKey(ev("o"), "changes")).toBe("open-in-comments");
		expect(mapReviewKey(ev("v"), "comments")).toBeNull();
	});
	test("comments-only triage keys", () => {
		expect(mapReviewKey(ev("a"), "comments")).toBe("accept");
		expect(mapReviewKey(ev("x"), "comments")).toBe("decline");
		expect(mapReviewKey(ev("e"), "comments")).toBe("edit");
		expect(mapReviewKey(ev("r"), "comments")).toBe("reply");
		expect(mapReviewKey(ev("o"), "comments")).toBe("open-in-changes");
		expect(mapReviewKey(ev("a"), "changes")).toBeNull();
	});
	test("escape everywhere, modifiers ignored", () => {
		expect(mapReviewKey(ev("Escape"), "overview")).toBe("escape");
		expect(mapReviewKey(ev("j", { metaKey: true }), "changes")).toBeNull();
	});
});
