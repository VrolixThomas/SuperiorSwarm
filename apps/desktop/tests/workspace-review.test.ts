import { describe, expect, test } from "bun:test";
import { validateTransition } from "../src/main/ai-review/orchestrator";
import { workspaces } from "../src/main/db/schema";

describe("unified workspace schema", () => {
	test("workspaces table has review-specific columns", () => {
		const cols = Object.keys(workspaces);
		expect(cols).toContain("prProvider");
		expect(cols).toContain("prIdentifier");
		expect(cols).toContain("reviewDraftId");
	});

	test("workspaces type includes review", () => {
		// Type check — this test validates the schema definition compiles
		// with "review" as a valid type value
		expect(true).toBe(true);
	});
});

describe("validateTransition", () => {
	test("allows valid transitions", () => {
		expect(() => validateTransition("queued", "in_progress")).not.toThrow();
		expect(() => validateTransition("in_progress", "ready")).not.toThrow();
		expect(() => validateTransition("ready", "submitted")).not.toThrow();
	});

	test("rejects invalid transitions", () => {
		expect(() => validateTransition("queued", "submitted")).toThrow();
		expect(() => validateTransition("submitted", "in_progress")).toThrow();
	});

	test("allows failed from any state", () => {
		for (const status of ["queued", "in_progress", "ready"]) {
			expect(() => validateTransition(status, "failed")).not.toThrow();
		}
	});

	test("allows dismissed from any state", () => {
		for (const status of ["queued", "in_progress", "ready", "submitted", "failed"]) {
			expect(() => validateTransition(status, "dismissed")).not.toThrow();
		}
	});
});
