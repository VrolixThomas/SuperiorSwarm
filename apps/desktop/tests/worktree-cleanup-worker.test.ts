import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, execFileSync, type spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { CleanupJobStore, CleanupLeaseLostError } from "../src/cleanup-daemon/job-store";
import { PermanentCleanupError } from "../src/cleanup-daemon/path-safety";
import { cleanWorktree, removeTreeIsolated, runGit } from "../src/cleanup-daemon/worktree-cleaner";
import * as schema from "../src/main/db/schema";
import { createCleanupJob } from "../src/main/services/worktree-cleanup-job-store";
import { CLEANUP_LEASE_MS, CLEANUP_MAX_ATTEMPTS } from "../src/shared/worktree-cleanup";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function createFixture() {
	const root = mkdtempSync(join(tmpdir(), "ss-cleanup-worker-"));
	roots.push(root);
	const repoPath = join(root, "repo");
	const worktreePath = join(root, "repo-worktrees", "feature");
	execFileSync("git", ["init", "-q", "-b", "main", repoPath]);
	execFileSync("git", ["-C", repoPath, "config", "user.email", "test@example.com"]);
	execFileSync("git", ["-C", repoPath, "config", "user.name", "Test"]);
	writeFileSync(join(repoPath, "README.md"), "main\n");
	execFileSync("git", ["-C", repoPath, "add", "README.md"]);
	execFileSync("git", ["-C", repoPath, "commit", "-q", "-m", "initial"]);
	execFileSync("git", ["-C", repoPath, "worktree", "add", "-q", "-b", "feature", worktreePath]);
	writeFileSync(join(worktreePath, "large-output.txt"), "work\n");

	const sqlitePath = join(root, "test.db");
	const sqlite = new Database(sqlitePath);
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	const job = {
		...(await createCleanupJob({ repoPath, originalPath: worktreePath })),
		status: "queued" as const,
	};
	db.insert(schema.worktreeCleanupJobs).values(job).run();
	return { repoPath, worktreePath, sqlite, job };
}

describe("detached worktree cleanup worker", () => {
	test("renames, unregisters, and deletes a registered worktree", async () => {
		const { repoPath, worktreePath, sqlite, job } = await createFixture();
		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-test");
		expect(claimed?.id).toBe(job.id);
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await cleanWorktree(claimed, store, "worker-test");

		expect(existsSync(worktreePath)).toBe(false);
		expect(existsSync(job.stagingPath)).toBe(false);
		expect(store.get(job.id).status).toBe("completed");
		const listed = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
			encoding: "utf8",
		});
		expect(listed).not.toContain(worktreePath);
		expect(
			execFileSync("git", ["-C", repoPath, "branch", "--list", "feature"], { encoding: "utf8" })
		).toContain("feature");
		store.close();
	});

	test("cleans a registered worktree containing an initialized submodule", async () => {
		const { repoPath, worktreePath, sqlite, job } = await createFixture();
		const submoduleRepo = join(dirname(repoPath), "submodule-repo");
		execFileSync("git", ["init", "-q", "-b", "main", submoduleRepo]);
		execFileSync("git", ["-C", submoduleRepo, "config", "user.email", "test@example.com"]);
		execFileSync("git", ["-C", submoduleRepo, "config", "user.name", "Test"]);
		writeFileSync(join(submoduleRepo, "README.md"), "submodule\n");
		execFileSync("git", ["-C", submoduleRepo, "add", "README.md"]);
		execFileSync("git", ["-C", submoduleRepo, "commit", "-q", "-m", "initial"]);
		execFileSync("git", [
			"-C",
			worktreePath,
			"-c",
			"protocol.file.allow=always",
			"submodule",
			"add",
			"-q",
			submoduleRepo,
			"nested",
		]);

		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-submodule");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await cleanWorktree(claimed, store, "worker-submodule");

		expect(existsSync(worktreePath)).toBe(false);
		expect(existsSync(job.stagingPath)).toBe(false);
		expect(store.get(job.id).status).toBe("completed");
		const listed = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
			encoding: "utf8",
		});
		expect(listed).not.toContain(worktreePath);
		store.close();
	});

	test("preserves an unrelated worktree registration when its path is unavailable", async () => {
		const { repoPath, worktreePath, sqlite } = await createFixture();
		const unavailablePath = join(dirname(worktreePath), "temporarily-unavailable");
		const offlinePath = join(dirname(worktreePath), "temporarily-unavailable-offline");
		execFileSync("git", [
			"-C",
			repoPath,
			"worktree",
			"add",
			"-q",
			"-b",
			"temporarily-unavailable",
			unavailablePath,
		]);
		renameSync(unavailablePath, offlinePath);

		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-unrelated");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await cleanWorktree(claimed, store, "worker-unrelated");

		const listed = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
			encoding: "utf8",
		});
		expect(listed).not.toContain(worktreePath);
		expect(listed).toContain(unavailablePath);
		expect(existsSync(offlinePath)).toBe(true);
		store.close();
	});

	test("recovers when the process previously crashed after the rename", async () => {
		const { worktreePath, sqlite, job } = await createFixture();
		mkdirSync(dirname(job.stagingPath), { recursive: true });
		renameSync(worktreePath, job.stagingPath);
		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-recovery");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await cleanWorktree(claimed, store, "worker-recovery");

		expect(existsSync(worktreePath)).toBe(false);
		expect(existsSync(job.stagingPath)).toBe(false);
		expect(store.get(job.id).status).toBe("completed");
		store.close();
	});

	test("preserves a replacement registered before the original path is marked reusable", async () => {
		const { repoPath, worktreePath, sqlite, job } = await createFixture();
		mkdirSync(dirname(job.stagingPath), { recursive: true });
		renameSync(worktreePath, job.stagingPath);
		execFileSync("git", ["-C", repoPath, "worktree", "prune", "--expire", "now"]);
		execFileSync("git", [
			"-C",
			repoPath,
			"worktree",
			"add",
			"-q",
			"-b",
			"replacement-before-reusable",
			worktreePath,
		]);
		writeFileSync(join(worktreePath, "replacement.txt"), "keep me\n");
		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-staged-registration");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await cleanWorktree(claimed, store, "worker-staged-registration");

		expect(existsSync(join(worktreePath, "replacement.txt"))).toBe(true);
		expect(existsSync(job.stagingPath)).toBe(false);
		const listed = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
			encoding: "utf8",
		});
		expect(listed).toContain(worktreePath);
		expect(listed).not.toContain(job.stagingPath);
		expect(store.get(job.id).status).toBe("completed");
		store.close();
	});

	test("refuses to rename or delete a replacement at the queued path", async () => {
		const { worktreePath, sqlite, job } = await createFixture();
		rmSync(worktreePath, { recursive: true, force: true });
		mkdirSync(worktreePath, { recursive: true });
		writeFileSync(join(worktreePath, "replacement.txt"), "keep me\n");

		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-replacement");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await expect(cleanWorktree(claimed, store, "worker-replacement")).rejects.toBeInstanceOf(
			PermanentCleanupError
		);
		expect(existsSync(join(worktreePath, "replacement.txt"))).toBe(true);
		expect(existsSync(job.stagingPath)).toBe(false);
		store.close();
	});

	test("falls back to identity-fenced filesystem cleanup when the main checkout is gone", async () => {
		const { repoPath, worktreePath, sqlite, job } = await createFixture();
		rmSync(repoPath, { recursive: true, force: true });
		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-no-repo");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await cleanWorktree(claimed, store, "worker-no-repo");

		expect(existsSync(worktreePath)).toBe(false);
		expect(existsSync(job.stagingPath)).toBe(false);
		expect(store.get(job.id).status).toBe("completed");
		expect(store.get(job.id).path_reusable_at).not.toBeNull();
		store.close();
	});

	test("completes cleanup when the original worktree parent is already gone", async () => {
		const { repoPath, worktreePath, sqlite, job } = await createFixture();
		rmSync(dirname(worktreePath), { recursive: true, force: true });
		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-missing-parent");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");

		await cleanWorktree(claimed, store, "worker-missing-parent");

		expect(store.get(job.id).status).toBe("completed");
		expect(store.get(job.id).path_reusable_at).not.toBeNull();
		const listed = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
			encoding: "utf8",
		});
		expect(listed).not.toContain(worktreePath);
		store.close();
	});

	test("serializes workers and reclaims an expired lease", async () => {
		const { sqlite, job } = await createFixture();
		const store = new CleanupJobStore(sqlite);
		const now = Date.now();
		expect(store.claimNext("worker-one", now)?.id).toBe(job.id);
		expect(store.claimNext("worker-two", now + 1)).toBeNull();
		expect(store.nextWakeDelay(now + 1)).toBe(CLEANUP_LEASE_MS - 1);

		const reclaimed = store.claimNext("worker-two", now + CLEANUP_LEASE_MS);
		expect(reclaimed?.id).toBe(job.id);
		expect(reclaimed?.worker_id).toBe("worker-two");
		expect(reclaimed?.attempts).toBe(2);
		store.close();
	});

	test("fails an expired lease instead of reclaiming beyond the retry cap", async () => {
		const { sqlite, job } = await createFixture();
		const store = new CleanupJobStore(sqlite);
		store.db
			.prepare("UPDATE worktree_cleanup_jobs SET attempts = ? WHERE id = ?")
			.run(CLEANUP_MAX_ATTEMPTS - 1, job.id);
		const now = Date.now();
		expect(store.claimNext("worker-final", now)?.attempts).toBe(CLEANUP_MAX_ATTEMPTS);

		expect(store.claimNext("worker-too-late", now + CLEANUP_LEASE_MS)).toBeNull();
		expect(store.get(job.id)).toMatchObject({
			status: "failed",
			attempts: CLEANUP_MAX_ATTEMPTS,
			worker_id: null,
			lease_expires_at: null,
			next_attempt_at: null,
			last_error: "Cleanup worker lease expired after reaching the retry limit",
		});
		store.close();
	});

	test("fences a stale worker after another worker reclaims its lease", async () => {
		const { repoPath, worktreePath, sqlite, job } = await createFixture();
		const store = new CleanupJobStore(sqlite);
		const now = Date.now();
		const staleClaim = store.claimNext("worker-stale", now);
		if (!staleClaim) throw new Error("Expected cleanup job to be claimed");

		const currentClaim = store.claimNext("worker-current", now + CLEANUP_LEASE_MS);
		if (!currentClaim) throw new Error("Expected expired cleanup job to be reclaimed");

		expect(() => store.heartbeat(job.id, "worker-stale")).toThrow(CleanupLeaseLostError);
		expect(() => store.setPhase(job.id, "worker-stale", "renamed")).toThrow(CleanupLeaseLostError);

		mkdirSync(dirname(job.stagingPath), { recursive: true });
		renameSync(worktreePath, job.stagingPath);
		execFileSync("git", ["-C", repoPath, "worktree", "prune", "--expire", "now"]);
		store.setPhase(job.id, "worker-current", "git_pruned");
		store.markPathReusable(job.id, "worker-current");

		execFileSync("git", [
			"-C",
			repoPath,
			"worktree",
			"add",
			"-q",
			"-b",
			"replacement-after-reclaim",
			worktreePath,
		]);
		writeFileSync(join(worktreePath, "replacement.txt"), "keep me\n");

		await expect(cleanWorktree(staleClaim, store, "worker-stale")).rejects.toBeInstanceOf(
			CleanupLeaseLostError
		);
		expect(existsSync(join(worktreePath, "replacement.txt"))).toBe(true);
		expect(existsSync(job.stagingPath)).toBe(true);
		expect(store.get(job.id).worker_id).toBe("worker-current");
		store.close();
	});

	test("never touches a replacement worktree after the original path becomes reusable", async () => {
		const { repoPath, worktreePath, sqlite, job } = await createFixture();
		mkdirSync(dirname(job.stagingPath), { recursive: true });
		renameSync(worktreePath, job.stagingPath);
		execFileSync("git", ["-C", repoPath, "worktree", "prune", "--expire", "now"]);

		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-reuse");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");
		store.setPhase(job.id, "worker-reuse", "git_pruned");
		store.markPathReusable(job.id, "worker-reuse");

		execFileSync("git", [
			"-C",
			repoPath,
			"worktree",
			"add",
			"-q",
			"-b",
			"replacement",
			worktreePath,
		]);
		writeFileSync(join(worktreePath, "replacement.txt"), "keep me\n");

		await cleanWorktree(store.get(job.id), store, "worker-reuse");

		expect(existsSync(join(worktreePath, "replacement.txt"))).toBe(true);
		expect(existsSync(job.stagingPath)).toBe(false);
		expect(store.get(job.id).status).toBe("completed");
		store.close();
	});

	test("refuses to delete a replacement at the staging path", async () => {
		const { worktreePath, sqlite, job } = await createFixture();
		mkdirSync(dirname(job.stagingPath), { recursive: true });
		renameSync(worktreePath, job.stagingPath);

		const store = new CleanupJobStore(sqlite);
		const claimed = store.claimNext("worker-staging-replacement");
		if (!claimed) throw new Error("Expected cleanup job to be claimed");
		store.markPathReusable(job.id, "worker-staging-replacement");
		rmSync(job.stagingPath, { recursive: true, force: true });
		mkdirSync(job.stagingPath, { recursive: true });
		writeFileSync(join(job.stagingPath, "replacement.txt"), "keep me\n");

		await expect(
			cleanWorktree(store.get(job.id), store, "worker-staging-replacement")
		).rejects.toBeInstanceOf(PermanentCleanupError);
		expect(existsSync(join(job.stagingPath, "replacement.txt"))).toBe(true);
		store.close();
	});

	test("terminates a wedged cleanup Git command within the configured bound", async () => {
		const signals: NodeJS.Signals[] = [];
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			kill(signal?: NodeJS.Signals): boolean;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.kill = (signal = "SIGTERM") => {
			signals.push(signal);
			return true;
		};
		const spawnProcess = (() => child as unknown as ChildProcess) as typeof spawn;

		const startedAt = Date.now();
		await expect(
			runGit("/repo", ["worktree", "list", "--porcelain"], {
				timeoutMs: 40,
				terminateGraceMs: 20,
				spawnProcess,
			})
		).rejects.toThrow("timed out after 40ms");

		expect(Date.now() - startedAt).toBeLessThan(500);
		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	});

	test("terminates a wedged isolated filesystem removal within the configured bound", async () => {
		const signals: NodeJS.Signals[] = [];
		const child = new EventEmitter() as EventEmitter & {
			stderr: PassThrough;
			kill(signal?: NodeJS.Signals): boolean;
		};
		child.stderr = new PassThrough();
		child.kill = (signal = "SIGTERM") => {
			signals.push(signal);
			return true;
		};
		const spawnProcess = (() => child as unknown as ChildProcess) as typeof spawn;

		const startedAt = Date.now();
		await expect(
			removeTreeIsolated(
				"/repo-worktrees/.superiorswarm-cleanup/stuck",
				{ device: "1", inode: "2", birthtimeNs: "3" },
				{
					timeoutMs: 40,
					terminateGraceMs: 20,
					spawnProcess,
				}
			)
		).rejects.toThrow("timed out after 40ms");

		expect(Date.now() - startedAt).toBeLessThan(500);
		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	});

	test("the isolated filesystem process rechecks identity before deleting", async () => {
		const target = mkdtempSync(join(tmpdir(), "ss-isolated-remove-identity-"));
		roots.push(target);
		writeFileSync(join(target, "replacement.txt"), "keep me\n");

		await expect(
			removeTreeIsolated(target, {
				device: "not-the-device",
				inode: "not-the-inode",
				birthtimeNs: "not-the-birthtime",
			})
		).rejects.toBeInstanceOf(PermanentCleanupError);

		expect(existsSync(join(target, "replacement.txt"))).toBe(true);
	});
});
