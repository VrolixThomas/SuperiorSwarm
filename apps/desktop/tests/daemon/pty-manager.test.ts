import { describe, expect, test } from "bun:test";
import { trimBuffer } from "../../src/daemon/pty-manager";

describe("trimBuffer", () => {
	test("returns buffer unchanged when under limit", () => {
		expect(trimBuffer("hello", 100)).toBe("hello");
	});

	test("trims to last maxBytes when over limit", () => {
		const big = "a".repeat(300);
		const result = trimBuffer(big, 200);
		expect(result.length).toBe(200);
		expect(result).toBe("a".repeat(200));
	});

	test("handles empty string", () => {
		expect(trimBuffer("", 100)).toBe("");
	});

	test("preserves tail content, not head", () => {
		const input = `HEADER${"x".repeat(100)}`;
		const result = trimBuffer(input, 50);
		expect(result.startsWith("HEADER")).toBe(false);
		expect(result).toBe("x".repeat(50));
	});
});
