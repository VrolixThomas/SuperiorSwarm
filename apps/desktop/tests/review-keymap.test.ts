import { describe, expect, test } from "bun:test";
import { escapeTarget, mapReviewKey } from "../src/renderer/lib/review-keymap";

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

test("path layout owns its shortcuts and retires numbered views", () => {
	const event = (key: string, metaKey = false) => ({ key, metaKey, ctrlKey: false, altKey: false });
	expect(mapReviewKey(event("f"), "changes", { layout: "path" })).toBe("toggle-rail-mode");
	expect(mapReviewKey(event("/"), "changes", { layout: "path" })).toBe("ask-agent");
	expect(mapReviewKey(event("t"), "changes", { layout: "path" })).toBe("open-threads");
	expect(mapReviewKey(event("ArrowDown", true), "changes", { layout: "path" })).toBe("next-pr");
	expect(mapReviewKey(event("ArrowUp", true), "changes", { layout: "path" })).toBe("prev-pr");
	expect(mapReviewKey(event("1"), "changes", { layout: "path" })).toBeNull();
	expect(mapReviewKey(event("f"), "changes")).toBeNull();
});

test("Escape closes only the deepest review layer", () => {
	expect(
		escapeTarget({ composerOpen: true, panel: "ask", queueOpen: true, overviewOpen: true })
	).toBe("composer");
	expect(escapeTarget({ panel: "threads", queueOpen: true, overviewOpen: true })).toBe("panel");
	expect(escapeTarget({ queueOpen: true, overviewOpen: true })).toBe("queue");
	expect(escapeTarget({ overviewOpen: true })).toBe("overview");
	expect(escapeTarget({})).toBe("leave");
});
