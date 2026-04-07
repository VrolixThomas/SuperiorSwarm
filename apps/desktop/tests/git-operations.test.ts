import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createWorktree,
	extractRepoName,
	initRepo,
	listBranches,
	listWorktrees,
	parseCommitsAhead,
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
	const testDir = join(realpathSync(tmpdir()), `superiorswarm-test-${Date.now()}`);
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
	const testDir = join(realpathSync(tmpdir()), `superiorswarm-branches-${Date.now()}`);
	const originPath = join(testDir, "origin");
	const repoPath = join(testDir, "repo");

	beforeAll(async () => {
		mkdirSync(testDir, { recursive: true });

		// Create a bare "origin" with two branches
		await initRepo(originPath, "main");
		const originGit = (await import("simple-git")).default(originPath);
		await originGit.raw(["commit", "--allow-empty", "-m", "initial commit"]);
		await originGit.branch(["remote-only"]);

		// Clone so the repo has a real remote
		const sg = (await import("simple-git")).default();
		await sg.clone(originPath, repoPath);
		const git = (await import("simple-git")).default(repoPath);
		await git.branch(["local-only"]);
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("lists both local and remote branches", async () => {
		const branches = await listBranches(repoPath);
		expect(branches).toContain("main");
		expect(branches).toContain("local-only");
		expect(branches).toContain("remote-only");
	});

	test("does not include HEAD pointer entries", async () => {
		const branches = await listBranches(repoPath);
		expect(branches.some((b) => b.includes("HEAD"))).toBe(false);
	});
});

describe("parseCommitsAhead", () => {
	test("parses a single-commit single-file modification", () => {
		const raw = [
			"__C__|abc123|abc1|2 days ago|fix: bug",
			"",
			":100644 100644 0000000 0000000 M\tsrc/foo.ts",
			"5\t2\tsrc/foo.ts",
		].join("\n");

		const commits = parseCommitsAhead(raw);
		expect(commits).toHaveLength(1);
		const c = commits[0];
		expect(c?.hash).toBe("abc123");
		expect(c?.shortHash).toBe("abc1");
		expect(c?.time).toBe("2 days ago");
		expect(c?.message).toBe("fix: bug");
		expect(c?.additions).toBe(5);
		expect(c?.deletions).toBe(2);
		expect(c?.files).toEqual([
			{
				path: "src/foo.ts",
				status: "modified",
				additions: 5,
				deletions: 2,
				hunks: [],
			},
		]);
	});

	test("parses multiple commits in order", () => {
		const raw = [
			"__C__|aaa|aa|now|first",
			"",
			":100644 100644 0 0 M\ta.ts",
			"1\t0\ta.ts",
			"__C__|bbb|bb|earlier|second",
			"",
			":100644 100644 0 0 M\tb.ts",
			"3\t1\tb.ts",
		].join("\n");

		const commits = parseCommitsAhead(raw);
		expect(commits.map((c) => c.shortHash)).toEqual(["aa", "bb"]);
		expect(commits[0]?.files[0]?.path).toBe("a.ts");
		expect(commits[1]?.files[0]?.path).toBe("b.ts");
	});

	test("maps git status letters to renderer palette", () => {
		const raw = [
			"__C__|h|h|t|m",
			"",
			":000000 100644 0 0 A\tnew.ts",
			":100644 000000 0 0 D\told.ts",
			":100644 100644 0 0 M\tmod.ts",
			":100644 100644 0 0 R100\tfrom.ts\tto.ts",
			"10\t0\tnew.ts",
			"0\t5\told.ts",
			"3\t3\tmod.ts",
			"0\t0\tfrom.ts => to.ts",
		].join("\n");

		const commits = parseCommitsAhead(raw);
		const c = commits[0];
		expect(c?.files.find((f) => f.path === "new.ts")?.status).toBe("added");
		expect(c?.files.find((f) => f.path === "old.ts")?.status).toBe("deleted");
		expect(c?.files.find((f) => f.path === "mod.ts")?.status).toBe("modified");
		const renamed = c?.files.find((f) => f.status === "renamed");
		expect(renamed?.path).toBe("to.ts");
		expect(renamed?.oldPath).toBe("from.ts");
	});

	test("handles binary files (numstat shows -\\t-)", () => {
		const raw = ["__C__|h|h|t|m", "", ":100644 100644 0 0 M\timage.png", "-\t-\timage.png"].join(
			"\n"
		);

		const commits = parseCommitsAhead(raw);
		const file = commits[0]?.files[0];
		expect(file?.path).toBe("image.png");
		expect(file?.additions).toBe(0);
		expect(file?.deletions).toBe(0);
	});

	test("collapses compact rename notation `{old => new}` from numstat onto the raw entry", () => {
		const raw = [
			"__C__|h|h|t|m",
			"",
			":100644 100644 0 0 R100\tdir/old.ts\tdir/new.ts",
			"0\t0\tdir/{old.ts => new.ts}",
		].join("\n");

		const commits = parseCommitsAhead(raw);
		const file = commits[0]?.files[0];
		expect(file?.path).toBe("dir/new.ts");
		expect(file?.status).toBe("renamed");
	});

	test("returns empty array for empty input", () => {
		expect(parseCommitsAhead("")).toEqual([]);
	});

	test("commit message can contain pipe characters", () => {
		const raw = [
			"__C__|h|h|t|fix: foo | bar | baz",
			"",
			":100644 100644 0 0 M\ta.ts",
			"1\t1\ta.ts",
		].join("\n");

		const commits = parseCommitsAhead(raw);
		expect(commits[0]?.message).toBe("fix: foo | bar | baz");
	});
});
