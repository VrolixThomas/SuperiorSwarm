import "../preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { getDb } from "../../src/main/db";

beforeAll(() => {
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
});

test("memory_fts virtual table exists", () => {
	const db = getDb();
	const rows = db.$client
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'"
		)
		.all();
	expect(rows.length).toBe(1);
});

test("memory_goals table exists", () => {
	const db = getDb();
	const rows = db.$client
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='memory_goals'"
		)
		.all();
	expect(rows.length).toBe(1);
});
