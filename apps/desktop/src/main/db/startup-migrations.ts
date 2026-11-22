import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type * as schema from "./schema";

const reviewTables = ["review_path_documents", "review_path_preferences"] as const;

export function migrateDatabase(
	db: BetterSQLite3Database<typeof schema>,
	migrationsFolder: string
): void {
	migrate(db, { migrationsFolder });
	// Drizzle compares only the highest ledger timestamp. A newer migration
	// from another branch can therefore hide this branch's additive tables.
	// Repair only these known tables, never rewind history or replay other SQL.
	db.transaction(() => {
		const existing = db.all<{ name: string }>(sql`
			SELECT name FROM sqlite_master WHERE type = 'table'
			AND name IN ('review_path_documents', 'review_path_preferences')
		`);
		const missing = reviewTables.filter((name) => !existing.some((row) => row.name === name));
		if (missing.length === 0) return;
		const statements = readFileSync(
			join(migrationsFolder, "0065_add_review_path_persistence.sql"),
			"utf8"
		)
			.split("--> statement-breakpoint")
			.map((statement) => statement.trim());
		for (const name of missing) {
			// Use the shipped canonical DDL, with an exact per-table allowlist.
			// Existing tables (including future extra columns) and rows stay untouched.
			const prefix = `CREATE TABLE \`${name}\` (`;
			const statement = statements.find((candidate) => candidate.startsWith(prefix));
			if (!statement) throw new Error(`Missing canonical startup schema for ${name}`);
			db.run(sql.raw(statement.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ")));
		}
	});
}
