import "./preload-electron-mock";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "../src/main/db/schema";
import { migrateDatabase } from "../src/main/db/startup-migrations";
import { makeRawTestDb } from "./test-db";

const folder = join(import.meta.dir, "../src/main/db/migrations");
const foundTarget = readMigrationFiles({ migrationsFolder: folder }).find((migration) =>
	migration.sql.some((statement) =>
		statement.trim().startsWith("CREATE TABLE `review_path_documents`")
	)
);
if (!foundTarget) throw new Error("Missing canonical migration fixture");
const target = foundTarget;
const handles: Database.Database[] = [];
afterEach(() => {
	for (const raw of handles.splice(0)) raw.close();
});
function fixture(fresh = false) {
	const raw = fresh ? new Database(":memory:") : makeRawTestDb();
	handles.push(raw);
	raw.pragma("foreign_keys = ON");
	const db = drizzle(raw, { schema });
	return { raw, start: () => migrateDatabase(db, folder) };
}
function ledger(raw: Database.Database) {
	return raw.prepare("SELECT rowid, * FROM __drizzle_migrations ORDER BY rowid").all();
}
function newerBranch(raw: Database.Database, retainTarget = false) {
	if (!retainTarget)
		raw.prepare("DELETE FROM __drizzle_migrations WHERE hash = ?").run(target.hash);
	raw
		.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
		.run("unrelated-branch-a", target.folderMillis - 100);
	raw
		.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
		.run("unrelated-branch-b", target.folderMillis + 100);
	raw.exec("CREATE TABLE branch_owned_data (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
	raw.prepare("INSERT INTO branch_owned_data VALUES (?, ?)").run("user-row", "preserve exactly");
}
function tables(raw: Database.Database) {
	return raw
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE name IN ('review_path_documents', 'review_path_preferences') ORDER BY name"
		)
		.all();
}
function documents(raw: Database.Database) {
	const now = new Date();
	const db = drizzle(raw, { schema });
	db.insert(schema.projects)
		.values({
			id: "fixture-project",
			name: "Fixture",
			repoPath: "/fixture",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.workspaces)
		.values({
			id: "fixture-workspace",
			projectId: "fixture-project",
			name: "Fixture",
			type: "review",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	raw
		.prepare("INSERT INTO review_path_documents VALUES (?, ?, ?)")
		.run("document", "fixture-workspace", "preserved document");
}

describe("startup migration branch compatibility", () => {
	test("fresh database uses the canonical migration and records its history", () => {
		const { raw, start } = fixture(true);
		start();
		expect(tables(raw)).toHaveLength(2);
		expect(ledger(raw)).toContainEqual(
			expect.objectContaining({ hash: target.hash, created_at: target.folderMillis })
		);
	});
	test("newer mixed-branch watermark cannot skip required review-path tables", () => {
		const { raw, start } = fixture();
		const canonical = tables(raw);
		raw.exec("DROP TABLE review_path_documents; DROP TABLE review_path_preferences");
		newerBranch(raw);
		const before = ledger(raw);
		start();
		expect(tables(raw)).toEqual(canonical);
		expect(ledger(raw)).toEqual(before);
		expect(raw.prepare("SELECT * FROM branch_owned_data").all()).toEqual([
			{ id: "user-row", payload: "preserve exactly" },
		]);
		start();
		expect(ledger(raw)).toEqual(before);
	});
	test("partial schema preserves an existing document and restores preferences", () => {
		const { raw, start } = fixture();
		documents(raw);
		raw.exec("DROP TABLE review_path_preferences");
		newerBranch(raw);
		const before = ledger(raw);
		start();
		expect(tables(raw)).toHaveLength(2);
		expect(raw.prepare("SELECT payload FROM review_path_documents").get()).toEqual({
			payload: "preserved document",
		});
		expect(ledger(raw)).toEqual(before);
	});
	test("partial schema preserves preferences and restores document constraints", () => {
		const { raw, start } = fixture();
		raw
			.prepare("INSERT INTO review_path_preferences VALUES (?, ?)")
			.run("settings", "preserved preferences");
		raw.exec("DROP TABLE review_path_documents");
		newerBranch(raw);
		start();
		expect(raw.prepare("SELECT * FROM review_path_preferences").get()).toEqual({
			key: "settings",
			payload: "preserved preferences",
		});
		expect(() =>
			raw
				.prepare("INSERT INTO review_path_documents VALUES (?, ?, ?)")
				.run("orphan", "missing", "payload")
		).toThrow("FOREIGN KEY");
		documents(raw);
		raw.prepare("DELETE FROM workspaces WHERE id = ?").run("fixture-workspace");
		expect(raw.prepare("SELECT * FROM review_path_documents").all()).toEqual([]);
	});
	test("recorded canonical hash does not conceal missing schema and history stays untouched", () => {
		const { raw, start } = fixture();
		raw.exec("DROP TABLE review_path_documents; DROP TABLE review_path_preferences");
		newerBranch(raw, true);
		const before = ledger(raw);
		start();
		expect(tables(raw)).toHaveLength(2);
		expect(ledger(raw)).toEqual(before);
	});

	test("existing future schema columns and their contents are not replaced", () => {
		const { raw, start } = fixture();
		raw.exec("ALTER TABLE review_path_preferences ADD COLUMN future_payload TEXT");
		raw
			.prepare("INSERT INTO review_path_preferences VALUES (?, ?, ?)")
			.run("settings", "preserved preferences", "future branch data");
		raw.exec("DROP TABLE review_path_documents");
		newerBranch(raw);
		const before = ledger(raw);
		start();
		expect(raw.prepare("SELECT * FROM review_path_preferences").get()).toEqual({
			key: "settings",
			payload: "preserved preferences",
			future_payload: "future branch data",
		});
		expect(ledger(raw)).toEqual(before);
	});
	test("repair is atomic when the shipped canonical schema is incomplete", () => {
		const { raw } = fixture();
		raw.exec("DROP TABLE review_path_documents; DROP TABLE review_path_preferences");
		newerBranch(raw);
		const before = ledger(raw);
		const incomplete = mkdtempSync(join(tmpdir(), "ss-startup-schema-"));
		try {
			mkdirSync(join(incomplete, "meta"));
			writeFileSync(join(incomplete, "meta/_journal.json"), JSON.stringify({ entries: [] }));
			const migration = "0065_add_review_path_persistence.sql";
			writeFileSync(
				join(incomplete, migration),
				readFileSync(join(folder, migration), "utf8").split("--> statement-breakpoint")[0] ?? ""
			);
			expect(() => migrateDatabase(drizzle(raw, { schema }), incomplete)).toThrow(
				"Missing canonical startup schema"
			);
			expect(tables(raw)).toEqual([]);
			expect(ledger(raw)).toEqual(before);
		} finally {
			rmSync(incomplete, { recursive: true, force: true });
		}
	});
	test("healthy databases retain existing review data across repeated startup", () => {
		const { raw, start } = fixture();
		documents(raw);
		raw
			.prepare("INSERT INTO review_path_preferences VALUES (?, ?)")
			.run("settings", "preserved preferences");
		const before = ledger(raw);
		start();
		start();
		expect(raw.prepare("SELECT payload FROM review_path_documents").get()).toEqual({
			payload: "preserved document",
		});
		expect(raw.prepare("SELECT payload FROM review_path_preferences").get()).toEqual({
			payload: "preserved preferences",
		});
		expect(ledger(raw)).toEqual(before);
	});
});
