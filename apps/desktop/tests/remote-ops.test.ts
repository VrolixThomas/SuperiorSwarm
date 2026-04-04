import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { initRepo } from "../src/main/git/operations";
import { fetchAll } from "../src/main/git/remote-ops";

const TEST_DIR = realpathSync(tmpdir());
const REPO_PATH = join(TEST_DIR, `remote-ops-test-${Date.now()}`);

beforeAll(async () => {
	mkdirSync(REPO_PATH, { recursive: true });
	await initRepo(REPO_PATH, "main");
	const git = simpleGit(REPO_PATH);
	await git.raw(["commit", "--allow-empty", "-m", "initial commit"]);
});

afterAll(() => {
	rmSync(REPO_PATH, { recursive: true, force: true });
});

describe("fetchAll", () => {
	test("succeeds on repo with no remotes", async () => {
		await fetchAll(REPO_PATH);
	});
});
