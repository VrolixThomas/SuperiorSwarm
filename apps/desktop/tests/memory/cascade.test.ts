import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import { memory } from "../../src/main/memory";

let PROJECT_ID: string;
let MEM_ROOT: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
});

beforeEach(() => {
	const db = getDb();
	db.$client.prepare("DELETE FROM memory_fts").run();
	db.delete(schema.projects).run();
	PROJECT_ID = `proj-${nanoid(8)}`;
	MEM_ROOT = mkdtempSync(join(tmpdir(), "mem-"));
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

test("deleting a project cascades to all memory tables", () => {
	memory.addGoal({ projectId: PROJECT_ID, title: "g" });
	memory.addFollowup({ projectId: PROJECT_ID, title: "f" });
	memory.logDecision({
		projectId: PROJECT_ID,
		title: "d",
		rationale: "r",
	});
	memory.addQuestion({ projectId: PROJECT_ID, question: "q" });
	memory.journalStart({ userDataPath: MEM_ROOT, projectId: PROJECT_ID });

	const db = getDb();
	db.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();

	expect(memory.listGoals({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.listFollowups({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.listDecisions({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.listQuestions({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.recentJournals({ projectId: PROJECT_ID }).length).toBe(0);

	rmSync(MEM_ROOT, { recursive: true, force: true });
});
