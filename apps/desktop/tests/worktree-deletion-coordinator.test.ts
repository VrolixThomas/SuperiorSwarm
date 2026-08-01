import "./preload-electron-mock";
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { CleanupJobStore } from "../src/cleanup-daemon/job-store";
import { _setDbForTesting } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import {
	disposeRepoWatcherManager,
	getRepoWatcherManager,
} from "../src/main/git/repo-watcher-instance";
import { serverManager } from "../src/main/lsp/server-manager";
import {
	activatePendingCleanupJobs,
	createCleanupJob,
	listJobsNeedingCleanupQuiescence,
} from "../src/main/services/worktree-cleanup-job-store";
import {
	disposeRecoveredCleanupTerminals,
	prepareWorktreeDeletion,
} from "../src/main/services/worktree-deletion-coordinator";

const roots: string[] = [];

afterEach(async () => {
	_setDbForTesting(null);
	await disposeRepoWatcherManager();
	for (const root of roots.splice(0)) {
		serverManager.resumeRepo(root);
		rmSync(root, { recursive: true, force: true });
	}
});

describe("worktree deletion coordination", () => {
	test("disposes and confirms daemon sessions under recovered cleanup paths", async () => {
		const currentSessions = new Map([
			["original", { id: "original", cwd: "/tmp/project-worktree", pid: 1 }],
			["nested", { id: "nested", cwd: "/tmp/project-worktree/packages/app", pid: 2 }],
			["staged", { id: "staged", cwd: "/tmp/.superiorswarm-cleanup/job-1", pid: 3 }],
			["sibling", { id: "sibling", cwd: "/tmp/project-worktree-copy", pid: 4 }],
		]);
		const disposed: string[] = [];
		const daemon = {
			listSessionsStrict: async () => [...currentSessions.values()],
			dispose: (id: string) => {
				disposed.push(id);
				currentSessions.delete(id);
			},
		};

		await expect(
			disposeRecoveredCleanupTerminals(daemon, [
				{
					originalPath: "/tmp/project-worktree",
					stagingPath: "/tmp/.superiorswarm-cleanup/job-1",
				},
			])
		).resolves.toEqual(["original", "nested", "staged"]);
		expect(disposed).toEqual(["original", "nested", "staged"]);
		expect([...currentSessions.keys()]).toEqual(["sibling"]);
	});

	test("fails closed when recovered daemon sessions cannot be listed", async () => {
		const daemon = {
			listSessionsStrict: async () => {
				throw new Error("terminal daemon disconnected");
			},
			dispose: () => {
				throw new Error("dispose must not run without a session listing");
			},
		};

		await expect(
			disposeRecoveredCleanupTerminals(daemon, [
				{
					originalPath: "/tmp/project-worktree",
					stagingPath: "/tmp/.superiorswarm-cleanup/job-1",
				},
			])
		).rejects.toThrow("terminal daemon disconnected");
	});

	test("preparing a job leaves existing watcher and LSP state untouched", async () => {
		const repoPath = mkdtempSync(join(tmpdir(), "ss-deletion-rollback-"));
		roots.push(repoPath);
		execFileSync("git", ["init", "-q", "-b", "main", repoPath]);

		const watcherManager = getRepoWatcherManager();
		const off = await watcherManager.subscribe(repoPath, () => {});
		const lspSuspensions = (serverManager as unknown as { suspendedRepoPaths: Set<string> })
			.suspendedRepoPaths;

		await prepareWorktreeDeletion({
			repoPath: join(repoPath, "..", "main-repo"),
			originalPath: repoPath,
		});

		expect(watcherManager.isWatching(repoPath)).toBe(true);
		expect(watcherManager.activeCount(repoPath)).toBe(1);
		expect(watcherManager.isSuspended(repoPath)).toBe(false);
		expect(lspSuspensions.has(resolve(repoPath))).toBe(false);
		await off();
	});

	test("pending jobs are path-blocking but cannot be claimed until startup activation", async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-pending-cleanup-"));
		roots.push(root);
		const repoPath = join(root, "repo");
		const worktreePath = join(root, "worktree");
		mkdirSync(repoPath, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });

		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
		_setDbForTesting(db);
		const job = await createCleanupJob({ repoPath, originalPath: worktreePath });
		db.insert(schema.worktreeCleanupJobs).values(job).run();

		const daemonStore = new CleanupJobStore(sqlite);
		expect(daemonStore.claimNext("worker-before-activation")).toBeNull();
		expect(listJobsNeedingCleanupQuiescence()).toEqual([
			expect.objectContaining({
				id: job.id,
				originalPath: resolve(worktreePath),
				status: "pending",
			}),
		]);
		expect(activatePendingCleanupJobs()).toBe(1);
		expect(daemonStore.claimNext("worker-after-activation")?.id).toBe(job.id);

		daemonStore.close();
	});
});
