import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import { ScrollbackStore } from "../../src/daemon/scrollback-store";

function makeTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.pragma("journal_mode = WAL");
	db.exec(`
		CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL,
			default_branch TEXT NOT NULL DEFAULT 'main', color TEXT, github_owner TEXT, github_repo TEXT,
			status TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		CREATE TABLE workspaces (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
			name TEXT NOT NULL, worktree_id TEXT, terminal_id TEXT, created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL);
		CREATE TABLE terminal_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
			title TEXT NOT NULL, cwd TEXT NOT NULL, scrollback TEXT, sort_order INTEGER NOT NULL,
			updated_at INTEGER NOT NULL);
	`);
	return db;
}

describe("ScrollbackStore", () => {
	let db: Database.Database;
	let store: ScrollbackStore;

	beforeEach(() => {
		db = makeTestDb();
		store = new ScrollbackStore(db);
	});

	afterEach(() => {
		store.close();
	});

	test("flush updates scrollback for existing rows", () => {
		db.prepare(
			`INSERT INTO terminal_sessions (id, workspace_id, title, cwd, scrollback, sort_order, updated_at)
			 VALUES (?, 'ws1', 'Terminal 1', '/tmp', NULL, 0, ?)`
		).run("term-1", Date.now());

		store.flush([{ id: "term-1", cwd: "/tmp", buffer: "hello world output" }]);

		const row = db
			.prepare("SELECT scrollback FROM terminal_sessions WHERE id = ?")
			.get("term-1") as { scrollback: string | null };
		expect(row.scrollback).toBe("hello world output");
	});

	test("flush is a no-op for missing rows (does not throw)", () => {
		expect(() => store.flush([{ id: "nonexistent", cwd: "/tmp", buffer: "data" }])).not.toThrow();
	});

	test("flush skips entries with empty buffer", () => {
		db.prepare(
			`INSERT INTO terminal_sessions (id, workspace_id, title, cwd, scrollback, sort_order, updated_at)
			 VALUES (?, 'ws1', 'Terminal 1', '/tmp', 'previous', 0, ?)`
		).run("term-1", Date.now());

		store.flush([{ id: "term-1", cwd: "/tmp", buffer: "" }]);

		const row = db
			.prepare("SELECT scrollback FROM terminal_sessions WHERE id = ?")
			.get("term-1") as { scrollback: string | null };
		expect(row.scrollback).toBe("previous");
	});

	test("flush handles multiple sessions in a single transaction", () => {
		for (const id of ["t1", "t2", "t3"]) {
			db.prepare(
				`INSERT INTO terminal_sessions (id, workspace_id, title, cwd, scrollback, sort_order, updated_at)
				 VALUES (?, 'ws1', 'T', '/tmp', NULL, 0, ?)`
			).run(id, Date.now());
		}

		store.flush([
			{ id: "t1", cwd: "/tmp", buffer: "output1" },
			{ id: "t2", cwd: "/tmp", buffer: "output2" },
			{ id: "t3", cwd: "/tmp", buffer: "output3" },
		]);

		for (const [id, expected] of [
			["t1", "output1"],
			["t2", "output2"],
			["t3", "output3"],
		] as const) {
			const row = db.prepare("SELECT scrollback FROM terminal_sessions WHERE id = ?").get(id) as {
				scrollback: string;
			};
			expect(row.scrollback).toBe(expected);
		}
	});
});
