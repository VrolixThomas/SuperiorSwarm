import "./preload-electron-mock";
import { beforeAll, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import * as s from "../src/main/db/schema";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
mock.module("../src/main/ai-review/orchestrator", () => ({
	getSettings: () => ({ solveAutoResolveThreads: false }),
}));
const { solvePublicationSnapshot } = await import("../src/main/activity-queue/solve-publication");
const { requireOrdinarySolvePublication } = await import(
	"../src/main/activity-queue/solve-queue-origin"
);
beforeAll(setupTestDb);
test("solver publication pins local content, exact scope and remote without pushing", async () => {
	const root = mkdtempSync(join(tmpdir(), "queue-solve-publish-"));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	try {
		git("init", "-q", "-b", "feature");
		writeFileSync(join(root, "file.ts"), "synthetic\n");
		git("add", "file.ts");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-qm",
			"fixture"
		);
		git("remote", "add", "origin", "git@github.com:owner/repo.git");
		const projectId = await seedProject();
		const ws = await seedWorkspace(projectId, { name: "Publication fixture" });
		const now = new Date();
		getDb()
			.insert(s.worktrees)
			.values({
				id: "pub-wt",
				projectId,
				path: root,
				branch: "feature",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.update(s.workspaces)
			.set({ worktreeId: "pub-wt", prProvider: "github", prIdentifier: "owner/repo#7" })
			.where(eq(s.workspaces.id, ws))
			.run();
		getDb()
			.insert(s.commentSolveSessions)
			.values({
				id: "solve",
				workspaceId: ws,
				prProvider: "github",
				prIdentifier: "owner/repo#7",
				prTitle: "PR",
				sourceBranch: "feature",
				targetBranch: "main",
				status: "ready",
				commitSha: git("rev-parse", "HEAD"),
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(s.sessionState)
			.values({
				key: "comment-solve-scope:solve",
				value: JSON.stringify([ws, "github", "github.com", "me", "owner/repo#7", "queue", 1]),
			})
			.run();
		getDb()
			.insert(s.commentGroups)
			.values({ id: "group", solveSessionId: "solve", label: "Fix", status: "approved", order: 0 })
			.run();
		getDb()
			.insert(s.prComments)
			.values({
				id: "comment",
				solveSessionId: "solve",
				groupId: "group",
				platformCommentId: "queue-feedback:thread:1",
				threadId: "thread",
				author: "reviewer",
				body: "Feedback",
				filePath: "file.ts",
				status: "fixed",
			})
			.run();
		getDb()
			.insert(s.commentReplies)
			.values({
				id: "reply",
				prCommentId: "comment",
				body: "Approved",
				status: "approved",
			})
			.run();
		const input = { kind: "solve" as const, sessionId: "solve" };
		const origin = { id: "queue", revision: 1 };
		const before = solvePublicationSnapshot(origin, input);
		expect(before.head).toBe(git("rev-parse", "HEAD"));
		expect(() => requireOrdinarySolvePublication("solve")).toThrow("Undo");
		expect(() => solvePublicationSnapshot({ id: "other", revision: 1 }, input)).toThrow(
			"occurrence"
		);
		getDb().update(s.commentReplies).set({ body: "Changed" }).run();
		expect(solvePublicationSnapshot(origin, input).signature).not.toBe(before.signature);
		getDb().update(s.commentReplies).set({ status: "draft" }).run();
		expect(() => solvePublicationSnapshot(origin, input)).toThrow("draft replies");
		getDb().update(s.commentReplies).set({ status: "approved" }).run();
		git("remote", "set-url", "origin", "git@github.com:unrelated/repo.git");
		expect(() => solvePublicationSnapshot(origin, input)).toThrow("remote");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
