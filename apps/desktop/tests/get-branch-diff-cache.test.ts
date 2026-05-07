import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { getBranchDiffCached } from "../src/main/git/cached-ops";
import { initRepo } from "../src/main/git/operations";
import { bumpRepoStateVersion } from "../src/main/git/repo-state-version";

const TEST_ROOT = realpathSync(tmpdir());

let repoPath: string;

beforeEach(async () => {
	repoPath = join(TEST_ROOT, `cache-test-${Date.now()}-${Math.random()}`);
	mkdirSync(repoPath, { recursive: true });
	await initRepo(repoPath, "main");
	await simpleGit(repoPath).raw(["commit", "--allow-empty", "-m", "init"]);
	await simpleGit(repoPath).checkoutLocalBranch("feature/x");
	writeFileSync(join(repoPath, "f.txt"), "x");
	await simpleGit(repoPath).add(["f.txt"]);
	await simpleGit(repoPath).commit("add f");
});

afterEach(() => {
	rmSync(repoPath, { recursive: true, force: true });
});

describe("getBranchDiffCached", () => {
	test("returns identical reference on cache hit", async () => {
		const a = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		const b = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		expect(b).toBe(a);
	});

	test("recomputes after state version bump", async () => {
		const a = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		bumpRepoStateVersion(repoPath);
		const b = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		expect(b).not.toBe(a);
	});
});
