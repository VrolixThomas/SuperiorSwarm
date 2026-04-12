import { describe, expect, test } from "bun:test";
import { validateTransition } from "../src/main/ai-review/orchestrator";

describe("review state machine with cancelled status", () => {
	test("allows cancelled from queued", () => {
		expect(() => validateTransition("queued", "cancelled")).not.toThrow();
	});

	test("allows cancelled from in_progress", () => {
		expect(() => validateTransition("in_progress", "cancelled")).not.toThrow();
	});

	test("allows dismissed from cancelled", () => {
		expect(() => validateTransition("cancelled", "dismissed")).not.toThrow();
	});

	test("rejects cancelled from ready", () => {
		expect(() => validateTransition("ready", "cancelled")).toThrow();
	});

	test("rejects cancelled from submitted", () => {
		expect(() => validateTransition("submitted", "cancelled")).toThrow();
	});

	test("rejects in_progress from cancelled", () => {
		expect(() => validateTransition("cancelled", "in_progress")).toThrow();
	});

	// Existing transitions still work
	test("preserves existing valid transitions", () => {
		expect(() => validateTransition("queued", "in_progress")).not.toThrow();
		expect(() => validateTransition("in_progress", "ready")).not.toThrow();
		expect(() => validateTransition("ready", "submitted")).not.toThrow();
		expect(() => validateTransition("failed", "queued")).not.toThrow();
	});
});
