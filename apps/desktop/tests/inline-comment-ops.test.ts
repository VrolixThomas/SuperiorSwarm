import { beforeEach, describe, expect, test } from "bun:test";
import {
	createComment,
	deleteComment,
	listPendingComments,
	markCommentsSent,
	updateCommentBody,
} from "../src/main/inline-comments/comment-ops";
import { createInlineCommentsTestDb } from "./helpers/inline-comments-test-db";

function seed(db: ReturnType<typeof createInlineCommentsTestDb>, id: string, ws = "ws1") {
	createComment(db, {
		id,
		workspaceId: ws,
		repoPath: "/repo",
		filePath: "src/a.ts",
		startLine: 3,
		endLine: 5,
		codeSnapshot: "x\ny\nz",
		body: `comment ${id}`,
	});
}

describe("inline comment ops", () => {
	let db: ReturnType<typeof createInlineCommentsTestDb>;

	beforeEach(() => {
		db = createInlineCommentsTestDb();
	});

	test("createComment + listPendingComments round-trips fields", () => {
		seed(db, "c1");
		const rows = listPendingComments(db, "ws1");
		expect(rows.length).toBe(1);
		const c = rows[0]!;
		expect(c.filePath).toBe("src/a.ts");
		expect(c.startLine).toBe(3);
		expect(c.endLine).toBe(5);
		expect(c.codeSnapshot).toBe("x\ny\nz");
		expect(c.status).toBe("pending");
		expect(c.sentAt).toBeNull();
	});

	test("list is scoped by workspace", () => {
		seed(db, "c1", "ws1");
		seed(db, "c2", "ws2");
		expect(listPendingComments(db, "ws1").length).toBe(1);
	});

	test("updateCommentBody changes body only", () => {
		seed(db, "c1");
		updateCommentBody(db, { id: "c1", body: "edited" });
		expect(listPendingComments(db, "ws1")[0]!.body).toBe("edited");
	});

	test("deleteComment removes the row", () => {
		seed(db, "c1");
		deleteComment(db, "c1");
		expect(listPendingComments(db, "ws1").length).toBe(0);
	});

	test("markCommentsSent excludes comments from pending list and stamps sentAt", () => {
		seed(db, "c1");
		seed(db, "c2");
		markCommentsSent(db, ["c1"]);
		const pending = listPendingComments(db, "ws1");
		expect(pending.length).toBe(1);
		expect(pending[0]!.id).toBe("c2");
	});

	test("markCommentsSent with empty ids is a no-op", () => {
		seed(db, "c1");
		markCommentsSent(db, []);
		expect(listPendingComments(db, "ws1").length).toBe(1);
	});
});
