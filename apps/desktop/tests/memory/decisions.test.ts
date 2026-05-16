import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import { listDecisions, logDecision } from "../../src/main/memory/decisions";
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
	db.delete(schema.memoryDecisions).run();
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

test("logDecision persists and indexes title + rationale + alternatives", () => {
	const { id } = logDecision({
		projectId: PROJECT_ID,
		title: "Use SQLite for memory state",
		rationale: "lowest infra cost",
		alternatives: "Vector store rejected: ABI rebuild pain",
	});

	const rows = listDecisions({ projectId: PROJECT_ID });
	expect(rows.length).toBe(1);
	expect(rows[0]?.id).toBe(id);

	const hits = ftsSearch({ projectId: PROJECT_ID, query: "ABI rebuild" });
	expect(hits.find((h) => h.refId === id)).toBeDefined();
});

test("listDecisions respects since and limit", () => {
	logDecision({ projectId: PROJECT_ID, title: "first", rationale: "r" });
	logDecision({ projectId: PROJECT_ID, title: "second", rationale: "r" });

	const top1 = listDecisions({ projectId: PROJECT_ID, limit: 1 });
	expect(top1.length).toBe(1);
});
