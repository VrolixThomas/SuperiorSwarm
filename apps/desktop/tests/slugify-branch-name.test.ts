import { describe, expect, test } from "bun:test";
import { slugifyBranchName } from "../src/renderer/lib/slugify";

describe("slugifyBranchName", () => {
	test("basic identifier + title", () => {
		expect(slugifyBranchName("ENG-123", "Fix authentication bug")).toBe(
			"eng-123/fix-authentication-bug"
		);
	});

	test("lowercases identifier", () => {
		expect(slugifyBranchName("BUG-42", "Update readme")).toBe("bug-42/update-readme");
	});

	test("strips special characters from title", () => {
		expect(slugifyBranchName("ENG-1", "Fix: user's login (OAuth)")).toBe(
			"eng-1/fix-users-login-oauth"
		);
	});

	test("collapses multiple hyphens", () => {
		expect(slugifyBranchName("ENG-5", "Fix -- double dash")).toBe("eng-5/fix-double-dash");
	});

	test("truncates long title slug to 50 chars", () => {
		const long = "a".repeat(60);
		const result = slugifyBranchName("ENG-1", long);
		const slug = result.split("/")[1]!;
		expect(slug.length).toBeLessThanOrEqual(50);
	});

	test("trims trailing hyphens after truncation", () => {
		// Title that would end with a hyphen after truncation
		const title = "a".repeat(49) + " b";
		const result = slugifyBranchName("ENG-1", title);
		expect(result.endsWith("-")).toBe(false);
	});
});
