import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	createWorktree,
	extractRepoName,
	initRepo,
	listBranches,
	listWorktrees,
	parseRemoteInfo,
	removeWorktree,
	validateGitUrl,
} from "../src/main/git/operations";

describe("validateGitUrl", () => {
	test("accepts HTTPS GitHub URL", () => {
		expect(validateGitUrl("https://github.com/owner/repo.git")).toBe(true);
	});

	test("accepts HTTPS URL without .git", () => {
		expect(validateGitUrl("https://github.com/owner/repo")).toBe(true);
	});

	test("accepts SSH URL", () => {
		expect(validateGitUrl("git@github.com:owner/repo.git")).toBe(true);
	});

	test("rejects empty string", () => {
		expect(validateGitUrl("")).toBe(false);
	});

	test("rejects random text", () => {
		expect(validateGitUrl("not a url")).toBe(false);
	});
});

describe("extractRepoName", () => {
	test("extracts name from HTTPS URL with .git", () => {
		expect(extractRepoName("https://github.com/owner/repo.git")).toBe("repo");
	});

	test("extracts name from HTTPS URL without .git", () => {
		expect(extractRepoName("https://github.com/owner/repo")).toBe("repo");
	});

	test("extracts name from SSH URL", () => {
		expect(extractRepoName("git@github.com:owner/repo.git")).toBe("repo");
	});
});

describe("parseRemoteInfo", () => {
	test("parses GitHub HTTPS URL", () => {
		expect(parseRemoteInfo("https://github.com/owner/repo.git")).toEqual({
			host: "github.com",
			owner: "owner",
			repo: "repo",
		});
	});

	test("parses GitHub SSH URL", () => {
		expect(parseRemoteInfo("git@github.com:owner/repo.git")).toEqual({
			host: "github.com",
			owner: "owner",
			repo: "repo",
		});
	});

	test("parses GitLab HTTPS URL", () => {
		expect(parseRemoteInfo("https://gitlab.com/owner/repo.git")).toEqual({
			host: "gitlab.com",
			owner: "owner",
			repo: "repo",
		});
	});

	test("parses Bitbucket SSH URL", () => {
		expect(parseRemoteInfo("git@bitbucket.org:team/project.git")).toEqual({
			host: "bitbucket.org",
			owner: "team",
			repo: "project",
		});
	});

	test("parses self-hosted GitLab URL", () => {
		expect(parseRemoteInfo("https://git.company.com/team/app.git")).toEqual({
			host: "git.company.com",
			owner: "team",
			repo: "app",
		});
	});

	test("parses URL without .git suffix", () => {
		expect(parseRemoteInfo("https://github.com/owner/repo")).toEqual({
			host: "github.com",
			owner: "owner",
			repo: "repo",
		});
	});

	test("returns null for invalid URL", () => {
		expect(parseRemoteInfo("not-a-url")).toBeNull();
	});
});

describe("worktree operations", () => {
	const testDir = join(realpathSync(tmpdir()), `branchflux-test-${Date.now()}`);
	const repoPath = join(testDir, "main-repo");
	const worktreePath = join(testDir, "main-repo-worktrees", "feature-test");

	beforeAll(async () => {
		mkdirSync(testDir, { recursive: true });
		await initRepo(repoPath, "main");
		const git = (await import("simple-git")).default(repoPath);
		await git.raw(["commit", "--allow-empty", "-m", "initial commit"]);
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("createWorktree creates a worktree with a new branch", async () => {
		await createWorktree(repoPath, worktreePath, "feature-test", "main");
		const worktrees = await listWorktrees(repoPath);
		expect(worktrees.length).toBeGreaterThanOrEqual(2);
		const found = worktrees.find((w) => w.branch === "feature-test");
		expect(found).toBeDefined();
		expect(found?.path).toBe(worktreePath);
	});

	test("listWorktrees returns all worktrees with branch info", async () => {
		const worktrees = await listWorktrees(repoPath);
		expect(worktrees.length).toBeGreaterThanOrEqual(2);
		const main = worktrees.find((w) => w.branch === "main");
		expect(main).toBeDefined();
	});

	test("removeWorktree removes the worktree", async () => {
		await removeWorktree(repoPath, worktreePath);
		const worktrees = await listWorktrees(repoPath);
		const found = worktrees.find((w) => w.branch === "feature-test");
		expect(found).toBeUndefined();
	});
});

describe("listBranches", () => {
	const testDir = join(realpathSync(tmpdir()), `branchflux-branches-${Date.now()}`);
	const repoPath = join(testDir, "repo");

	beforeAll(async () => {
		mkdirSync(testDir, { recursive: true });
		await initRepo(repoPath, "main");
		const git = (await import("simple-git")).default(repoPath);
		await git.raw(["commit", "--allow-empty", "-m", "initial commit"]);
		await git.branch(["develop"]);
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("lists local branches", async () => {
		const branches = await listBranches(repoPath);
		expect(branches).toContain("main");
		expect(branches).toContain("develop");
	});
});
