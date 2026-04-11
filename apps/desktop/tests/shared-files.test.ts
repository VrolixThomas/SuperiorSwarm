import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPathInsideRepo } from "../src/main/path-utils";
import { type SharedFileEntry, symlinkSharedFiles } from "../src/main/shared-files";

describe("assertPathInsideRepo", () => {
	test("allows a simple filename", () => {
		expect(() => assertPathInsideRepo("/repo", ".env")).not.toThrow();
	});

	test("allows a nested path", () => {
		expect(() => assertPathInsideRepo("/repo", "apps/desktop/.env")).not.toThrow();
	});

	test("rejects .. traversal that escapes the repo", () => {
		expect(() => assertPathInsideRepo("/repo", "../../etc/passwd")).toThrow(
			"Path must be inside the repository"
		);
	});

	test("rejects a single .. that goes to the parent", () => {
		expect(() => assertPathInsideRepo("/repo", "..")).toThrow("Path must be inside the repository");
	});

	test("rejects an absolute path outside the repo", () => {
		expect(() => assertPathInsideRepo("/repo", "/etc/passwd")).toThrow(
			"Path must be inside the repository"
		);
	});

	test("rejects a path that traverses up through the repo root", () => {
		// a/../../../etc resolves to /etc — outside /repo
		expect(() => assertPathInsideRepo("/repo", "a/../../../etc/passwd")).toThrow(
			"Path must be inside the repository"
		);
	});
});

describe("symlinkSharedFiles", () => {
	const testDir = join(realpathSync(tmpdir()), `superiorswarm-shared-${Date.now()}`);
	const repoPath = join(testDir, "main-repo");
	const worktreePath = join(testDir, "main-repo-worktrees", "feature-test");

	beforeAll(() => {
		mkdirSync(repoPath, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("creates symlink for existing file", async () => {
		writeFileSync(join(repoPath, ".env"), "SECRET=123");
		const entries: SharedFileEntry[] = [{ relativePath: ".env", type: "file" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("created");
		expect(existsSync(join(worktreePath, ".env"))).toBe(true);
		expect(readlinkSync(join(worktreePath, ".env"))).toBe(join(repoPath, ".env"));
	});

	test("skips when source does not exist", async () => {
		const entries: SharedFileEntry[] = [{ relativePath: ".env.nonexistent", type: "file" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("source_missing");
	});

	test("skips when target already exists", async () => {
		writeFileSync(join(repoPath, ".env.local"), "LOCAL=1");
		writeFileSync(join(worktreePath, ".env.local"), "EXISTING=1");
		const entries: SharedFileEntry[] = [{ relativePath: ".env.local", type: "file" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("target_exists");
	});

	test("creates parent directories for nested paths", async () => {
		mkdirSync(join(repoPath, "apps", "desktop"), { recursive: true });
		writeFileSync(join(repoPath, "apps", "desktop", ".env"), "NESTED=1");
		const entries: SharedFileEntry[] = [{ relativePath: "apps/desktop/.env", type: "file" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("created");
		expect(existsSync(join(worktreePath, "apps", "desktop", ".env"))).toBe(true);
	});
});

describe("symlinkSharedFiles — directories", () => {
	const testDir = join(realpathSync(tmpdir()), `superiorswarm-dirs-${Date.now()}`);
	const repoPath = join(testDir, "main-repo");
	const worktreePath = join(testDir, "main-repo-worktrees", "feature-test");

	beforeAll(() => {
		mkdirSync(repoPath, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("creates symlink for existing directory", async () => {
		mkdirSync(join(repoPath, "graphify-out"), { recursive: true });
		writeFileSync(join(repoPath, "graphify-out", "graph.json"), "{}");

		const entries: SharedFileEntry[] = [{ relativePath: "graphify-out", type: "directory" }];
		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("created");

		const symlinkPath = join(worktreePath, "graphify-out");
		expect(existsSync(symlinkPath)).toBe(true);
		expect(readlinkSync(symlinkPath)).toBe(join(repoPath, "graphify-out"));
		expect(existsSync(join(symlinkPath, "graph.json"))).toBe(true);
	});

	test("reports source_missing when directory does not exist", async () => {
		const entries: SharedFileEntry[] = [{ relativePath: "nonexistent-dir", type: "directory" }];
		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("source_missing");
	});

	test("reports target_exists when directory symlink already exists", async () => {
		mkdirSync(join(repoPath, "already-linked"), { recursive: true });
		mkdirSync(join(worktreePath, "already-linked"), { recursive: true });

		const entries: SharedFileEntry[] = [{ relativePath: "already-linked", type: "directory" }];
		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("target_exists");
	});

	test("creates parent directories for nested directory entries", async () => {
		mkdirSync(join(repoPath, "nested", "output"), { recursive: true });
		writeFileSync(join(repoPath, "nested", "output", "data.json"), "{}");

		const entries: SharedFileEntry[] = [
			{ relativePath: "nested/output", type: "directory" },
		];
		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("created");
		expect(readlinkSync(join(worktreePath, "nested", "output"))).toBe(
			join(repoPath, "nested", "output")
		);
	});
});
