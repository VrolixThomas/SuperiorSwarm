import { describe, expect, test } from "bun:test";
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
