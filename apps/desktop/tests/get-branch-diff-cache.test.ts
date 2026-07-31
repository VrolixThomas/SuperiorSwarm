import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { getBranchDiffCached } from "../src/main/git/cached-ops";
import { createWorktree, initRepo } from "../src/main/git/operations";
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

	test("compares against origin when the local base branch is behind", async () => {
		const testDir = join(TEST_ROOT, `cache-remote-base-${Date.now()}-${Math.random()}`);
		const originPath = join(testDir, "origin");
		const clonePath = join(testDir, "clone");
		const worktreePath = join(testDir, "worktree");

		try {
			await initRepo(originPath, "main");
			const originGit = simpleGit(originPath);
			writeFileSync(join(originPath, "shared.txt"), "one\n");
			await originGit.add(["shared.txt"]);
			await originGit.commit("initial");
			await simpleGit().clone(originPath, clonePath);

			writeFileSync(join(originPath, "shared.txt"), "two\n");
			await originGit.add(["shared.txt"]);
			await originGit.commit("remote base update");

			await createWorktree(clonePath, worktreePath, "feature/x", "main");
			const worktreeGit = simpleGit(worktreePath);
			writeFileSync(join(worktreePath, "feature.txt"), "feature\n");
			await worktreeGit.add(["feature.txt"]);
			await worktreeGit.commit("feature change");
			const featureBase = (await worktreeGit.raw(["merge-base", "main", "feature/x"])).trim();

			writeFileSync(join(originPath, "shared.txt"), "three\n");
			await originGit.add(["shared.txt"]);
			await originGit.commit("later remote base update");
			await worktreeGit.fetch("origin", "main");

			const result = await getBranchDiffCached({
				repoPath: worktreePath,
				baseBranch: "main",
				headBranch: "feature/x",
			});

			expect(result.baseRef).toBe("refs/remotes/origin/main");
			expect(result.mergeBase).toBe(featureBase);
			expect(result.files.map((file) => file.path)).toEqual(["feature.txt"]);
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});
});
