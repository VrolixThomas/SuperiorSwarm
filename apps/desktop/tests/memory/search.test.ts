import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import { memory } from "../../src/main/memory";

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
	db.delete(schema.memoryDecisions).run();
	db.delete(schema.memoryOpenQuestions).run();
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

test("memory.search ranks hits across kinds", () => {
	memory.addGoal({ projectId: PROJECT_ID, title: "Ship auth rewrite" });
	memory.logDecision({
		projectId: PROJECT_ID,
		title: "Pick OIDC",
		rationale: "auth rewrite needs SSO",
	});
	memory.addQuestion({
		projectId: PROJECT_ID,
		question: "When do we cut over to new auth?",
	});

	const hits = memory.search({ projectId: PROJECT_ID, query: "auth" });
	expect(hits.length).toBe(3);
	const kinds = new Set(hits.map((h) => h.kind));
	expect(kinds.has("goal")).toBe(true);
	expect(kinds.has("decision")).toBe(true);
	expect(kinds.has("question")).toBe(true);
});

test("memory.search respects kinds filter", () => {
	memory.addGoal({ projectId: PROJECT_ID, title: "X" });
	memory.logDecision({
		projectId: PROJECT_ID,
		title: "X",
		rationale: "X",
	});

	const hits = memory.search({
		projectId: PROJECT_ID,
		query: "X",
		kinds: ["decision"],
	});
	expect(hits.length).toBe(1);
	expect(hits[0]?.kind).toBe("decision");
});
