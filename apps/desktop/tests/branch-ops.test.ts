import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
	checkoutBranch,
	createBranch,
	deleteBranch,
	getBranchStatus,
	renameBranch,
} from "../src/main/git/branch-ops";
import { initRepo } from "../src/main/git/operations";

const TEST_DIR = realpathSync(tmpdir());
const REPO_PATH = join(TEST_DIR, `branch-ops-test-${Date.now()}`);

beforeAll(async () => {
	mkdirSync(REPO_PATH, { recursive: true });
	await initRepo(REPO_PATH, "main");
	const git = simpleGit(REPO_PATH);
	await git.raw(["commit", "--allow-empty", "-m", "initial commit"]);
});

afterAll(() => {
	rmSync(REPO_PATH, { recursive: true, force: true });
});

describe("createBranch", () => {
	test("creates a new branch from base", async () => {
		await createBranch(REPO_PATH, "feature/test-branch", "main");
		const git = simpleGit(REPO_PATH);
		const branches = await git.branchLocal();
		expect(branches.all).toContain("feature/test-branch");
	});

	test("throws on duplicate branch name", async () => {
		expect(createBranch(REPO_PATH, "feature/test-branch", "main")).rejects.toThrow();
	});
});

describe("checkoutBranch", () => {
	test("switches to existing branch", async () => {
		await checkoutBranch(REPO_PATH, "feature/test-branch");
		const git = simpleGit(REPO_PATH);
		const status = await git.status();
		expect(status.current).toBe("feature/test-branch");
	});

	test("throws on nonexistent branch", async () => {
		expect(checkoutBranch(REPO_PATH, "nonexistent")).rejects.toThrow();
	});
});

describe("renameBranch", () => {
	test("renames a local branch", async () => {
		await checkoutBranch(REPO_PATH, "main");
		await renameBranch(REPO_PATH, "feature/test-branch", "feature/renamed");
		const git = simpleGit(REPO_PATH);
		const branches = await git.branchLocal();
		expect(branches.all).toContain("feature/renamed");
		expect(branches.all).not.toContain("feature/test-branch");
	});
});

describe("deleteBranch", () => {
	test("deletes a local branch", async () => {
		await deleteBranch(REPO_PATH, "feature/renamed", false);
		const git = simpleGit(REPO_PATH);
		const branches = await git.branchLocal();
		expect(branches.all).not.toContain("feature/renamed");
	});

	test("throws when deleting current branch", async () => {
		expect(deleteBranch(REPO_PATH, "main", false)).rejects.toThrow();
	});
});

describe("getBranchStatus", () => {
	test("returns clean status for local-only branch", async () => {
		const status = await getBranchStatus(REPO_PATH);
		expect(status.branch).toBe("main");
		expect(status.state).toBe("clean");
		expect(status.ahead).toBe(0);
		expect(status.behind).toBe(0);
	});
});
