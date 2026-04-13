import { describe, expect, test } from "bun:test";
import { getHintItems } from "../src/renderer/components/ConflictHintBar";

describe("getHintItems", () => {
	test("sidebar zone returns navigation hints", () => {
		const items = getHintItems("sidebar", false, "merge");
		expect(items.map((i) => i.key)).toContain("j/k");
		expect(items.map((i) => i.key)).toContain("↵");
		expect(items.map((i) => i.key)).toContain("n");
	});

	test("nav zone returns hunk-accept hints", () => {
		const items = getHintItems("nav", false, "merge");
		expect(items.map((i) => i.key)).toContain("t");
		expect(items.map((i) => i.key)).toContain("b");
		expect(items.map((i) => i.key)).toContain("e");
	});

	test("edit zone returns only edit hints", () => {
		const items = getHintItems("edit", false, "merge");
		expect(items.map((i) => i.key)).toContain("⌘↵");
		expect(items.map((i) => i.key)).toContain("Esc");
		expect(items.every((i) => !["t", "b", "+"].includes(i.key))).toBe(true);
	});

	test("sidebar zone with allResolved shows commit hint", () => {
		const mergeItems = getHintItems("sidebar", true, "merge");
		expect(mergeItems.some((i) => i.label.includes("commit"))).toBe(true);
		const rebaseItems = getHintItems("sidebar", true, "rebase");
		expect(rebaseItems.some((i) => i.label.includes("rebase"))).toBe(true);
	});

	test("sidebar zone without allResolved does not show commit hint", () => {
		const items = getHintItems("sidebar", false, "rebase");
		expect(items.every((i) => !i.label.includes("rebase"))).toBe(true);
		const mergeItems = getHintItems("sidebar", false, "merge");
		expect(mergeItems.every((i) => !i.label.includes("commit"))).toBe(true);
	});

	test("nav zone hint items are same regardless of allResolved", () => {
		const notResolved = getHintItems("nav", false, "merge");
		const resolved = getHintItems("nav", true, "merge");
		expect(notResolved.map((i) => i.key)).toEqual(resolved.map((i) => i.key));
	});
});
