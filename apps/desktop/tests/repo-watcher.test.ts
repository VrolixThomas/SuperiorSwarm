import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { initRepo } from "../src/main/git/operations";
import { RepoWatcher } from "../src/main/git/repo-watcher";
import type { RepoChangeKind } from "../src/shared/types";

const TEST_ROOT = realpathSync(tmpdir());

let repoPath: string;
let watcher: RepoWatcher;

beforeEach(async () => {
	repoPath = join(TEST_ROOT, `repo-watcher-${Date.now()}-${Math.random()}`);
	mkdirSync(repoPath, { recursive: true });
	await initRepo(repoPath, "main");
	await simpleGit(repoPath).raw(["commit", "--allow-empty", "-m", "init"]);
});

afterEach(async () => {
	await watcher?.close();
	rmSync(repoPath, { recursive: true, force: true });
});

async function waitForKind(kind: RepoChangeKind, timeoutMs = 2000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout waiting for ${kind}`)), timeoutMs);
		const off = watcher.on((event) => {
			if (event.kinds.includes(kind)) {
				clearTimeout(timer);
				off();
				resolve();
			}
		});
	});
}

describe("RepoWatcher", () => {
	test("emits 'index' kind when files are staged", async () => {
		watcher = new RepoWatcher(repoPath);
		await watcher.start();

		writeFileSync(join(repoPath, "a.txt"), "hello");
		await simpleGit(repoPath).add(["a.txt"]);

		await waitForKind("index");
	});

	test("emits 'working-tree' kind when a tracked file changes", async () => {
		writeFileSync(join(repoPath, "tracked.txt"), "v1");
		await simpleGit(repoPath).add(["tracked.txt"]);
		await simpleGit(repoPath).commit("add tracked");

		watcher = new RepoWatcher(repoPath);
		await watcher.start();

		writeFileSync(join(repoPath, "tracked.txt"), "v2");
		await waitForKind("working-tree");
	});

	test("emits 'head' kind on branch checkout", async () => {
		const git = simpleGit(repoPath);
		await git.checkoutLocalBranch("feature/x");
		await git.checkout("main");

		watcher = new RepoWatcher(repoPath);
		await watcher.start();

		await git.checkout("feature/x");
		await waitForKind("head");
	});

	test("emits 'refs' kind on commit", async () => {
		watcher = new RepoWatcher(repoPath);
		await watcher.start();

		writeFileSync(join(repoPath, "b.txt"), "b");
		await simpleGit(repoPath).add(["b.txt"]);
		await simpleGit(repoPath).commit("b");
		await waitForKind("refs");
	});

	test("debounces rapid changes into one event", async () => {
		watcher = new RepoWatcher(repoPath);
		await watcher.start();

		const events: RepoChangeKind[][] = [];
		watcher.on((e) => events.push(e.kinds));

		for (let i = 0; i < 5; i++) {
			writeFileSync(join(repoPath, `f${i}.txt`), String(i));
		}

		await new Promise((r) => setTimeout(r, 600));
		expect(events.length).toBeLessThanOrEqual(2);
		expect(events.flat()).toContain("working-tree");
	});
});
