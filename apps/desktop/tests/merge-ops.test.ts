import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
	abortMerge,
	getConflictContent,
	getConflictingFiles,
	markFileResolved,
	mergeBranch,
} from "../src/main/git/merge-ops";
import { initRepo } from "../src/main/git/operations";

const TEST_DIR = realpathSync(tmpdir());
const REPO_PATH = join(TEST_DIR, `merge-ops-test-${Date.now()}`);

beforeAll(async () => {
	mkdirSync(REPO_PATH, { recursive: true });
	await initRepo(REPO_PATH, "main");
	const git = simpleGit(REPO_PATH);

	// Create a file and initial commit on main
	writeFileSync(join(REPO_PATH, "file.txt"), "line1\nline2\nline3\n");
	await git.add("file.txt");
	await git.commit("initial commit");

	// Create a branch with a conflicting change
	await git.checkoutBranch("conflict-branch", "main");
	writeFileSync(join(REPO_PATH, "file.txt"), "line1\nchanged-by-branch\nline3\n");
	await git.add("file.txt");
	await git.commit("branch change");

	// Go back to main and make a different change to the same line
	await git.checkout("main");
	writeFileSync(join(REPO_PATH, "file.txt"), "line1\nchanged-by-main\nline3\n");
	await git.add("file.txt");
	await git.commit("main change");
});

afterAll(() => {
	rmSync(REPO_PATH, { recursive: true, force: true });
});

describe("mergeBranch", () => {
	test("returns conflict status when merge has conflicts", async () => {
		const result = await mergeBranch(REPO_PATH, "conflict-branch");
		expect(result.status).toBe("conflict");
		expect(result.files).toBeDefined();
		expect(result.files?.length).toBeGreaterThan(0);
	});
});

describe("getConflictingFiles", () => {
	test("lists conflicting files", async () => {
		const files = await getConflictingFiles(REPO_PATH);
		expect(files.length).toBeGreaterThan(0);
		expect(files[0]?.path).toBe("file.txt");
		expect(files[0]?.status).toBe("conflicting");
	});
});

describe("getConflictContent", () => {
	test("returns ours, theirs, and base content", async () => {
		const content = await getConflictContent(REPO_PATH, "file.txt");
		expect(content.ours).toContain("changed-by-main");
		expect(content.theirs).toContain("changed-by-branch");
		expect(content.base).toContain("line2");
	});
});

describe("markFileResolved", () => {
	test("resolves a conflicting file", async () => {
		await markFileResolved(REPO_PATH, "file.txt", "line1\nresolved\nline3\n");
		const files = await getConflictingFiles(REPO_PATH);
		const fileEntry = files.find((f) => f.path === "file.txt");
		expect(fileEntry?.status).toBe("resolved");
	});
});

describe("abortMerge", () => {
	test("aborts an in-progress merge", async () => {
		const git = simpleGit(REPO_PATH);
		await git.raw(["reset", "--hard", "HEAD"]);
		const result = await mergeBranch(REPO_PATH, "conflict-branch");
		expect(result.status).toBe("conflict");

		await abortMerge(REPO_PATH);
		const status = await git.status();
		expect(status.conflicted.length).toBe(0);
	});
});
