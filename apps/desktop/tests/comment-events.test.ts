import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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

		CREATE TABLE comment_events (
			id TEXT PRIMARY KEY NOT NULL,
			pr_provider TEXT NOT NULL,
			pr_identifier TEXT NOT NULL,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			comment_count INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at INTEGER NOT NULL
		);
	`);

	return db;
}

let db: Database.Database;
const NOW = Date.now();

function seedWorkspace(id: string, prProvider = "github", prIdentifier = "owner/repo#1"): void {
	db.prepare(`
		INSERT INTO workspaces (id, project_id, name, type, pr_provider, pr_identifier, created_at, updated_at)
		VALUES (?, 'proj-1', 'Test', 'worktree', ?, ?, ?, ?)
	`).run(id, prProvider, prIdentifier, NOW, NOW);
}

function insertEvent(
	id: string,
	prIdentifier: string,
	workspaceId: string,
	commentCount: number,
	status = "pending"
): void {
	db.prepare(`
		INSERT INTO comment_events (id, pr_provider, pr_identifier, workspace_id, comment_count, status, created_at)
		VALUES (?, 'github', ?, ?, ?, ?, ?)
	`).run(id, prIdentifier, workspaceId, commentCount, status, NOW);
}

function getPendingEvent(prIdentifier: string): Record<string, unknown> | undefined {
	const row = db
		.prepare("SELECT * FROM comment_events WHERE pr_identifier = ? AND status = 'pending'")
		.get(prIdentifier) as Record<string, unknown> | null;
	return row ?? undefined;
}

beforeAll(() => {
	db = makeTestDb();
});

afterAll(() => {
	db.close();
});

describe("Comment Events", () => {
	beforeEach(() => {
		db.exec("DELETE FROM comment_events");
		db.exec("DELETE FROM workspaces");
		seedWorkspace("ws-1", "github", "owner/repo#1");
		seedWorkspace("ws-2", "bitbucket", "team/repo#5");
	});

	describe("Upsert logic", () => {
		test("inserts a new pending event when none exists", () => {
			insertEvent("evt-1", "owner/repo#1", "ws-1", 3);

			const event = getPendingEvent("owner/repo#1");
			expect(event).toBeDefined();
			expect(event!["comment_count"]).toBe(3);
			expect(event!["status"]).toBe("pending");
		});

		test("updates existing pending event instead of creating duplicate", () => {
			insertEvent("evt-1", "owner/repo#1", "ws-1", 3);

			// Simulate upsert: update count on existing pending row
			db.prepare(`
				UPDATE comment_events SET comment_count = ?, created_at = ?
				WHERE pr_identifier = ? AND status = 'pending'
			`).run(7, NOW + 60000, "owner/repo#1");

			const events = db
				.prepare("SELECT * FROM comment_events WHERE pr_identifier = ? AND status = 'pending'")
				.all("owner/repo#1");
			expect(events).toHaveLength(1);
			expect((events[0] as Record<string, unknown>)["comment_count"]).toBe(7);
		});

		test("can have pending events for different PRs simultaneously", () => {
			insertEvent("evt-1", "owner/repo#1", "ws-1", 2);
			insertEvent("evt-2", "team/repo#5", "ws-2", 5);

			const evt1 = getPendingEvent("owner/repo#1");
			const evt2 = getPendingEvent("team/repo#5");
			expect(evt1).toBeDefined();
			expect(evt2).toBeDefined();
			expect(evt1!["comment_count"]).toBe(2);
			expect(evt2!["comment_count"]).toBe(5);
		});
	});

	describe("Status transitions", () => {
		test("dismissing an event allows a new pending event for same PR", () => {
			insertEvent("evt-1", "owner/repo#1", "ws-1", 3);

			db.prepare("UPDATE comment_events SET status = 'dismissed' WHERE id = 'evt-1'").run();

			// New pending event should be allowed
			insertEvent("evt-2", "owner/repo#1", "ws-1", 1);

			const pending = getPendingEvent("owner/repo#1");
			expect(pending).toBeDefined();
			expect(pending!["id"]).toBe("evt-2");
		});

		test("auto_solving status prevents double-trigger", () => {
			insertEvent("evt-1", "owner/repo#1", "ws-1", 3);

			db.prepare("UPDATE comment_events SET status = 'auto_solving' WHERE id = 'evt-1'").run();

			// No pending event exists anymore
			const pending = getPendingEvent("owner/repo#1");
			expect(pending).toBeUndefined();
		});
	});

	describe("Cascade delete", () => {
		test("deleting workspace cascades to its comment events", () => {
			insertEvent("evt-1", "owner/repo#1", "ws-1", 3);

			db.prepare("DELETE FROM workspaces WHERE id = 'ws-1'").run();

			const event = db.prepare("SELECT * FROM comment_events WHERE id = 'evt-1'").get();
			expect(event).toBeNull();
		});
	});
});
