import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/main/db/schema";

describe("Hermes persistence migration", () => {
	test("registers secure connections, deterministic workspace links, and report delivery state", () => {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });

		const tableNames = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all()
			.map((row) => (row as { name: string }).name);

		expect(tableNames).toContain("hermes_connections");
		expect(tableNames).toContain("hermes_session_workspaces");
		expect(tableNames).toContain("hermes_origin_reports");

		const indexes = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(indexes).toContain("hermes_session_workspaces_unique");
		expect(indexes).toContain("hermes_origin_reports_unique");

		sqlite.close();
	});
});
