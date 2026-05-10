import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import { createWorkspace } from "../src/main/services/workspace-service";

let TMP: string;
let REPO: string;
let PROJECT_ID: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "ws-svc-"));
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);

	PROJECT_ID = `proj-${nanoid(8)}`;
	const db = getDb();
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			repoPath: REPO,
			name: "repo",
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
});

afterEach(() => {
	const db = getDb();
	db.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

describe("createWorkspace", () => {
	test("creates worktree, workspace, and worktree DB rows", async () => {
		const result = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/x",
			baseBranch: "main",
		});

		expect(result.branch).toBe("feature/x");
		expect(result.baseBranch).toBe("main");
		expect(result.path.endsWith("/feature/x")).toBe(true);

		const db = getDb();
		const ws = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.projectId, PROJECT_ID))
			.all();
		expect(ws).toHaveLength(1);
		expect(ws[0]?.name).toBe("feature/x");
	});

	test("uses project default branch when baseBranch omitted", async () => {
		const result = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/y" });
		expect(result.baseBranch).toBe("main");
	});

	test("throws when project does not exist", async () => {
		await expect(createWorkspace({ projectId: "missing", branch: "feature/z" })).rejects.toThrow(
			/not found/i
		);
	});
});
