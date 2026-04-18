import "./preload-electron-mock";
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/main/db";

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

describe("lsp dismiss-language store", () => {
	test("returns empty list before any dismissal", async () => {
		const { getDismissedLanguages } = await import("../src/main/lsp/dismissed-languages");
		// Clear any prior state
		const { undismissLanguage } = await import("../src/main/lsp/dismissed-languages");
		undismissLanguage("typescript");
		const result = getDismissedLanguages();
		expect(result).not.toContain("typescript");
	});

	test("dismissLanguage persists and getDismissedLanguages lists it", async () => {
		const { dismissLanguage, getDismissedLanguages, undismissLanguage } = await import(
			"../src/main/lsp/dismissed-languages"
		);
		undismissLanguage("python");
		dismissLanguage("python");
		expect(getDismissedLanguages()).toContain("python");
	});

	test("dismissing twice is idempotent", async () => {
		const { dismissLanguage, getDismissedLanguages, undismissLanguage } = await import(
			"../src/main/lsp/dismissed-languages"
		);
		undismissLanguage("go");
		dismissLanguage("go");
		dismissLanguage("go");
		const count = getDismissedLanguages().filter((l) => l === "go").length;
		expect(count).toBe(1);
	});

	test("undismissLanguage removes the entry", async () => {
		const { dismissLanguage, getDismissedLanguages, undismissLanguage } = await import(
			"../src/main/lsp/dismissed-languages"
		);
		dismissLanguage("rust");
		expect(getDismissedLanguages()).toContain("rust");
		undismissLanguage("rust");
		expect(getDismissedLanguages()).not.toContain("rust");
	});
});
