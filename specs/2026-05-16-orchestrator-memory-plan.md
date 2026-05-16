# Orchestrator Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-scoped persistent memory (goals, follow-ups, decisions, open questions, journal) for orchestrator workspaces, accessed by the orchestrator through MCP tools.

**Architecture:** Five new SQLite tables + one FTS5 virtual table in the existing app DB. Markdown journal files in `<userData>/memory/<projectId>/journal/`. A new `src/main/memory/` module owns CRUD + FTS5 sync + journal file I/O. The `mcp-standalone/server.mjs` workspace-agent mode gains `memory.*` tools that read/write directly against the same SQLite DB.

**Tech Stack:** TypeScript, Drizzle ORM, better-sqlite3, Bun test runner, MCP SDK 1.27, FTS5 (SQLite built-in), nanoid.

Spec: `specs/2026-05-16-orchestrator-memory-design.md`.

---

## File map

Create:
- `apps/desktop/src/main/db/schema-memory.ts` — Drizzle schema for memory tables
- `apps/desktop/src/main/db/migrations/0043_orchestrator_memory.sql` — generated migration (manually patched to include FTS5)
- `apps/desktop/src/main/memory/index.ts` — public API
- `apps/desktop/src/main/memory/paths.ts` — userData → memory root resolver
- `apps/desktop/src/main/memory/fts.ts` — FTS5 dual-write helpers
- `apps/desktop/src/main/memory/journal.ts` — journal MD file I/O
- `apps/desktop/src/main/memory/ids.ts` — id factory (thin wrapper over nanoid)
- `apps/desktop/tests/memory/goals.test.ts`
- `apps/desktop/tests/memory/followups.test.ts`
- `apps/desktop/tests/memory/decisions.test.ts`
- `apps/desktop/tests/memory/questions.test.ts`
- `apps/desktop/tests/memory/journal.test.ts`
- `apps/desktop/tests/memory/fts-search.test.ts`
- `apps/desktop/tests/memory/cascade.test.ts`
- `apps/desktop/tests/memory/mcp-tools.test.ts`

Modify:
- `apps/desktop/src/main/db/schema.ts` — re-export memory schema
- `apps/desktop/src/main/db/index.ts` — pass schema-memory through drizzle `schema` arg (no change if `import * as schema`)
- `apps/desktop/mcp-standalone/server.mjs` — open DB in workspace-agent mode; register memory tools; resolve `MEMORY_ROOT`
- Wherever workspace-agent MCP is spawned — pass `DB_PATH` + `MEMORY_ROOT` env vars (Task 12 confirms exact file)

---

## Task 1: Memory schema (Drizzle)

**Files:**
- Create: `apps/desktop/src/main/db/schema-memory.ts`
- Modify: `apps/desktop/src/main/db/schema.ts`

- [ ] **Step 1: Write `schema-memory.ts`**

```ts
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./schema";

export const memoryGoals = sqliteTable(
	"memory_goals",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		body: text("body"),
		status: text("status", { enum: ["active", "done", "abandoned"] })
			.notNull()
			.default("active"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [index("memory_goals_project_status_idx").on(t.projectId, t.status)]
);

export type MemoryGoal = typeof memoryGoals.$inferSelect;
export type NewMemoryGoal = typeof memoryGoals.$inferInsert;

export const memoryFollowups = sqliteTable(
	"memory_followups",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		goalId: text("goal_id").references(() => memoryGoals.id, {
			onDelete: "set null",
		}),
		title: text("title").notNull(),
		body: text("body"),
		owner: text("owner"),
		dueAt: integer("due_at", { mode: "timestamp" }),
		status: text("status", { enum: ["open", "done", "cancelled"] })
			.notNull()
			.default("open"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [
		index("memory_followups_project_status_idx").on(t.projectId, t.status),
		index("memory_followups_project_due_idx").on(t.projectId, t.dueAt),
	]
);

export type MemoryFollowup = typeof memoryFollowups.$inferSelect;
export type NewMemoryFollowup = typeof memoryFollowups.$inferInsert;

export const memoryDecisions = sqliteTable(
	"memory_decisions",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		rationale: text("rationale").notNull(),
		alternatives: text("alternatives"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [index("memory_decisions_project_idx").on(t.projectId, t.createdAt)]
);

export type MemoryDecision = typeof memoryDecisions.$inferSelect;
export type NewMemoryDecision = typeof memoryDecisions.$inferInsert;

export const memoryOpenQuestions = sqliteTable(
	"memory_open_questions",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		question: text("question").notNull(),
		context: text("context"),
		status: text("status", { enum: ["open", "answered", "stale"] })
			.notNull()
			.default("open"),
		answer: text("answer"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		answeredAt: integer("answered_at", { mode: "timestamp" }),
	},
	(t) => [
		index("memory_questions_project_status_idx").on(t.projectId, t.status),
	]
);

export type MemoryOpenQuestion = typeof memoryOpenQuestions.$inferSelect;
export type NewMemoryOpenQuestion = typeof memoryOpenQuestions.$inferInsert;

export const memoryJournal = sqliteTable(
	"memory_journal",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		filePath: text("file_path").notNull(),
		summary: text("summary"),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		endedAt: integer("ended_at", { mode: "timestamp" }),
	},
	(t) => [index("memory_journal_project_idx").on(t.projectId, t.startedAt)]
);

export type MemoryJournalEntry = typeof memoryJournal.$inferSelect;
export type NewMemoryJournalEntry = typeof memoryJournal.$inferInsert;
```

- [ ] **Step 2: Re-export from `schema.ts`**

Append to `apps/desktop/src/main/db/schema.ts` (do not remove existing content):

```ts
export * from "./schema-memory";
```

- [ ] **Step 3: Type-check**

Run: `bun run type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/db/schema-memory.ts apps/desktop/src/main/db/schema.ts
git commit -m "feat(memory): add Drizzle schema for orchestrator memory tables"
```

---

## Task 2: Migration with FTS5

**Files:**
- Create: `apps/desktop/src/main/db/migrations/0043_orchestrator_memory.sql`
- Modify: `apps/desktop/src/main/db/migrations/meta/_journal.json` (auto)

- [ ] **Step 1: Generate migration with Drizzle**

Run from `apps/desktop/`:

```bash
bun run db:generate --name orchestrator_memory
```

Expected: a new file `0043_orchestrator_memory.sql` containing `CREATE TABLE memory_goals (...)` etc, plus a new snapshot under `meta/`.

- [ ] **Step 2: Append FTS5 virtual table to the generated SQL**

Edit `0043_orchestrator_memory.sql`, append at the bottom:

```sql
--> statement-breakpoint
CREATE VIRTUAL TABLE memory_fts USING fts5(
    kind,
    ref_id,
    project_id UNINDEXED,
    body,
    tokenize = 'porter unicode61'
);
```

Drizzle does not generate FTS5; this is an intentional manual addition.

- [ ] **Step 3: Verify migration applies cleanly in a test**

Add a smoke test at `apps/desktop/tests/memory/migration.test.ts`:

```ts
import "../preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { getDb } from "../../src/main/db";

beforeAll(() => {
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
});

test("memory_fts virtual table exists", () => {
	const db = getDb();
	const rows = db.$client
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'"
		)
		.all();
	expect(rows.length).toBe(1);
});

test("memory_goals table exists", () => {
	const db = getDb();
	const rows = db.$client
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='memory_goals'"
		)
		.all();
	expect(rows.length).toBe(1);
});
```

- [ ] **Step 4: Run the smoke test**

Run from `apps/desktop/`:

```bash
bun test tests/memory/migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/db/migrations/0043_orchestrator_memory.sql \
        apps/desktop/src/main/db/migrations/meta \
        apps/desktop/tests/memory/migration.test.ts
git commit -m "feat(memory): add migration 0043 with FTS5 virtual table"
```

---

## Task 3: Memory paths + ids helpers

**Files:**
- Create: `apps/desktop/src/main/memory/paths.ts`
- Create: `apps/desktop/src/main/memory/ids.ts`
- Create: `apps/desktop/tests/memory/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/desktop/tests/memory/paths.test.ts`:

```ts
import "../preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	memoryRoot,
	projectMemoryRoot,
	journalDir,
	journalFileName,
} from "../../src/main/memory/paths";

describe("memory paths", () => {
	test("memoryRoot returns <root>/memory", () => {
		const root = memoryRoot("/tmp/x");
		expect(root).toBe(join("/tmp/x", "memory"));
	});

	test("projectMemoryRoot scopes by project id", () => {
		expect(projectMemoryRoot("/tmp/x", "proj-1")).toBe(
			join("/tmp/x", "memory", "proj-1")
		);
	});

	test("journalDir scopes under project root", () => {
		expect(journalDir("/tmp/x", "proj-1")).toBe(
			join("/tmp/x", "memory", "proj-1", "journal")
		);
	});

	test("journalFileName encodes started_at and session id", () => {
		const startedAt = new Date("2026-05-16T14:32:09Z");
		expect(journalFileName(startedAt, "sess-abc")).toBe(
			"2026-05-16-143209-sess-abc.md"
		);
	});
});
```

- [ ] **Step 2: Run to confirm it fails**

Run from `apps/desktop/`:

```bash
bun test tests/memory/paths.test.ts
```

Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `paths.ts`**

`apps/desktop/src/main/memory/paths.ts`:

```ts
import { join } from "node:path";

export function memoryRoot(userDataPath: string): string {
	return join(userDataPath, "memory");
}

export function projectMemoryRoot(
	userDataPath: string,
	projectId: string
): string {
	return join(memoryRoot(userDataPath), projectId);
}

export function journalDir(userDataPath: string, projectId: string): string {
	return join(projectMemoryRoot(userDataPath, projectId), "journal");
}

export function journalFileName(startedAt: Date, sessionId: string): string {
	const yyyy = startedAt.getUTCFullYear();
	const mm = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(startedAt.getUTCDate()).padStart(2, "0");
	const hh = String(startedAt.getUTCHours()).padStart(2, "0");
	const mi = String(startedAt.getUTCMinutes()).padStart(2, "0");
	const ss = String(startedAt.getUTCSeconds()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}-${sessionId}.md`;
}
```

- [ ] **Step 4: Implement `ids.ts`**

`apps/desktop/src/main/memory/ids.ts`:

```ts
import { nanoid } from "nanoid";

export function newMemoryId(prefix: string): string {
	return `${prefix}_${nanoid(12)}`;
}
```

- [ ] **Step 5: Run paths tests**

Run from `apps/desktop/`:

```bash
bun test tests/memory/paths.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/memory/paths.ts \
        apps/desktop/src/main/memory/ids.ts \
        apps/desktop/tests/memory/paths.test.ts
git commit -m "feat(memory): add paths and id helpers"
```

---

## Task 4: FTS5 sync helpers

**Files:**
- Create: `apps/desktop/src/main/memory/fts.ts`
- Create: `apps/desktop/tests/memory/fts.test.ts`

The `fts` module is the only module allowed to write to `memory_fts`. CRUD modules call it.

- [ ] **Step 1: Write the failing test**

`apps/desktop/tests/memory/fts.test.ts`:

```ts
import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../../src/main/db";
import { ftsUpsert, ftsDelete, ftsSearch } from "../../src/main/memory/fts";

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
```

- [ ] **Step 2: Run to confirm fail**

```bash
bun test tests/memory/fts.test.ts
```

Expected: FAIL ("Cannot find module fts").

- [ ] **Step 3: Implement `fts.ts`**

`apps/desktop/src/main/memory/fts.ts`:

```ts
import { getDb } from "../db";

export type FtsKind = "goal" | "decision" | "question" | "journal";

export interface FtsUpsertInput {
	kind: FtsKind;
	refId: string;
	projectId: string;
	body: string;
}

export interface FtsDeleteInput {
	kind: FtsKind;
	refId: string;
}

export interface FtsSearchInput {
	projectId: string;
	query: string;
	kinds?: FtsKind[];
	limit?: number;
}

export interface FtsHit {
	kind: FtsKind;
	refId: string;
	projectId: string;
	snippet: string;
	rank: number;
}

export function ftsUpsert(input: FtsUpsertInput): void {
	const sqlite = getDb().$client;
	sqlite
		.prepare(
			"DELETE FROM memory_fts WHERE kind = ? AND ref_id = ?"
		)
		.run(input.kind, input.refId);
	sqlite
		.prepare(
			"INSERT INTO memory_fts (kind, ref_id, project_id, body) VALUES (?, ?, ?, ?)"
		)
		.run(input.kind, input.refId, input.projectId, input.body);
}

export function ftsDelete(input: FtsDeleteInput): void {
	const sqlite = getDb().$client;
	sqlite
		.prepare("DELETE FROM memory_fts WHERE kind = ? AND ref_id = ?")
		.run(input.kind, input.refId);
}

export function ftsSearch(input: FtsSearchInput): FtsHit[] {
	const sqlite = getDb().$client;
	const limit = input.limit ?? 50;
	const kindFilter =
		input.kinds && input.kinds.length > 0
			? `AND kind IN (${input.kinds.map(() => "?").join(",")})`
			: "";
	const stmt = sqlite.prepare(
		`SELECT kind, ref_id AS refId, project_id AS projectId,
		        snippet(memory_fts, 3, '[', ']', '...', 16) AS snippet,
		        bm25(memory_fts) AS rank
		   FROM memory_fts
		  WHERE project_id = ? AND memory_fts MATCH ? ${kindFilter}
		  ORDER BY rank
		  LIMIT ?`
	);
	const params: unknown[] = [input.projectId, input.query];
	if (input.kinds && input.kinds.length > 0) params.push(...input.kinds);
	params.push(limit);
	return stmt.all(...params) as FtsHit[];
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
bun test tests/memory/fts.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/memory/fts.ts apps/desktop/tests/memory/fts.test.ts
git commit -m "feat(memory): add FTS5 sync helpers (upsert, delete, search)"
```

---

## Task 5: Goals CRUD

**Files:**
- Create: `apps/desktop/src/main/memory/goals.ts`
- Create: `apps/desktop/tests/memory/goals.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/desktop/tests/memory/goals.test.ts`:

```ts
import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import { addGoal, listGoals, updateGoal } from "../../src/main/memory/goals";
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
```

- [ ] **Step 2: Run to confirm fail**

```bash
bun test tests/memory/goals.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `goals.ts`**

`apps/desktop/src/main/memory/goals.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memoryGoals, type MemoryGoal } from "../db/schema-memory";
import { ftsDelete, ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";

type GoalStatus = "active" | "done" | "abandoned";

export interface AddGoalInput {
	projectId: string;
	title: string;
	body?: string | null;
}

export function addGoal(input: AddGoalInput): { id: string } {
	const id = newMemoryId("goal");
	const now = new Date();
	getDb()
		.insert(memoryGoals)
		.values({
			id,
			projectId: input.projectId,
			title: input.title,
			body: input.body ?? null,
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	ftsUpsert({
		kind: "goal",
		refId: id,
		projectId: input.projectId,
		body: ftsBody(input.title, input.body),
	});
	return { id };
}

export interface UpdateGoalInput {
	id: string;
	title?: string;
	body?: string | null;
	status?: GoalStatus;
}

export function updateGoal(input: UpdateGoalInput): void {
	const db = getDb();
	const existing = db
		.select()
		.from(memoryGoals)
		.where(eq(memoryGoals.id, input.id))
		.get();
	if (!existing) throw new Error(`goal not found: ${input.id}`);

	const next: Partial<MemoryGoal> = {
		title: input.title ?? existing.title,
		body: input.body === undefined ? existing.body : input.body,
		status: input.status ?? existing.status,
		updatedAt: new Date(),
	};

	db.update(memoryGoals).set(next).where(eq(memoryGoals.id, input.id)).run();

	ftsUpsert({
		kind: "goal",
		refId: input.id,
		projectId: existing.projectId,
		body: ftsBody(next.title ?? existing.title, next.body ?? existing.body),
	});
}

export interface ListGoalsInput {
	projectId: string;
	status?: GoalStatus;
}

export function listGoals(input: ListGoalsInput): MemoryGoal[] {
	const db = getDb();
	const where = input.status
		? and(eq(memoryGoals.projectId, input.projectId), eq(memoryGoals.status, input.status))
		: eq(memoryGoals.projectId, input.projectId);
	return db
		.select()
		.from(memoryGoals)
		.where(where)
		.orderBy(desc(memoryGoals.createdAt))
		.all();
}

export function deleteGoal(id: string): void {
	const db = getDb();
	const row = db.select().from(memoryGoals).where(eq(memoryGoals.id, id)).get();
	if (!row) return;
	db.delete(memoryGoals).where(eq(memoryGoals.id, id)).run();
	ftsDelete({ kind: "goal", refId: id });
}

function ftsBody(title: string, body: string | null | undefined): string {
	return body ? `${title}\n\n${body}` : title;
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
bun test tests/memory/goals.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/memory/goals.ts apps/desktop/tests/memory/goals.test.ts
git commit -m "feat(memory): add goals CRUD with FTS sync"
```

---

## Task 6: Followups CRUD

**Files:**
- Create: `apps/desktop/src/main/memory/followups.ts`
- Create: `apps/desktop/tests/memory/followups.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import {
	addFollowup,
	listFollowups,
	updateFollowup,
} from "../../src/main/memory/followups";

let PROJECT_ID: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
});

beforeEach(() => {
	const db = getDb();
	db.delete(schema.memoryFollowups).run();
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

test("addFollowup defaults to open", () => {
	const { id } = addFollowup({ projectId: PROJECT_ID, title: "Ping user" });
	const all = listFollowups({ projectId: PROJECT_ID });
	expect(all.length).toBe(1);
	expect(all[0]?.id).toBe(id);
	expect(all[0]?.status).toBe("open");
});

test("listFollowups filters by status and owner", () => {
	addFollowup({ projectId: PROJECT_ID, title: "A", owner: "user" });
	const b = addFollowup({ projectId: PROJECT_ID, title: "B", owner: "agent" });
	updateFollowup({ id: b.id, status: "done" });

	const open = listFollowups({ projectId: PROJECT_ID, status: "open" });
	expect(open.length).toBe(1);
	expect(open[0]?.title).toBe("A");

	const agent = listFollowups({ projectId: PROJECT_ID, owner: "agent" });
	expect(agent.length).toBe(1);
	expect(agent[0]?.id).toBe(b.id);
});

test("listFollowups filters by due_before and due_after", () => {
	const past = new Date("2026-01-01");
	const future = new Date("2027-01-01");
	addFollowup({ projectId: PROJECT_ID, title: "past", dueAt: past });
	addFollowup({ projectId: PROJECT_ID, title: "future", dueAt: future });

	const overdue = listFollowups({
		projectId: PROJECT_ID,
		dueBefore: new Date("2026-06-01"),
	});
	expect(overdue.map((f) => f.title)).toEqual(["past"]);

	const upcoming = listFollowups({
		projectId: PROJECT_ID,
		dueAfter: new Date("2026-06-01"),
	});
	expect(upcoming.map((f) => f.title)).toEqual(["future"]);
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
bun test tests/memory/followups.test.ts
```

- [ ] **Step 3: Implement `followups.ts`**

```ts
import { and, asc, eq, gt, lt, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import {
	memoryFollowups,
	type MemoryFollowup,
} from "../db/schema-memory";
import { newMemoryId } from "./ids";

type FollowupStatus = "open" | "done" | "cancelled";

export interface AddFollowupInput {
	projectId: string;
	title: string;
	body?: string | null;
	owner?: string | null;
	dueAt?: Date | null;
	goalId?: string | null;
}

export function addFollowup(input: AddFollowupInput): { id: string } {
	const id = newMemoryId("fu");
	const now = new Date();
	getDb()
		.insert(memoryFollowups)
		.values({
			id,
			projectId: input.projectId,
			goalId: input.goalId ?? null,
			title: input.title,
			body: input.body ?? null,
			owner: input.owner ?? null,
			dueAt: input.dueAt ?? null,
			status: "open",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { id };
}

export interface UpdateFollowupInput {
	id: string;
	title?: string;
	body?: string | null;
	owner?: string | null;
	dueAt?: Date | null;
	status?: FollowupStatus;
	goalId?: string | null;
}

export function updateFollowup(input: UpdateFollowupInput): void {
	const db = getDb();
	const existing = db
		.select()
		.from(memoryFollowups)
		.where(eq(memoryFollowups.id, input.id))
		.get();
	if (!existing) throw new Error(`followup not found: ${input.id}`);

	db.update(memoryFollowups)
		.set({
			title: input.title ?? existing.title,
			body: input.body === undefined ? existing.body : input.body,
			owner: input.owner === undefined ? existing.owner : input.owner,
			dueAt: input.dueAt === undefined ? existing.dueAt : input.dueAt,
			status: input.status ?? existing.status,
			goalId: input.goalId === undefined ? existing.goalId : input.goalId,
			updatedAt: new Date(),
		})
		.where(eq(memoryFollowups.id, input.id))
		.run();
}

export interface ListFollowupsInput {
	projectId: string;
	status?: FollowupStatus;
	owner?: string;
	dueBefore?: Date;
	dueAfter?: Date;
}

export function listFollowups(input: ListFollowupsInput): MemoryFollowup[] {
	const conds: SQL[] = [eq(memoryFollowups.projectId, input.projectId)];
	if (input.status) conds.push(eq(memoryFollowups.status, input.status));
	if (input.owner) conds.push(eq(memoryFollowups.owner, input.owner));
	if (input.dueBefore) conds.push(lt(memoryFollowups.dueAt, input.dueBefore));
	if (input.dueAfter) conds.push(gt(memoryFollowups.dueAt, input.dueAfter));

	return getDb()
		.select()
		.from(memoryFollowups)
		.where(and(...conds))
		.orderBy(asc(memoryFollowups.dueAt), asc(memoryFollowups.createdAt))
		.all();
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
bun test tests/memory/followups.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/memory/followups.ts apps/desktop/tests/memory/followups.test.ts
git commit -m "feat(memory): add followups CRUD with status, owner, due-date filters"
```

---

## Task 7: Decisions CRUD

**Files:**
- Create: `apps/desktop/src/main/memory/decisions.ts`
- Create: `apps/desktop/tests/memory/decisions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import {
	logDecision,
	listDecisions,
} from "../../src/main/memory/decisions";
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
```

- [ ] **Step 2: Run to confirm fail**

```bash
bun test tests/memory/decisions.test.ts
```

- [ ] **Step 3: Implement `decisions.ts`**

```ts
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import {
	memoryDecisions,
	type MemoryDecision,
} from "../db/schema-memory";
import { ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";

export interface LogDecisionInput {
	projectId: string;
	title: string;
	rationale: string;
	alternatives?: string | null;
}

export function logDecision(input: LogDecisionInput): { id: string } {
	const id = newMemoryId("dec");
	const now = new Date();
	getDb()
		.insert(memoryDecisions)
		.values({
			id,
			projectId: input.projectId,
			title: input.title,
			rationale: input.rationale,
			alternatives: input.alternatives ?? null,
			createdAt: now,
		})
		.run();

	const body = [input.title, input.rationale, input.alternatives ?? ""]
		.filter(Boolean)
		.join("\n\n");
	ftsUpsert({
		kind: "decision",
		refId: id,
		projectId: input.projectId,
		body,
	});
	return { id };
}

export interface ListDecisionsInput {
	projectId: string;
	since?: Date;
	limit?: number;
}

export function listDecisions(input: ListDecisionsInput): MemoryDecision[] {
	const conds = [eq(memoryDecisions.projectId, input.projectId)];
	if (input.since) conds.push(gt(memoryDecisions.createdAt, input.since));

	return getDb()
		.select()
		.from(memoryDecisions)
		.where(and(...conds))
		.orderBy(desc(memoryDecisions.createdAt))
		.limit(input.limit ?? 100)
		.all();
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/memory/decisions.ts apps/desktop/tests/memory/decisions.test.ts
git commit -m "feat(memory): add decisions log with rationale + FTS sync"
```

---

## Task 8: Open questions CRUD

**Files:**
- Create: `apps/desktop/src/main/memory/questions.ts`
- Create: `apps/desktop/tests/memory/questions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to confirm fail**

- [ ] **Step 3: Implement `questions.ts`**

```ts
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
	memoryOpenQuestions,
	type MemoryOpenQuestion,
} from "../db/schema-memory";
import { ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";

type QuestionStatus = "open" | "answered" | "stale";

export interface AddQuestionInput {
	projectId: string;
	question: string;
	context?: string | null;
}

export function addQuestion(input: AddQuestionInput): { id: string } {
	const id = newMemoryId("q");
	const now = new Date();
	getDb()
		.insert(memoryOpenQuestions)
		.values({
			id,
			projectId: input.projectId,
			question: input.question,
			context: input.context ?? null,
			status: "open",
			createdAt: now,
		})
		.run();

	ftsUpsert({
		kind: "question",
		refId: id,
		projectId: input.projectId,
		body: ftsBody(input.question, input.context, null),
	});
	return { id };
}

export interface AnswerQuestionInput {
	id: string;
	answer: string;
}

export function answerQuestion(input: AnswerQuestionInput): void {
	const db = getDb();
	const existing = db
		.select()
		.from(memoryOpenQuestions)
		.where(eq(memoryOpenQuestions.id, input.id))
		.get();
	if (!existing) throw new Error(`question not found: ${input.id}`);

	db.update(memoryOpenQuestions)
		.set({
			answer: input.answer,
			status: "answered",
			answeredAt: new Date(),
		})
		.where(eq(memoryOpenQuestions.id, input.id))
		.run();

	ftsUpsert({
		kind: "question",
		refId: input.id,
		projectId: existing.projectId,
		body: ftsBody(existing.question, existing.context, input.answer),
	});
}

export interface ListQuestionsInput {
	projectId: string;
	status?: QuestionStatus;
}

export function listQuestions(
	input: ListQuestionsInput
): MemoryOpenQuestion[] {
	const conds = [eq(memoryOpenQuestions.projectId, input.projectId)];
	if (input.status) conds.push(eq(memoryOpenQuestions.status, input.status));

	return getDb()
		.select()
		.from(memoryOpenQuestions)
		.where(and(...conds))
		.orderBy(desc(memoryOpenQuestions.createdAt))
		.all();
}

function ftsBody(
	q: string,
	ctx: string | null | undefined,
	ans: string | null | undefined
): string {
	return [q, ctx ?? "", ans ?? ""].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/memory/questions.ts apps/desktop/tests/memory/questions.test.ts
git commit -m "feat(memory): add open-questions CRUD with answer flow"
```

---

## Task 9: Journal start/append/end

**Files:**
- Create: `apps/desktop/src/main/memory/journal.ts`
- Create: `apps/desktop/tests/memory/journal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to confirm fail**

- [ ] **Step 3: Implement `journal.ts`**

```ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memoryJournal, type MemoryJournalEntry } from "../db/schema-memory";
import { ftsDelete, ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";
import { journalDir, journalFileName } from "./paths";

export interface JournalStartInput {
	userDataPath: string;
	projectId: string;
}

export interface JournalStartResult {
	sessionId: string;
	filePath: string;
	startedAt: Date;
}

export function journalStart(input: JournalStartInput): JournalStartResult {
	const sessionId = newMemoryId("sess");
	const startedAt = new Date();
	const dir = journalDir(input.userDataPath, input.projectId);
	mkdirSync(dir, { recursive: true });

	const fileName = journalFileName(startedAt, sessionId);
	const filePath = `${dir}/${fileName}`;
	writeFileSync(filePath, `# Session ${startedAt.toISOString()} (${sessionId})\n\n`, "utf-8");

	getDb()
		.insert(memoryJournal)
		.values({
			id: sessionId,
			projectId: input.projectId,
			sessionId,
			filePath,
			startedAt,
		})
		.run();

	return { sessionId, filePath, startedAt };
}

export interface JournalAppendInput {
	sessionId: string;
	text: string;
}

export function journalAppend(input: JournalAppendInput): void {
	const row = getDb()
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.get();
	if (!row) throw new Error(`journal session not found: ${input.sessionId}`);
	if (row.endedAt) throw new Error(`journal already ended: ${input.sessionId}`);

	const ensureNewline = input.text.endsWith("\n") ? input.text : `${input.text}\n`;
	appendFileSync(row.filePath, ensureNewline, "utf-8");
}

export interface JournalEndInput {
	sessionId: string;
	summary: string;
}

export function journalEnd(input: JournalEndInput): void {
	const db = getDb();
	const row = db
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.get();
	if (!row) throw new Error(`journal session not found: ${input.sessionId}`);

	db.update(memoryJournal)
		.set({ endedAt: new Date(), summary: input.summary })
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.run();

	ftsUpsert({
		kind: "journal",
		refId: row.sessionId,
		projectId: row.projectId,
		body: input.summary,
	});
}

export interface RecentJournalsInput {
	projectId: string;
	limit?: number;
}

export function recentJournals(
	input: RecentJournalsInput
): MemoryJournalEntry[] {
	return getDb()
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.projectId, input.projectId))
		.orderBy(desc(memoryJournal.startedAt))
		.limit(input.limit ?? 20)
		.all();
}

export interface ReadJournalInput {
	sessionId: string;
}

export function readJournal(input: ReadJournalInput): string {
	const row = getDb()
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.get();
	if (!row) throw new Error(`journal session not found: ${input.sessionId}`);
	return readFileSync(row.filePath, "utf-8");
}

export function deleteJournal(sessionId: string): void {
	const db = getDb();
	db.delete(memoryJournal).where(eq(memoryJournal.sessionId, sessionId)).run();
	ftsDelete({ kind: "journal", refId: sessionId });
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
bun test tests/memory/journal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/memory/journal.ts apps/desktop/tests/memory/journal.test.ts
git commit -m "feat(memory): add journal start/append/end with MD file storage"
```

---

## Task 10: Search facade + module index

**Files:**
- Create: `apps/desktop/src/main/memory/index.ts`
- Create: `apps/desktop/tests/memory/search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to confirm fail**

- [ ] **Step 3: Implement `index.ts`**

```ts
import {
	addFollowup,
	listFollowups,
	updateFollowup,
} from "./followups";
import { addGoal, deleteGoal, listGoals, updateGoal } from "./goals";
import {
	addQuestion,
	answerQuestion,
	listQuestions,
} from "./questions";
import { listDecisions, logDecision } from "./decisions";
import {
	deleteJournal,
	journalAppend,
	journalEnd,
	journalStart,
	readJournal,
	recentJournals,
} from "./journal";
import { ftsSearch, type FtsHit, type FtsKind } from "./fts";

export interface SearchInput {
	projectId: string;
	query: string;
	kinds?: FtsKind[];
	limit?: number;
}

export type SearchHit = FtsHit;

function search(input: SearchInput): SearchHit[] {
	return ftsSearch(input);
}

export const memory = {
	addGoal,
	updateGoal,
	listGoals,
	deleteGoal,
	addFollowup,
	updateFollowup,
	listFollowups,
	logDecision,
	listDecisions,
	addQuestion,
	answerQuestion,
	listQuestions,
	journalStart,
	journalAppend,
	journalEnd,
	readJournal,
	recentJournals,
	deleteJournal,
	search,
};

export type { FtsKind } from "./fts";
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/memory/index.ts apps/desktop/tests/memory/search.test.ts
git commit -m "feat(memory): add memory facade with search across kinds"
```

---

## Task 11: Cascade-delete behavior

**Files:**
- Create: `apps/desktop/tests/memory/cascade.test.ts`

This is a verification task. No production code change expected; if it fails, root cause is the migration.

- [ ] **Step 1: Write the test**

```ts
import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
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
	db.delete(schema.projects)
		.where(eq(schema.projects.id, PROJECT_ID))
		.run();

	expect(memory.listGoals({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.listFollowups({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.listDecisions({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.listQuestions({ projectId: PROJECT_ID }).length).toBe(0);
	expect(memory.recentJournals({ projectId: PROJECT_ID }).length).toBe(0);

	rmSync(MEM_ROOT, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
bun test tests/memory/cascade.test.ts
```

If FAIL: check migration `0043_orchestrator_memory.sql` includes `ON DELETE CASCADE` on each `project_id` FK; regenerate with `--name orchestrator_memory` if needed.

Note: FTS5 rows are not cascaded by SQLite (FTS5 is a virtual table, not a real FK target). Per-row FTS deletes happen on explicit CRUD calls. Project deletion does not clear FTS rows; that is acceptable because `memory.search` scopes by `project_id`, so orphan rows are invisible. Document this in a code comment in `src/main/memory/fts.ts`.

- [ ] **Step 3: Add the FTS-orphans comment to `fts.ts`**

In `apps/desktop/src/main/memory/fts.ts`, at the top of the file, append:

```ts
// FTS5 rows are not auto-deleted when a parent project row goes away
// (FTS5 virtual tables cannot be FK targets). Searches scope by project_id
// so orphans are invisible; rely on per-row ftsDelete for cleanup.
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/tests/memory/cascade.test.ts apps/desktop/src/main/memory/fts.ts
git commit -m "test(memory): verify project deletion cascades to memory tables"
```

---

## Task 12: MCP tool registration (workspace-agent mode)

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs`
- Locate + Modify: file that spawns workspace-agent MCP (search step below)

The `server.mjs` workspace-agent mode currently does not open the DB. Memory tools need it, plus a `MEMORY_ROOT` env var.

- [ ] **Step 1: Find where workspace-agent MCP is spawned**

Run from repo root:

```bash
grep -rn "WORKSPACE_AGENT" apps/desktop/src
```

Note the file that sets `WORKSPACE_AGENT=1`. The spawn site will look like `env: { ..., WORKSPACE_AGENT: "1", PROJECT_ID, WORKSPACE_ID, ... }`. Record the file path and line range for use in Step 3.

- [ ] **Step 2: Open DB and resolve `MEMORY_ROOT` in workspace-agent mode**

In `apps/desktop/mcp-standalone/server.mjs`, near the existing `if (!isWorkspaceAgentMode) { db = new Database(DB_PATH); ... }` block, replace with:

```js
const MEMORY_ROOT = process.env.MEMORY_ROOT;

if (isWorkspaceAgentMode) {
	if (!DB_PATH || !MEMORY_ROOT) {
		console.error(
			"WORKSPACE_AGENT mode requires DB_PATH and MEMORY_ROOT for memory tools"
		);
		process.exit(1);
	}
	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("foreign_keys = ON");
} else {
	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("foreign_keys = ON");
}
```

Remove the old `let db = null; if (!isWorkspaceAgentMode) { ... }` lines this replaces.

- [ ] **Step 3: Pass `DB_PATH` and `MEMORY_ROOT` from the spawn site**

In the file located in Step 1, add to the env block when spawning workspace-agent MCP:

```ts
env: {
	...existingEnv,
	DB_PATH: getDbPath(),                     // or wherever DB_PATH is computed
	MEMORY_ROOT: app.getPath("userData"),     // app.getPath('userData') in main
}
```

If `getDbPath` is not exported from `src/main/db/index.ts`, export it now (small refactor). Verify with `bun run type-check`.

- [ ] **Step 4: Register memory tools inside the `isWorkspaceAgentMode` branch in `server.mjs`**

At the bottom of `server.mjs`, before the transport is wired up, add a workspace-agent-only block:

```js
if (isWorkspaceAgentMode) {
	const { randomUUID } = require("node:crypto");
	const fs = require("node:fs");
	const path = require("node:path");

	function nowS() {
		return Math.floor(Date.now() / 1000);
	}

	function memoryRoot() {
		return path.join(MEMORY_ROOT, "memory");
	}
	function projectRoot(pid) {
		return path.join(memoryRoot(), pid);
	}
	function journalDir(pid) {
		return path.join(projectRoot(pid), "journal");
	}

	function ftsUpsert(kind, refId, projectId, body) {
		db.prepare(
			"DELETE FROM memory_fts WHERE kind = ? AND ref_id = ?"
		).run(kind, refId);
		db.prepare(
			"INSERT INTO memory_fts (kind, ref_id, project_id, body) VALUES (?, ?, ?, ?)"
		).run(kind, refId, projectId, body);
	}

	// add_goal
	server.tool(
		"memory_add_goal",
		"Add a project goal to long-lived orchestrator memory",
		{
			title: z.string(),
			body: z.string().optional(),
		},
		async ({ title, body }) => {
			const id = `goal_${randomUUID().slice(0, 12)}`;
			const now = nowS();
			db.prepare(
				`INSERT INTO memory_goals (id, project_id, title, body, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, 'active', ?, ?)`
			).run(id, PROJECT_ID, title, body ?? null, now, now);
			ftsUpsert("goal", id, PROJECT_ID, body ? `${title}\n\n${body}` : title);
			return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
		}
	);

	// list_goals
	server.tool(
		"memory_list_goals",
		"List project goals",
		{
			status: z.enum(["active", "done", "abandoned"]).optional(),
		},
		async ({ status }) => {
			const rows = status
				? db
						.prepare(
							"SELECT * FROM memory_goals WHERE project_id = ? AND status = ? ORDER BY created_at DESC"
						)
						.all(PROJECT_ID, status)
				: db
						.prepare(
							"SELECT * FROM memory_goals WHERE project_id = ? ORDER BY created_at DESC"
						)
						.all(PROJECT_ID);
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		}
	);

	// add_followup
	server.tool(
		"memory_add_followup",
		"Add a follow-up item",
		{
			title: z.string(),
			body: z.string().optional(),
			owner: z.string().optional(),
			due_at: z.number().optional().describe("unix seconds"),
			goal_id: z.string().optional(),
		},
		async ({ title, body, owner, due_at, goal_id }) => {
			const id = `fu_${randomUUID().slice(0, 12)}`;
			const now = nowS();
			db.prepare(
				`INSERT INTO memory_followups (id, project_id, goal_id, title, body, owner, due_at, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
			).run(
				id,
				PROJECT_ID,
				goal_id ?? null,
				title,
				body ?? null,
				owner ?? null,
				due_at ?? null,
				now,
				now
			);
			return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
		}
	);

	// list_followups
	server.tool(
		"memory_list_followups",
		"List follow-ups with optional filters",
		{
			status: z.enum(["open", "done", "cancelled"]).optional(),
			owner: z.string().optional(),
			due_before: z.number().optional(),
			due_after: z.number().optional(),
		},
		async ({ status, owner, due_before, due_after }) => {
			const where = ["project_id = ?"];
			const params = [PROJECT_ID];
			if (status) {
				where.push("status = ?");
				params.push(status);
			}
			if (owner) {
				where.push("owner = ?");
				params.push(owner);
			}
			if (due_before !== undefined) {
				where.push("due_at < ?");
				params.push(due_before);
			}
			if (due_after !== undefined) {
				where.push("due_at > ?");
				params.push(due_after);
			}
			const rows = db
				.prepare(
					`SELECT * FROM memory_followups WHERE ${where.join(
						" AND "
					)} ORDER BY due_at ASC, created_at ASC`
				)
				.all(...params);
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		}
	);

	// log_decision
	server.tool(
		"memory_log_decision",
		"Record a decision and its rationale",
		{
			title: z.string(),
			rationale: z.string(),
			alternatives: z.string().optional(),
		},
		async ({ title, rationale, alternatives }) => {
			const id = `dec_${randomUUID().slice(0, 12)}`;
			const now = nowS();
			db.prepare(
				`INSERT INTO memory_decisions (id, project_id, title, rationale, alternatives, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			).run(id, PROJECT_ID, title, rationale, alternatives ?? null, now);
			const body = [title, rationale, alternatives ?? ""]
				.filter(Boolean)
				.join("\n\n");
			ftsUpsert("decision", id, PROJECT_ID, body);
			return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
		}
	);

	// add_question
	server.tool(
		"memory_add_question",
		"Record an open question",
		{
			question: z.string(),
			context: z.string().optional(),
		},
		async ({ question, context }) => {
			const id = `q_${randomUUID().slice(0, 12)}`;
			const now = nowS();
			db.prepare(
				`INSERT INTO memory_open_questions (id, project_id, question, context, status, created_at)
				 VALUES (?, ?, ?, ?, 'open', ?)`
			).run(id, PROJECT_ID, question, context ?? null, now);
			ftsUpsert(
				"question",
				id,
				PROJECT_ID,
				[question, context ?? ""].filter(Boolean).join("\n\n")
			);
			return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
		}
	);

	// answer_question
	server.tool(
		"memory_answer_question",
		"Mark an open question answered",
		{
			id: z.string(),
			answer: z.string(),
		},
		async ({ id, answer }) => {
			const row = db
				.prepare("SELECT * FROM memory_open_questions WHERE id = ?")
				.get(id);
			if (!row) throw new Error(`question not found: ${id}`);
			db.prepare(
				`UPDATE memory_open_questions
				    SET answer = ?, status = 'answered', answered_at = ?
				  WHERE id = ?`
			).run(answer, nowS(), id);
			ftsUpsert(
				"question",
				id,
				row.project_id,
				[row.question, row.context ?? "", answer].filter(Boolean).join("\n\n")
			);
			return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
		}
	);

	// journal_start
	server.tool(
		"memory_journal_start",
		"Open a new journal session and return its session id and file path",
		{},
		async () => {
			const sessionId = `sess_${randomUUID().slice(0, 12)}`;
			const startedAt = new Date();
			const dir = journalDir(PROJECT_ID);
			fs.mkdirSync(dir, { recursive: true });
			const yyyy = startedAt.getUTCFullYear();
			const mm = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
			const dd = String(startedAt.getUTCDate()).padStart(2, "0");
			const hh = String(startedAt.getUTCHours()).padStart(2, "0");
			const mi = String(startedAt.getUTCMinutes()).padStart(2, "0");
			const ss = String(startedAt.getUTCSeconds()).padStart(2, "0");
			const filePath = path.join(
				dir,
				`${yyyy}-${mm}-${dd}-${hh}${mi}${ss}-${sessionId}.md`
			);
			fs.writeFileSync(
				filePath,
				`# Session ${startedAt.toISOString()} (${sessionId})\n\n`,
				"utf-8"
			);
			db.prepare(
				`INSERT INTO memory_journal (id, project_id, session_id, file_path, started_at)
				 VALUES (?, ?, ?, ?, ?)`
			).run(sessionId, PROJECT_ID, sessionId, filePath, nowS());
			return {
				content: [
					{ type: "text", text: JSON.stringify({ session_id: sessionId, file_path: filePath }) },
				],
			};
		}
	);

	// journal_append
	server.tool(
		"memory_journal_append",
		"Append markdown text to an open journal session",
		{
			session_id: z.string(),
			text: z.string(),
		},
		async ({ session_id, text }) => {
			const row = db
				.prepare("SELECT * FROM memory_journal WHERE session_id = ?")
				.get(session_id);
			if (!row) throw new Error(`journal session not found: ${session_id}`);
			if (row.ended_at) throw new Error(`journal already ended: ${session_id}`);
			const withNl = text.endsWith("\n") ? text : `${text}\n`;
			fs.appendFileSync(row.file_path, withNl, "utf-8");
			return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
		}
	);

	// journal_end
	server.tool(
		"memory_journal_end",
		"Close a journal session, attach a summary, index FTS",
		{
			session_id: z.string(),
			summary: z.string(),
		},
		async ({ session_id, summary }) => {
			const row = db
				.prepare("SELECT * FROM memory_journal WHERE session_id = ?")
				.get(session_id);
			if (!row) throw new Error(`journal session not found: ${session_id}`);
			db.prepare(
				"UPDATE memory_journal SET ended_at = ?, summary = ? WHERE session_id = ?"
			).run(nowS(), summary, session_id);
			ftsUpsert("journal", session_id, row.project_id, summary);
			return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
		}
	);

	// recent_journals
	server.tool(
		"memory_recent_journals",
		"List recent journal index rows",
		{
			limit: z.number().optional(),
		},
		async ({ limit }) => {
			const rows = db
				.prepare(
					"SELECT * FROM memory_journal WHERE project_id = ? ORDER BY started_at DESC LIMIT ?"
				)
				.all(PROJECT_ID, limit ?? 20);
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		}
	);

	// read_journal
	server.tool(
		"memory_read_journal",
		"Read the MD body of a journal session",
		{ session_id: z.string() },
		async ({ session_id }) => {
			const row = db
				.prepare("SELECT * FROM memory_journal WHERE session_id = ?")
				.get(session_id);
			if (!row) throw new Error(`journal session not found: ${session_id}`);
			const body = fs.readFileSync(row.file_path, "utf-8");
			return { content: [{ type: "text", text: body }] };
		}
	);

	// list_decisions
	server.tool(
		"memory_list_decisions",
		"List decisions, newest first",
		{ limit: z.number().optional(), since: z.number().optional() },
		async ({ limit, since }) => {
			const rows =
				since !== undefined
					? db
							.prepare(
								"SELECT * FROM memory_decisions WHERE project_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?"
							)
							.all(PROJECT_ID, since, limit ?? 100)
					: db
							.prepare(
								"SELECT * FROM memory_decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
							)
							.all(PROJECT_ID, limit ?? 100);
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		}
	);

	// list_questions
	server.tool(
		"memory_list_questions",
		"List open questions",
		{ status: z.enum(["open", "answered", "stale"]).optional() },
		async ({ status }) => {
			const rows = status
				? db
						.prepare(
							"SELECT * FROM memory_open_questions WHERE project_id = ? AND status = ? ORDER BY created_at DESC"
						)
						.all(PROJECT_ID, status)
				: db
						.prepare(
							"SELECT * FROM memory_open_questions WHERE project_id = ? ORDER BY created_at DESC"
						)
						.all(PROJECT_ID);
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		}
	);

	// search
	server.tool(
		"memory_search",
		"Full-text search across goals, decisions, questions, and journal summaries",
		{
			query: z.string(),
			kinds: z
				.array(z.enum(["goal", "decision", "question", "journal"]))
				.optional(),
			limit: z.number().optional(),
		},
		async ({ query, kinds, limit }) => {
			const kindFilter =
				kinds && kinds.length > 0
					? ` AND kind IN (${kinds.map(() => "?").join(",")})`
					: "";
			const params = [PROJECT_ID, query];
			if (kinds && kinds.length > 0) params.push(...kinds);
			params.push(limit ?? 50);
			const rows = db
				.prepare(
					`SELECT kind, ref_id, project_id,
					        snippet(memory_fts, 3, '[', ']', '...', 16) AS snippet,
					        bm25(memory_fts) AS rank
					   FROM memory_fts
					  WHERE project_id = ? AND memory_fts MATCH ?${kindFilter}
					  ORDER BY rank
					  LIMIT ?`
				)
				.all(...params);
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		}
	);
}
```

Note: `update_goal` and `update_followup` are intentionally not exposed in MCP v1 — orchestrator practice in early use is "log, don't edit". Add them in a follow-up if the model asks for them.

- [ ] **Step 5: Type-check**

Run from repo root:

```bash
bun run type-check
```

Expected: no errors. `server.mjs` is plain JS; the type check runs against `apps/desktop/src/main/memory/` and the spawn-site change from Step 3.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs <spawn-site-file-from-step-1>
git commit -m "feat(memory): expose memory tools via workspace-agent MCP server"
```

---

## Task 13: MCP integration smoke test

**Files:**
- Create: `apps/desktop/tests/memory/mcp-tools.test.ts`

Verifies the MCP server boots in workspace-agent mode, exposes the memory tools, and a tool call writes the expected row.

- [ ] **Step 1: Write the test**

```ts
import "../preload-electron-mock";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";

const SERVER = join(import.meta.dir, "../../mcp-standalone/server.mjs");
let proc: ChildProcessByStdio<NodeJS.WritableStream, NodeJS.ReadableStream, NodeJS.ReadableStream>;
let PROJECT_ID: string;
let MEM_ROOT: string;
let DB_PATH: string;

function sendMcp(req: object): Promise<string> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(req) + "\n";
		let buf = "";
		const onData = (chunk: Buffer) => {
			buf += chunk.toString("utf-8");
			if (buf.includes("\n")) {
				proc.stdout.off("data", onData);
				resolve(buf);
			}
		};
		proc.stdout.on("data", onData);
		proc.stdin.write(payload, (err) => err && reject(err));
		setTimeout(() => reject(new Error("mcp timeout")), 5000);
	});
}

beforeAll(async () => {
	MEM_ROOT = mkdtempSync(join(tmpdir(), "mem-mcp-"));
	DB_PATH = join(MEM_ROOT, "test.db");

	// Seed DB with migrations and a project
	process.env.SUPERIORSWARM_TEST_DB = DB_PATH;
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
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

	proc = spawn("node", [SERVER], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			WORKSPACE_AGENT: "1",
			PROJECT_ID,
			WORKSPACE_ID: "ws-1",
			DB_PATH,
			MEMORY_ROOT: MEM_ROOT,
			SUPERIORSWARM_CONTROL_PORT: "9999",
			SUPERIORSWARM_CONTROL_TOKEN: "t",
		},
	}) as unknown as typeof proc;
});

afterAll(() => {
	if (proc && !proc.killed) proc.kill();
	if (MEM_ROOT) rmSync(MEM_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
	const db = getDb();
	db.delete(schema.memoryGoals).run();
});

test("memory_add_goal tool inserts a row", async () => {
	const initMsg = {
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "test", version: "0" },
		},
	};
	await sendMcp(initMsg);
	await sendMcp({
		jsonrpc: "2.0",
		method: "notifications/initialized",
		params: {},
	});

	const call = {
		jsonrpc: "2.0",
		id: 2,
		method: "tools/call",
		params: {
			name: "memory_add_goal",
			arguments: { title: "smoke goal" },
		},
	};
	const out = await sendMcp(call);
	expect(out).toContain("smoke goal" /* echoed via tool result not guaranteed */);

	const rows = getDb()
		.select()
		.from(schema.memoryGoals)
		.where(eq(schema.memoryGoals.projectId, PROJECT_ID))
		.all();
	expect(rows.length).toBe(1);
	expect(rows[0]?.title).toBe("smoke goal");
});
```

If this test proves flaky in CI (stdio framing, MCP protocol negotiation), simplify to direct in-process import of the server's tool-handler code; do not skip the verification.

- [ ] **Step 2: Run, expect PASS**

```bash
bun test tests/memory/mcp-tools.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tests/memory/mcp-tools.test.ts
git commit -m "test(memory): smoke test memory tools via workspace-agent MCP"
```

---

## Task 14: CLAUDE.md note + full test pass

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a one-line index entry to `CLAUDE.md`**

Find the existing `## Architecture` section and append a bullet at the end (do not remove or reorder existing bullets):

```md
- **Orchestrator memory** → `apps/desktop/src/main/memory/` (project-scoped goals/followups/decisions/questions/journal in SQLite + MD files under `<userData>/memory/<projectId>/`, exposed to orchestrator via MCP tools in `mcp-standalone/server.mjs` workspace-agent mode).
```

- [ ] **Step 2: Run full test suite**

Run from `apps/desktop/`:

```bash
bun test
```

Expected: PASS. If any test fails, return to the relevant task and fix before continuing.

- [ ] **Step 3: Run type-check + lint**

```bash
bun run type-check
bun run check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: index orchestrator-memory module in CLAUDE.md"
```

---

## Done criteria

- All 14 tasks complete and committed.
- `bun test` passes for the whole desktop app.
- `bun run type-check` and `bun run check` pass.
- An orchestrator started in workspace-agent mode can call `memory_add_goal`, `memory_list_followups`, `memory_journal_start/append/end`, and `memory_search` against the project DB.
- A new orchestrator session in the same project can `memory_recent_journals` and `memory_list_followups({status:'open'})` and see entries written in a prior session.
