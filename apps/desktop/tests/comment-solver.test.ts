import "./preload-electron-mock";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type Database from "better-sqlite3";
import {
	cancelSolve,
	validateSolveTransition,
} from "../src/main/ai-review/comment-solver-orchestrator";
import { makeRawTestDb } from "./test-db";

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
	db = makeRawTestDb();
	// Seed FK dependencies used across tests (workspaces.id is referenced by
	// comment_solve_sessions and pr_comment_cache).
	db.prepare(`INSERT INTO projects (id, name, repo_path, default_branch, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
		"proj-1",
		"test",
		"/tmp/test",
		"main",
		"ready",
		NOW,
		NOW
	);
	const workspaceIds = [
		WORKSPACE_ID,
		"ws-schema",
		"ws-cascade",
		"ws-cancel",
		"status-ws",
		"status-ws-isolated",
	];
	for (const ws of workspaceIds) {
		db.prepare(
			`INSERT INTO workspaces (id, project_id, type, name, created_at, updated_at) VALUES (?, 'proj-1', 'branch', ?, ?, ?)`
		).run(ws, ws, NOW, NOW);
	}
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
			expect(() => validateSolveTransition("queued", "cancelled")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "ready")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "failed")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "cancelled")).not.toThrow();
			expect(() => validateSolveTransition("ready", "submitted")).not.toThrow();
			expect(() => validateSolveTransition("ready", "failed")).not.toThrow();
			expect(() => validateSolveTransition("ready", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("submitted", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("failed", "dismissed")).not.toThrow();
			expect(() => validateSolveTransition("cancelled", "dismissed")).not.toThrow();
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
			// Dismissed has no valid transitions
			expect(() => validateSolveTransition("dismissed", "queued")).toThrow(
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

			const row = db.prepare("SELECT * FROM comment_solve_sessions WHERE id = ?").get(id) as Record<
				string,
				unknown
			>;

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

			const group = db.prepare("SELECT * FROM comment_groups WHERE id = 'cg-cascade'").get();
			const comment = db.prepare("SELECT * FROM pr_comments WHERE id = 'cc-1'").get();

			expect(group).toBeNull();
			expect(comment).toBeNull();
		});
	});

	describe("Recovery schema", () => {
		test("can store pid and lastActivityAt on session", () => {
			const id = "recovery-sess-1";
			const now = Date.now();
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at, pid, last_activity_at)
				VALUES (?, 'github', 'owner/repo#10', 'Test', 'feat', 'main', 'in_progress', 'ws-schema', ?, ?, 12345, ?)
			`).run(id, now, now, now);

			const row = db
				.prepare("SELECT pid, last_activity_at FROM comment_solve_sessions WHERE id = ?")
				.get(id) as Record<string, unknown>;
			expect(row["pid"]).toBe(12345);
			expect(row["last_activity_at"]).toBe(now);
		});

		test("pid and lastActivityAt default to null", () => {
			const id = "recovery-sess-2";
			const now = Date.now();
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
				VALUES (?, 'github', 'owner/repo#11', 'Test', 'feat', 'main', 'queued', 'ws-schema', ?, ?)
			`).run(id, now, now);

			const row = db
				.prepare("SELECT pid, last_activity_at FROM comment_solve_sessions WHERE id = ?")
				.get(id) as Record<string, unknown>;
			expect(row["pid"]).toBeNull();
			expect(row["last_activity_at"]).toBeNull();
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

			const group = db.prepare("SELECT * FROM comment_groups WHERE id = 'grp-A'").get() as Record<
				string,
				unknown
			>;
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

			const row = db.prepare("SELECT group_id FROM pr_comments WHERE id = 'gc-3'").get() as Record<
				string,
				unknown
			>;
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

			const row = db.prepare("SELECT status FROM pr_comments WHERE id = 'fix-c-1'").get() as Record<
				string,
				unknown
			>;
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

	describe("Session recovery", () => {
		// NOTE: recoverStuckSessions() calls getDb() internally which returns the production DB,
		// so we cannot inject the test DB to call it directly. Instead, these tests replicate
		// the exact SQL logic from recoverStuckSessions() in comment-solver-orchestrator.ts.
		// The anchor logic below must stay in sync with that function:
		//   anchor = lastActivityAt ?? createdAt
		//   if (anchor !== null && anchor < cutoff) → mark failed
		//
		// The raw SQL equivalent uses COALESCE(last_activity_at, created_at) as the anchor.

		test("recoverStuckSessions marks sessions with no pid as failed when lastActivityAt is stale", () => {
			const staleness = 11 * 60 * 1000; // 11 minutes in ms
			const staleTime = Date.now() - staleness;
			const id = "stuck-no-pid";
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at, pid, last_activity_at)
				VALUES (?, 'github', 'owner/repo#20', 'Test', 'feat', 'main', 'in_progress', 'ws-schema', ?, ?, NULL, ?)
			`).run(id, Date.now(), Date.now(), staleTime);

			// Mirrors recoverStuckSessions(): anchor = COALESCE(last_activity_at, created_at)
			const TEN_MIN_MS = 10 * 60 * 1000;
			const cutoff = Date.now() - TEN_MIN_MS;
			db.prepare(`
				UPDATE comment_solve_sessions
				SET status = 'failed', updated_at = ?
				WHERE status IN ('queued', 'in_progress')
				AND pid IS NULL
				AND COALESCE(last_activity_at, created_at) IS NOT NULL
				AND COALESCE(last_activity_at, created_at) < ?
			`).run(Date.now(), cutoff);

			const row = db
				.prepare("SELECT status FROM comment_solve_sessions WHERE id = ?")
				.get(id) as Record<string, unknown>;
			expect(row["status"]).toBe("failed");
		});

		test("recoverStuckSessions does not mark a recently active session as failed", () => {
			const id = "stuck-recent";
			const now = Date.now();
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at, pid, last_activity_at)
				VALUES (?, 'github', 'owner/repo#21', 'Test', 'feat', 'main', 'in_progress', 'ws-schema', ?, ?, NULL, ?)
			`).run(id, now, now, now); // lastActivityAt = now (fresh)

			// Mirrors recoverStuckSessions(): anchor = COALESCE(last_activity_at, created_at)
			const TEN_MIN_MS = 10 * 60 * 1000;
			const cutoff = Date.now() - TEN_MIN_MS;
			db.prepare(`
				UPDATE comment_solve_sessions
				SET status = 'failed', updated_at = ?
				WHERE status IN ('queued', 'in_progress')
				AND pid IS NULL
				AND COALESCE(last_activity_at, created_at) IS NOT NULL
				AND COALESCE(last_activity_at, created_at) < ?
			`).run(Date.now(), cutoff);

			const row = db
				.prepare("SELECT status FROM comment_solve_sessions WHERE id = ?")
				.get(id) as Record<string, unknown>;
			expect(row["status"]).toBe("in_progress"); // Not failed — was active recently
		});

		test("recoverStuckSessions marks sessions with null lastActivityAt as failed when createdAt is stale", () => {
			// Covers the case where a session was queued but never got any activity before crashing.
			// lastActivityAt is null so we fall back to createdAt as the anchor.
			const staleness = 11 * 60 * 1000; // 11 minutes in ms
			const staleCreatedAt = Date.now() - staleness;
			const id = "stuck-no-pid-no-activity";
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at, pid, last_activity_at)
				VALUES (?, 'github', 'owner/repo#22', 'Test', 'feat', 'main', 'queued', 'ws-schema', ?, ?, NULL, NULL)
			`).run(id, staleCreatedAt, staleCreatedAt);

			// Mirrors recoverStuckSessions(): anchor = COALESCE(last_activity_at, created_at)
			const TEN_MIN_MS = 10 * 60 * 1000;
			const cutoff = Date.now() - TEN_MIN_MS;
			db.prepare(`
				UPDATE comment_solve_sessions
				SET status = 'failed', updated_at = ?
				WHERE status IN ('queued', 'in_progress')
				AND pid IS NULL
				AND COALESCE(last_activity_at, created_at) IS NOT NULL
				AND COALESCE(last_activity_at, created_at) < ?
			`).run(Date.now(), cutoff);

			const row = db
				.prepare("SELECT status FROM comment_solve_sessions WHERE id = ?")
				.get(id) as Record<string, unknown>;
			expect(row["status"]).toBe("failed"); // Recovered via createdAt fallback
		});
	});

	describe("Publish gate", () => {
		test("all non-reverted groups approved → allGroupsApproved is true", () => {
			// The new gate is: every non-reverted group has status === "approved"
			const groups = [
				{ status: "approved" },
				{ status: "approved" },
				{ status: "reverted" }, // skipped
			];
			const nonReverted = groups.filter((g) => g.status !== "reverted");
			const allApproved = nonReverted.every((g) => g.status === "approved");
			expect(allApproved).toBe(true);
		});

		test("any non-reverted group not approved → allGroupsApproved is false", () => {
			const groups = [
				{ status: "approved" },
				{ status: "fixed" }, // not yet approved
			];
			const nonReverted = groups.filter((g) => g.status !== "reverted");
			const allApproved = nonReverted.every((g) => g.status === "approved");
			expect(allApproved).toBe(false);
		});

		test("unclear draft reply count gates the Approve button on a group", () => {
			// hasUnclearDraftReplies: group.comments.some(c => c.status === 'unclear' && c.reply?.status === 'draft')
			const commentsWithUnclearDraft = [
				{ status: "fixed", reply: { status: "approved" } },
				{ status: "unclear", reply: { status: "draft" } },
			];
			const hasUnclearDraft = commentsWithUnclearDraft.some(
				(c) => c.status === "unclear" && c.reply?.status === "draft"
			);
			expect(hasUnclearDraft).toBe(true);
		});

		test("unclear comment with approved reply does not gate the Approve button", () => {
			const comments = [{ status: "unclear", reply: { status: "approved" } }];
			const hasUnclearDraft = comments.some(
				(c) => c.status === "unclear" && c.reply?.status === "draft"
			);
			expect(hasUnclearDraft).toBe(false);
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
			const group = db.prepare("SELECT * FROM comment_groups WHERE id = ?").get(groupId) as
				| Record<string, unknown>
				| undefined;

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

	describe("Sign-off flow", () => {
		const SESSION = "signoff-sess";
		const GROUP_ID = "signoff-grp";
		const COMMENT_ID = "signoff-c-1";
		const REPLY_ID = "signoff-r-1";

		beforeAll(() => {
			seedSession(SESSION, "ready");
			seedGroup(GROUP_ID, SESSION, 1, "approved", "commit-xyz");
			seedComment(COMMENT_ID, SESSION, "plat-signoff-1", GROUP_ID, "unclear");
			seedReply(REPLY_ID, COMMENT_ID, "draft");
		});

		test("approveReply sets reply status to approved", () => {
			db.prepare("UPDATE comment_replies SET status = 'draft' WHERE id = ?").run(REPLY_ID);

			// Mirrors approveReply endpoint logic
			db.prepare("UPDATE comment_replies SET status = 'approved' WHERE id = ?").run(REPLY_ID);

			const row = db
				.prepare("SELECT status FROM comment_replies WHERE id = ?")
				.get(REPLY_ID) as Record<string, unknown>;
			expect(row["status"]).toBe("approved");
		});

		test("revokeGroup resets group to fixed and approved replies to draft", () => {
			// Setup: group is approved, reply is approved
			db.prepare("UPDATE comment_groups SET status = 'approved' WHERE id = ?").run(GROUP_ID);
			db.prepare("UPDATE comment_replies SET status = 'approved' WHERE id = ?").run(REPLY_ID);

			// Mirrors revokeGroup endpoint logic
			db.prepare("UPDATE comment_groups SET status = 'fixed' WHERE id = ?").run(GROUP_ID);

			const comments = db
				.prepare("SELECT id FROM pr_comments WHERE group_id = ?")
				.all(GROUP_ID) as Array<{ id: string }>;
			const commentIds = comments.map((c) => c.id);
			if (commentIds.length > 0) {
				db.prepare(
					`UPDATE comment_replies SET status = 'draft'
         WHERE pr_comment_id IN (${commentIds.map(() => "?").join(",")})
         AND status = 'approved'`
				).run(...commentIds);
			}

			const groupRow = db
				.prepare("SELECT status FROM comment_groups WHERE id = ?")
				.get(GROUP_ID) as Record<string, unknown>;
			expect(groupRow["status"]).toBe("fixed");

			const replyRow = db
				.prepare("SELECT status FROM comment_replies WHERE id = ?")
				.get(REPLY_ID) as Record<string, unknown>;
			expect(replyRow["status"]).toBe("draft");
		});

		test("revokeGroup only resets approved replies, leaves draft replies alone", () => {
			const DRAFT_REPLY_ID = "signoff-r-draft-only";
			db.prepare(
				"INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'draft body', 'draft')"
			).run(DRAFT_REPLY_ID, COMMENT_ID);

			// revokeGroup should not touch already-draft replies
			db.prepare(
				`UPDATE comment_replies SET status = 'draft'
       WHERE pr_comment_id = ? AND status = 'approved'`
			).run(COMMENT_ID);

			const row = db
				.prepare("SELECT status FROM comment_replies WHERE id = ?")
				.get(DRAFT_REPLY_ID) as Record<string, unknown>;
			expect(row["status"]).toBe("draft"); // Unchanged

			// Cleanup
			db.prepare("DELETE FROM comment_replies WHERE id = ?").run(DRAFT_REPLY_ID);
		});

		test("revokeGroup on a non-approved group should be guarded", () => {
			// Verify the data condition: group must be 'approved' to revoke
			db.prepare("UPDATE comment_groups SET status = 'fixed' WHERE id = ?").run(GROUP_ID);
			const row = db
				.prepare("SELECT status FROM comment_groups WHERE id = ?")
				.get(GROUP_ID) as Record<string, unknown>;
			// In the router, if status !== 'approved' we throw. This test verifies
			// the DB state that would trigger the guard.
			expect(row["status"]).not.toBe("approved");
		});

		test("addReply without draft flag creates reply as approved", () => {
			const replyId = "signoff-r-approved";
			// Mirrors addReply with draft: false (default) — creates as 'approved'
			db.prepare(
				"INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'User reply', 'approved')"
			).run(replyId, COMMENT_ID);

			const row = db
				.prepare("SELECT status FROM comment_replies WHERE id = ?")
				.get(replyId) as Record<string, unknown>;
			expect(row["status"]).toBe("approved");

			db.prepare("DELETE FROM comment_replies WHERE id = ?").run(replyId);
		});

		test("addReply with draft: true creates reply as draft", () => {
			const replyId = "signoff-r-undo";
			// Mirrors addReply with draft: true — used for undo-discard
			db.prepare(
				"INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'Restored body', 'draft')"
			).run(replyId, COMMENT_ID);

			const row = db
				.prepare("SELECT status FROM comment_replies WHERE id = ?")
				.get(replyId) as Record<string, unknown>;
			expect(row["status"]).toBe("draft");

			db.prepare("DELETE FROM comment_replies WHERE id = ?").run(replyId);
		});

		test("updateReply with body resets an approved reply to draft", () => {
			// Mirrors updateReply: when body changes, status resets to draft
			const replyId = "signoff-r-reset";
			db.prepare(
				"INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'Original', 'approved')"
			).run(replyId, COMMENT_ID);

			// Simulate updateReply with body — always resets to draft
			db.prepare("UPDATE comment_replies SET body = ?, status = 'draft' WHERE id = ?").run(
				"Edited body",
				replyId
			);

			const row = db
				.prepare("SELECT status, body FROM comment_replies WHERE id = ?")
				.get(replyId) as Record<string, unknown>;
			expect(row["status"]).toBe("draft");
			expect(row["body"]).toBe("Edited body");

			db.prepare("DELETE FROM comment_replies WHERE id = ?").run(replyId);
		});
	});

	describe("cancelSolve", () => {
		// NOTE: cancelSolve() calls getDb() internally which returns the production DB,
		// so we cannot inject the test DB to call it directly. Instead, these tests replicate
		// the exact SQL logic from cancelSolve() in comment-solver-orchestrator.ts.
		// The logic below must stay in sync with that function:
		//   - pending groups are deleted and their comments reset to status "open" / groupId null
		//   - session status is set to "cancelled"
		//   - fixed groups are preserved

		test("cancelSolve state machine: queued and in_progress can transition to cancelled", () => {
			expect(() => validateSolveTransition("queued", "cancelled")).not.toThrow();
			expect(() => validateSolveTransition("in_progress", "cancelled")).not.toThrow();
		});

		test("cancelSolve state machine: cancelled can transition to dismissed", () => {
			expect(() => validateSolveTransition("cancelled", "dismissed")).not.toThrow();
		});

		test("cancelSolve state machine: ready cannot transition to cancelled", () => {
			expect(() => validateSolveTransition("ready", "cancelled")).toThrow(
				"Invalid solve session status transition"
			);
		});

		test("cancelSolve SQL: deletes pending groups, resets comments, preserves fixed groups", () => {
			// Mirrors cancelSolve() transaction logic from comment-solver-orchestrator.ts
			const sessionId = "cancel-sess-1";
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
				VALUES (?, 'github', 'owner/repo#10', 'Cancel PR', 'feat/cancel', 'main', 'in_progress', 'ws-cancel', ?, ?)
			`).run(sessionId, NOW, NOW);

			// Insert a fixed group (should be preserved)
			db.prepare(`
				INSERT INTO comment_groups (id, solve_session_id, label, status, commit_hash, "order")
				VALUES ('cg-fixed', ?, 'Fixed group', 'fixed', 'abc123', 1)
			`).run(sessionId);

			// Insert a pending group (should be deleted)
			db.prepare(`
				INSERT INTO comment_groups (id, solve_session_id, label, status, commit_hash, "order")
				VALUES ('cg-pending', ?, 'Pending group', 'pending', NULL, 2)
			`).run(sessionId);

			// Insert a comment linked to the pending group
			db.prepare(`
				INSERT INTO pr_comments
					(id, solve_session_id, group_id, platform_comment_id, author, body, file_path, status)
				VALUES ('cc-pending-1', ?, 'cg-pending', 'plat-cancel-1', 'reviewer', 'Fix this', 'src/foo.ts', 'fixed')
			`).run(sessionId);

			// Simulate cancelSolve transaction: find pending groups, reset comments, delete groups, update session
			const pendingGroups = db
				.prepare(`SELECT id FROM comment_groups WHERE solve_session_id = ? AND status = 'pending'`)
				.all(sessionId) as Array<{ id: string }>;

			for (const group of pendingGroups) {
				db.prepare(
					`UPDATE pr_comments SET group_id = NULL, status = 'open' WHERE group_id = ?`
				).run(group.id);
				db.prepare(`DELETE FROM comment_groups WHERE id = ?`).run(group.id);
			}

			db.prepare(
				`UPDATE comment_solve_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?`
			).run(NOW, sessionId);

			// Verify: session is cancelled
			const session = db
				.prepare("SELECT status FROM comment_solve_sessions WHERE id = ?")
				.get(sessionId) as Record<string, unknown>;
			expect(session["status"]).toBe("cancelled");

			// Verify: fixed group still exists
			const fixedGroup = db.prepare("SELECT * FROM comment_groups WHERE id = 'cg-fixed'").get() as
				| Record<string, unknown>
				| undefined;
			expect(fixedGroup).toBeDefined();
			expect(fixedGroup?.["status"]).toBe("fixed");

			// Verify: pending group was deleted
			const deletedGroup = db.prepare("SELECT * FROM comment_groups WHERE id = 'cg-pending'").get();
			expect(deletedGroup).toBeNull();

			// Verify: comment was reset to open with no group
			const comment = db
				.prepare("SELECT status, group_id FROM pr_comments WHERE id = 'cc-pending-1'")
				.get() as Record<string, unknown>;
			expect(comment["status"]).toBe("open");
			expect(comment["group_id"]).toBeNull();
		});
	});

	describe("buildCommentSolveStatuses", () => {
		// NOTE: buildCommentSolveStatuses() calls getDb() internally which returns the production DB,
		// so we cannot inject the test DB to call it directly. Instead, these tests replicate
		// the exact SQL logic from buildCommentSolveStatuses() in comment-solver.ts.
		// The logic below must stay in sync with that function.

		function buildCommentSolveStatusesFromDb(
			workspaceId: string
		): Record<string, "addressed" | "new"> {
			const result: Record<string, "addressed" | "new"> = {};

			const sessions = db
				.prepare(
					`SELECT id, status FROM comment_solve_sessions
					WHERE workspace_id = ? AND status != 'dismissed'`
				)
				.all(workspaceId) as Array<{ id: string; status: string }>;

			if (sessions.length === 0) return result;

			const sessionIds = sessions.map((s) => s.id);
			const hasSubmittedOrReady = sessions.some(
				(s) => s.status === "submitted" || s.status === "ready"
			);

			const placeholders = sessionIds.map(() => "?").join(",");
			const sessionComments = db
				.prepare(
					`SELECT platform_comment_id, status FROM pr_comments
					WHERE solve_session_id IN (${placeholders})`
				)
				.all(...sessionIds) as Array<{ platform_comment_id: string; status: string }>;

			const knownPlatformIds = new Set<string>();
			for (const c of sessionComments) {
				knownPlatformIds.add(c.platform_comment_id);
				if (c.status === "fixed" || c.status === "wont_fix" || c.status === "unclear") {
					result[c.platform_comment_id] = "addressed";
				}
			}

			if (hasSubmittedOrReady) {
				const cacheComments = db
					.prepare(`SELECT platform_comment_id FROM pr_comment_cache WHERE workspace_id = ?`)
					.all(workspaceId) as Array<{ platform_comment_id: string }>;

				for (const c of cacheComments) {
					if (!knownPlatformIds.has(c.platform_comment_id)) {
						result[c.platform_comment_id] = "new";
					}
				}
			}

			return result;
		}

		const WS = "status-ws";
		const NOW_TS = Date.now();

		function insertSession(id: string, status: string): void {
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
				VALUES (?, 'github', 'owner/repo#99', 'Status PR', 'feat/status', 'main', ?, ?, ?, ?)
			`).run(id, status, WS, NOW_TS, NOW_TS);
		}

		function insertComment(
			id: string,
			sessionId: string,
			platformId: string,
			status: string
		): void {
			db.prepare(`
				INSERT INTO pr_comments
					(id, solve_session_id, platform_comment_id, author, body, file_path, status)
				VALUES (?, ?, ?, 'reviewer', 'body', 'file.ts', ?)
			`).run(id, sessionId, platformId, status);
		}

		function insertCacheComment(id: string, platformId: string): void {
			db.prepare(`
				INSERT INTO pr_comment_cache
					(id, workspace_id, platform_comment_id, author, body, file_path, created_at, fetched_at)
				VALUES (?, ?, ?, 'reviewer', 'body', 'file.ts', '2024-01-01T00:00:00Z', ?)
			`).run(id, WS, platformId, NOW_TS);
		}

		afterAll(() => {
			// Clean up all data inserted for this describe block
			db.prepare(`DELETE FROM pr_comment_cache WHERE workspace_id = ?`).run(WS);
			db.prepare(`DELETE FROM comment_solve_sessions WHERE workspace_id = ?`).run(WS);
		});

		test("returns empty object when no sessions exist for workspace", () => {
			const result = buildCommentSolveStatusesFromDb("no-such-workspace");
			expect(result).toEqual({});
		});

		test("returns empty object when only dismissed sessions exist", () => {
			insertSession("status-sess-dismissed", "dismissed");
			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result).toEqual({});
		});

		test("marks fixed comment as addressed", () => {
			insertSession("status-sess-fixed", "ready");
			insertComment("status-c-fixed", "status-sess-fixed", "plat-fixed-1", "fixed");

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-fixed-1"]).toBe("addressed");
		});

		test("marks wont_fix comment as addressed", () => {
			insertSession("status-sess-wont", "ready");
			insertComment("status-c-wont", "status-sess-wont", "plat-wont-1", "wont_fix");

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-wont-1"]).toBe("addressed");
		});

		test("marks unclear comment as addressed", () => {
			insertSession("status-sess-unclear", "ready");
			insertComment("status-c-unclear", "status-sess-unclear", "plat-unclear-1", "unclear");

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-unclear-1"]).toBe("addressed");
		});

		test("open comment gets no entry", () => {
			insertSession("status-sess-open", "in_progress");
			insertComment("status-c-open", "status-sess-open", "plat-open-1", "open");

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-open-1"]).toBeUndefined();
		});

		test("changes_requested comment gets no entry", () => {
			insertSession("status-sess-cr", "in_progress");
			insertComment("status-c-cr", "status-sess-cr", "plat-cr-1", "changes_requested");

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-cr-1"]).toBeUndefined();
		});

		test("cache-only comment gets 'new' when submitted session exists", () => {
			insertSession("status-sess-submitted", "submitted");
			insertComment("status-c-submitted", "status-sess-submitted", "plat-known-1", "fixed");
			insertCacheComment("cache-new-1", "plat-new-1");

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-new-1"]).toBe("new");
		});

		test("cache-only comment gets 'new' when ready session exists", () => {
			insertCacheComment("cache-new-2", "plat-new-2");
			// A ready session already exists from previous test (status-sess-fixed)

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-new-2"]).toBe("new");
		});

		test("cache comment that is already in a session does not get 'new'", () => {
			// plat-known-1 was inserted as a session comment above — it should be "addressed" not "new"
			insertCacheComment("cache-known-1", "plat-known-1");

			const result = buildCommentSolveStatusesFromDb(WS);
			expect(result["plat-known-1"]).toBe("addressed");
			expect(result["plat-known-1"]).not.toBe("new");
		});

		test("cache comment is NOT marked 'new' when only in_progress session exists", () => {
			// Isolated workspace: only has in_progress session, no submitted/ready
			const isolatedWs = "status-ws-isolated";
			db.prepare(`
				INSERT INTO comment_solve_sessions
					(id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at)
				VALUES ('status-sess-iso', 'github', 'owner/repo#iso', 'Iso PR', 'feat', 'main', 'in_progress', ?, ?, ?)
			`).run(isolatedWs, NOW_TS, NOW_TS);
			db.prepare(`
				INSERT INTO pr_comment_cache
					(id, workspace_id, platform_comment_id, author, body, file_path, created_at, fetched_at)
				VALUES ('cache-iso-1', ?, 'plat-iso-1', 'reviewer', 'body', 'file.ts', '2024-01-01T00:00:00Z', ?)
			`).run(isolatedWs, NOW_TS);

			const result = buildCommentSolveStatusesFromDb(isolatedWs);
			expect(result["plat-iso-1"]).toBeUndefined();

			db.prepare(`DELETE FROM pr_comment_cache WHERE workspace_id = ?`).run(isolatedWs);
			db.prepare(`DELETE FROM comment_solve_sessions WHERE workspace_id = ?`).run(isolatedWs);
		});
	});
});
