import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";

function makeTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.exec(`
		CREATE TABLE workspaces (
			id TEXT PRIMARY KEY NOT NULL,
			project_id TEXT NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'branch',
			worktree_id TEXT,
			pr_provider TEXT,
			pr_identifier TEXT,
			review_draft_id TEXT,
			terminal_id TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE pr_comment_cache (
			id TEXT PRIMARY KEY NOT NULL,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			platform_comment_id TEXT NOT NULL,
			author TEXT NOT NULL,
			body TEXT NOT NULL,
			file_path TEXT,
			line_number INTEGER,
			side TEXT,
			created_at TEXT NOT NULL,
			fetched_at INTEGER NOT NULL
		);
	`);
	return db;
}

describe("comment-poller side propagation", () => {
	test("inserts side from NormalizedComment into pr_comment_cache", () => {
		const db = makeTestDb();
		const now = new Date();

		db.prepare(
			"INSERT INTO workspaces (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
		).run("w1", "p1", "ws", now.getTime(), now.getTime());

		// Mirror the poller's insert shape (one row at a time, side from NormalizedComment).
		const insert = db.prepare(
			"INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, file_path, line_number, side, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
		);

		insert.run(
			"r1",
			"w1",
			"c1",
			"alice",
			"hi",
			"src/foo.ts",
			10,
			"LEFT",
			"2026-01-01T00:00:00Z",
			now.getTime()
		);
		insert.run(
			"r2",
			"w1",
			"c2",
			"bob",
			"yo",
			"src/foo.ts",
			12,
			"RIGHT",
			"2026-01-01T00:00:00Z",
			now.getTime()
		);
		insert.run(
			"r3",
			"w1",
			"c3",
			"carol",
			"ok",
			null,
			null,
			null,
			"2026-01-01T00:00:00Z",
			now.getTime()
		);

		const rows = db
			.prepare("SELECT platform_comment_id, side FROM pr_comment_cache ORDER BY id")
			.all() as Array<{ platform_comment_id: string; side: string | null }>;

		expect(rows).toEqual([
			{ platform_comment_id: "c1", side: "LEFT" },
			{ platform_comment_id: "c2", side: "RIGHT" },
			{ platform_comment_id: "c3", side: null },
		]);
	});
});
