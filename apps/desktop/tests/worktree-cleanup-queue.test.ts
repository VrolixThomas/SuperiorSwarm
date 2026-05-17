import { describe, expect, test } from "bun:test";
import { createWorktreeCleanupQueue } from "../src/main/services/worktree-cleanup-queue";

describe("worktree-cleanup-queue", () => {
	test("schedule() returns synchronously and runs cleanup asynchronously", async () => {
		const calls: Array<{ repoPath: string; worktreePath: string }> = [];
		const queue = createWorktreeCleanupQueue({
			graceMs: 0,
			forceRemove: async (repoPath, worktreePath) => {
				calls.push({ repoPath, worktreePath });
			},
		});

		queue.schedule("/repo", "/repo-worktrees/a");
		// Sync return — cleanup has not run yet
		expect(calls.length).toBe(0);
		expect(queue.pendingCount()).toBe(1);

		await queue.drain();
		expect(calls).toEqual([{ repoPath: "/repo", worktreePath: "/repo-worktrees/a" }]);
		expect(queue.pendingCount()).toBe(0);
	});

	test("runs cleanups serially, not in parallel", async () => {
		let active = 0;
		let maxActive = 0;
		const queue = createWorktreeCleanupQueue({
			graceMs: 0,
			forceRemove: async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
			},
		});

		queue.schedule("/repo", "/a");
		queue.schedule("/repo", "/b");
		queue.schedule("/repo", "/c");
		await queue.drain();
		expect(maxActive).toBe(1);
	});

	test("a failing cleanup does not stop the queue", async () => {
		const ran: string[] = [];
		const queue = createWorktreeCleanupQueue({
			graceMs: 0,
			forceRemove: async (_repo, path) => {
				ran.push(path);
				if (path === "/b") throw new Error("boom");
			},
		});

		queue.schedule("/repo", "/a");
		queue.schedule("/repo", "/b");
		queue.schedule("/repo", "/c");
		await queue.drain();
		expect(ran).toEqual(["/a", "/b", "/c"]);
	});
});
