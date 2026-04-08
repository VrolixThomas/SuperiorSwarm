import "./preload-electron-mock";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/main/db";
import { sessionState } from "../src/main/db/schema";
import {
	extractReleaseSummary,
	getDismissedUpdateVersion,
	getVersionDiffType,
	setDismissedUpdateVersion,
} from "../src/main/updater";

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

describe("dismissed update version", () => {
	beforeAll(() => {
		const db = getDb();
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	});

	beforeEach(() => {
		const db = getDb();
		db.delete(sessionState).where(eq(sessionState.key, "dismissedUpdateVersion")).run();
	});

	test("stores and retrieves dismissed update version", () => {
		setDismissedUpdateVersion("2.1.0");
		expect(getDismissedUpdateVersion()).toBe("2.1.0");
	});

	test("clears dismissed update version", () => {
		setDismissedUpdateVersion(null);
		expect(getDismissedUpdateVersion()).toBeNull();
	});
});
