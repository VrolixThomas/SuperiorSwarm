import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { _setDbForTesting } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import {
	_resetWorktreeCleanupQueueForTesting,
	_setWorktreeCleanupQueueForTesting,
	createWorktreeCleanupQueue,
} from "../src/main/services/worktree-cleanup-queue";
import { removeWorkspace } from "../src/main/services/workspace-service";

describe("removeWorkspace fast-path", () => {
	test("returns before forceRemove resolves and deletes DB rows synchronously", async () => {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: "src/main/db/migrations" });
		_setDbForTesting(db);

		const projectId = "p1";
		const workspaceId = "w1";
		const worktreeId = "wt1";
		const now = new Date();

		// Create real tmp directories so existsSync returns true
		const wtPath = mkdtempSync(join(tmpdir(), "ss-test-wt-"));
		const repoPath = mkdtempSync(join(tmpdir(), "ss-test-repo-"));

		// Seed the DB with the minimum required rows
		db.insert(schema.projects)
			.values({
				id: projectId,
				name: "Test Project",
				repoPath,
				defaultBranch: "main",
				status: "ready",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		db.insert(schema.worktrees)
			.values({
				id: worktreeId,
				projectId,
				path: wtPath,
				branch: "feature/test",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		db.insert(schema.workspaces)
			.values({
				id: workspaceId,
				projectId,
				type: "worktree",
				name: "feature/test",
				worktreeId,
				terminalId: null,
				currentPhase: "idle",
				isOrchestrator: false,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		// Replace the queue with one whose forceRemove blocks until released
		let released = false;
		let releaseResolve: (() => void) | undefined;
		const blocked = new Promise<void>((r) => {
			releaseResolve = r;
		});
		const queue = createWorktreeCleanupQueue({
			graceMs: 0,
			forceRemove: async () => {
				await blocked;
				released = true;
			},
		});
		_setWorktreeCleanupQueueForTesting(queue);

		const start = Date.now();
		const result = await removeWorkspace({ projectId, workspaceId, force: true });
		const elapsed = Date.now() - start;

		expect(result.status).toBe("removed");
		expect(elapsed).toBeLessThan(500);
		expect(released).toBe(false);
		expect(
			db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).all()
				.length
		).toBe(0);
		expect(
			db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).all().length
		).toBe(0);
		expect(queue.pendingCount()).toBe(1);

		releaseResolve?.();
		await queue.drain();
		rmSync(wtPath, { recursive: true, force: true });
		rmSync(repoPath, { recursive: true, force: true });
		_resetWorktreeCleanupQueueForTesting();
		_setDbForTesting(null);
	});
});
