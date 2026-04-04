import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { extractReleaseSummary, getVersionDiffType } from "../src/main/updater";

describe("getVersionDiffType", () => {
	test("returns 'major' for major version bump", () => {
		expect(getVersionDiffType("1.0.0", "2.0.0")).toBe("major");
	});

	test("returns 'minor' for minor version bump", () => {
		expect(getVersionDiffType("1.0.0", "1.1.0")).toBe("minor");
	});

	test("returns 'patch' for patch version bump", () => {
		expect(getVersionDiffType("1.0.0", "1.0.1")).toBe("patch");
	});

	test("returns null when versions are the same", () => {
		expect(getVersionDiffType("1.0.0", "1.0.0")).toBeNull();
	});

	test("returns null for invalid versions", () => {
		expect(getVersionDiffType("not-a-version", "1.0.0")).toBeNull();
	});
});

describe("extractReleaseSummary", () => {
	test("extracts first non-heading line as summary", () => {
		const md =
			"## What's New\n\nWorkspace templates and Linear integration.\n\n### Details\nMore text.";
		expect(extractReleaseSummary(md)).toBe("Workspace templates and Linear integration.");
	});

	test("returns null for empty body", () => {
		expect(extractReleaseSummary("")).toBeNull();
		expect(extractReleaseSummary(null)).toBeNull();
	});

	test("truncates long summaries", () => {
		const long = "A".repeat(200);
		const result = extractReleaseSummary(long);
		expect(result!.length).toBeLessThanOrEqual(120);
		expect(result!.endsWith("...")).toBe(true);
	});
});
