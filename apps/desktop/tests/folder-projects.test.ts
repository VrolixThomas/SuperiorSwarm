import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import simpleGit from "simple-git";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import { openFolderProject } from "../src/main/services/folder-projects";

let TMP: string;
const createdProjectIds: string[] = [];

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(() => {
	TMP = mkdtempSync(join(tmpdir(), "folder-proj-"));
});

afterEach(() => {
	const db = getDb();
	for (const id of createdProjectIds.splice(0)) {
		db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
	}
	rmSync(TMP, { recursive: true, force: true });
});

function track(projectId: string | undefined) {
	if (projectId) createdProjectIds.push(projectId);
}

describe("openFolderProject", () => {
	test("creates a folder project with a default workspace", async () => {
		const dir = join(TMP, "plain");
		mkdirSync(dir);
		const res = await openFolderProject({ path: dir });
		track(res.project?.id);

		expect(res.isGitRepo).toBe(false);
		expect(res.project?.kind).toBe("folder");
		expect(res.project?.name).toBe("plain");
		expect(res.project?.repoPath).toBe(dir);

		const db = getDb();
		const ws = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.projectId, res.project?.id ?? ""))
			.all();
		expect(ws).toHaveLength(1);
		expect(ws[0]?.type).toBe("folder");
		expect(ws[0]?.folderPath).toBeNull();
		expect(ws[0]?.worktreeId).toBeNull();
	});

	test("rejects relative, missing, and file paths", async () => {
		await expect(openFolderProject({ path: "relative/path" })).rejects.toThrow(/absolute/i);
		await expect(openFolderProject({ path: join(TMP, "nope") })).rejects.toThrow(/exist/i);
		const file = join(TMP, "a.txt");
		writeFileSync(file, "x");
		await expect(openFolderProject({ path: file })).rejects.toThrow(/not a folder/i);
	});

	test("returns isGitRepo flag for git repos without creating a project", async () => {
		const dir = join(TMP, "gitty");
		mkdirSync(dir);
		await initRepo(dir, "main");
		const res = await openFolderProject({ path: dir });
		expect(res.isGitRepo).toBe(true);
		expect(res.project).toBeNull();
	});

	test("force opens a git repo as folder", async () => {
		const dir = join(TMP, "gitty2");
		mkdirSync(dir);
		await initRepo(dir, "main");
		const res = await openFolderProject({ path: dir, force: true });
		track(res.project?.id);
		expect(res.project?.kind).toBe("folder");
	});

	test("quick opens a git repo as folder without the flag round-trip", async () => {
		const dir = join(TMP, "gitty3");
		mkdirSync(dir);
		await initRepo(dir, "main");
		await simpleGit(dir).raw(["commit", "--allow-empty", "-m", "init"]);
		const res = await openFolderProject({ path: dir, quick: true });
		track(res.project?.id);
		expect(res.project?.kind).toBe("folder");
	});

	test("is idempotent: existing project at path is returned", async () => {
		const dir = join(TMP, "again");
		mkdirSync(dir);
		const first = await openFolderProject({ path: dir });
		track(first.project?.id);
		const second = await openFolderProject({ path: dir });
		expect(second.project?.id).toBe(first.project?.id);

		const db = getDb();
		const ws = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.projectId, first.project?.id ?? ""))
			.all();
		expect(ws).toHaveLength(1);
	});

	test("expands tilde", async () => {
		// "~" itself always exists; just verify no validation error and no duplicate insert crash.
		const res = await openFolderProject({ path: "~", quick: true });
		track(res.project?.id);
		expect(res.project?.repoPath.startsWith("/")).toBe(true);
	});
});
