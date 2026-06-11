import "./preload-electron-mock";
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../src/main/db";

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

describe("folder project schema", () => {
	test("projects.kind defaults to repo and accepts folder", () => {
		const db = getDb();
		const now = new Date();
		const repoId = `proj-${nanoid(8)}`;
		const folderId = `proj-${nanoid(8)}`;

		db.insert(schema.projects)
			.values({
				id: repoId,
				name: "r",
				repoPath: `/tmp/schema-test-${repoId}`,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.projects)
			.values({
				id: folderId,
				name: "f",
				repoPath: `/tmp/schema-test-${folderId}`,
				kind: "folder",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		const repo = db.select().from(schema.projects).where(eq(schema.projects.id, repoId)).get();
		const folder = db.select().from(schema.projects).where(eq(schema.projects.id, folderId)).get();
		expect(repo?.kind).toBe("repo");
		expect(folder?.kind).toBe("folder");

		db.delete(schema.projects).where(eq(schema.projects.id, repoId)).run();
		db.delete(schema.projects).where(eq(schema.projects.id, folderId)).run();
	});

	test("workspaces accept type folder with folderPath", () => {
		const db = getDb();
		const now = new Date();
		const projectId = `proj-${nanoid(8)}`;
		const wsId = `ws-${nanoid(8)}`;
		db.insert(schema.projects)
			.values({
				id: projectId,
				name: "f",
				repoPath: `/tmp/schema-test-${projectId}`,
				kind: "folder",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.workspaces)
			.values({
				id: wsId,
				projectId,
				type: "folder",
				name: "api",
				worktreeId: null,
				terminalId: null,
				folderPath: "/tmp/somewhere/api",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		const ws = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)).get();
		expect(ws?.type).toBe("folder");
		expect(ws?.folderPath).toBe("/tmp/somewhere/api");

		db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
	});
});
