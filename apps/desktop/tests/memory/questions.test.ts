import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import {
	addQuestion,
	answerQuestion,
	listQuestions,
} from "../../src/main/memory/questions";
import { ftsSearch } from "../../src/main/memory/fts";

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

test("addQuestion is open by default", () => {
	const { id } = addQuestion({
		projectId: PROJECT_ID,
		question: "Do we want renderer UI?",
	});
	const open = listQuestions({ projectId: PROJECT_ID, status: "open" });
	expect(open.length).toBe(1);
	expect(open[0]?.id).toBe(id);
});

test("answerQuestion moves to answered and updates FTS", () => {
	const { id } = addQuestion({
		projectId: PROJECT_ID,
		question: "Vector backend?",
		context: "for v2",
	});
	answerQuestion({ id, answer: "No — SQLite covers it" });

	const open = listQuestions({ projectId: PROJECT_ID, status: "open" });
	expect(open.length).toBe(0);

	const hits = ftsSearch({ projectId: PROJECT_ID, query: "SQLite" });
	expect(hits.find((h) => h.refId === id)).toBeDefined();
});
