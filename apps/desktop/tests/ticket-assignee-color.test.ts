import { describe, expect, test } from "bun:test";
import { assigneeColorFromId } from "../src/shared/tickets";

describe("assigneeColorFromId", () => {
	test("returns consistent color for same id", () => {
		const color1 = assigneeColorFromId("user-abc");
		const color2 = assigneeColorFromId("user-abc");
		expect(color1).toBe(color2);
	});

	test("returns a hex color string", () => {
		const color = assigneeColorFromId("user-123");
		expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
	});

	test("returns different colors for different ids", () => {
		const colors = new Set([
			assigneeColorFromId("user-a"),
			assigneeColorFromId("user-b"),
			assigneeColorFromId("user-c"),
			assigneeColorFromId("user-d"),
		]);
		expect(colors.size).toBeGreaterThan(1);
	});

	test("returns fallback color for null/undefined", () => {
		const color = assigneeColorFromId(null);
		expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
	});
});
