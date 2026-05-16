import "../preload-electron-mock";
import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import {
	journalAppend,
	journalEnd,
	journalStart,
	readJournal,
	recentJournals,
} from "../../src/main/memory/journal";
import { ftsSearch } from "../../src/main/memory/fts";

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
	db.delete(schema.memoryJournal).run();
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

afterEach(() => {
	rmSync(MEM_ROOT, { recursive: true, force: true });
});

test("journalStart creates the MD file and DB row", () => {
	const { sessionId, filePath } = journalStart({
		userDataPath: MEM_ROOT,
		projectId: PROJECT_ID,
	});
	expect(existsSync(filePath)).toBe(true);
	const rows = recentJournals({ projectId: PROJECT_ID, limit: 5 });
	expect(rows.length).toBe(1);
	expect(rows[0]?.sessionId).toBe(sessionId);
	expect(rows[0]?.endedAt).toBeNull();
});

test("journalAppend appends to file", () => {
	const { sessionId, filePath } = journalStart({
		userDataPath: MEM_ROOT,
		projectId: PROJECT_ID,
	});
	journalAppend({ sessionId, text: "## Did\n- thing\n" });
	journalAppend({ sessionId, text: "## Next\n- other thing\n" });

	const body = readFileSync(filePath, "utf-8");
	expect(body).toContain("## Did");
	expect(body).toContain("## Next");
});

test("journalEnd sets summary and indexes FTS", () => {
	const { sessionId } = journalStart({
		userDataPath: MEM_ROOT,
		projectId: PROJECT_ID,
	});
	journalAppend({ sessionId, text: "first session for memory work" });
	journalEnd({ sessionId, summary: "first memory session" });

	const rows = recentJournals({ projectId: PROJECT_ID, limit: 5 });
	expect(rows[0]?.endedAt).not.toBeNull();
	expect(rows[0]?.summary).toBe("first memory session");

	const hits = ftsSearch({
		projectId: PROJECT_ID,
		query: "first",
		kinds: ["journal"],
	});
	expect(hits.length).toBe(1);
});

test("readJournal returns MD body", () => {
	const { sessionId } = journalStart({
		userDataPath: MEM_ROOT,
		projectId: PROJECT_ID,
	});
	journalAppend({ sessionId, text: "marker-string-xyz" });
	const body = readJournal({ sessionId });
	expect(body).toContain("marker-string-xyz");
});
