import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { RepoWatcher } from "../src/main/git/repo-watcher";
import { initRepo } from "../src/main/git/operations";
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
});
