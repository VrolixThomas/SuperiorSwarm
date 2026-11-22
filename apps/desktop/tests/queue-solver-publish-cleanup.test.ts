import "./preload-electron-mock";
import { beforeAll, expect, mock, test } from "bun:test";
import * as child from "node:child_process";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import * as s from "../src/main/db/schema";
import type { GitProvider } from "../src/main/providers/types";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
mock.module("node:child_process", () => ({
	...child,
	execSync: () => Buffer.from("fake push: no process executed"),
}));
mock.module("../src/main/ai-review/orchestrator", () => ({
	getSettings: () => ({ solveAutoResolveThreads: false }),
}));
const { publishGroup, publishSolve } = await import("../src/main/ai-review/solve-publisher");
beforeAll(setupTestDb);
async function fixture(id: string, change: () => void) {
	const db = getDb();
	const projectId = await seedProject();
	const ws = await seedWorkspace(projectId, { name: "cleanup" });
	const now = new Date();
	db.insert(s.worktrees)
		.values({
			id: `wt-${id}`,
			projectId,
			path: `/synthetic-no-push-${id}`,
			branch: "feature",
			baseBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.update(s.workspaces)
		.set({ worktreeId: `wt-${id}` })
		.where(eq(s.workspaces.id, ws))
		.run();
	db.insert(s.commentSolveSessions)
		.values({
			id,
			workspaceId: ws,
			prProvider: "github",
			prIdentifier: "owner/repo#7",
			prTitle: "PR",
			sourceBranch: "feature",
			targetBranch: "main",
			status: "ready",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(s.commentGroups)
		.values({
			id: `group-${id}`,
			solveSessionId: id,
			label: "Approved",
			status: "approved",
			order: 0,
		})
		.run();
	db.insert(s.prComments)
		.values({
			id: `comment-${id}`,
			solveSessionId: id,
			groupId: `group-${id}`,
			platformCommentId: "queue-feedback:thread:1",
			threadId: "thread",
			author: "Reviewer",
			body: "Fix",
			filePath: "file.ts",
			status: "fixed",
		})
		.run();
	db.insert(s.commentReplies)
		.values({
			id: `reply-${id}`,
			prCommentId: `comment-${id}`,
			body: "Approved reply",
			status: "approved",
		})
		.run();
	return {
		provider: {
			replyToComment: async () => {
				change();
				return { id: "sent" };
			},
		} as unknown as GitProvider,
		beforePush: async () => {},
		afterPush: () => {},
	};
}
test("successful network reply cannot overwrite an edit made while it was sending", async () => {
	const guard = await fixture("edited", () =>
		getDb()
			.update(s.commentReplies)
			.set({ body: "Correction", status: "draft" })
			.where(eq(s.commentReplies.id, "reply-edited"))
			.run()
	);
	const result = await publishGroup("group-edited", guard);
	expect(result.errors.join(" ")).toContain("edited while submitting");
	expect(
		getDb().select().from(s.commentReplies).where(eq(s.commentReplies.id, "reply-edited")).get()
	).toMatchObject({ body: "Correction", status: "draft" });
	expect(
		getDb().select().from(s.commentGroups).where(eq(s.commentGroups.id, "group-edited")).get()
			?.status
	).toBe("approved");
});
test("revoked group remains revoked after a successful response", async () => {
	const guard = await fixture("revoked", () =>
		getDb()
			.update(s.commentGroups)
			.set({ status: "fixed" })
			.where(eq(s.commentGroups.id, "group-revoked"))
			.run()
	);
	const result = await publishSolve("revoked", guard);
	expect(result.errors.join(" ")).toContain("approval changed");
	expect(
		getDb().select().from(s.commentGroups).where(eq(s.commentGroups.id, "group-revoked")).get()
			?.status
	).toBe("fixed");
});
