import "./preload-electron-mock";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/main/db/schema";
import { migrateDatabase } from "../src/main/db/startup-migrations";
const mergedFolder = join(import.meta.dir, "../src/main/db/migrations");
function historicalMigrations(ref: string) {
	const dir = mkdtempSync(join(tmpdir(), "ss-merge-migrations-"));
	mkdirSync(join(dir, "meta"));
	// Reconstruct the two shipped histories from their unchanged canonical SQL.
	// No Git history/network dependency: this also works in shallow CI checkouts.
	const journal = JSON.parse(readFileSync(join(mergedFolder, "meta/_journal.json"), "utf8"));
	journal.entries = (journal.entries as { tag: string; idx: number }[])
		.filter(({ tag }) =>
			ref === "0adb8d00"
				? Number.parseInt(tag, 10) <= 74 && tag !== "0065_add_review_path_persistence"
				: Number.parseInt(tag, 10) <= 64 || tag === "0065_add_review_path_persistence"
		)
		.map((entry, idx) => ({ ...entry, idx }));
	writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
	for (const { tag } of journal.entries as { tag: string }[]) {
		writeFileSync(join(dir, `${tag}.sql`), readFileSync(join(mergedFolder, `${tag}.sql`)));
	}
	return dir;
}
for (const [name, ref, ownedTable] of [
	["queue branch", "0adb8d00", "activity_queue_sources"],
	["main review branch", "4f2d7bc2", "review_path_preferences"],
] as const) {
	test(`upgrade from ${name} retains data and installs both schemas`, () => {
		const old = historicalMigrations(ref);
		const raw = new Database(":memory:");
		try {
			raw.pragma("foreign_keys = ON");
			const db = drizzle(raw, { schema });
			migrate(db, { migrationsFolder: old });
			const before = raw.prepare("SELECT hash, created_at FROM __drizzle_migrations").all();
			if (ownedTable === "activity_queue_sources")
				raw
					.prepare(
						"INSERT INTO activity_queue_sources (source_id,source_type,snapshot,fingerprint,revision,acknowledged_revision,observed_at) VALUES (?,?,?,?,?,?,?)"
					)
					.run("kept", "pr", "{}", "same", 7, 7, 100);
			else raw.prepare("INSERT INTO review_path_preferences VALUES (?,?)").run("kept", "same");
			raw.exec(
				"INSERT INTO projects (id,name,repo_path,created_at,updated_at) VALUES ('project','kept','/fixture',1,1)"
			);
			raw.exec(
				"INSERT INTO workspaces (id,project_id,name,type,created_at,updated_at) VALUES ('workspace','project','kept','review',1,1)"
			);
			raw.exec(
				"INSERT INTO agent_messages (id,project_id,from_workspace_id,kind,content,created_at) VALUES ('message','project','workspace','question','keep this',1)"
			);
			migrateDatabase(db, mergedFolder);
			for (const table of [
				"activity_queue_sources",
				"activity_queue_snoozes",
				"activity_queue_deliveries",
				"review_path_documents",
				"review_path_preferences",
			])
				expect(
					raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
				).toBeTruthy();
			expect(raw.prepare("PRAGMA table_info(agent_sessions)").all()).toContainEqual(
				expect.objectContaining({ name: "queue_launch_known" })
			);
			expect(raw.prepare("SELECT content FROM agent_messages WHERE id='message'").get()).toEqual({
				content: "keep this",
			});
			if (ownedTable === "activity_queue_sources")
				expect(
					raw
						.prepare(
							"SELECT revision,acknowledged_revision FROM activity_queue_sources WHERE source_id='kept'"
						)
						.get()
				).toEqual({ revision: 7, acknowledged_revision: 7 });
			else
				expect(
					raw.prepare("SELECT payload FROM review_path_preferences WHERE key='kept'").get()
				).toEqual({ payload: "same" });
			const after = raw.prepare("SELECT hash,created_at FROM __drizzle_migrations").all();
			for (const record of before) expect(after).toContainEqual(record);
			migrateDatabase(db, mergedFolder);
			expect(raw.prepare("SELECT hash,created_at FROM __drizzle_migrations").all()).toEqual(after);
			expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
		} finally {
			raw.close();
			rmSync(old, { recursive: true, force: true });
		}
	});
}
