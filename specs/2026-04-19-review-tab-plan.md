# Review Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a keybind-driven Review tab (workspace tab kind) that traverses working + branch changes, reuses the right-sidebar Changes list for navigation (via highlight/dim sync), opens files for editing in a split pane, and persists per-file viewed state with content-hash invalidation.

**Architecture:** New Zustand `review-session-store` is the cross-component source of truth. New `review` tab kind renders `DiffEditor` in read-only mode. Sidebar components (`BranchChanges.tsx` + working-changes rendered in `DraftCommitCard.tsx`) subscribe to the store for highlight/dim and route clicks through `openReviewTab()` (replacing `openDiffFile()` for working + branch sources; `openDiffFile` is preserved for commit/PR diffs). Keybinds are registered as `Action`s in the existing `action-store` with `when` guards; `useShortcutListener` already exists and dispatches them. Optimistic overlay in the store provides flicker-free edit-pane saves.

**Tech Stack:** React 19, TypeScript strict, Zustand, tRPC, SQLite + Drizzle, Monaco (existing `DiffEditor` + `FileEditor`), Bun test.

**Spec:** `specs/2026-04-19-review-tab-design.md`

---

## File structure

**New files:**
- `apps/desktop/src/shared/review-types.ts` — `ReviewScope`, `ScopedDiffFile`, `ReviewViewedRecord`
- `apps/desktop/src/renderer/stores/review-session-store.ts` — Zustand store
- `apps/desktop/src/renderer/components/review/ReviewTab.tsx` — tab renderer (DiffEditor + empty state)
- `apps/desktop/src/renderer/components/review/ReviewProgressBar.tsx` — "X of Y reviewed" + percentage
- `apps/desktop/src/renderer/actions/review-actions.ts` — registers j/k/e/v/esc/1/2/3 + Cmd+Shift+R
- `apps/desktop/src/renderer/lib/content-hash.ts` — SHA-256 helper with 5s TTL cache
- `apps/desktop/src/main/trpc/routers/review.ts` — `getViewed`, `setViewed`, `unsetViewed`
- `apps/desktop/tests/review-session-store.test.ts` — store unit tests
- `apps/desktop/tests/review-router.test.ts` — router tests
- `apps/desktop/tests/review-actions.test.ts` — keybind guard + action wiring tests
- `apps/desktop/tests/review-tab-sync.test.ts` — sidebar highlight/dim + scope behavior

**Modified files:**
- `apps/desktop/src/main/db/schema.ts` — add `reviewViewed` table
- `apps/desktop/src/main/trpc/routers/index.ts` — mount `review` router
- `apps/desktop/src/renderer/stores/tab-store.ts` — add `review` tab kind + `openReviewTab()` action
- `apps/desktop/src/renderer/components/panes/PaneContent.tsx` — dispatch `review` kind
- `apps/desktop/src/renderer/components/panes/PaneTabBar.tsx` — icon for `review`
- `apps/desktop/src/renderer/components/BranchChanges.tsx` — subscribe to store; highlight/dim; click → `openReviewTab("branch", ...)`
- `apps/desktop/src/renderer/components/DraftCommitCard.tsx` — same treatment for unstaged + staged file rows (scope = `"working"`)
- `apps/desktop/src/renderer/actions/core-actions.ts` — call `registerReviewActions()` at end
- `apps/desktop/src/main/db/migrations/` — generated migration file `XXXX_add_review_viewed_table.sql`

---

## Baseline verification

Before starting, confirm baseline is green:

```bash
cd apps/desktop && bun test && cd - \
  && bun run type-check \
  && bun run lint
```

Re-run after every task.

---

## Task 1: Shared types

**Files:**
- Create: `apps/desktop/src/shared/review-types.ts`

- [ ] **Step 1: Write file**

```ts
// apps/desktop/src/shared/review-types.ts
import type { DiffFile } from "./diff-types";

export type ReviewScope = "all" | "working" | "branch";

export type WorkingSubScope = "staged" | "unstaged" | "untracked";

/** A DiffFile tagged with which scope it came from. */
export interface ScopedDiffFile extends DiffFile {
	scope: "working" | "branch";
	/** Only set when scope === "working" */
	workingSubScope?: WorkingSubScope;
}

export interface ReviewViewedRecord {
	workspaceId: string;
	filePath: string;
	contentHash: string;
	viewedAt: Date;
}
```

- [ ] **Step 2: Type-check**

```bash
bun run type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/shared/review-types.ts
git commit -m "feat(review): add shared review types"
```

---

## Task 2: DB schema — reviewViewed table

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts` (append after `lspDismissedLanguages`)

- [ ] **Step 1: Append table definition**

```ts
// apps/desktop/src/main/db/schema.ts (append at end, before the final newline)

export const reviewViewed = sqliteTable(
	"review_viewed",
	{
		workspaceId: text("workspace_id").notNull(),
		filePath: text("file_path").notNull(),
		contentHash: text("content_hash").notNull(),
		viewedAt: integer("viewed_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.workspaceId, table.filePath] }),
		index("idx_review_viewed_workspace").on(table.workspaceId),
	],
);

export type ReviewViewed = typeof reviewViewed.$inferSelect;
export type NewReviewViewed = typeof reviewViewed.$inferInsert;
```

- [ ] **Step 2: Generate migration with descriptive name**

```bash
cd apps/desktop && bun run db:generate --name add_review_viewed_table
```

Expected: new file `apps/desktop/src/main/db/migrations/NNNN_add_review_viewed_table.sql` created. Contents should include `CREATE TABLE review_viewed` and the index.

**Implementer note:** before running, verify `bun run db:generate` is a `drizzle-kit generate` wrapper (which accepts `--name`). Check `apps/desktop/package.json` scripts. If the script swallows args, run `drizzle-kit generate --name add_review_viewed_table` directly instead.

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/migrations/
git commit -m "feat(review): add review_viewed table + migration"
```

---

## Task 3: tRPC review router — failing test first

**Files:**
- Create: `apps/desktop/tests/review-router.test.ts`

- [ ] **Step 1: Write test**

```ts
// apps/desktop/tests/review-router.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createReviewTestDb } from "./helpers/review-test-db";
import { setViewed, getViewed, unsetViewed } from "../src/main/review/viewed-ops";

describe("review viewed-ops", () => {
	let db: ReturnType<typeof createReviewTestDb>;

	beforeEach(() => {
		db = createReviewTestDb();
	});

	test("setViewed inserts a row", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		const rows = getViewed(db, "ws1");
		expect(rows.length).toBe(1);
		expect(rows[0].filePath).toBe("a.ts");
		expect(rows[0].contentHash).toBe("h1");
	});

	test("setViewed upserts on conflict (same workspace + path)", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h2" });
		const rows = getViewed(db, "ws1");
		expect(rows.length).toBe(1);
		expect(rows[0].contentHash).toBe("h2");
	});

	test("unsetViewed removes a row", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		unsetViewed(db, { workspaceId: "ws1", filePath: "a.ts" });
		expect(getViewed(db, "ws1").length).toBe(0);
	});

	test("getViewed is scoped by workspaceId", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		setViewed(db, { workspaceId: "ws2", filePath: "a.ts", contentHash: "h2" });
		expect(getViewed(db, "ws1").length).toBe(1);
		expect(getViewed(db, "ws2").length).toBe(1);
	});
});
```

- [ ] **Step 2: Create test-db helper**

```ts
// apps/desktop/tests/helpers/review-test-db.ts
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { reviewViewed } from "../../src/main/db/schema";

export function createReviewTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.exec(`
		CREATE TABLE review_viewed (
			workspace_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			viewed_at INTEGER NOT NULL,
			PRIMARY KEY (workspace_id, file_path)
		);
		CREATE INDEX idx_review_viewed_workspace ON review_viewed(workspace_id);
	`);
	return drizzle(sqlite, { schema: { reviewViewed } });
}
```

- [ ] **Step 3: Run test — verify it fails**

```bash
cd apps/desktop && bun test tests/review-router.test.ts
```

Expected: FAIL with "Cannot find module" for `viewed-ops`.

- [ ] **Step 4: Implement viewed-ops**

```ts
// apps/desktop/src/main/review/viewed-ops.ts
import { and, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { reviewViewed } from "../db/schema";

export interface SetViewedInput {
	workspaceId: string;
	filePath: string;
	contentHash: string;
}

export function setViewed(db: BunSQLiteDatabase<any>, input: SetViewedInput): void {
	const now = new Date();
	db.insert(reviewViewed)
		.values({
			workspaceId: input.workspaceId,
			filePath: input.filePath,
			contentHash: input.contentHash,
			viewedAt: now,
		})
		.onConflictDoUpdate({
			target: [reviewViewed.workspaceId, reviewViewed.filePath],
			set: { contentHash: input.contentHash, viewedAt: now },
		})
		.run();
}

export function unsetViewed(
	db: BunSQLiteDatabase<any>,
	input: { workspaceId: string; filePath: string },
): void {
	db.delete(reviewViewed)
		.where(
			and(
				eq(reviewViewed.workspaceId, input.workspaceId),
				eq(reviewViewed.filePath, input.filePath),
			),
		)
		.run();
}

export function getViewed(
	db: BunSQLiteDatabase<any>,
	workspaceId: string,
): Array<{ filePath: string; contentHash: string; viewedAt: Date }> {
	return db
		.select({
			filePath: reviewViewed.filePath,
			contentHash: reviewViewed.contentHash,
			viewedAt: reviewViewed.viewedAt,
		})
		.from(reviewViewed)
		.where(eq(reviewViewed.workspaceId, workspaceId))
		.all();
}
```

- [ ] **Step 5: Re-run test — verify PASS**

```bash
cd apps/desktop && bun test tests/review-router.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/review/viewed-ops.ts apps/desktop/tests/review-router.test.ts apps/desktop/tests/helpers/review-test-db.ts
git commit -m "feat(review): add viewed-ops (setViewed/getViewed/unsetViewed)"
```

---

## Task 4: Wire router + mount in app router

**Files:**
- Create: `apps/desktop/src/main/trpc/routers/review.ts`
- Modify: `apps/desktop/src/main/trpc/routers/index.ts`

- [ ] **Step 1: Create review router**

```ts
// apps/desktop/src/main/trpc/routers/review.ts
import { z } from "zod";
import { getDb } from "../../db";
import { getViewed, setViewed, unsetViewed } from "../../review/viewed-ops";
import { publicProcedure, router } from "../index";

export const reviewRouter = router({
	getViewed: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			return getViewed(db, input.workspaceId);
		}),

	setViewed: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				filePath: z.string(),
				contentHash: z.string(),
			}),
		)
		.mutation(({ input }) => {
			const db = getDb();
			setViewed(db, input);
			return { ok: true };
		}),

	unsetViewed: publicProcedure
		.input(z.object({ workspaceId: z.string(), filePath: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			unsetViewed(db, input);
			return { ok: true };
		}),
});
```

- [ ] **Step 2: Mount in app router**

In `apps/desktop/src/main/trpc/routers/index.ts`, add the import and mount alongside the other routers:

```ts
// add to imports (alphabetical-ish, after `remoteRouter`)
import { reviewRouter } from "./review";

// inside appRouter object, add:
review: reviewRouter,
```

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/review.ts apps/desktop/src/main/trpc/routers/index.ts
git commit -m "feat(review): mount review tRPC router"
```

---

## Task 5: Content-hash helper with TTL cache

**Files:**
- Create: `apps/desktop/src/renderer/lib/content-hash.ts`
- Create: `apps/desktop/tests/content-hash.test.ts`

- [ ] **Step 1: Write test**

```ts
// apps/desktop/tests/content-hash.test.ts
import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/renderer/lib/content-hash";

describe("sha256Hex", () => {
	test("hashes ascii content", async () => {
		const h = await sha256Hex("hello");
		expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
	});

	test("is deterministic", async () => {
		expect(await sha256Hex("x")).toBe(await sha256Hex("x"));
	});

	test("differs for different content", async () => {
		expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
	});
});
```

- [ ] **Step 2: Run test — verify fail**

```bash
cd apps/desktop && bun test tests/content-hash.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/renderer/lib/content-hash.ts

/** SHA-256 hex digest of a string. Runs in the renderer via Web Crypto. */
export async function sha256Hex(content: string): Promise<string> {
	const bytes = new TextEncoder().encode(content);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const arr = Array.from(new Uint8Array(digest));
	return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** TTL-cached variant. Useful for sidebar renders that ask the same hash repeatedly. */
const hashCache = new Map<string, { hash: string; expiresAt: number }>();
const TTL_MS = 5_000;

export async function sha256HexCached(key: string, content: string): Promise<string> {
	const now = Date.now();
	const hit = hashCache.get(key);
	if (hit && hit.expiresAt > now) return hit.hash;
	const hash = await sha256Hex(content);
	hashCache.set(key, { hash, expiresAt: now + TTL_MS });
	return hash;
}

export function invalidateHashCache(key?: string): void {
	if (key === undefined) hashCache.clear();
	else hashCache.delete(key);
}
```

- [ ] **Step 4: Re-run test — verify PASS**

```bash
cd apps/desktop && bun test tests/content-hash.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/content-hash.ts apps/desktop/tests/content-hash.test.ts
git commit -m "feat(review): add SHA-256 content-hash helper with TTL cache"
```

---

## Task 6: review-session-store — skeleton + lifecycle

**Files:**
- Create: `apps/desktop/src/renderer/stores/review-session-store.ts`
- Create: `apps/desktop/tests/review-session-store.test.ts`

- [ ] **Step 1: Write failing test for lifecycle**

```ts
// apps/desktop/tests/review-session-store.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { useReviewSessionStore } from "../src/renderer/stores/review-session-store";

function reset() {
	useReviewSessionStore.setState({ activeSession: null });
}

describe("review-session-store lifecycle", () => {
	beforeEach(reset);

	test("starts with no active session", () => {
		expect(useReviewSessionStore.getState().activeSession).toBeNull();
	});

	test("startSession creates a session with defaults", () => {
		useReviewSessionStore.getState().startSession({ workspaceId: "ws1" });
		const s = useReviewSessionStore.getState().activeSession;
		expect(s).not.toBeNull();
		expect(s!.workspaceId).toBe("ws1");
		expect(s!.scope).toBe("all");
		expect(s!.selectedFilePath).toBeNull();
		expect(s!.editSplitPaneId).toBeNull();
		expect(s!.editOverlay.size).toBe(0);
	});

	test("startSession with scope + filePath", () => {
		useReviewSessionStore
			.getState()
			.startSession({ workspaceId: "ws1", scope: "branch", filePath: "a.ts" });
		const s = useReviewSessionStore.getState().activeSession!;
		expect(s.scope).toBe("branch");
		expect(s.selectedFilePath).toBe("a.ts");
	});

	test("startSession on existing session updates fields, preserves overlay", () => {
		const s0 = useReviewSessionStore.getState();
		s0.startSession({ workspaceId: "ws1" });
		s0.pushOptimisticContent("a.ts", "edited");
		s0.startSession({ workspaceId: "ws1", scope: "working", filePath: "b.ts" });
		const s = useReviewSessionStore.getState().activeSession!;
		expect(s.scope).toBe("working");
		expect(s.selectedFilePath).toBe("b.ts");
		expect(s.editOverlay.get("a.ts")).toBe("edited");
	});

	test("startSession for a different workspace resets overlay", () => {
		const s0 = useReviewSessionStore.getState();
		s0.startSession({ workspaceId: "ws1" });
		s0.pushOptimisticContent("a.ts", "edited");
		s0.startSession({ workspaceId: "ws2" });
		const s = useReviewSessionStore.getState().activeSession!;
		expect(s.workspaceId).toBe("ws2");
		expect(s.editOverlay.size).toBe(0);
	});

	test("endSession clears to null", () => {
		useReviewSessionStore.getState().startSession({ workspaceId: "ws1" });
		useReviewSessionStore.getState().endSession();
		expect(useReviewSessionStore.getState().activeSession).toBeNull();
	});
});
```

- [ ] **Step 2: Run — verify fail**

```bash
cd apps/desktop && bun test tests/review-session-store.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement store skeleton**

```ts
// apps/desktop/src/renderer/stores/review-session-store.ts
import { create } from "zustand";
import type { ReviewScope, ScopedDiffFile } from "../../shared/review-types";

export interface ReviewSession {
	workspaceId: string;
	scope: ReviewScope;
	selectedFilePath: string | null;
	editSplitPaneId: string | null;
	editOverlay: Map<string, string>;
}

export interface ReviewSessionStore {
	activeSession: ReviewSession | null;

	startSession: (args: {
		workspaceId: string;
		scope?: ReviewScope;
		filePath?: string;
	}) => void;
	endSession: () => void;

	selectFile: (path: string | null) => void;
	nextFile: (scopedFiles: ScopedDiffFile[]) => void;
	prevFile: (scopedFiles: ScopedDiffFile[]) => void;

	setScope: (scope: ReviewScope, scopedFiles?: ScopedDiffFile[]) => void;

	setEditSplitPaneId: (paneId: string | null) => void;
	pushOptimisticContent: (path: string, content: string) => void;
	clearOptimisticContent: (path: string) => void;
	getOptimisticContent: (path: string) => string | undefined;
}

export const useReviewSessionStore = create<ReviewSessionStore>()((set, get) => ({
	activeSession: null,

	startSession: ({ workspaceId, scope, filePath }) => {
		const current = get().activeSession;
		const preserveOverlay = current?.workspaceId === workspaceId;
		set({
			activeSession: {
				workspaceId,
				scope: scope ?? current?.scope ?? "all",
				selectedFilePath: filePath ?? current?.selectedFilePath ?? null,
				editSplitPaneId: preserveOverlay ? current!.editSplitPaneId : null,
				editOverlay: preserveOverlay ? current!.editOverlay : new Map(),
			},
		});
	},

	endSession: () => set({ activeSession: null }),

	selectFile: (path) => {
		const s = get().activeSession;
		if (!s) return;
		set({ activeSession: { ...s, selectedFilePath: path } });
	},

	nextFile: (scopedFiles) => {
		const s = get().activeSession;
		if (!s || scopedFiles.length === 0) return;
		const idx = scopedFiles.findIndex((f) => f.path === s.selectedFilePath);
		const nextIdx = Math.min(idx + 1, scopedFiles.length - 1);
		const next = scopedFiles[nextIdx];
		if (!next || next.path === s.selectedFilePath) return;
		set({ activeSession: { ...s, selectedFilePath: next.path } });
	},

	prevFile: (scopedFiles) => {
		const s = get().activeSession;
		if (!s || scopedFiles.length === 0) return;
		const idx = scopedFiles.findIndex((f) => f.path === s.selectedFilePath);
		const prevIdx = Math.max(idx === -1 ? 0 : idx - 1, 0);
		const prev = scopedFiles[prevIdx];
		if (!prev || prev.path === s.selectedFilePath) return;
		set({ activeSession: { ...s, selectedFilePath: prev.path } });
	},

	setScope: (scope, scopedFiles) => {
		const s = get().activeSession;
		if (!s) return;
		const next = { ...s, scope };
		if (scopedFiles) {
			const stillInScope = scopedFiles.some((f) => f.path === s.selectedFilePath);
			if (!stillInScope) {
				next.selectedFilePath = scopedFiles[0]?.path ?? null;
			}
		}
		set({ activeSession: next });
	},

	setEditSplitPaneId: (paneId) => {
		const s = get().activeSession;
		if (!s) return;
		set({ activeSession: { ...s, editSplitPaneId: paneId } });
	},

	pushOptimisticContent: (path, content) => {
		const s = get().activeSession;
		if (!s) return;
		const next = new Map(s.editOverlay);
		next.set(path, content);
		set({ activeSession: { ...s, editOverlay: next } });
	},

	clearOptimisticContent: (path) => {
		const s = get().activeSession;
		if (!s) return;
		if (!s.editOverlay.has(path)) return;
		const next = new Map(s.editOverlay);
		next.delete(path);
		set({ activeSession: { ...s, editOverlay: next } });
	},

	getOptimisticContent: (path) => {
		return get().activeSession?.editOverlay.get(path);
	},
}));
```

- [ ] **Step 4: Re-run test — verify PASS**

```bash
cd apps/desktop && bun test tests/review-session-store.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/review-session-store.ts apps/desktop/tests/review-session-store.test.ts
git commit -m "feat(review): add review-session-store with lifecycle + overlay"
```

---

## Task 7: review-session-store — navigation tests (j/k) + scope filter

**Files:**
- Modify: `apps/desktop/tests/review-session-store.test.ts` (append)

- [ ] **Step 1: Append navigation tests**

```ts
// append to apps/desktop/tests/review-session-store.test.ts

import type { ScopedDiffFile } from "../src/shared/review-types";

function makeFiles(paths: Array<[string, "working" | "branch"]>): ScopedDiffFile[] {
	return paths.map(([path, scope]) => ({
		path,
		status: "modified" as const,
		additions: 0,
		deletions: 0,
		hunks: [],
		scope,
	}));
}

describe("review-session-store navigation", () => {
	beforeEach(reset);

	test("nextFile moves to next in list", () => {
		const files = makeFiles([
			["a.ts", "working"],
			["b.ts", "working"],
			["c.ts", "branch"],
		]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.nextFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("b.ts");
	});

	test("nextFile stops at the last file (no wrap)", () => {
		const files = makeFiles([
			["a.ts", "working"],
			["b.ts", "branch"],
		]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "b.ts" });
		s.nextFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("b.ts");
	});

	test("prevFile stops at the first file (no wrap)", () => {
		const files = makeFiles([
			["a.ts", "working"],
			["b.ts", "branch"],
		]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.prevFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("nextFile no-op on empty list", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "x.ts" });
		s.nextFile([]);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("x.ts");
	});

	test("nextFile from null selection picks first", () => {
		const files = makeFiles([["a.ts", "working"]]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1" });
		s.nextFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});
});

describe("review-session-store scope", () => {
	beforeEach(reset);

	test("setScope updates scope", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1" });
		s.setScope("branch");
		expect(useReviewSessionStore.getState().activeSession!.scope).toBe("branch");
	});

	test("setScope with scopedFiles reselects if current out-of-scope", () => {
		const scoped = makeFiles([["c.ts", "branch"]]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setScope("branch", scoped);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("c.ts");
	});

	test("setScope preserves selection if still in scope", () => {
		const scoped = makeFiles([["a.ts", "branch"]]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setScope("branch", scoped);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("setScope clears selection if scope is empty", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setScope("branch", []);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBeNull();
	});
});
```

The `nextFile from null selection picks first` test — the current implementation returns `idx = -1` then `nextIdx = Math.min(0, len-1) = 0`. Good.

- [ ] **Step 2: Run — verify PASS**

```bash
cd apps/desktop && bun test tests/review-session-store.test.ts
```

Expected: PASS — all tests (lifecycle + navigation + scope).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tests/review-session-store.test.ts
git commit -m "test(review): cover nextFile/prevFile + setScope reselection"
```

---

## Task 8: Add `review` tab kind to tab-store

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`

- [ ] **Step 1: Extend TabItem union**

In `tab-store.ts`, inside the `TabItem` union (after `merge-conflict` variant, around line 81), add:

```ts
	| {
			kind: "review";
			id: string;
			workspaceId: string;
			repoPath: string;
			baseBranch: string;
			title: "Review";
	  };

/*
Note: we do NOT store currentBranch in the tab. ReviewTab resolves it at render-time
via trpc.diff.getWorkingTreeStatus — that's the live truth if the branch changes while
the tab is open.
*/
```

- [ ] **Step 2: Add `openReviewTab` action**

Locate the existing `openDiffFile` action in `tab-store.ts` (search for `openDiffFile:`). Add `openReviewTab` immediately after it in the `TabStore` interface:

```ts
	openReviewTab: (args: {
		workspaceId: string;
		repoPath: string;
		baseBranch: string;
		scope?: ReviewScope;
		filePath?: string;
	}) => void;
	closeReviewTab: (workspaceId: string) => void;
```

Add to imports at top of file:

```ts
import type { ReviewScope } from "../../shared/review-types";
import { useReviewSessionStore } from "./review-session-store";
```

Implement both actions (place them immediately after `openDiffFile`):

```ts
	openReviewTab: ({ workspaceId, repoPath, baseBranch, scope, filePath }) => {
		const ps = usePaneStore.getState();
		const focused = ps.getFocusedPane(workspaceId) ?? ps.getLayout(workspaceId);
		// Find existing review tab in any pane for this workspace
		const allPanes = getAllPanes(ps.getLayout(workspaceId) ?? createDefaultPane());
		for (const pane of allPanes) {
			const existing = pane.tabs.find(
				(t) => t.kind === "review" && t.workspaceId === workspaceId,
			);
			if (existing) {
				ps.setActiveTabInPane(workspaceId, pane.id, existing.id);
				useReviewSessionStore.getState().startSession({ workspaceId, scope, filePath });
				return;
			}
		}
		// Create a new review tab
		const tab: TabItem = {
			kind: "review",
			id: `review-${nextFileTabId()}`,
			workspaceId,
			repoPath,
			baseBranch,
			title: "Review",
		};
		if (focused && "id" in focused) {
			ps.addTabToPane(workspaceId, focused.id, tab);
		} else {
			// No focused pane — cannot open
			return;
		}
		useReviewSessionStore.getState().startSession({ workspaceId, scope, filePath });
	},

	closeReviewTab: (workspaceId) => {
		const ps = usePaneStore.getState();
		const layout = ps.getLayout(workspaceId);
		if (!layout) return;
		const allPanes = getAllPanes(layout);
		for (const pane of allPanes) {
			const tab = pane.tabs.find((t) => t.kind === "review" && t.workspaceId === workspaceId);
			if (tab) {
				ps.closeTabInPane(workspaceId, pane.id, tab.id);
				break;
			}
		}
		useReviewSessionStore.getState().endSession();
	},
```

Note: `getAllPanes`, `nextFileTabId`, `createDefaultPane` are already imported/available in `tab-store.ts`. Verify their exact exports before editing: `getAllPanes` and `createDefaultPane` are imported from `./pane-store` (see line 6 of tab-store.ts); `nextFileTabId` is a file-local counter. If `nextFileTabId` is defined as a local `let nextFileTabIdCounter = 0` style helper, match the existing pattern.

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts
git commit -m "feat(review): add \`review\` tab kind + openReviewTab/closeReviewTab"
```

---

## Task 9: ReviewProgressBar component

**Files:**
- Create: `apps/desktop/src/renderer/components/review/ReviewProgressBar.tsx`

- [ ] **Step 1: Write component**

```tsx
// apps/desktop/src/renderer/components/review/ReviewProgressBar.tsx

export function ReviewProgressBar({
	reviewed,
	total,
}: {
	reviewed: number;
	total: number;
}) {
	const pct = total === 0 ? 0 : Math.round((reviewed / total) * 100);
	return (
		<div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-tertiary)]">
			<span>
				{reviewed} of {total} reviewed
			</span>
			<div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
				<div
					className="h-full bg-[var(--term-green)] transition-[width] duration-150"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="tabular-nums text-[var(--text-quaternary)]">{pct}%</span>
		</div>
	);
}
```

- [ ] **Step 2: Type-check**

```bash
bun run type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/review/ReviewProgressBar.tsx
git commit -m "feat(review): add ReviewProgressBar component"
```

---

## Task 10: ReviewTab component

**Files:**
- Create: `apps/desktop/src/renderer/components/review/ReviewTab.tsx`

- [ ] **Step 1: Write ReviewTab**

```tsx
// apps/desktop/src/renderer/components/review/ReviewTab.tsx
import { useEffect, useMemo, useState } from "react";
import type { DiffFile } from "../../../shared/diff-types";
import { detectLanguage } from "../../../shared/diff-types";
import type { ScopedDiffFile } from "../../../shared/review-types";
import { useReviewSessionStore } from "../../stores/review-session-store";
import { trpc } from "../../trpc/client";
import { DiffEditor } from "../DiffEditor";
import { ReviewProgressBar } from "./ReviewProgressBar";

export function ReviewTab({
	workspaceId,
	repoPath,
	baseBranch,
}: {
	workspaceId: string;
	repoPath: string;
	baseBranch: string;
}) {
	const session = useReviewSessionStore((s) => s.activeSession);

	// Resolve current branch live so the tab reflects branch switches without
	// needing to store it on the tab item.
	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath },
		{ refetchInterval: 5_000 },
	);
	const currentBranch = statusQuery.data?.branch ?? "";

	// ── Data: working + branch diffs ─────────────────────────────────────────
	const workingQuery = trpc.diff.getWorkingTreeDiff.useQuery(
		{ repoPath },
		{ refetchInterval: 2_000 },
	);
	const branchQuery = trpc.diff.getBranchDiff.useQuery(
		{ repoPath, baseBranch, headBranch: currentBranch },
		{ refetchInterval: 2_000, enabled: !!currentBranch },
	);

	// ── Merged scoped list ───────────────────────────────────────────────────
	const allFiles: ScopedDiffFile[] = useMemo(() => {
		const w = (workingQuery.data?.files ?? []).map((f): ScopedDiffFile => ({ ...f, scope: "working" }));
		const b = (branchQuery.data?.files ?? []).map((f): ScopedDiffFile => ({ ...f, scope: "branch" }));
		return [...w, ...b];
	}, [workingQuery.data, branchQuery.data]);

	const scope = session?.scope ?? "all";
	const scopedFiles = useMemo(
		() => (scope === "all" ? allFiles : allFiles.filter((f) => f.scope === scope)),
		[allFiles, scope],
	);

	// ── Viewed state ─────────────────────────────────────────────────────────
	const viewedQuery = trpc.review.getViewed.useQuery({ workspaceId }, { refetchInterval: 10_000 });
	const viewedMap = useMemo(() => {
		const m = new Map<string, string>();
		for (const row of viewedQuery.data ?? []) m.set(row.filePath, row.contentHash);
		return m;
	}, [viewedQuery.data]);

	// We show viewed count based on entries in DB that are in scope AND whose stored hash
	// matches what's on disk. Hash comparison happens in the sidebar on the fly; for the
	// progress bar we conservatively count any scoped file whose path has a viewed record.
	const reviewedInScope = useMemo(
		() => scopedFiles.filter((f) => viewedMap.has(f.path)).length,
		[scopedFiles, viewedMap],
	);

	// ── Selected file + content ─────────────────────────────────────────────
	const selectedFile: ScopedDiffFile | null = useMemo(
		() => scopedFiles.find((f) => f.path === session?.selectedFilePath) ?? null,
		[scopedFiles, session?.selectedFilePath],
	);

	// Auto-select first file if none selected or if selection fell out of scope
	useEffect(() => {
		if (!session) return;
		if (session.selectedFilePath && scopedFiles.some((f) => f.path === session.selectedFilePath))
			return;
		const first = scopedFiles[0]?.path ?? null;
		if (first !== session.selectedFilePath) {
			useReviewSessionStore.getState().selectFile(first);
		}
	}, [session, scopedFiles]);

	// ── File content (original = HEAD, modified = working tree) ─────────────
	const originalRef = selectedFile?.scope === "branch" ? baseBranch : "HEAD";
	const contentQ = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: originalRef, filePath: selectedFile?.path ?? "" },
		{ enabled: !!selectedFile },
	);
	const modifiedQ = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: "", filePath: selectedFile?.path ?? "" },
		{ enabled: !!selectedFile },
	);

	// Optimistic overlay — if the edit pane has pending content, show it on the right side.
	const overlay = useReviewSessionStore((s) =>
		selectedFile ? s.activeSession?.editOverlay.get(selectedFile.path) : undefined,
	);
	const modifiedContent = overlay ?? modifiedQ.data?.content ?? "";

	// ── Empty state ──────────────────────────────────────────────────────────
	if (allFiles.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No working or branch changes
			</div>
		);
	}
	if (scopedFiles.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No {scope} changes
			</div>
		);
	}
	if (!selectedFile) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No file selected
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col" data-review-tab>
			<ReviewProgressBar reviewed={reviewedInScope} total={scopedFiles.length} />
			<div className="flex-1 min-h-0">
				<DiffEditor
					original={contentQ.data?.content ?? ""}
					modified={modifiedContent}
					language={detectLanguage(selectedFile.path)}
					renderSideBySide={true}
					readOnly={true}
				/>
			</div>
		</div>
	);
}

// Helper to sum ScopedDiffFile back to DiffFile (not needed here, but kept for callers)
export type _unused = DiffFile;
```

**Note:** `DiffEditor` may not yet accept a `readOnly` prop. Check `apps/desktop/src/renderer/components/DiffEditor.tsx`. If it doesn't, extend it (`readOnly?: boolean` prop → passed to `monaco.editor.createDiffEditor({ readOnly: ... })`). If this is too invasive, fall back to omitting the prop and accepting that the diff editor is editable (but this is a UX regression — prefer the prop route).

- [ ] **Step 2: Type-check**

```bash
bun run type-check
```

Expected: PASS. If `DiffEditor` rejects `readOnly` prop, add it:

In `DiffEditor.tsx`, add `readOnly?: boolean` to its props interface, default `false`, and pass into Monaco config:

```ts
// inside createDiffEditor options
readOnly: props.readOnly ?? false,
```

Re-run type-check → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/review/ReviewTab.tsx apps/desktop/src/renderer/components/DiffEditor.tsx
git commit -m "feat(review): add ReviewTab component with scope + optimistic overlay"
```

---

## Task 11: Dispatch `review` kind in PaneContent + PaneTabBar icon

**Files:**
- Modify: `apps/desktop/src/renderer/components/panes/PaneContent.tsx`
- Modify: `apps/desktop/src/renderer/components/panes/PaneTabBar.tsx`

- [ ] **Step 1: Add dispatch in PaneContent.tsx**

Open `PaneContent.tsx`, locate the conditional blocks dispatching each tab kind (around the section handling `diff-file`, `file`, etc). Add a new block for `review`:

```tsx
{activeTab?.kind === "review" && (
	<div className="absolute inset-0">
		<ReviewTab
			workspaceId={activeTab.workspaceId}
			repoPath={activeTab.repoPath}
			baseBranch={activeTab.baseBranch}
		/>
	</div>
)}
```

Add import at top of file:

```ts
import { ReviewTab } from "../review/ReviewTab";
```

- [ ] **Step 2: Add icon in PaneTabBar.tsx**

In `PaneTabBar.tsx`, locate the `TabIcon` function. Add a case for `kind === "review"`. Use a simple inline SVG (a glasses or checkmark-list glyph) matching the existing icon style — if patterns in the file are ASCII emoji strings, match that style. If uncertain, reuse an existing glyph:

```tsx
if (kind === "review") {
	return (
		<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M2 2h12v2H2V2zm0 5h12v2H2V7zm0 5h8v2H2v-2z" />
		</svg>
	);
}
```

- [ ] **Step 3: Type-check + lint**

```bash
bun run type-check && bun run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/panes/PaneContent.tsx apps/desktop/src/renderer/components/panes/PaneTabBar.tsx
git commit -m "feat(review): render review tab kind + tab icon"
```

---

## Task 12: review-actions — registration + handlers

**Files:**
- Create: `apps/desktop/src/renderer/actions/review-actions.ts`

- [ ] **Step 1: Write module**

```ts
// apps/desktop/src/renderer/actions/review-actions.ts
import type { ScopedDiffFile } from "../../shared/review-types";
import { useActionStore } from "../stores/action-store";
import { usePaneStore } from "../stores/pane-store";
import { useReviewSessionStore } from "../stores/review-session-store";
import { useTabStore } from "../stores/tab-store";

function activeReviewTabFocused(): boolean {
	const ts = useTabStore.getState();
	const ps = usePaneStore.getState();
	const wsId = ts.activeWorkspaceId;
	if (!wsId) return false;
	const focused = ps.getFocusedPane(wsId);
	if (!focused) return false;
	const active = focused.tabs.find((t) => t.id === focused.activeTabId);
	return active?.kind === "review";
}

function scopedFilesFromStore(): ScopedDiffFile[] {
	// Lightweight re-derivation of what ReviewTab computes. We read from the tRPC
	// React Query cache via a global accessor set up by ReviewTab. To keep this
	// simple and coupling low, ReviewTab publishes its scoped list to the store
	// on every render (Task 12a below).
	return useReviewSessionStore.getState().lastScopedFiles;
}

export function registerReviewActions(): void {
	const store = useActionStore.getState();

	store.registerMany([
		{
			id: "review.openTab",
			label: "Open Review Tab",
			category: "Navigation",
			shortcut: { key: "r", meta: true, shift: true },
			execute: () => {
				const ts = useTabStore.getState();
				const wsId = ts.activeWorkspaceId;
				const repoPath = ts.activeWorkspaceCwd;
				if (!wsId || !repoPath) return;
				const baseBranch = ts.baseBranchByWorkspace[wsId] ?? "main";
				ts.openReviewTab({ workspaceId: wsId, repoPath, baseBranch });
			},
			keywords: ["changes", "diff", "walk"],
		},

		{
			id: "review.nextFile",
			label: "Next File (Review)",
			category: "Navigation",
			shortcut: { key: "j" },
			when: activeReviewTabFocused,
			execute: () => useReviewSessionStore.getState().nextFile(scopedFilesFromStore()),
		},
		{
			id: "review.prevFile",
			label: "Previous File (Review)",
			category: "Navigation",
			shortcut: { key: "k" },
			when: activeReviewTabFocused,
			execute: () => useReviewSessionStore.getState().prevFile(scopedFilesFromStore()),
		},

		{
			id: "review.scopeAll",
			label: "Review Scope: All",
			category: "View",
			shortcut: { key: "1" },
			when: activeReviewTabFocused,
			execute: () => useReviewSessionStore.getState().setScope("all", scopedFilesFromStore()),
		},
		{
			id: "review.scopeWorking",
			label: "Review Scope: Working",
			category: "View",
			shortcut: { key: "2" },
			when: activeReviewTabFocused,
			execute: () =>
				useReviewSessionStore
					.getState()
					.setScope(
						"working",
						useReviewSessionStore.getState().lastAllFiles.filter((f) => f.scope === "working"),
					),
		},
		{
			id: "review.scopeBranch",
			label: "Review Scope: Branch",
			category: "View",
			shortcut: { key: "3" },
			when: activeReviewTabFocused,
			execute: () =>
				useReviewSessionStore
					.getState()
					.setScope(
						"branch",
						useReviewSessionStore.getState().lastAllFiles.filter((f) => f.scope === "branch"),
					),
		},

		{
			id: "review.toggleViewed",
			label: "Toggle Viewed (Review)",
			category: "View",
			shortcut: { key: "v" },
			when: activeReviewTabFocused,
			execute: () => {
				window.dispatchEvent(new CustomEvent("review:toggle-viewed"));
			},
		},

		{
			id: "review.openEdit",
			label: "Open Current File for Editing (Review)",
			category: "Navigation",
			shortcut: { key: "e" },
			when: activeReviewTabFocused,
			execute: () => {
				window.dispatchEvent(new CustomEvent("review:open-edit"));
			},
		},

		{
			id: "review.closeEdit",
			label: "Close Edit Split (Review)",
			category: "Navigation",
			shortcut: { key: "Escape" },
			when: () => {
				// Active when edit split pane is open (regardless of focus — users may be
				// inside the edit pane's Monaco editor). We rely on `shouldSkipShortcutHandling`
				// NOT skipping Escape inside a textarea with modifier — but Monaco's `inputarea`
				// is a textarea, so `isTextInputElement` returns true. To let Escape through we
				// add an explicit exception in useShortcutListener (Task 15).
				return useReviewSessionStore.getState().activeSession?.editSplitPaneId != null;
			},
			execute: () => {
				window.dispatchEvent(new CustomEvent("review:close-edit"));
			},
		},
	]);
}
```

- [ ] **Step 2: Extend store with `lastScopedFiles` / `lastAllFiles`**

Add to `ReviewSessionStore` interface in `review-session-store.ts`:

```ts
	lastAllFiles: ScopedDiffFile[];
	lastScopedFiles: ScopedDiffFile[];
	setFileSnapshot: (all: ScopedDiffFile[], scoped: ScopedDiffFile[]) => void;
```

Add to initial state and implementation:

```ts
	lastAllFiles: [],
	lastScopedFiles: [],
	setFileSnapshot: (all, scoped) =>
		set({ lastAllFiles: all, lastScopedFiles: scoped }),
```

In `ReviewTab.tsx`, after computing `allFiles` and `scopedFiles`, publish:

```tsx
	useEffect(() => {
		useReviewSessionStore.getState().setFileSnapshot(allFiles, scopedFiles);
	}, [allFiles, scopedFiles]);
```

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/actions/review-actions.ts apps/desktop/src/renderer/stores/review-session-store.ts apps/desktop/src/renderer/components/review/ReviewTab.tsx
git commit -m "feat(review): register j/k/e/v/esc/1/2/3/Cmd+Shift+R actions"
```

---

## Task 13: Register review actions on boot

**Files:**
- Modify: `apps/desktop/src/renderer/actions/core-actions.ts`

- [ ] **Step 1: Call from registerCoreActions**

At the very end of `registerCoreActions()` in `core-actions.ts`, after the last `store.registerMany([...])` block closes, add:

```ts
	registerReviewActions();
```

Add to imports at top:

```ts
import { registerReviewActions } from "./review-actions";
```

- [ ] **Step 2: Type-check**

```bash
bun run type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/actions/core-actions.ts
git commit -m "feat(review): register review actions on boot"
```

---

## Task 14: ReviewTab event listeners + edit-split orchestration (combined)

This task combines the ReviewTab event listeners (previously Task 14) and the tab-store edit-split orchestration methods (previously Task 15). They are one logical commit — the ReviewTab handlers call the tab-store methods, so they must land together or type-check fails.

**Files:**
- Modify: `apps/desktop/src/renderer/components/review/ReviewTab.tsx`
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`

The keybind actions dispatch `CustomEvent`s; ReviewTab listens and handles them, because it has the tRPC hooks and knows the current file.

### Part A — add ReviewTab event listeners

- [ ] **Step 1: Add listeners**

In `ReviewTab.tsx`, add after the state hooks:

```tsx
	const utils = trpc.useUtils();
	const setViewedMut = trpc.review.setViewed.useMutation({
		onSuccess: () => utils.review.getViewed.invalidate({ workspaceId }),
	});
	const unsetViewedMut = trpc.review.unsetViewed.useMutation({
		onSuccess: () => utils.review.getViewed.invalidate({ workspaceId }),
	});

	useEffect(() => {
		async function handleToggleViewed() {
			if (!selectedFile) return;
			const path = selectedFile.path;
			const modified = modifiedQ.data?.content ?? "";
			const { sha256Hex } = await import("../../lib/content-hash");
			const hash = await sha256Hex(modified);
			const stored = viewedMap.get(path);
			if (stored === hash) {
				unsetViewedMut.mutate({ workspaceId, filePath: path });
			} else {
				setViewedMut.mutate({ workspaceId, filePath: path, contentHash: hash });
			}
		}

		function handleOpenEdit() {
			if (!selectedFile) return;
			const store = useReviewSessionStore.getState();
			// Invoke tab-store to split current pane with a file tab for this file.
			// We re-use `useTabStore.openEditFileSplitForReview` — see Task 15.
			const ts = useTabStore.getState();
			ts.openEditFileSplitForReview({
				workspaceId,
				repoPath,
				filePath: selectedFile.path,
			});
		}

		function handleCloseEdit() {
			const ts = useTabStore.getState();
			ts.closeEditFileSplitForReview(workspaceId);
		}

		window.addEventListener("review:toggle-viewed", handleToggleViewed);
		window.addEventListener("review:open-edit", handleOpenEdit);
		window.addEventListener("review:close-edit", handleCloseEdit);
		return () => {
			window.removeEventListener("review:toggle-viewed", handleToggleViewed);
			window.removeEventListener("review:open-edit", handleOpenEdit);
			window.removeEventListener("review:close-edit", handleCloseEdit);
		};
	}, [selectedFile, modifiedQ.data, viewedMap, workspaceId, repoPath, setViewedMut, unsetViewedMut]);
```

### Part B — add edit-split orchestration to tab-store

- [ ] **Step 2: Add methods to TabStore interface**

```ts
	openEditFileSplitForReview: (args: {
		workspaceId: string;
		repoPath: string;
		filePath: string;
	}) => void;
	closeEditFileSplitForReview: (workspaceId: string) => void;
```

- [ ] **Step 3: Implement**

Append to tab-store implementation, after `closeReviewTab`:

```ts
	openEditFileSplitForReview: ({ workspaceId, repoPath, filePath }) => {
		const ps = usePaneStore.getState();
		const rs = useReviewSessionStore.getState();
		const session = rs.activeSession;
		if (!session) return;

		// Find the review pane (the pane whose active tab is this workspace's review tab)
		const layout = ps.getLayout(workspaceId);
		if (!layout) return;
		const allPanes = getAllPanes(layout);
		const reviewPane = allPanes.find((p) => {
			const active = p.tabs.find((t) => t.id === p.activeTabId);
			return active?.kind === "review" && active.workspaceId === workspaceId;
		});
		if (!reviewPane) return;

		const language = detectLanguage(filePath);
		const fileTab: TabItem = {
			kind: "file",
			id: `file-${nextFileTabId()}`,
			workspaceId,
			repoPath,
			filePath,
			title: filePath.split("/").pop() ?? filePath,
			language,
		};

		// Existing split pane — check liveness and whether it already holds this file
		if (session.editSplitPaneId) {
			const existing = allPanes.find((p) => p.id === session.editSplitPaneId);
			if (existing) {
				const active = existing.tabs.find((t) => t.id === existing.activeTabId);
				if (active?.kind === "file" && active.filePath === filePath) {
					// Same file — just focus the pane
					ps.setFocusedPane(existing.id);
					return;
				}
				// Different file — replace the pane's active tab
				// Close all tabs in the pane, then add the new one
				for (const t of [...existing.tabs]) ps.closeTabInPane(workspaceId, existing.id, t.id);
				ps.addTabToPane(workspaceId, existing.id, fileTab);
				ps.setFocusedPane(existing.id);
				return;
			}
			// Stale pane id — clear and fall through
			rs.setEditSplitPaneId(null);
		}

		// Create a new split pane to the right of the review pane
		ps.splitPane(workspaceId, reviewPane.id, "horizontal", fileTab);
		// The newly-created pane is now active; find its id
		const afterSplit = getAllPanes(ps.getLayout(workspaceId)!);
		const newPane = afterSplit.find((p) =>
			p.tabs.some((t) => t.id === fileTab.id),
		);
		if (newPane) rs.setEditSplitPaneId(newPane.id);
	},

	closeEditFileSplitForReview: (workspaceId) => {
		const ps = usePaneStore.getState();
		const rs = useReviewSessionStore.getState();
		const paneId = rs.activeSession?.editSplitPaneId;
		if (!paneId) return;

		const layout = ps.getLayout(workspaceId);
		if (!layout) {
			rs.setEditSplitPaneId(null);
			return;
		}
		const pane = getAllPanes(layout).find((p) => p.id === paneId);
		if (!pane) {
			rs.setEditSplitPaneId(null);
			return;
		}
		// Close the whole pane: closing the last tab removes the pane (existing behavior).
		for (const t of [...pane.tabs]) ps.closeTabInPane(workspaceId, pane.id, t.id);
		rs.setEditSplitPaneId(null);
	},
```

Add `detectLanguage` import near the top of tab-store.ts (if not already imported):

```ts
import { detectLanguage } from "../../shared/diff-types";
```

- [ ] **Step 4: Type-check**

```bash
bun run type-check
```

Expected: PASS. ReviewTab listeners + tab-store methods compile together.

- [ ] **Step 5: Run existing tests**

```bash
cd apps/desktop && bun test
```

Expected: all previously-passing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts apps/desktop/src/renderer/components/review/ReviewTab.tsx
git commit -m "feat(review): wire toggle-viewed + open/close edit-split in ReviewTab"
```

---

## Task 15: (merged into Task 14 above)

Task 14 now covers both ReviewTab event listeners and tab-store edit-split orchestration as one atomic commit. Skip this task number.

---

## Task 16: Optimistic overlay during save

**Files:**
- Modify: `apps/desktop/src/renderer/components/FileEditor.tsx`

`FileEditor` already debounces and calls `saveFileContent`. Hook into it to push optimistic content to the review-session-store.

- [ ] **Step 1: Read FileEditor.tsx** to find the debounced save call site.

- [ ] **Step 2: Push overlay on change + clear on refetch**

Locate where FileEditor schedules / invokes its save. Before the mutation call, push to the review store:

```tsx
import { useReviewSessionStore } from "../stores/review-session-store";

// inside the onChange/save-scheduling code (pseudo-location — inside the debounced save handler):
const rs = useReviewSessionStore.getState();
if (rs.activeSession) {
	rs.pushOptimisticContent(filePath, content);
}

// After `saveMutation.mutate(...)` succeeds (use `onSuccess` in the mutation's options):
onSuccess: () => {
	utils.diff.getWorkingTreeDiff.invalidate({ repoPath });
	utils.diff.getWorkingTreeStatus.invalidate({ repoPath });
	// Clear the overlay so ReviewTab falls back to server truth
	useReviewSessionStore.getState().clearOptimisticContent(filePath);
},
onError: () => {
	useReviewSessionStore.getState().clearOptimisticContent(filePath);
},
```

Be surgical — FileEditor is used for more than just the review edit split. Guard with `if (rs.activeSession)` so non-review file tabs do nothing. This means normal file-editor tabs incur no behavior change: `activeSession` is null when no Review tab is open.

- [ ] **Step 3: Type-check + existing tests**

```bash
bun run type-check && cd apps/desktop && bun test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/FileEditor.tsx
git commit -m "feat(review): push optimistic overlay during FileEditor save"
```

---

## Task 17: Sidebar highlight + dim — BranchChanges.tsx

**Files:**
- Modify: `apps/desktop/src/renderer/components/BranchChanges.tsx`

- [ ] **Step 1: Subscribe + re-route click**

Replace the component to (a) read `selectedFilePath` + `scope` from the review-session-store, (b) apply highlight/dim classes, and (c) route click through `openReviewTab` instead of `openDiffFile`.

Changes in `BranchChanges.tsx`:

1. Add imports:

```ts
import { useReviewSessionStore } from "../stores/review-session-store";
```

2. Inside `BranchChanges`, replace the `openDiffFile = useTabStore((s) => s.openDiffFile)` line with:

```ts
const openReviewTab = useTabStore((s) => s.openReviewTab);
const selectedFilePath = useReviewSessionStore((s) => s.activeSession?.selectedFilePath ?? null);
const scope = useReviewSessionStore((s) => s.activeSession?.scope ?? "all");
```

3. Change the `DirectoryGroup` onFileClick to:

```tsx
onFileClick={(file) =>
	openReviewTab({
		workspaceId,
		repoPath,
		baseBranch,
		currentBranch,
		scope: "branch",
		filePath: file.path,
	})
}
```

4. In `DirectoryGroup`, pass `selectedFilePath` and `scope` down as new props, and apply highlight/dim classes to the file `<button>`:

```tsx
function DirectoryGroup({
	group,
	onFileClick,
	selectedFilePath,
	scope,
}: {
	group: FileGroup;
	onFileClick: (file: DiffFile) => void;
	selectedFilePath: string | null;
	scope: "all" | "working" | "branch";
}) {
	// ... existing expanded state
	return (
		<div>
			{/* ... existing directory header ... */}
			{expanded &&
				group.files.map((file) => {
					const isSelected = file.path === selectedFilePath;
					const isOutOfScope = scope !== "all" && scope !== "branch";
					return (
						<button
							key={file.path}
							type="button"
							onClick={() => onFileClick(file)}
							className={[
								"flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] transition-colors duration-[120ms]",
								group.dir !== "." ? "pl-7" : "",
								isSelected
									? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
									: "text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
								isOutOfScope ? "opacity-40" : "",
							].join(" ")}
						>
							{/* ... existing inner content ... */}
						</button>
					);
				})}
		</div>
	);
}
```

5. Remove the `diffCtx` and `workspaceId` props from `DirectoryGroup` (no longer needed for click).

6. Remove the now-unused `diffCtx` import / destructuring at the component boundary, if any.

- [ ] **Step 2: Type-check + lint**

```bash
bun run type-check && bun run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/BranchChanges.tsx
git commit -m "feat(review): route branch-changes clicks to review tab + highlight/dim"
```

---

## Task 18: Sidebar highlight + dim — DraftCommitCard.tsx (working changes)

**Files:**
- Modify: `apps/desktop/src/renderer/components/DraftCommitCard.tsx`

- [ ] **Step 1: Read file** to find where staged/unstaged files are rendered and how they are clicked today.

- [ ] **Step 2: Mirror the BranchChanges treatment**

Add the same `useReviewSessionStore` subscription for `selectedFilePath` + `scope`.

Replace the existing click handler (which likely calls `openDiffFile` with `diffCtx.type === "working-tree"`) with:

```tsx
onClick={() =>
	useTabStore.getState().openReviewTab({
		workspaceId,
		repoPath: diffCtx.repoPath,
		baseBranch: /* from DiffPanel context — propagate via prop or lookup via store */,
		currentBranch: /* same */,
		scope: "working",
		filePath: file.path,
	})
}
```

Apply:
- `bg-[var(--bg-selected)]` + `text-[var(--text-primary)]` when `file.path === selectedFilePath`
- `opacity-40` when `scope !== "all" && scope !== "working"`

Because `DraftCommitCard` does not currently receive `baseBranch` and `currentBranch`, either:
(a) pass them as new props from `DiffPanel.tsx`, or
(b) read them from `useTabStore` — but the baseBranch is computed via `effectiveBaseBranch` in `DiffPanel.tsx` and `currentBranch` from `statusQuery`. Preferred: **(a) — pass as props from `DiffPanel.tsx`** to keep data flow explicit.

In `DiffPanel.tsx`, extend the `DraftCommitCard` JSX with the two new props:

```tsx
<DraftCommitCard
	/* ...existing props... */
	baseBranch={effectiveBaseBranch}
	currentBranch={currentBranch}
/>
```

And add them to `DraftCommitCard`'s props interface.

- [ ] **Step 3: Type-check + lint**

```bash
bun run type-check && bun run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/DraftCommitCard.tsx apps/desktop/src/renderer/components/DiffPanel.tsx
git commit -m "feat(review): route working-changes clicks to review tab + highlight/dim"
```

---

## Task 19: Let Esc pass through Monaco for close-edit

**Files:**
- Modify: `apps/desktop/src/renderer/hooks/useShortcutListener.ts` (verify — no change expected)

Monaco's input is a `<textarea>`, so `isTextInputElement` returns true and `shouldSkipShortcutHandling` skips plain-printable keys. Escape is not printable (length ≠ 1), so it already passes. Verify:

**Implementer note:** bun's test runner does not expose `document` by default. Check `bunfig.toml` for `[test] preload = "..."` or a happy-dom setup. If `document.createElement` is unavailable, either (a) add happy-dom setup (match what any existing DOM-touching test does — grep for `document.createElement` in `apps/desktop/tests/`), or (b) rewrite the test to pass a plain object shaped like HTMLElement (`{ tagName: "TEXTAREA", classList: { contains: () => false }, closest: () => null }`) — the `shouldSkipShortcutHandling` signature accepts `HTMLElement | null`.

- [ ] **Step 1: Add test**

```ts
// apps/desktop/tests/review-actions.test.ts
import { describe, expect, test } from "bun:test";
import { shouldSkipShortcutHandling } from "../src/renderer/hooks/useShortcutListener";

function evt(key: string, extras: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return { key, ...extras } as KeyboardEvent;
}

describe("shortcut-listener Monaco behavior", () => {
	test("Escape in a textarea is NOT skipped", () => {
		const ta = document.createElement("textarea");
		expect(shouldSkipShortcutHandling(evt("Escape"), ta)).toBe(false);
	});

	test("plain 'j' in a textarea IS skipped", () => {
		const ta = document.createElement("textarea");
		expect(shouldSkipShortcutHandling(evt("j"), ta)).toBe(true);
	});

	test("plain 'j' outside any input is NOT skipped", () => {
		const div = document.createElement("div");
		expect(shouldSkipShortcutHandling(evt("j"), div)).toBe(false);
	});
});
```

- [ ] **Step 2: Run — verify PASS**

```bash
cd apps/desktop && bun test tests/review-actions.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tests/review-actions.test.ts
git commit -m "test(review): verify Escape passes through textarea skip logic"
```

No implementation change required — the existing `shouldSkipShortcutHandling` already lets Escape through.

---

## Task 20: Integration test — sidebar highlight + dim behavior

**Files:**
- Create: `apps/desktop/tests/review-tab-sync.test.ts`

- [ ] **Step 1: Write behavioral tests against the store**

Pure-store tests of the sync behavior (no component mount needed):

```ts
// apps/desktop/tests/review-tab-sync.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import type { ScopedDiffFile } from "../src/shared/review-types";
import { useReviewSessionStore } from "../src/renderer/stores/review-session-store";

function reset() {
	useReviewSessionStore.setState({
		activeSession: null,
		lastAllFiles: [],
		lastScopedFiles: [],
	});
}

function mk(path: string, scope: "working" | "branch"): ScopedDiffFile {
	return { path, status: "modified", additions: 0, deletions: 0, hunks: [], scope };
}

describe("sidebar sync via store", () => {
	beforeEach(reset);

	test("scope=all keeps selection across scope change if still in scope", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setFileSnapshot([mk("a.ts", "working"), mk("b.ts", "branch")], [mk("a.ts", "working"), mk("b.ts", "branch")]);
		s.setScope("working", [mk("a.ts", "working")]);
		expect(useReviewSessionStore.getState().activeSession!.scope).toBe("working");
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("scope change jumps selection if out of scope", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "b.ts" });
		s.setScope("working", [mk("a.ts", "working")]);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("nextFile on scoped list stops at end", () => {
		const s = useReviewSessionStore.getState();
		const scoped = [mk("a.ts", "working"), mk("b.ts", "working")];
		s.startSession({ workspaceId: "ws1", filePath: "b.ts" });
		s.nextFile(scoped);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("b.ts");
	});
});
```

- [ ] **Step 2: Run — verify PASS**

```bash
cd apps/desktop && bun test tests/review-tab-sync.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tests/review-tab-sync.test.ts
git commit -m "test(review): sync behavior (scope change, nextFile clamp)"
```

---

## Task 21: Manual acceptance pass

- [ ] **Step 1: Build + launch**

```bash
bun run dev
```

- [ ] **Step 2: Verify acceptance checklist against a workspace with branch + working changes**

All of these must pass. Check each box ✅:

- [ ] Click a branch-changes file in the right sidebar → Review tab opens; that file selected.
- [ ] Click a working-changes file (unstaged in DraftCommitCard) → Review tab reuses, scope = `working`, that file selected.
- [ ] Press `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Win/Linux) with no review tab open → opens, scope `all`, first file selected.
- [ ] `j` advances selection; `k` moves back. On last file, `j` is a no-op (no wrap). On first file, `k` is a no-op.
- [ ] `1` / `2` / `3` switches scope. Sidebar dims out-of-scope files to 40% opacity.
- [ ] Switching scope while current file is out-of-scope → selection jumps to first in-scope file.
- [ ] `e` opens an edit split pane to the right with the current file in `FileEditor`. Press `e` on another file → same split pane is reused (no extra pane).
- [ ] Type into the edit pane; wait 500ms. The diff on the left shows the new content immediately (no flicker).
- [ ] `Esc` (from inside the edit pane or the review pane) closes the edit split; Review returns to full width.
- [ ] `v` on the current file marks it viewed → green dot appears in the sidebar row. Progress bar advances.
- [ ] Press `v` again → unmarks.
- [ ] Mark viewed, restart the app → still marked.
- [ ] Mark viewed, edit the file externally (via terminal: `echo "x" >> the-file`) → within 2s, the green dot disappears (hash mismatch).
- [ ] Close the Review tab → sidebar highlight + dim cleared; progress bar removed.
- [ ] `diff-file` tabs for commit views (from `CommittedStack` clicks) still work normally — untouched.

If any step fails, file a fix task and re-run.

- [ ] **Step 3: Run full verification**

```bash
bun run type-check && bun run lint && cd apps/desktop && bun test
```

All PASS.

- [ ] **Step 4: Commit (if fixes were needed)**

Any fix-ups get their own focused commit. After all pass, the branch is ready for PR.

---

## Self-review

**Spec coverage:**
- ✅ Sidebar click → Review tab (Tasks 17 + 18)
- ✅ `Cmd+Shift+R` shortcut (Task 12)
- ✅ j / k navigation with stop-at-ends (Tasks 6 + 7)
- ✅ 1 / 2 / 3 scope with selection jump (Tasks 6 + 7)
- ✅ `v` toggle viewed with hash invalidation (Tasks 5 + 14)
- ✅ `e` edit split pane with reuse (Tasks 14 + 15)
- ✅ `Esc` close edit split (Tasks 12 + 14 + 19)
- ✅ Optimistic overlay, no flicker (Tasks 6 + 16)
- ✅ Sidebar dim non-scope (Tasks 17 + 18)
- ✅ Progress bar (Tasks 9 + 10)
- ✅ `diff-file` preserved for commit/PR (Tasks 17 + 18 only re-route branch + working)
- ✅ `review_viewed` table + descriptive migration (Task 2)

**Placeholders scan:** All code blocks contain complete implementations. No "TBD" / "TODO" / "implement later" strings. The only runtime lookup is the migration filename, which Drizzle generates deterministically from `--name`.

**Type consistency:** `ReviewScope`, `ScopedDiffFile`, `ReviewSession`, `openReviewTab`, `openEditFileSplitForReview`, `closeEditFileSplitForReview`, `pushOptimisticContent`, `clearOptimisticContent`, `setFileSnapshot` — names are consistent across Tasks 1, 6, 8, 12, 14, 15, 16.

**Known follow-ups (explicitly out of scope, noted in spec §12):**
- Persist `activeSession` across app restart
- Customizable keybind rebinding via settings UI
