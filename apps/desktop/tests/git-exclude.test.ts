import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ensureRepoExclude } from "../src/main/services/git-exclude";

const MARKER = "# superiorswarm: ignore MCP config strays";
const PATTERNS = [".mcp.json", ".gemini/", ".codex/", "opencode.json"];

let TMP: string;

beforeEach(() => {
	TMP = mkdtempSync(join(tmpdir(), "git-exclude-test-"));
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("ensureRepoExclude", () => {
	test("no-op when .git dir is missing", () => {
		const dir = join(TMP, "not-a-repo");
		mkdirSync(dir, { recursive: true });
		// Should not throw
		ensureRepoExclude(dir);
		// No .git/info/exclude created
		expect(existsSync(join(dir, ".git", "info", "exclude"))).toBe(false);
	});

	test("creates marker + patterns in a fresh repo", async () => {
		const repo = join(TMP, "fresh-repo");
		mkdirSync(repo, { recursive: true });
		await simpleGit(repo).init();

		ensureRepoExclude(repo);

		const excludeFile = join(repo, ".git", "info", "exclude");
		expect(existsSync(excludeFile)).toBe(true);
		const content = readFileSync(excludeFile, "utf-8");
		expect(content).toContain(MARKER);
		for (const pattern of PATTERNS) {
			expect(content).toContain(pattern);
		}
	});

	test("idempotent — second call does not duplicate lines", async () => {
		const repo = join(TMP, "idempotent-repo");
		mkdirSync(repo, { recursive: true });
		await simpleGit(repo).init();

		ensureRepoExclude(repo);
		ensureRepoExclude(repo);

		const excludeFile = join(repo, ".git", "info", "exclude");
		const content = readFileSync(excludeFile, "utf-8");

		// Marker appears exactly once
		const markerCount = content.split(MARKER).length - 1;
		expect(markerCount).toBe(1);

		// Each pattern appears exactly once
		for (const pattern of PATTERNS) {
			const lines = content.split("\n").filter((l) => l === pattern);
			expect(lines.length).toBe(1);
		}
	});

	test("appends to existing exclude file content", async () => {
		const repo = join(TMP, "existing-exclude-repo");
		mkdirSync(repo, { recursive: true });
		await simpleGit(repo).init();

		const infoDir = join(repo, ".git", "info");
		mkdirSync(infoDir, { recursive: true });
		const excludeFile = join(infoDir, "exclude");
		writeFileSync(excludeFile, "# pre-existing content\nnode_modules/\n", "utf-8");

		ensureRepoExclude(repo);

		const content = readFileSync(excludeFile, "utf-8");
		expect(content).toContain("# pre-existing content");
		expect(content).toContain("node_modules/");
		expect(content).toContain(MARKER);
		for (const pattern of PATTERNS) {
			expect(content).toContain(pattern);
		}
	});
});
