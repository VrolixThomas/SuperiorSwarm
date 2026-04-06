import { describe, expect, test } from "bun:test";

describe("quickActions schema", () => {
	test("quickActions table has the expected columns", async () => {
		const { quickActions } = await import("../src/main/db/schema");
		const columns = Object.keys(quickActions);
		expect(columns).toContain("id");
		expect(columns).toContain("projectId");
		expect(columns).toContain("label");
		expect(columns).toContain("command");
		expect(columns).toContain("cwd");
		expect(columns).toContain("shortcut");
		expect(columns).toContain("sortOrder");
		expect(columns).toContain("createdAt");
		expect(columns).toContain("updatedAt");
	});
});

import { join } from "node:path";
import Database from "better-sqlite3";
import { eq, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { projects, quickActions } from "../src/main/db/schema";

function createTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	return db;
}

function seedProject(db: ReturnType<typeof createTestDb>, id = "proj-1") {
	db.insert(projects)
		.values({
			id,
			name: "Test Project",
			repoPath: "/tmp/test-repo",
			defaultBranch: "main",
			status: "ready",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.run();
	return id;
}

describe("quickActions CRUD", () => {
	test("create and list actions for a project (includes globals)", () => {
		const db = createTestDb();
		const projectId = seedProject(db);

		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId: null,
				label: "Global Build",
				command: "make build",
				sortOrder: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId,
				label: "Test",
				command: "bun test",
				sortOrder: 1,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		const result = db
			.select()
			.from(quickActions)
			.where(or(eq(quickActions.projectId, projectId), isNull(quickActions.projectId)))
			.all();

		expect(result).toHaveLength(2);
		expect(result.map((r) => r.label).sort()).toEqual(["Global Build", "Test"]);
	});

	test("delete cascades when project is deleted", () => {
		const db = createTestDb();
		const projectId = seedProject(db);

		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId,
				label: "Build",
				command: "bun run build",
				sortOrder: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		db.delete(projects).where(eq(projects.id, projectId)).run();
		const result = db.select().from(quickActions).all();
		expect(result).toHaveLength(0);
	});

	test("global actions survive project deletion", () => {
		const db = createTestDb();
		const projectId = seedProject(db);

		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId: null,
				label: "Global",
				command: "echo hello",
				sortOrder: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		db.delete(projects).where(eq(projects.id, projectId)).run();
		const result = db.select().from(quickActions).all();
		expect(result).toHaveLength(1);
		expect(result[0]!.label).toBe("Global");
	});

	test("reorder updates sortOrder values", () => {
		const db = createTestDb();
		const projectId = seedProject(db);
		const ids = [nanoid(), nanoid(), nanoid()];

		for (let i = 0; i < ids.length; i++) {
			db.insert(quickActions)
				.values({
					id: ids[i]!,
					projectId,
					label: `Action ${i}`,
					command: `cmd ${i}`,
					sortOrder: i,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.run();
		}

		const newOrder = [ids[2]!, ids[1]!, ids[0]!];
		for (let i = 0; i < newOrder.length; i++) {
			db.update(quickActions)
				.set({ sortOrder: i, updatedAt: new Date() })
				.where(eq(quickActions.id, newOrder[i]!))
				.run();
		}

		const result = db
			.select()
			.from(quickActions)
			.where(eq(quickActions.projectId, projectId))
			.orderBy(quickActions.sortOrder)
			.all();

		expect(result.map((r) => r.label)).toEqual(["Action 2", "Action 1", "Action 0"]);
	});
});
