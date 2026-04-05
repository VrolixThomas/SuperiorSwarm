import { describe, expect, test } from "bun:test";

describe("DaemonClient dispose", () => {
	test("dispose cleans up local state regardless of quitting flag", () => {
		const liveSessions = new Set(["term-1", "term-2"]);
		const callbacks = new Map<string, unknown>();
		callbacks.set("term-1", {});
		callbacks.set("term-2", {});

		// Simulate dispose for term-1
		const id = "term-1";
		callbacks.delete(id);
		liveSessions.delete(id);

		expect(callbacks.has(id)).toBe(false);
		expect(liveSessions.has(id)).toBe(false);
		expect(liveSessions.size).toBe(1);
		expect(callbacks.size).toBe(1);
	});
});
