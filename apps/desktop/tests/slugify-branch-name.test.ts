import { describe, expect, test } from "bun:test";
import { slugifyBranchName, slugifyTicketBranchSuffix } from "../src/renderer/lib/slugify";

describe("slugifyBranchName", () => {
	test("basic identifier + title", () => {
		expect(slugifyBranchName("ENG-123", "Fix authentication bug")).toBe(
			"feature/ENG-123-fix-authentication-bug"
		);
	});

	test("keeps the board prefix uppercase", () => {
		expect(slugifyBranchName("pi-42", "Update readme")).toBe("feature/PI-42-update-readme");
	});

	test("supports an explicit branch type", () => {
		expect(slugifyBranchName("BUG-42", "Fix login", "bugfix")).toBe("bugfix/BUG-42-fix-login");
	});

	test("strips special characters from title", () => {
		expect(slugifyBranchName("ENG-1", "Fix: user's login (OAuth)")).toBe(
			"feature/ENG-1-fix-users-login-oauth"
		);
	});

	test("collapses multiple hyphens", () => {
		expect(slugifyBranchName("ENG-5", "Fix -- double dash")).toBe("feature/ENG-5-fix-double-dash");
	});

	test("truncates long title slug to 50 chars", () => {
		const long = "a".repeat(60);
		const suffix = slugifyTicketBranchSuffix("ENG-1", long);
		const slug = suffix.slice("ENG-1-".length);
		expect(slug.length).toBeLessThanOrEqual(50);
	});

	test("trims trailing hyphens after truncation", () => {
		// Title that would end with a hyphen after truncation
		const title = `${"a".repeat(49)} b`;
		const result = slugifyBranchName("ENG-1", title);
		expect(result.endsWith("-")).toBe(false);
	});

	test("sanitizes malformed identifiers before uppercasing them", () => {
		expect(slugifyTicketBranchSuffix(" pi  99 ", "Ship it")).toBe("PI-99-ship-it");
	});
});
