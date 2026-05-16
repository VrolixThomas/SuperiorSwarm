import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../../src/main/db";
import { ftsDelete, ftsSearch, ftsUpsert } from "../../src/main/memory/fts";

beforeAll(() => {
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
});

beforeEach(() => {
	const db = getDb();
	db.$client.prepare("DELETE FROM memory_fts").run();
});

test("ftsUpsert inserts then replaces rows by (kind, ref_id)", () => {
	ftsUpsert({ kind: "goal", refId: "g1", projectId: "p1", body: "auth rewrite" });
	ftsUpsert({ kind: "goal", refId: "g1", projectId: "p1", body: "auth migration plan" });

	const hits = ftsSearch({ projectId: "p1", query: "migration" });
	expect(hits.length).toBe(1);
	expect(hits[0]?.refId).toBe("g1");
});

test("ftsDelete removes only the matching row", () => {
	ftsUpsert({ kind: "goal", refId: "g1", projectId: "p1", body: "alpha" });
	ftsUpsert({ kind: "decision", refId: "d1", projectId: "p1", body: "alpha bravo" });

	ftsDelete({ kind: "goal", refId: "g1" });
	const hits = ftsSearch({ projectId: "p1", query: "alpha" });

	expect(hits.length).toBe(1);
	expect(hits[0]?.kind).toBe("decision");
});

test("ftsSearch can filter by kinds", () => {
	ftsUpsert({ kind: "goal", refId: "g1", projectId: "p1", body: "alpha" });
	ftsUpsert({ kind: "journal", refId: "j1", projectId: "p1", body: "alpha" });

	const hits = ftsSearch({ projectId: "p1", query: "alpha", kinds: ["journal"] });
	expect(hits.length).toBe(1);
	expect(hits[0]?.kind).toBe("journal");
});

test("ftsSearch scopes by projectId", () => {
	ftsUpsert({ kind: "goal", refId: "g1", projectId: "p1", body: "alpha" });
	ftsUpsert({ kind: "goal", refId: "g2", projectId: "p2", body: "alpha" });

	const hits = ftsSearch({ projectId: "p1", query: "alpha" });
	expect(hits.length).toBe(1);
	expect(hits[0]?.refId).toBe("g1");
});
