import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import simpleGit from "simple-git";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import {
	createFolderWorkspace,
	openFolderProject,
} from "../src/main/services/folder-projects";

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
		expect(res.project?.repoPath).toBe(realpathSync(dir));

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

describe("createFolderWorkspace", () => {
	async function makeFolderProject(name: string) {
		const dir = join(TMP, name);
		mkdirSync(dir);
		const res = await openFolderProject({ path: dir });
		track(res.project?.id);
		if (!res.project) throw new Error("setup failed");
		return res.project;
	}

	test("creates a folder workspace with null folderPath by default", async () => {
		const project = await makeFolderProject("svc1");
		const created = await createFolderWorkspace({ projectId: project.id, name: "deploy" });

		const db = getDb();
		const ws = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, created.workspaceId))
			.get();
		expect(ws?.type).toBe("folder");
		expect(ws?.name).toBe("deploy");
		expect(ws?.folderPath).toBeNull();
	});

	test("accepts a subfolder of the project path", async () => {
		const project = await makeFolderProject("svc2");
		const sub = join(project.repoPath, "api");
		mkdirSync(sub);
		const created = await createFolderWorkspace({
			projectId: project.id,
			name: "api",
			folderPath: sub,
		});
		expect(created.folderPath).toBe(sub);
	});

	test("normalizes folderPath equal to project path to null", async () => {
		const project = await makeFolderProject("svc3");
		const created = await createFolderWorkspace({
			projectId: project.id,
			name: "root",
			folderPath: project.repoPath,
		});
		expect(created.folderPath).toBeNull();
	});

	test("rejects folderPath outside the project", async () => {
		const project = await makeFolderProject("svc4");
		const outside = join(TMP, "outside");
		mkdirSync(outside);
		await expect(
			createFolderWorkspace({ projectId: project.id, name: "x", folderPath: outside })
		).rejects.toThrow(/inside the project/i);
	});

	test("rejects missing folderPath dir", async () => {
		const project = await makeFolderProject("svc5a");
		await expect(
			createFolderWorkspace({
				projectId: project.id,
				name: "x",
				folderPath: join(project.repoPath, "missing"),
			})
		).rejects.toThrow(/exist/i);
	});

	test("rejects empty name", async () => {
		const project = await makeFolderProject("svc5b");
		await expect(createFolderWorkspace({ projectId: project.id, name: "  " })).rejects.toThrow(
			/empty/i
		);
	});

	test("rejects repo-kind projects", async () => {
		const project = await makeFolderProject("svc5c");
		const db = getDb();
		db.update(schema.projects)
			.set({ kind: "repo" })
			.where(eq(schema.projects.id, project.id))
			.run();
		await expect(createFolderWorkspace({ projectId: project.id, name: "x" })).rejects.toThrow(
			/folder projects/i
		);
	});

	test("rejects duplicate workspace names in the same project", async () => {
		const project = await makeFolderProject("svc6");
		await createFolderWorkspace({ projectId: project.id, name: "dup" });
		await expect(createFolderWorkspace({ projectId: project.id, name: "dup" })).rejects.toThrow(
			/already in use/i
		);
	});
});
