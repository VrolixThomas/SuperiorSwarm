# Comment Placement Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inline solve-comment cards render at the correct line in the correct diff pane for every comment, including those on deleted lines, by propagating GitHub's `side` field end-to-end and adding a renderer fallback for legacy/null values.

**Architecture:** Add `side` column to `pr_comment_cache`, propagate `side` through `NormalizedComment` → `github-adapter` → `comment-poller` → `create-and-queue-solve`, then have the renderer's view-zone hook resolve side via explicit value or line-existence heuristic. Inline diff mode shows a banner counting deleted-line comments with a one-click switch to split.

**Tech Stack:** TypeScript, Drizzle ORM, SQLite, Bun test runner, React 19, Monaco diff editor.

**Spec:** `docs/superpowers/specs/2026-05-03-comment-placement-rework-design.md`

---

## File map

**Modified:**
- `apps/desktop/src/main/db/schema-comment-solver.ts` — add `side` column to `prCommentCache`
- `apps/desktop/src/main/db/migrations/00NN_add_side_to_pr_comment_cache.sql` — generated migration (SQL)
- `apps/desktop/src/main/db/migrations/meta/_journal.json` — auto-updated
- `apps/desktop/src/main/db/migrations/meta/00NN_snapshot.json` — auto-generated
- `apps/desktop/src/main/providers/types.ts` — add `side` to `NormalizedComment`
- `apps/desktop/src/main/providers/github-adapter.ts` — read `side` from raw comment, map to `NormalizedComment`
- `apps/desktop/src/main/ai-review/comment-poller.ts` — write `side` into cache
- `apps/desktop/src/main/ai-review/create-and-queue-solve.ts` — read `side` from cached row instead of hardcoded null
- `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx` — export pure `resolveSide` helper, swap routing call sites
- `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx` — render banner in inline mode when LEFT-side comments exist

**Created:**
- `apps/desktop/tests/resolveSide.test.ts` — pure-function unit tests
- `apps/desktop/tests/comment-poller-side.test.ts` — in-memory db test that side propagates from `NormalizedComment` to `pr_comment_cache`

---

## Task 1: Add `side` column to `pr_comment_cache` schema and generate migration

**Files:**
- Modify: `apps/desktop/src/main/db/schema-comment-solver.ts:97-119`
- Generated: `apps/desktop/src/main/db/migrations/00NN_add_side_to_pr_comment_cache.sql` (Drizzle generates `NN`)

- [ ] **Step 1: Add `side` column to the schema**

In `apps/desktop/src/main/db/schema-comment-solver.ts`, change the `prCommentCache` definition from:

```ts
export const prCommentCache = sqliteTable(
	"pr_comment_cache",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		platformCommentId: text("platform_comment_id").notNull(),
		author: text("author").notNull(),
		body: text("body").notNull(),
		filePath: text("file_path"),
		lineNumber: integer("line_number"),
		/** ISO 8601 string from the platform API (not a local timestamp) */
		createdAt: text("created_at").notNull(),
		fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		workspacePlatformUnique: uniqueIndex("pr_comment_cache_workspace_platform_unique").on(
			table.workspaceId,
			table.platformCommentId
		),
	})
);
```

to:

```ts
export const prCommentCache = sqliteTable(
	"pr_comment_cache",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		platformCommentId: text("platform_comment_id").notNull(),
		author: text("author").notNull(),
		body: text("body").notNull(),
		filePath: text("file_path"),
		lineNumber: integer("line_number"),
		side: text("side"),
		/** ISO 8601 string from the platform API (not a local timestamp) */
		createdAt: text("created_at").notNull(),
		fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		workspacePlatformUnique: uniqueIndex("pr_comment_cache_workspace_platform_unique").on(
			table.workspaceId,
			table.platformCommentId
		),
	})
);
```

- [ ] **Step 2: Generate the migration with a descriptive name**

Run from the desktop app dir:

```bash
cd apps/desktop && bun run db:generate --name add_side_to_pr_comment_cache
```

Expected: a new SQL file `migrations/00NN_add_side_to_pr_comment_cache.sql` containing `ALTER TABLE pr_comment_cache ADD COLUMN side TEXT;`, plus updated `meta/_journal.json` and a new snapshot.

- [ ] **Step 3: Verify the generated SQL is exactly an ALTER**

Cat the generated file. It MUST be a single `ALTER TABLE pr_comment_cache ADD COLUMN side TEXT;` statement (with whatever statement-breakpoint the generator emits). If Drizzle proposes a destructive table rebuild, abort and reach out — that means it tried to also touch the unique index. Workaround: hand-write the SQL ALTER and let Drizzle update the snapshot in a follow-up.

- [ ] **Step 4: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: clean — no TS errors. The schema change is additive on a nullable column so insert sites compile.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/db/schema-comment-solver.ts apps/desktop/src/main/db/migrations/
git commit -m "feat(db): add side column to pr_comment_cache"
```

---

## Task 2: Add `side` to `NormalizedComment` provider type

**Files:**
- Modify: `apps/desktop/src/main/providers/types.ts:24-31`

- [ ] **Step 1: Extend NormalizedComment**

In `apps/desktop/src/main/providers/types.ts`, change:

```ts
export interface NormalizedComment {
	id: string;
	body: string;
	author: string;
	filePath: string | null;
	lineNumber: number | null;
	createdAt: string;
}
```

to:

```ts
export interface NormalizedComment {
	id: string;
	body: string;
	author: string;
	filePath: string | null;
	lineNumber: number | null;
	side: "LEFT" | "RIGHT" | null;
	createdAt: string;
}
```

- [ ] **Step 2: Run type-check to surface every consumer**

```bash
cd apps/desktop && bun run type-check
```

Expected: errors at every site that constructs a `NormalizedComment` without `side`. Keep these errors visible — they map directly to Tasks 3 and 4 below. Do NOT fix them in this task.

- [ ] **Step 3: Commit type-only change**

```bash
git add apps/desktop/src/main/providers/types.ts
git commit -m "feat(providers): add side to NormalizedComment"
```

---

## Task 3: Populate `side` in github-adapter

**Files:**
- Modify: `apps/desktop/src/main/providers/github-adapter.ts:106-142`

- [ ] **Step 1: Add `side` to `RawCommentNode`**

Change:

```ts
interface RawCommentNode {
	id: number;
	body: string;
	user: { login: string };
	created_at: string;
	path?: string;
	line?: number;
}
```

to:

```ts
interface RawCommentNode {
	id: number;
	body: string;
	user: { login: string };
	created_at: string;
	path?: string;
	line?: number;
	side?: "LEFT" | "RIGHT";
}
```

- [ ] **Step 2: Map `side` into `NormalizedComment`**

Change the mapper from:

```ts
const all: NormalizedComment[] = [...issueComments, ...reviewComments].map((c) => ({
	id: String(c.id),
	body: c.body ?? "",
	author: c.user?.login ?? "Unknown",
	filePath: c.path ?? null,
	lineNumber: c.line ?? null,
	createdAt: c.created_at ?? "",
}));
```

to:

```ts
const all: NormalizedComment[] = [...issueComments, ...reviewComments].map((c) => ({
	id: String(c.id),
	body: c.body ?? "",
	author: c.user?.login ?? "Unknown",
	filePath: c.path ?? null,
	lineNumber: c.line ?? null,
	side: c.side ?? null,
	createdAt: c.created_at ?? "",
}));
```

Issue-thread comments (no file/line) naturally have no `side` and stay null.

- [ ] **Step 3: Find any other adapter that constructs NormalizedComment**

```bash
grep -rn "NormalizedComment" apps/desktop/src/main/providers/
```

For each adapter that the type-check (Task 2 Step 2) flagged but isn't `github-adapter`, add `side: null` to the constructed object. Bitbucket, GitLab — none of them emit per-side info today, so null is correct. Show the engineer the diff for each before applying.

- [ ] **Step 4: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: only `comment-poller.ts` and `create-and-queue-solve.ts` errors should remain (handled in Tasks 4 and 5).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/providers/
git commit -m "feat(providers): propagate side from github review comments"
```

---

## Task 4: Write `side` to `pr_comment_cache` from poller

**Files:**
- Modify: `apps/desktop/src/main/ai-review/comment-poller.ts:90-103`
- Create: `apps/desktop/tests/comment-poller-side.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/comment-poller-side.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";

function makeTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.exec(`
		CREATE TABLE workspaces (
			id TEXT PRIMARY KEY NOT NULL,
			project_id TEXT NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'branch',
			worktree_id TEXT,
			pr_provider TEXT,
			pr_identifier TEXT,
			review_draft_id TEXT,
			terminal_id TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE pr_comment_cache (
			id TEXT PRIMARY KEY NOT NULL,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			platform_comment_id TEXT NOT NULL,
			author TEXT NOT NULL,
			body TEXT NOT NULL,
			file_path TEXT,
			line_number INTEGER,
			side TEXT,
			created_at TEXT NOT NULL,
			fetched_at INTEGER NOT NULL
		);
	`);
	return db;
}

describe("comment-poller side propagation", () => {
	test("inserts side from NormalizedComment into pr_comment_cache", () => {
		const db = makeTestDb();
		const now = new Date();

		db.prepare(
			"INSERT INTO workspaces (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
		).run("w1", "p1", "ws", now.getTime(), now.getTime());

		// Mirror the poller's insert shape (one row at a time, side from NormalizedComment).
		const insert = db.prepare(
			"INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, file_path, line_number, side, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
		);

		insert.run("r1", "w1", "c1", "alice", "hi", "src/foo.ts", 10, "LEFT", "2026-01-01T00:00:00Z", now.getTime());
		insert.run("r2", "w1", "c2", "bob", "yo", "src/foo.ts", 12, "RIGHT", "2026-01-01T00:00:00Z", now.getTime());
		insert.run("r3", "w1", "c3", "carol", "ok", null, null, null, "2026-01-01T00:00:00Z", now.getTime());

		const rows = db.prepare("SELECT platform_comment_id, side FROM pr_comment_cache ORDER BY id").all() as Array<{ platform_comment_id: string; side: string | null }>;

		expect(rows).toEqual([
			{ platform_comment_id: "c1", side: "LEFT" },
			{ platform_comment_id: "c2", side: "RIGHT" },
			{ platform_comment_id: "c3", side: null },
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && bun test tests/comment-poller-side.test.ts
```

Expected: PASS immediately (the test exercises the SQL only). The point of this test is to lock in the expected schema + insert shape so the poller change in Step 3 can't regress it. If it FAILS, the schema in `makeTestDb` is wrong — fix it.

(Note: this is a regression-locking test, not a strict TDD red. Schema migrations are exercised by Drizzle separately.)

- [ ] **Step 3: Update the poller insert to include side**

In `apps/desktop/src/main/ai-review/comment-poller.ts`, change:

```ts
for (const c of comments) {
	tx.insert(schema.prCommentCache)
		.values({
			id: randomUUID(),
			workspaceId,
			platformCommentId: c.id,
			author: c.author,
			body: c.body,
			filePath: c.filePath ?? null,
			lineNumber: c.lineNumber ?? null,
			createdAt: c.createdAt,
			fetchedAt: now,
		})
		.run();
}
```

to:

```ts
for (const c of comments) {
	tx.insert(schema.prCommentCache)
		.values({
			id: randomUUID(),
			workspaceId,
			platformCommentId: c.id,
			author: c.author,
			body: c.body,
			filePath: c.filePath ?? null,
			lineNumber: c.lineNumber ?? null,
			side: c.side ?? null,
			createdAt: c.createdAt,
			fetchedAt: now,
		})
		.run();
}
```

- [ ] **Step 4: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: only `create-and-queue-solve.ts` errors remain (Task 5).

- [ ] **Step 5: Run the new test**

```bash
cd apps/desktop && bun test tests/comment-poller-side.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ai-review/comment-poller.ts apps/desktop/tests/comment-poller-side.test.ts
git commit -m "feat(poller): persist comment side to pr_comment_cache"
```

---

## Task 5: Read `side` from cache in create-and-queue-solve

**Files:**
- Modify: `apps/desktop/src/main/ai-review/create-and-queue-solve.ts:79-87, 161-176`

- [ ] **Step 1: Replace hardcoded null with cache value**

Change:

```ts
const rawComments = cachedComments.map((c) => ({
	id: c.platformCommentId,
	body: c.body,
	author: c.author,
	filePath: c.filePath,
	lineNumber: c.lineNumber,
	threadId: null as string | null,
	side: null as string | null,
}));
```

to:

```ts
const rawComments = cachedComments.map((c) => ({
	id: c.platformCommentId,
	body: c.body,
	author: c.author,
	filePath: c.filePath,
	lineNumber: c.lineNumber,
	threadId: null as string | null,
	side: c.side,
}));
```

`c.side` is now `string | null` from the schema and matches the existing `pr_comments.side` column type.

- [ ] **Step 2: Run type-check — should be clean**

```bash
cd apps/desktop && bun run type-check
```

Expected: clean (no TS errors).

- [ ] **Step 3: Run all existing comment-solver tests**

```bash
cd apps/desktop && bun test tests/comment-solver.test.ts tests/comment-poller-side.test.ts tests/solve-session-store.test.ts tests/solve-sidebar.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/create-and-queue-solve.ts
git commit -m "feat(solve): propagate cached side into solve-session comments"
```

---

## Task 6: Extract pure `resolveSide` helper in renderer with unit tests

**Files:**
- Modify: `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx`
- Create: `apps/desktop/tests/resolveSide.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/resolveSide.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { SolveCommentInfo } from "../src/shared/solve-types";
import { resolveSide } from "../src/renderer/components/solve/useSolveCommentZones";

function comment(partial: Partial<SolveCommentInfo>): SolveCommentInfo {
	return {
		id: "c",
		platformCommentId: "p",
		author: "u",
		body: "",
		filePath: "f",
		lineNumber: null,
		side: null,
		threadId: null,
		status: "open",
		commitSha: null,
		groupId: null,
		followUpText: null,
		reply: null,
		...partial,
	};
}

interface FakeModel {
	getLineCount(): number;
}

const model = (n: number): FakeModel => ({ getLineCount: () => n });

describe("resolveSide", () => {
	test("explicit LEFT wins", () => {
		expect(resolveSide(comment({ side: "LEFT", lineNumber: 5 }), model(100), model(100))).toBe(
			"LEFT"
		);
	});

	test("explicit RIGHT wins", () => {
		expect(resolveSide(comment({ side: "RIGHT", lineNumber: 5 }), model(100), model(100))).toBe(
			"RIGHT"
		);
	});

	test("null side + null lineNumber → RIGHT (file-level)", () => {
		expect(resolveSide(comment({ side: null, lineNumber: null }), model(100), model(100))).toBe(
			"RIGHT"
		);
	});

	test("null side + line beyond modified count → LEFT (deleted line)", () => {
		expect(resolveSide(comment({ side: null, lineNumber: 50 }), model(10), model(100))).toBe(
			"LEFT"
		);
	});

	test("null side + line within both → RIGHT (default to new)", () => {
		expect(resolveSide(comment({ side: null, lineNumber: 5 }), model(100), model(100))).toBe(
			"RIGHT"
		);
	});

	test("case-insensitive side strings", () => {
		expect(resolveSide(comment({ side: "left", lineNumber: 5 }), model(100), model(100))).toBe(
			"LEFT"
		);
	});

	test("null models behave like 0 line counts", () => {
		expect(resolveSide(comment({ side: null, lineNumber: 5 }), null, null)).toBe("RIGHT");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && bun test tests/resolveSide.test.ts
```

Expected: FAIL — `resolveSide` not exported.

- [ ] **Step 3: Add `resolveSide` to useSolveCommentZones.tsx**

In `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx`, just below the existing `commentSide` function (or replacing it — it's about to become unused), add:

```ts
interface LineCountModel {
	getLineCount(): number;
}

export function resolveSide(
	comment: SolveCommentInfo,
	originalModel: LineCountModel | null,
	modifiedModel: LineCountModel | null
): Side {
	const explicit = comment.side?.toUpperCase();
	if (explicit === "LEFT") return "LEFT";
	if (explicit === "RIGHT") return "RIGHT";
	if (comment.lineNumber == null) return "RIGHT";
	const modCount = modifiedModel?.getLineCount() ?? 0;
	const origCount = originalModel?.getLineCount() ?? 0;
	if (comment.lineNumber > modCount && comment.lineNumber <= origCount) return "LEFT";
	return "RIGHT";
}
```

`LineCountModel` is structural so the test can pass plain objects without importing monaco. Real Monaco `ITextModel` implements `getLineCount(): number` and matches.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/desktop && bun test tests/resolveSide.test.ts
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx apps/desktop/tests/resolveSide.test.ts
git commit -m "feat(solve): add resolveSide helper with line-existence fallback"
```

---

## Task 7: Wire resolveSide into useSolveCommentZones

**Files:**
- Modify: `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx`

- [ ] **Step 1: Replace `commentSide(c)` call sites with `resolveSide(c, modifiedModel, originalModel)`**

The hook has three places that call `commentSide`:

1. View-zones effect line ~117: `if (commentSide(c) !== side) continue;`
2. Glyph effect line ~177: `const side = commentSide(c);`
3. Active-line decoration effect line ~219: `const side = commentSide(active);`

In each, fetch the models once at the top of the effect:

```ts
const originalModel = editor.getOriginalEditor().getModel();
const modifiedModel = editor.getModifiedEditor().getModel();
```

(For the active-line effect, fetch them inside the effect too — yes, it duplicates the call, that's fine.)

Then replace:

- `commentSide(c)` → `resolveSide(c, modifiedModel, originalModel)`
- `commentSide(active)` → `resolveSide(active, modifiedModel, originalModel)`

**NOTE:** The signature of `resolveSide` is `(comment, modifiedModel, originalModel)` — the second arg is the modified model, third is the original. This matches the test cases in Task 6.

After all three are replaced, remove the now-unused `commentSide` function.

- [ ] **Step 2: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: clean.

- [ ] **Step 3: Run all related unit tests**

```bash
cd apps/desktop && bun test tests/resolveSide.test.ts tests/solve-session-store.test.ts tests/solve-sidebar.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Run biome on the modified file**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/rework-comment-solver-ui && bunx biome check apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx
```

Expected: no NEW errors. Pre-existing project-wide lint debt is acceptable.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx
git commit -m "feat(solve): route comments via resolveSide for line-aware fallback"
```

---

## Task 8: Inline-mode banner for deleted-line comments

**Files:**
- Modify: `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx`

- [ ] **Step 1: Compute LEFT-side count and render banner**

In `SolveDiffPane.tsx`, after the existing `useSolveCommentZones(...)` call and before the `useEffect` that sets up scrolling, add:

```ts
const leftSideCount = useMemo(() => {
	if (!editorInstance) return 0;
	const originalModel = editorInstance.getOriginalEditor().getModel();
	const modifiedModel = editorInstance.getModifiedEditor().getModel();
	let n = 0;
	for (const c of fileComments) {
		if (resolveSide(c, modifiedModel, originalModel) === "LEFT") n++;
	}
	return n;
}, [editorInstance, fileComments]);
```

Add `import { resolveSide } from "./useSolveCommentZones";` at the top of the file (next to the existing useSolveCommentZones import — combine them into one import line).

In the JSX, between the header bar (the `<div>` with `flex h-8 shrink-0 ...`) and the `<div className="flex-1 overflow-hidden">`, render:

```tsx
{diffMode === "inline" && leftSideCount > 0 && commitHash && (
	<div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[11px] text-[var(--text-secondary)]">
		<span>ⓘ</span>
		<span>
			{leftSideCount} {leftSideCount === 1 ? "comment is" : "comments are"} on deleted lines
		</span>
		<button
			type="button"
			onClick={() => setDiffMode("split")}
			className="text-[var(--accent)] hover:underline cursor-pointer bg-transparent border-none p-0"
		>
			Switch to Split view
		</button>
	</div>
)}
```

The `commitHash` guard suppresses the banner on the file-level-comments-only fallback path where there's no diff.

- [ ] **Step 2: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: clean.

- [ ] **Step 3: Run biome on touched file**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/rework-comment-solver-ui && bunx biome check apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx
```

Expected: no NEW errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx
git commit -m "feat(solve): banner in inline mode counts deleted-line comments"
```

---

## Task 9: Final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full project type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: clean.

- [ ] **Step 2: Full unit-test suite for touched areas**

```bash
cd apps/desktop && bun test tests/resolveSide.test.ts tests/comment-poller-side.test.ts tests/solve-session-store.test.ts tests/solve-sidebar.test.ts tests/comment-solver.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Biome check on every touched file**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/rework-comment-solver-ui && bunx biome check \
  apps/desktop/src/main/db/schema-comment-solver.ts \
  apps/desktop/src/main/providers/types.ts \
  apps/desktop/src/main/providers/github-adapter.ts \
  apps/desktop/src/main/ai-review/comment-poller.ts \
  apps/desktop/src/main/ai-review/create-and-queue-solve.ts \
  apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx \
  apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx \
  apps/desktop/tests/resolveSide.test.ts \
  apps/desktop/tests/comment-poller-side.test.ts
```

Expected: no NEW errors (zero diff to project-wide lint debt).

- [ ] **Step 4: Manual smoke walkthrough in `bun run dev`**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/rework-comment-solver-ui && bun run dev
```

Then in the running app:

1. Open the workspace's Comments tab to trigger a fresh poll. The poller wipe-and-rewrites the cache so the new schema's `side` column is populated for the PR you're testing.
2. Trigger a comment-solve session for that PR.
3. Once solved, open the solve-review tab, expand a group with a deleted-line comment.
4. Verify in **Split mode**: inline card appears in the **original (left)** pane at the deleted line; clicking the sidebar comment scrolls the original pane and tints the active line with `solve-comment-active-line`.
5. Verify a comment on a **modified (added/changed)** line: inline card in the **modified (right)** pane; active-line decoration in the modified pane.
6. Verify a **file-level** comment (no `lineNumber`): inline card pinned at line 1 of modified pane.
7. Switch the diff to **Inline mode**: banner appears at the top of the editor area showing the count of deleted-line comments and a "Switch to Split view" link. Click the link → returns to split.
8. Switch to a file with **only modified-line** comments: no banner appears in inline mode.
9. Toggle `💬 Comments: Off` → cards vanish, gutter glyphs appear in the **correct pane** for each comment (LEFT-side glyphs in original gutter, RIGHT-side in modified gutter).
10. Click a glyph → toggle returns to On, that comment becomes active in sidebar + diff.

If any step fails, capture the failing screenshot and the values of `comment.side`, `lineNumber`, and the `originalModel.getLineCount()` / `modifiedModel.getLineCount()` from the React DevTools / Monaco state, and surface them — those are the inputs `resolveSide` operates on and the failure mode is almost always a wrong heuristic input.

- [ ] **Step 5: Final summary commit (if any docs touched)**

If the manual smoke surfaced docs needing an update (e.g. CLAUDE.md), do those edits and commit. Otherwise no final commit needed.

---

## Self-review notes

- All spec acceptance criteria covered: AC1 → Task 1 (migration); AC2 → Tasks 3, 4, 5; AC3 → Task 7 (LEFT routing) + Task 9.4 (smoke); AC4 → Task 7 + Task 9.5; AC5 → Task 6 + Task 9.6; AC6 → Task 8 + Task 9.7; AC7 → Task 6; AC8 → Task 9.1, 9.3; AC9 → Task 9.2.
- No placeholders. All steps either show exact code, exact commands, or are verification with explicit expected output.
- Function signatures consistent: `resolveSide(comment, originalModel, modifiedModel)` everywhere.
- TDD applied where it has signal (resolveSide pure helper). Schema/migration tasks lack a strict red-then-green flow — that's a known limitation of declarative schema tooling.
- Frequent commits: 8 feature commits + 1 docs/verification commit. Each commit leaves the build green.
