import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import { validateSolveTransition } from "../src/main/ai-review/comment-solver-orchestrator";

// ─── In-memory database setup ─────────────────────────────────────────────────

function makeTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	db.exec(`
		CREATE TABLE comment_solve_sessions (
			id TEXT PRIMARY KEY NOT NULL,
			pr_provider TEXT NOT NULL,
			pr_identifier TEXT NOT NULL,
			pr_title TEXT NOT NULL,
			source_branch TEXT NOT NULL,
			target_branch TEXT NOT NULL,
			status TEXT DEFAULT 'queued' NOT NULL,
			commit_sha TEXT,
			workspace_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE comment_groups (
			id TEXT PRIMARY KEY NOT NULL,
			solve_session_id TEXT NOT NULL,
			label TEXT NOT NULL,
			status TEXT DEFAULT 'pending' NOT NULL,
			commit_hash TEXT,
			"order" INTEGER NOT NULL,
			FOREIGN KEY (solve_session_id) REFERENCES comment_solve_sessions(id) ON DELETE CASCADE
		);

		CREATE TABLE pr_comments (
			id TEXT PRIMARY KEY NOT NULL,
			solve_session_id TEXT NOT NULL,
			group_id TEXT,
			platform_comment_id TEXT NOT NULL,
			author TEXT NOT NULL,
			body TEXT NOT NULL,
			file_path TEXT NOT NULL,
			line_number INTEGER,
			side TEXT,
			thread_id TEXT,
			status TEXT DEFAULT 'open' NOT NULL,
			commit_sha TEXT,
			FOREIGN KEY (solve_session_id) REFERENCES comment_solve_sessions(id) ON DELETE CASCADE,
			FOREIGN KEY (group_id) REFERENCES comment_groups(id) ON DELETE SET NULL
		);

		CREATE UNIQUE INDEX pr_comments_session_platform_unique
			ON pr_comments (solve_session_id, platform_comment_id);

		CREATE TABLE comment_replies (
			id TEXT PRIMARY KEY NOT NULL,
			pr_comment_id TEXT NOT NULL,
			body TEXT NOT NULL,
			status TEXT DEFAULT 'draft' NOT NULL,
			FOREIGN KEY (pr_comment_id) REFERENCES pr_comments(id) ON DELETE CASCADE
		);
	`);

	return db;
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

let db: Database.Database;

const SESSION_ID = "sess-1";
const WORKSPACE_ID = "ws-1";
const NOW = Date.now();

function seedSession(id = SESSION_ID, status = "queued"): void {
	db.prepare(`
		INSERT INTO comment_solve_sessions
			(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
		VALUES (?, 'github', 'owner/repo#42', 'Fix bugs', 'fix/branch', 'main', ?, ?, ?, ?)
	`).run(id, status, WORKSPACE_ID, NOW, NOW);
}

function seedGroup(
	id: string,
	sessionId: string,
	order: number,
	status = "pending",
	commitHash: string | null = null
): void {
	db.prepare(`
		INSERT INTO comment_groups (id, solve_session_id, label, status, commit_hash, "order")
		VALUES (?, ?, ?, ?, ?, ?)
	`).run(id, sessionId, `Group ${id}`, status, commitHash, order);
}

function seedComment(
	id: string,
	sessionId: string,
	platformId: string,
	groupId: string | null = null,
	status = "open"
): void {
	db.prepare(`
		INSERT INTO pr_comments
			(id, solve_session_id, group_id, platform_comment_id, author, body, file_path, status)
		VALUES (?, ?, ?, ?, 'reviewer', 'Please fix this', 'src/index.ts', ?)
	`).run(id, sessionId, groupId, platformId, status);
}

function seedReply(id: string, commentId: string, status = "draft"): void {
	db.prepare(`
		INSERT INTO comment_replies (id, pr_comment_id, body, status)
		VALUES (?, ?, 'I fixed it', ?)
	`).run(id, commentId, status);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeAll(() => {
	db = makeTestDb();
});

afterAll(() => {
	db.close();
});

describe("Comment Solver", () => {
	describe("State Machine", () => {
		test("allows valid transitions", () => {
			expect(() => validateSolveTransition("queued", "in_progress")).not.toThrow();
			expect(() => validateSolveTransition("queued", "failed")).not.toThrow();
			expect(() => validateSolveTransition("queued", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "ready")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "failed")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("ready", "submitted")).not.toThrow();
			expect(() => validateSolveTransition("ready", "failed")).not.toThrow();
			expect(() => validateSolveTransition("ready", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("submitted", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("failed", "dismissed")).not.toThrow();
		});

		test("rejects invalid transitions", () => {
			// Cannot go backwards
			expect(() => validateSolveTransition("in_progress", "queued")).toThrow(
				"Invalid solve session status transition"
			);
			expect(() => validateSolveTransition("ready", "in_progress")).toThrow(
				"Invalid solve session status transition"
			);
			expect(() => validateSolveTransition("submitted", "ready")).toThrow(
				"Invalid solve session status transition"
			);
			// Cannot jump ahead
			expect(() => validateSolveTransition("queued", "ready")).toThrow(
				"Invalid solve session status transition"
			);
			expect(() => validateSolveTransition("queued", "submitted")).toThrow(
				"Invalid solve session status transition"
			);
			// Unknown status
			expect(() => validateSolveTransition("nonexistent", "queued")).toThrow(
				"Invalid solve session status transition"
			);
		});
	});

	describe("Schema validation", () => {
		test("can insert and query a solve session", () => {
			const id = "schema-sess-1";
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
				VALUES (?, 'github', 'owner/repo#1', 'Test PR', 'feature', 'main', 'queued', 'ws-schema', ?, ?)
			`).run(id, NOW, NOW);

			const row = db
				.prepare("SELECT * FROM comment_solve_sessions WHERE id = ?")
				.get(id) as Record<string, unknown>;

			expect(row).toBeDefined();
			expect(row["status"]).toBe("queued");
			expect(row["pr_provider"]).toBe("github");
			expect(row["source_branch"]).toBe("feature");
		});

		test("enforces unique platform_comment_id per session", () => {
			const sessionId = "schema-sess-2";
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
				VALUES (?, 'github', 'owner/repo#2', 'Test PR 2', 'feature', 'main', 'queued', 'ws-schema', ?, ?)
			`).run(sessionId, NOW, NOW);

			db.prepare(`
				INSERT INTO pr_comments
					(id, solve_session_id, platform_comment_id, author, body, file_path, status)
				VALUES ('c1', ?, 'platform-99', 'user', 'body', 'file.ts', 'open')
			`).run(sessionId);

			expect(() => {
				db.prepare(`
					INSERT INTO pr_comments
						(id, solve_session_id, platform_comment_id, author, body, file_path, status)
					VALUES ('c2', ?, 'platform-99', 'user', 'body', 'file.ts', 'open')
				`).run(sessionId);
			}).toThrow();
		});

		test("cascade deletes groups and comments when session is deleted", () => {
			const sessionId = "schema-sess-cascade";
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
				VALUES (?, 'github', 'owner/repo#99', 'Cascade PR', 'feature', 'main', 'queued', 'ws-cascade', ?, ?)
			`).run(sessionId, NOW, NOW);

			db.prepare(`
				INSERT INTO comment_groups (id, solve_session_id, label, status, "order")
				VALUES ('cg-cascade', ?, 'Group A', 'pending', 1)
			`).run(sessionId);

			db.prepare(`
				INSERT INTO pr_comments
					(id, solve_session_id, group_id, platform_comment_id, author, body, file_path, status)
				VALUES ('cc-1', ?, 'cg-cascade', 'plat-1', 'user', 'body', 'file.ts', 'open')
			`).run(sessionId);

			db.prepare("DELETE FROM comment_solve_sessions WHERE id = ?").run(sessionId);

			const group = db
				.prepare("SELECT * FROM comment_groups WHERE id = 'cg-cascade'")
				.get();
			const comment = db
				.prepare("SELECT * FROM pr_comments WHERE id = 'cc-1'")
				.get();

			expect(group).toBeNull();
			expect(comment).toBeNull();
		});
	});

	describe("Comment grouping", () => {
		const SESSION = "grouping-sess";

		beforeAll(() => {
			seedSession(SESSION, "in_progress");
			seedComment("gc-1", SESSION, "plat-100");
			seedComment("gc-2", SESSION, "plat-101");
			seedComment("gc-3", SESSION, "plat-102");
		});

		test("creates groups and links comments (submit_grouping SQL)", () => {
			// Simulate submit_grouping: insert group, then update comments to link
			db.prepare(`
				INSERT INTO comment_groups (id, solve_session_id, label, status, "order")
				VALUES ('grp-A', ?, 'Naming issues', 'pending', 1)
			`).run(SESSION);

			db.prepare(`
				UPDATE pr_comments SET group_id = 'grp-A' WHERE id IN ('gc-1', 'gc-2')
			`).run();

			const group = db
				.prepare("SELECT * FROM comment_groups WHERE id = 'grp-A'")
				.get() as Record<string, unknown>;
			expect(group).toBeDefined();
			expect(group["label"]).toBe("Naming issues");
			expect(group["status"]).toBe("pending");

			const linked = db
				.prepare("SELECT id FROM pr_comments WHERE group_id = 'grp-A'")
				.all() as Array<{ id: string }>;
			expect(linked).toHaveLength(2);
			expect(linked.map((r) => r.id).sort()).toEqual(["gc-1", "gc-2"]);
		});

		test("submit_grouping updates comment group_id", () => {
			// gc-3 was unlinked — now assign to a new group
			db.prepare(`
				INSERT INTO comment_groups (id, solve_session_id, label, status, "order")
				VALUES ('grp-B', ?, 'Error handling', 'pending', 2)
			`).run(SESSION);

			db.prepare("UPDATE pr_comments SET group_id = 'grp-B' WHERE id = 'gc-3'").run();

			const row = db
				.prepare("SELECT group_id FROM pr_comments WHERE id = 'gc-3'")
				.get() as Record<string, unknown>;
			expect(row["group_id"]).toBe("grp-B");
		});
	});

	describe("Fix workflow", () => {
		const SESSION = "fix-sess";

		beforeAll(() => {
			seedSession(SESSION, "in_progress");
			seedGroup("fix-grp-1", SESSION, 1);
			seedComment("fix-c-1", SESSION, "plat-200", "fix-grp-1");
			seedComment("fix-c-2", SESSION, "plat-201", "fix-grp-1");
		});

		test("mark_comment_fixed updates status", () => {
			db.prepare("UPDATE pr_comments SET status = 'fixed' WHERE id = 'fix-c-1'").run();

			const row = db
				.prepare("SELECT status FROM pr_comments WHERE id = 'fix-c-1'")
				.get() as Record<string, unknown>;
			expect(row["status"]).toBe("fixed");
		});

		test("mark_comment_unclear creates draft reply", () => {
			// mark_comment_unclear: update comment status + insert a draft reply
			db.prepare("UPDATE pr_comments SET status = 'unclear' WHERE id = 'fix-c-2'").run();

			db.prepare(`
				INSERT INTO comment_replies (id, pr_comment_id, body, status)
				VALUES ('reply-1', 'fix-c-2', 'I was not sure what you meant — I interpreted it as X', 'draft')
			`).run();

			const commentRow = db
				.prepare("SELECT status FROM pr_comments WHERE id = 'fix-c-2'")
				.get() as Record<string, unknown>;
			expect(commentRow["status"]).toBe("unclear");

			const replyRow = db
				.prepare("SELECT * FROM comment_replies WHERE pr_comment_id = 'fix-c-2'")
				.get() as Record<string, unknown>;
			expect(replyRow).toBeDefined();
			expect(replyRow["status"]).toBe("draft");
			expect(typeof replyRow["body"]).toBe("string");
		});

		test("finish_fix_group sets group status to fixed and stores commit hash", () => {
			const fakeCommitHash = "abc1234";
			db.prepare(`
				UPDATE comment_groups SET status = 'fixed', commit_hash = ? WHERE id = 'fix-grp-1'
			`).run(fakeCommitHash);

			const row = db
				.prepare("SELECT status, commit_hash FROM comment_groups WHERE id = 'fix-grp-1'")
				.get() as Record<string, unknown>;
			expect(row["status"]).toBe("fixed");
			expect(row["commit_hash"]).toBe(fakeCommitHash);
		});

		test("finish_solving sets session to ready", () => {
			db.prepare("UPDATE comment_solve_sessions SET status = 'ready' WHERE id = ?").run(SESSION);

			const row = db
				.prepare("SELECT status FROM comment_solve_sessions WHERE id = ?")
				.get(SESSION) as Record<string, unknown>;
			expect(row["status"]).toBe("ready");
		});
	});

	describe("Revert ordering", () => {
		const SESSION = "revert-sess";

		beforeAll(() => {
			seedSession(SESSION, "ready");
			seedGroup("rv-grp-1", SESSION, 1, "fixed", "commit-aaa");
			seedGroup("rv-grp-2", SESSION, 2, "fixed", "commit-bbb");
			seedGroup("rv-grp-3", SESSION, 3, "fixed", "commit-ccc");
		});

		/**
		 * Mirrors the reverse-order constraint in revertGroup() from the orchestrator.
		 * Returns the group IDs that block reverting `groupId`.
		 */
		function getBlockers(groupId: string): string[] {
			const group = db
				.prepare("SELECT * FROM comment_groups WHERE id = ?")
				.get(groupId) as Record<string, unknown> | undefined;

			if (!group) throw new Error(`Group ${groupId} not found`);

			const currentOrder = group["order"] as number;
			const sessionId = group["solve_session_id"] as string;

			const others = db
				.prepare(
					`SELECT id, "order" FROM comment_groups
					 WHERE solve_session_id = ? AND status != 'reverted' AND id != ?`
				)
				.all(sessionId, groupId) as Array<{ id: string; order: number }>;

			return others.filter((g) => g.order > currentOrder).map((g) => g.id);
		}

		test("allows reverting the last group (highest order)", () => {
			// grp-3 is highest order — no blockers
			const blockers = getBlockers("rv-grp-3");
			expect(blockers).toHaveLength(0);
		});

		test("blocks reverting a group with later non-reverted groups", () => {
			// grp-1 is blocked by grp-2 and grp-3
			const blockers = getBlockers("rv-grp-1");
			expect(blockers.length).toBeGreaterThan(0);
			expect(blockers).toContain("rv-grp-2");
			expect(blockers).toContain("rv-grp-3");
		});

		test("unblocks after higher groups are reverted", () => {
			// Revert grp-3, then grp-2
			db.prepare("UPDATE comment_groups SET status = 'reverted' WHERE id = 'rv-grp-3'").run();
			db.prepare("UPDATE comment_groups SET status = 'reverted' WHERE id = 'rv-grp-2'").run();

			// Now grp-1 has no non-reverted groups with higher order
			const blockers = getBlockers("rv-grp-1");
			expect(blockers).toHaveLength(0);
		});

		test("a group with no commit_hash cannot be reverted (guard check)", () => {
			// Insert a group with no commit hash
			db.prepare(`
				INSERT INTO comment_groups (id, solve_session_id, label, status, commit_hash, "order")
				VALUES ('rv-no-hash', ?, 'No commit group', 'pending', NULL, 10)
			`).run(SESSION);

			const row = db
				.prepare("SELECT commit_hash FROM comment_groups WHERE id = 'rv-no-hash'")
				.get() as Record<string, unknown>;
			expect(row["commit_hash"]).toBeNull();
			// In revertGroup(), the orchestrator throws when commit_hash is null — we verify the
			// data condition that would trigger that guard.
		});
	});
});
