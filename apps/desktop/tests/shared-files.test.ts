import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SharedFileEntry, symlinkSharedFiles } from "../src/main/shared-files";

describe("symlinkSharedFiles", () => {
	const testDir = join(realpathSync(tmpdir()), `branchflux-shared-${Date.now()}`);
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
		const entries: SharedFileEntry[] = [{ relativePath: ".env" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("created");
		expect(existsSync(join(worktreePath, ".env"))).toBe(true);
		expect(readlinkSync(join(worktreePath, ".env"))).toBe(join(repoPath, ".env"));
	});

	test("skips when source does not exist", async () => {
		const entries: SharedFileEntry[] = [{ relativePath: ".env.nonexistent" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("source_missing");
	});

	test("skips when target already exists", async () => {
		writeFileSync(join(repoPath, ".env.local"), "LOCAL=1");
		writeFileSync(join(worktreePath, ".env.local"), "EXISTING=1");
		const entries: SharedFileEntry[] = [{ relativePath: ".env.local" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("target_exists");
	});

	test("creates parent directories for nested paths", async () => {
		mkdirSync(join(repoPath, "apps", "desktop"), { recursive: true });
		writeFileSync(join(repoPath, "apps", "desktop", ".env"), "NESTED=1");
		const entries: SharedFileEntry[] = [{ relativePath: "apps/desktop/.env" }];

		const results = await symlinkSharedFiles(repoPath, worktreePath, entries);

		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("created");
		expect(existsSync(join(worktreePath, "apps", "desktop", ".env"))).toBe(true);
	});
});
