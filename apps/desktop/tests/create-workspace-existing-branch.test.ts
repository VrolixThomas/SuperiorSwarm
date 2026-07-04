import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import { createWorkspace } from "../src/main/services/workspace-service";
import { setupTestDb } from "./helpers/db";

let TMP: string;
let REPO: string;
let PROJECT_ID: string;

beforeAll(() => {
	setupTestDb();
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "wt-existing-"));
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);

	PROJECT_ID = `proj-${nanoid(8)}`;
	const now = new Date();
	getDb()
		.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			name: "existing-branch-repo",
			repoPath: REPO,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
});

afterEach(() => {
	getDb().delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

describe("createWorkspace with existing branches", () => {
	test("new branch is created from base (previous behavior)", async () => {
		const res = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/new" });
		expect(res.reusedExistingBranch).toBe(false);
		expect(res.baseBranch).toBe("main");
		expect(existsSync(res.path)).toBe(true);
	});

	test("existing local branch is checked out, not recreated", async () => {
		// Seed a branch with a distinguishing commit, then return to main so the
		// branch is free for worktree checkout.
		const git = simpleGit(REPO);
		await git.raw(["checkout", "-b", "feature/existing"]);
		writeFileSync(join(REPO, "marker.txt"), "on-branch\n");
		await git.add(["marker.txt"]);
		await git.commit("branch commit");
		await git.raw(["checkout", "main"]);

		const res = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/existing" });
		expect(res.reusedExistingBranch).toBe(true);
		// The branch is its own base, mirroring the UI's checkoutExisting flow.
		expect(res.baseBranch).toBe("feature/existing");
		// Worktree has the branch's content — proof it checked out, not forked fresh.
		expect(existsSync(join(res.path, "marker.txt"))).toBe(true);

		const wtBranch = (await simpleGit(res.path).raw(["branch", "--show-current"])).trim();
		expect(wtBranch).toBe("feature/existing");
	});

	test("branch already checked out in another worktree fails cleanly", async () => {
		const git = simpleGit(REPO);
		await git.raw(["checkout", "-b", "feature/busy"]);
		await git.raw(["commit", "--allow-empty", "-m", "busy"]);
		await git.raw(["checkout", "main"]);

		const first = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/busy" });
		expect(first.reusedExistingBranch).toBe(true);

		// Same branch again: git refuses a second checkout, and the DB must not
		// gain a phantom row (unique worktree path also collides).
		await expect(
			createWorkspace({ projectId: PROJECT_ID, branch: "feature/busy" })
		).rejects.toThrow();
	});

	test("existing branch ignores base_branch input", async () => {
		const git = simpleGit(REPO);
		await git.raw(["checkout", "-b", "feature/pinned"]);
		await git.raw(["commit", "--allow-empty", "-m", "pinned"]);
		await git.raw(["checkout", "main"]);
		await git.raw(["checkout", "-b", "other-base"]);
		await git.raw(["checkout", "main"]);

		const res = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/pinned",
			baseBranch: "other-base",
		});
		expect(res.reusedExistingBranch).toBe(true);
		expect(res.baseBranch).toBe("feature/pinned");
	});
});
