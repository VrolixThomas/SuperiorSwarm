import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { initRepo } from "../src/main/git/operations";
import { RepoWatcherManager } from "../src/main/git/repo-watcher-manager";

const TEST_ROOT = realpathSync(tmpdir());

let repoPath: string;
let manager: RepoWatcherManager;

beforeEach(async () => {
	repoPath = join(TEST_ROOT, `rwm-${Date.now()}-${Math.random()}`);
	mkdirSync(repoPath, { recursive: true });
	await initRepo(repoPath, "main");
	await simpleGit(repoPath).raw(["commit", "--allow-empty", "-m", "init"]);
	manager = new RepoWatcherManager();
});

afterEach(async () => {
	await manager.disposeAll();
	rmSync(repoPath, { recursive: true, force: true });
});

describe("RepoWatcherManager", () => {
	test("returns same watcher for same path", async () => {
		const a = await manager.subscribe(repoPath, () => {});
		const b = await manager.subscribe(repoPath, () => {});
		expect(manager.activeCount(repoPath)).toBe(2);
		await a();
		expect(manager.activeCount(repoPath)).toBe(1);
		await b();
		expect(manager.activeCount(repoPath)).toBe(0);
	});

	test("closes watcher when last subscriber leaves", async () => {
		const off = await manager.subscribe(repoPath, () => {});
		expect(manager.isWatching(repoPath)).toBe(true);
		await off();
		expect(manager.isWatching(repoPath)).toBe(false);
	});
});
