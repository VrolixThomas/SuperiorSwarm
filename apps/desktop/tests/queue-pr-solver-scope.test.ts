import "./preload-electron-mock";
import { beforeAll, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import * as s from "../src/main/db/schema";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
let item: any;
let queued = 0;
let spawned = 0;
const root = mkdtempSync(join(tmpdir(), "ss-solver-proof-"));
const script = join(root, "launch.sh");
writeFileSync(script, "#!/bin/sh\nexit 0\n");
mock.module("../src/main/activity-queue/queue-view", () => ({
	currentExternalQueueItem: () => item,
}));
mock.module("../src/main/activity-queue/pr-scope", () => ({
	currentPRScope: () => ({ accountId: "me", host: "github.com" }),
	isPRQueueItemCurrent: () => true,
}));
mock.module("../src/main/control-plane/confirm-bridge", () => ({
	requestConfirm: async () => true,
}));
mock.module("../src/main/ai-review/orchestrator", () => ({
	getSettings: () => ({ cliPreset: "codex", skipPermissions: false, autoSolveEnabled: false }),
}));
mock.module("../src/main/providers/git-provider", () => ({
	getGitProvider: () => ({
		isConnected: () => true,
		getPRCommentsIfChanged: async () => ({
			changed: true,
			cacheKey: "fresh",
			comments: [
				{
					id: "1",
					author: "new",
					body: "current comments",
					createdAt: "2026-11-22",
					filePath: null,
					lineNumber: null,
					side: null,
				},
			],
		}),
	}),
}));
mock.module("../src/main/ai-review/pr-poller", () => ({ getCachedPRs: () => [] }));
mock.module("../src/main/ai-review/comment-solver-orchestrator", () => ({
	queueSolve: async (sessionId: string) => {
		queued++;
		return { sessionId, worktreePath: root, launchScript: script };
	},
}));
mock.module("../src/main/services/workspace-service", () => ({
	defaultSpawnFn: async () => {
		spawned++;
		return { terminalId: "fake", launch: { cwd: root, title: "fake", scriptPath: script } };
	},
}));
const { solveQueuePRFeedback } = await import("../src/main/activity-queue/pr-solve");
beforeAll(setupTestDb);
test("new queue solver preserves active other-provider session with same PR identifier", async () => {
	const projectId = await seedProject();
	const ws = await seedWorkspace(projectId, { name: "selected" });
	const sibling = await seedWorkspace(projectId, { name: "other-provider" });
	const now = new Date();
	getDb()
		.insert(s.worktrees)
		.values({
			id: "wt",
			projectId,
			path: root,
			branch: "branch",
			baseBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.update(s.workspaces)
		.set({ worktreeId: "wt", prProvider: "github", prIdentifier: "owner/repo#7" })
		.where(eq(s.workspaces.id, ws))
		.run();
	getDb()
		.insert(s.prCommentCache)
		.values({
			id: "stale",
			workspaceId: ws,
			platformCommentId: "1",
			author: "old",
			body: "stale from previous poll",
			createdAt: "2020-01-01",
			fetchedAt: new Date(0),
		})
		.run();
	getDb()
		.insert(s.commentSolveSessions)
		.values({
			id: "sibling-live",
			workspaceId: sibling,
			prProvider: "bitbucket",
			prIdentifier: "owner/repo#7",
			prTitle: "Other provider PR",
			sourceBranch: "other",
			targetBranch: "main",
			status: "in_progress",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(s.commentSolveSessions)
		.values({
			id: "previous-account",
			workspaceId: ws,
			prProvider: "github",
			prIdentifier: "owner/repo#7",
			prTitle: "Old account",
			sourceBranch: "branch",
			targetBranch: "main",
			status: "ready",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(s.sessionState)
		.values({
			key: "comment-solve-scope:previous-account",
			value: JSON.stringify([ws, "github", "github.com", "old-account", "owner/repo#7"]),
		})
		.run();
	getDb()
		.insert(s.prComments)
		.values({
			id: "old-comment",
			solveSessionId: "previous-account",
			platformCommentId: "1",
			author: "old",
			body: "already handled under another account",
			filePath: "",
			status: "open",
		})
		.run();
	item = {
		id: "queue",
		revision: 1,
		kind: "pr-feedback",
		target: {
			type: "pr",
			provider: "github",
			accountId: "me",
			host: "github.com",
			owner: "owner",
			repo: "repo",
			number: 7,
		},
		context: { workspaceId: ws },
	};
	const result = await solveQueuePRFeedback({ id: "queue", revision: 1 });
	console.log(
		JSON.stringify({
			result: result.status,
			queued,
			spawned,
			siblingStillPresent: !!getDb()
				.select()
				.from(s.commentSolveSessions)
				.where(eq(s.commentSolveSessions.id, "sibling-live"))
				.get(),
		})
	);
	expect(spawned).toBe(1);
	if (result.status !== "prepared") throw new Error("Expected prepared launch");
	expect(
		getDb()
			.select()
			.from(s.prComments)
			.where(eq(s.prComments.solveSessionId, result.sessionId))
			.get()?.body
	).toBe("current comments");
	expect(
		getDb()
			.select()
			.from(s.sessionState)
			.where(eq(s.sessionState.key, `comment-solve-scope:${result.sessionId}`))
			.get()?.value
	).toBe(JSON.stringify([ws, "github", "github.com", "me", "owner/repo#7"]));
	expect(
		getDb()
			.select()
			.from(s.commentSolveSessions)
			.where(eq(s.commentSolveSessions.id, "sibling-live"))
			.get()
	).toBeDefined();
});
