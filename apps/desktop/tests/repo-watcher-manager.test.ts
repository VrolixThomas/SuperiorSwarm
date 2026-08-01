import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

	test("suspend closes the watcher, drops events, and blocks resubscription", async () => {
		let events = 0;
		const off = await manager.subscribe(repoPath, () => events++);
		await manager.suspend(repoPath, "cleanup-job");

		expect(manager.isSuspended(repoPath)).toBe(true);
		expect(manager.isWatching(repoPath)).toBe(false);
		const suspendedOff = await manager.subscribe(repoPath, () => events++);
		writeFileSync(join(repoPath, "after-suspend.txt"), "ignored");
		await new Promise((resolve) => setTimeout(resolve, 400));

		expect(events).toBe(0);
		expect(manager.activeCount(repoPath)).toBe(2);
		await suspendedOff();
		await off();
	});

	test("resume restarts the watcher with its existing subscriptions", async () => {
		let resolveEvent: (() => void) | undefined;
		const eventReceived = new Promise<void>((resolve) => {
			resolveEvent = resolve;
		});
		const off = await manager.subscribe(repoPath, () => resolveEvent?.());
		await manager.suspend(repoPath, "cleanup-job");
		await manager.resume(repoPath);
		expect(manager.isSuspended(repoPath)).toBe(false);
		expect(manager.isWatching(repoPath)).toBe(true);

		writeFileSync(join(repoPath, "after-resume.txt"), "observed");
		await Promise.race([
			eventReceived,
			Bun.sleep(2_000).then(() => {
				throw new Error("Timed out waiting for resumed watcher event");
			}),
		]);
		await off();
	});

	test("resume starts subscriptions registered while the path was suspended", async () => {
		await manager.suspend(repoPath, "startup-recovery");
		const off = await manager.subscribe(repoPath, () => {});
		expect(manager.activeCount(repoPath)).toBe(1);
		expect(manager.isWatching(repoPath)).toBe(false);

		await manager.resume(repoPath);
		expect(manager.isWatching(repoPath)).toBe(true);
		await off();
	});
});
