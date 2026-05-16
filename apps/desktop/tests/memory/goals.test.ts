import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import { ftsSearch } from "../../src/main/memory/fts";
import { addGoal, listGoals, updateGoal } from "../../src/main/memory/goals";

let PROJECT_ID: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
});

beforeEach(() => {
	const db = getDb();
	db.$client.prepare("DELETE FROM memory_fts").run();
	db.delete(schema.memoryGoals).run();
	db.delete(schema.projects).run();

	PROJECT_ID = `proj-${nanoid(8)}`;
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			name: "p",
			repoPath: `/tmp/${PROJECT_ID}`,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
});

test("addGoal persists and indexes in FTS", () => {
	const { id } = addGoal({
		projectId: PROJECT_ID,
		title: "Ship orchestrator memory",
		body: "see spec 2026-05-16",
	});

	const goals = listGoals({ projectId: PROJECT_ID });
	expect(goals.length).toBe(1);
	expect(goals[0]?.id).toBe(id);
	expect(goals[0]?.status).toBe("active");

	const hits = ftsSearch({ projectId: PROJECT_ID, query: "orchestrator" });
	expect(hits.find((h) => h.refId === id)).toBeDefined();
});

test("listGoals filters by status", () => {
	const a = addGoal({ projectId: PROJECT_ID, title: "A" });
	addGoal({ projectId: PROJECT_ID, title: "B" });
	updateGoal({ id: a.id, status: "done" });

	const active = listGoals({ projectId: PROJECT_ID, status: "active" });
	const done = listGoals({ projectId: PROJECT_ID, status: "done" });

	expect(active.map((g) => g.title)).toEqual(["B"]);
	expect(done.map((g) => g.title)).toEqual(["A"]);
});

test("updateGoal refreshes FTS body", () => {
	const { id } = addGoal({ projectId: PROJECT_ID, title: "Initial" });
	updateGoal({ id, title: "Renamed Goal", body: "with detail" });

	const hits = ftsSearch({ projectId: PROJECT_ID, query: "renamed" });
	expect(hits.length).toBe(1);
	expect(hits[0]?.refId).toBe(id);
});
