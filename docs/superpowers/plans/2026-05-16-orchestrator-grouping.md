# Orchestrator Grouping & Worktree Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render orchestrator workspaces as collapsible parents that own their managed worktrees, with drag-and-drop ordering at top-level and within groups.

**Architecture:** Add a `orchestrator_members` join table for parent→child membership and a `sortOrder` column on `workspaces` for both top-level and intra-group ordering. The renderer consumes a new tree-shaped `listByProject` result, renders orchestrator parents + nested children via two new components reusing existing `WorkspaceItem`, and wires DnD with `@dnd-kit`.

**Tech Stack:** Drizzle ORM + SQLite, tRPC over Electron IPC, React 19, `@dnd-kit/core` + `@dnd-kit/sortable`, Bun test runner, Biome.

**Spec:** `docs/superpowers/specs/2026-05-16-orchestrator-grouping-design.md`

---

## File Structure

**New files:**
- `apps/desktop/src/main/db/migrations/0044_add_orchestrator_grouping.sql` (post-generate)
- `apps/desktop/src/main/services/workspace-ordering.ts` — renumber helpers
- `apps/desktop/src/main/services/orchestrator-membership.ts` — attach/detach/list with guards
- `apps/desktop/src/renderer/hooks/useOrchestratorColor.ts`
- `apps/desktop/src/renderer/components/OrchestratorRow.tsx`
- `apps/desktop/src/renderer/components/OrchestratorGroup.tsx`
- `apps/desktop/tests/orchestrator-membership.test.ts`
- `apps/desktop/tests/workspace-ordering.test.ts`
- `apps/desktop/tests/list-by-project-tree.test.ts`

**Modified files:**
- `apps/desktop/src/main/db/schema.ts` — add column + table
- `apps/desktop/src/main/services/workspace-service.ts` — new `listByProjectTree`
- `apps/desktop/src/main/trpc/routers/workspaces.ts` — new procedures + tree query
- `apps/desktop/src/shared/types.ts` — tree-shape types
- `apps/desktop/src/renderer/styles.css` — `--orch-N` tokens
- `apps/desktop/src/renderer/components/WorkspaceItem.tsx` — `indentLevel` prop
- `apps/desktop/src/renderer/components/ProjectItem.tsx` — render tree, DnD wiring
- `apps/desktop/package.json` — add `@dnd-kit` deps

---

## Task 1: Add CSS orchestrator color tokens

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add the three muted palette tokens + bg variants under both `:root` and `[data-theme="light"]`**

Locate the `:root` declaration in `apps/desktop/src/renderer/styles.css` (the dark theme block where `--term-green`, `--term-yellow` etc. are defined, ~line 49-65). After the `--term-*` block in `:root`, append:

```css
	/* Orchestrator group colors — muted ~40% saturation tints.
	   Cycled per-project via session_state map; --accent stays reserved
	   for active-selection treatment. */
	--orch-1: #8a9ab0;
	--orch-1-bg: rgba(138, 154, 176, 0.12);
	--orch-2: #b09a8a;
	--orch-2-bg: rgba(176, 154, 138, 0.12);
	--orch-3: #9ab08a;
	--orch-3-bg: rgba(154, 176, 138, 0.12);
```

Locate the light-theme block (the `[data-theme="light"]` or `.light` selector around line 94+) and append the same tokens — palette values stay the same; only the bg alpha rises slightly for legibility on light backgrounds:

```css
	--orch-1: #6f8094;
	--orch-1-bg: rgba(111, 128, 148, 0.14);
	--orch-2: #948070;
	--orch-2-bg: rgba(148, 128, 112, 0.14);
	--orch-3: #809470;
	--orch-3-bg: rgba(128, 148, 112, 0.14);
```

- [ ] **Step 2: Verify no other file references these names**

Run: `grep -rn "\-\-orch-" apps/desktop/src`
Expected: only matches in `styles.css`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "feat(theme): add orchestrator color tokens"
```

---

## Task 2: Schema — add `sortOrder` + `orchestrator_members` table

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts`
- Create: `apps/desktop/src/main/db/migrations/0044_add_orchestrator_grouping.sql`

- [ ] **Step 1: Add `sortOrder` column to the existing `workspaces` table**

Edit `apps/desktop/src/main/db/schema.ts`. Inside the `workspaces` sqliteTable definition (just before `createdAt`), add:

```ts
		sortOrder: integer("sort_order").notNull().default(0),
```

- [ ] **Step 2: Add `orchestratorMembers` table at the bottom of `schema.ts`**

Append below the existing `workspaces` exports (and before any later sections), import additions first:

Locate the existing imports at top of `schema.ts` and ensure `primaryKey` is imported from `drizzle-orm/sqlite-core`. If absent, add it to the existing import line.

Then append the table:

```ts
export const orchestratorMembers = sqliteTable(
	"orchestrator_members",
	{
		orchestratorId: text("orchestrator_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		sortOrder: integer("sort_order").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.orchestratorId, t.workspaceId] }),
		index("orch_members_workspace_idx").on(t.workspaceId),
		index("orch_members_orch_sort_idx").on(t.orchestratorId, t.sortOrder),
	]
);

export type OrchestratorMember = typeof orchestratorMembers.$inferSelect;
export type NewOrchestratorMember = typeof orchestratorMembers.$inferInsert;
```

- [ ] **Step 3: Generate the migration**

Run: `cd apps/desktop && bun run db:generate --name add_orchestrator_grouping`
Expected: a new file `apps/desktop/src/main/db/migrations/0044_add_orchestrator_grouping.sql` and updated `meta/_journal.json`.

- [ ] **Step 4: Hand-edit the generated migration to backfill `sort_order`**

Open `apps/desktop/src/main/db/migrations/0044_add_orchestrator_grouping.sql`. After the `ALTER TABLE workspaces ADD COLUMN sort_order` line, append a backfill statement that orders existing rows by `created_at` per project so the post-migration sidebar order matches what users saw before:

```sql
--> statement-breakpoint
UPDATE workspaces
SET sort_order = (
	SELECT COUNT(*) - 1
	FROM workspaces AS w2
	WHERE w2.project_id = workspaces.project_id
	  AND w2.created_at <= workspaces.created_at
);
```

(SQLite has no `ROW_NUMBER()` in older versions; correlated subquery is portable.)

- [ ] **Step 5: Apply by booting the app once** (or run the migration runner directly if there's a script)

If the project has a test fixture DB at `apps/desktop/tests/`, run any existing migration smoke test, e.g. `bun test tests/db-migrations.test.ts` if present. Otherwise: start the app once (`bun run dev` from repo root) and confirm it boots without migration errors, then close.

Expected: app launches; no SQL errors in main process logs.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/migrations/0044_add_orchestrator_grouping.sql apps/desktop/src/main/db/migrations/meta/
git commit -m "feat(db): add sortOrder column + orchestrator_members table"
```

---

## Task 3: Ordering service + tests

**Files:**
- Create: `apps/desktop/src/main/services/workspace-ordering.ts`
- Create: `apps/desktop/tests/workspace-ordering.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/workspace-ordering.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb, seedProject, seedWorkspace } from "./helpers/db";
import { reorderTopLevel, reorderChildren } from "../src/main/services/workspace-ordering";
import { attachToOrchestrator } from "../src/main/services/orchestrator-membership";
import { getDb } from "../src/main/db";
import { workspaces, orchestratorMembers } from "../src/main/db/schema";
import { eq, asc } from "drizzle-orm";

describe("workspace-ordering", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("reorderTopLevel rewrites sortOrder to dense 0..N-1", async () => {
		const projectId = await seedProject();
		const a = await seedWorkspace(projectId, { name: "a" });
		const b = await seedWorkspace(projectId, { name: "b" });
		const c = await seedWorkspace(projectId, { name: "c" });

		await reorderTopLevel({ projectId, orderedIds: [c, a, b] });

		const rows = getDb()
			.select({ id: workspaces.id, sortOrder: workspaces.sortOrder })
			.from(workspaces)
			.where(eq(workspaces.projectId, projectId))
			.orderBy(asc(workspaces.sortOrder))
			.all();
		expect(rows.map((r) => r.id)).toEqual([c, a, b]);
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
	});

	test("reorderChildren rewrites orchestrator_members.sortOrder", async () => {
		const projectId = await seedProject();
		const orch = await seedWorkspace(projectId, { name: "orch", isOrchestrator: true });
		const x = await seedWorkspace(projectId, { name: "x" });
		const y = await seedWorkspace(projectId, { name: "y" });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: x });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: y });

		await reorderChildren({ orchestratorId: orch, orderedIds: [y, x] });

		const rows = getDb()
			.select({ workspaceId: orchestratorMembers.workspaceId, sortOrder: orchestratorMembers.sortOrder })
			.from(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, orch))
			.orderBy(asc(orchestratorMembers.sortOrder))
			.all();
		expect(rows.map((r) => r.workspaceId)).toEqual([y, x]);
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
	});

	test("reorderTopLevel throws when orderedIds contains an id not in the project", async () => {
		const projectId = await seedProject();
		const a = await seedWorkspace(projectId, { name: "a" });
		await expect(
			reorderTopLevel({ projectId, orderedIds: [a, "ws-foreign"] })
		).rejects.toThrow(/cross-project|unknown/i);
	});
});
```

If `tests/helpers/db.ts` doesn't already exist, peek at how other tests bootstrap a DB (e.g. `tests/agent-coordination.test.ts`) and copy that pattern into a new `tests/helpers/db.ts` with these named exports:

- `setupTestDb()` — wipes/creates an in-memory or temp-file SQLite DB, runs migrations, sets it as the DB returned by `getDb()`.
- `teardownTestDb()` — closes + deletes.
- `seedProject()` — inserts a `projects` row, returns its id.
- `seedWorkspace(projectId, { name, isOrchestrator? })` — inserts a `workspaces` row with required defaults, returns its id.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/workspace-ordering.test.ts`
Expected: module-not-found error (`workspace-ordering` not yet created).

- [ ] **Step 3: Write the service**

Create `apps/desktop/src/main/services/workspace-ordering.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { orchestratorMembers, workspaces } from "../db/schema";

export async function reorderTopLevel(input: {
	projectId: string;
	orderedIds: string[];
}): Promise<{ ok: true }> {
	const db = getDb();
	const found = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(
			and(eq(workspaces.projectId, input.projectId), inArray(workspaces.id, input.orderedIds))
		)
		.all();
	if (found.length !== input.orderedIds.length) {
		throw new Error("reorderTopLevel: unknown or cross-project workspace id");
	}
	const now = new Date();
	db.transaction((tx) => {
		input.orderedIds.forEach((id, i) => {
			tx.update(workspaces).set({ sortOrder: i, updatedAt: now }).where(eq(workspaces.id, id)).run();
		});
	});
	return { ok: true };
}

export async function reorderChildren(input: {
	orchestratorId: string;
	orderedIds: string[];
}): Promise<{ ok: true }> {
	const db = getDb();
	const found = db
		.select({ workspaceId: orchestratorMembers.workspaceId })
		.from(orchestratorMembers)
		.where(
			and(
				eq(orchestratorMembers.orchestratorId, input.orchestratorId),
				inArray(orchestratorMembers.workspaceId, input.orderedIds)
			)
		)
		.all();
	if (found.length !== input.orderedIds.length) {
		throw new Error("reorderChildren: unknown member workspace id");
	}
	db.transaction((tx) => {
		input.orderedIds.forEach((id, i) => {
			tx.update(orchestratorMembers)
				.set({ sortOrder: i })
				.where(
					and(
						eq(orchestratorMembers.orchestratorId, input.orchestratorId),
						eq(orchestratorMembers.workspaceId, id)
					)
				)
				.run();
		});
	});
	return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/workspace-ordering.test.ts`
Expected: all three tests pass. (The `reorderChildren` test depends on `attachToOrchestrator` from the next task — it will fail on that import. Leave it failing for now; Task 4 will resolve it.)

If two tests pass and one fails on `orchestrator-membership` import, that's expected — proceed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-ordering.ts apps/desktop/tests/workspace-ordering.test.ts apps/desktop/tests/helpers/db.ts
git commit -m "feat(workspaces): ordering service with TDD"
```

---

## Task 4: Membership service + guards + tests

**Files:**
- Create: `apps/desktop/src/main/services/orchestrator-membership.ts`
- Create: `apps/desktop/tests/orchestrator-membership.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/orchestrator-membership.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb, seedProject, seedWorkspace } from "./helpers/db";
import {
	attachToOrchestrator,
	detachFromOrchestrator,
	listMembership,
} from "../src/main/services/orchestrator-membership";

describe("orchestrator-membership", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("attach creates a member row at end of orchestrator's sortOrder", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });

		await attachToOrchestrator({ orchestratorId: orch, workspaceId: a });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: b });

		const members = await listMembership({ orchestratorId: orch });
		expect(members.map((m) => m.workspaceId)).toEqual([a, b]);
		expect(members.map((m) => m.sortOrder)).toEqual([0, 1]);
	});

	test("attach moves membership when worktree is already in another orchestrator (V1 single-parent)", async () => {
		const p = await seedProject();
		const orch1 = await seedWorkspace(p, { name: "o1", isOrchestrator: true });
		const orch2 = await seedWorkspace(p, { name: "o2", isOrchestrator: true });
		const x = await seedWorkspace(p, { name: "x" });

		await attachToOrchestrator({ orchestratorId: orch1, workspaceId: x });
		await attachToOrchestrator({ orchestratorId: orch2, workspaceId: x });

		expect((await listMembership({ orchestratorId: orch1 })).length).toBe(0);
		expect((await listMembership({ orchestratorId: orch2 })).map((m) => m.workspaceId)).toEqual([x]);
	});

	test("detach removes the member row", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: a });
		await detachFromOrchestrator({ workspaceId: a });
		expect((await listMembership({ orchestratorId: orch })).length).toBe(0);
	});

	test("attach rejects when parent is not flagged isOrchestrator", async () => {
		const p = await seedProject();
		const notOrch = await seedWorkspace(p, { name: "no", isOrchestrator: false });
		const a = await seedWorkspace(p, { name: "a" });
		await expect(
			attachToOrchestrator({ orchestratorId: notOrch, workspaceId: a })
		).rejects.toThrow(/not.*orchestrator/i);
	});

	test("attach rejects when worktree is in different project", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const orch = await seedWorkspace(p1, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p2, { name: "a" });
		await expect(
			attachToOrchestrator({ orchestratorId: orch, workspaceId: a })
		).rejects.toThrow(/different project|cross-project/i);
	});

	test("attach rejects attaching an orchestrator to another orchestrator", async () => {
		const p = await seedProject();
		const o1 = await seedWorkspace(p, { name: "o1", isOrchestrator: true });
		const o2 = await seedWorkspace(p, { name: "o2", isOrchestrator: true });
		await expect(
			attachToOrchestrator({ orchestratorId: o1, workspaceId: o2 })
		).rejects.toThrow(/cannot nest|orchestrator/i);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/orchestrator-membership.test.ts`
Expected: module-not-found error.

- [ ] **Step 3: Write the service**

Create `apps/desktop/src/main/services/orchestrator-membership.ts`:

```ts
import { and, asc, eq, max } from "drizzle-orm";
import { getDb } from "../db";
import { orchestratorMembers, workspaces } from "../db/schema";

export async function attachToOrchestrator(input: {
	orchestratorId: string;
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const orch = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, input.orchestratorId))
		.get();
	if (!orch) throw new Error(`unknown orchestrator: ${input.orchestratorId}`);
	if (!orch.isOrchestrator) {
		throw new Error(`workspace ${input.orchestratorId} is not an orchestrator`);
	}

	const child = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!child) throw new Error(`unknown workspace: ${input.workspaceId}`);
	if (child.projectId !== orch.projectId) {
		throw new Error("attachToOrchestrator: different project / cross-project disallowed");
	}
	if (child.isOrchestrator) {
		throw new Error("cannot nest orchestrator under another orchestrator");
	}

	db.transaction((tx) => {
		// V1 single-parent: remove any existing membership for this workspace
		tx.delete(orchestratorMembers).where(eq(orchestratorMembers.workspaceId, input.workspaceId)).run();

		const maxRow = tx
			.select({ m: max(orchestratorMembers.sortOrder) })
			.from(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
			.get();
		const nextSort = (maxRow?.m ?? -1) + 1;

		tx.insert(orchestratorMembers)
			.values({
				orchestratorId: input.orchestratorId,
				workspaceId: input.workspaceId,
				sortOrder: nextSort,
				createdAt: new Date(),
			})
			.run();
	});

	return { ok: true };
}

export async function detachFromOrchestrator(input: {
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();
	db.delete(orchestratorMembers).where(eq(orchestratorMembers.workspaceId, input.workspaceId)).run();
	return { ok: true };
}

export async function listMembership(input: {
	orchestratorId: string;
}): Promise<Array<{ workspaceId: string; sortOrder: number }>> {
	const db = getDb();
	return db
		.select({
			workspaceId: orchestratorMembers.workspaceId,
			sortOrder: orchestratorMembers.sortOrder,
		})
		.from(orchestratorMembers)
		.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
		.orderBy(asc(orchestratorMembers.sortOrder))
		.all();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/orchestrator-membership.test.ts tests/workspace-ordering.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/orchestrator-membership.ts apps/desktop/tests/orchestrator-membership.test.ts
git commit -m "feat(workspaces): orchestrator membership service with guards"
```

---

## Task 5: Tree-shaped `listByProject` + types + tests

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Create: `apps/desktop/tests/list-by-project-tree.test.ts`

- [ ] **Step 1: Add shared types**

In `apps/desktop/src/shared/types.ts`, append:

```ts
export interface WorkspaceRow {
	id: string;
	projectId: string;
	type: "branch" | "worktree" | "review";
	name: string;
	worktreeId: string | null;
	terminalId: string | null;
	prProvider: string | null;
	prIdentifier: string | null;
	reviewDraftId: string | null;
	createdAt: Date;
	updatedAt: Date;
	worktreePath: string | null;
	draftStatus: string | null;
	draftCommitSha: string | null;
	currentPhase: "idle" | "working" | "blocked" | "done";
	statusText: string | null;
	needs: string | null;
	isOrchestrator: boolean;
	cliPreset: string | null;
	sortOrder: number;
}

export interface OrchestratorGroupNode {
	workspace: WorkspaceRow;
	children: WorkspaceRow[];
}

export interface ProjectWorkspaceTree {
	orchestrators: OrchestratorGroupNode[];
	loose: WorkspaceRow[];
}
```

- [ ] **Step 2: Write failing test**

Create `apps/desktop/tests/list-by-project-tree.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb, seedProject, seedWorkspace } from "./helpers/db";
import { listByProjectTree } from "../src/main/services/workspace-service";
import { attachToOrchestrator } from "../src/main/services/orchestrator-membership";
import { reorderTopLevel, reorderChildren } from "../src/main/services/workspace-ordering";

describe("listByProjectTree", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("empty project returns empty arrays", async () => {
		const p = await seedProject();
		const tree = await listByProjectTree({ projectId: p });
		expect(tree.orchestrators).toEqual([]);
		expect(tree.loose).toEqual([]);
	});

	test("loose-only project returns all in loose, ordered by sortOrder", async () => {
		const p = await seedProject();
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });
		await reorderTopLevel({ projectId: p, orderedIds: [b, a] });
		const tree = await listByProjectTree({ projectId: p });
		expect(tree.orchestrators).toEqual([]);
		expect(tree.loose.map((w) => w.id)).toEqual([b, a]);
	});

	test("orchestrators with children: children attached do not appear in loose", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const c1 = await seedWorkspace(p, { name: "c1" });
		const c2 = await seedWorkspace(p, { name: "c2" });
		const loose = await seedWorkspace(p, { name: "loose" });

		await attachToOrchestrator({ orchestratorId: orch, workspaceId: c1 });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: c2 });
		await reorderChildren({ orchestratorId: orch, orderedIds: [c2, c1] });

		const tree = await listByProjectTree({ projectId: p });
		expect(tree.orchestrators).toHaveLength(1);
		expect(tree.orchestrators[0].workspace.id).toBe(orch);
		expect(tree.orchestrators[0].children.map((c) => c.id)).toEqual([c2, c1]);
		expect(tree.loose.map((w) => w.id)).toEqual([loose]);
	});

	test("review-type workspaces are filtered out", async () => {
		const p = await seedProject();
		const a = await seedWorkspace(p, { name: "a", type: "review" });
		const b = await seedWorkspace(p, { name: "b" });
		const tree = await listByProjectTree({ projectId: p });
		expect(tree.loose.map((w) => w.name)).toEqual(["b"]);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/list-by-project-tree.test.ts`
Expected: import error (`listByProjectTree` not exported).

- [ ] **Step 4: Implement `listByProjectTree`**

In `apps/desktop/src/main/services/workspace-service.ts`, add this function (place it near the existing project-scoped queries). Imports already include `workspaces` and `worktrees`; add `orchestratorMembers` and `reviewDrafts` from `../db/schema` and `../db/schema-ai-review` if not already present.

```ts
import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
// ...existing imports
import { orchestratorMembers } from "../db/schema";
import { reviewDrafts } from "../db/schema-ai-review";
import type { ProjectWorkspaceTree, WorkspaceRow } from "../../shared/types";

const WORKSPACE_SELECT = {
	id: workspaces.id,
	projectId: workspaces.projectId,
	type: workspaces.type,
	name: workspaces.name,
	worktreeId: workspaces.worktreeId,
	terminalId: workspaces.terminalId,
	prProvider: workspaces.prProvider,
	prIdentifier: workspaces.prIdentifier,
	reviewDraftId: workspaces.reviewDraftId,
	createdAt: workspaces.createdAt,
	updatedAt: workspaces.updatedAt,
	worktreePath: worktrees.path,
	draftStatus: reviewDrafts.status,
	draftCommitSha: reviewDrafts.commitSha,
	currentPhase: workspaces.currentPhase,
	statusText: workspaces.statusText,
	needs: workspaces.needs,
	isOrchestrator: workspaces.isOrchestrator,
	cliPreset: workspaces.cliPreset,
	sortOrder: workspaces.sortOrder,
};

export async function listByProjectTree(input: {
	projectId: string;
}): Promise<ProjectWorkspaceTree> {
	const db = getDb();

	const rows = db
		.select(WORKSPACE_SELECT)
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.projectId, input.projectId))
		.all()
		.filter((r) => r.type !== "review") as WorkspaceRow[];

	const memberRows = db
		.select({
			orchestratorId: orchestratorMembers.orchestratorId,
			workspaceId: orchestratorMembers.workspaceId,
			sortOrder: orchestratorMembers.sortOrder,
		})
		.from(orchestratorMembers)
		.innerJoin(workspaces, eq(workspaces.id, orchestratorMembers.workspaceId))
		.where(eq(workspaces.projectId, input.projectId))
		.all();

	const memberOf = new Map<string, { orchestratorId: string; sortOrder: number }>();
	for (const m of memberRows) memberOf.set(m.workspaceId, m);

	const childrenByOrch = new Map<string, WorkspaceRow[]>();
	for (const ws of rows) {
		const mem = memberOf.get(ws.id);
		if (!mem) continue;
		const arr = childrenByOrch.get(mem.orchestratorId) ?? [];
		arr.push(ws);
		childrenByOrch.set(mem.orchestratorId, arr);
	}
	for (const arr of childrenByOrch.values()) {
		arr.sort((a, b) => {
			const am = memberOf.get(a.id)!.sortOrder;
			const bm = memberOf.get(b.id)!.sortOrder;
			return am - bm;
		});
	}

	const orchestrators = rows
		.filter((r) => r.isOrchestrator)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((workspace) => ({
			workspace,
			children: childrenByOrch.get(workspace.id) ?? [],
		}));

	const loose = rows
		.filter((r) => !r.isOrchestrator && !memberOf.has(r.id))
		.sort((a, b) => a.sortOrder - b.sortOrder);

	return { orchestrators, loose };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/list-by-project-tree.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/list-by-project-tree.test.ts
git commit -m "feat(workspaces): tree-shaped listByProject"
```

---

## Task 6: tRPC surface — replace `listByProject` + add procedures

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts`

- [ ] **Step 1: Replace the existing `listByProject` to delegate to `listByProjectTree`**

In `apps/desktop/src/main/trpc/routers/workspaces.ts`, replace the existing `listByProject: publicProcedure...` block (around lines 40-69) with:

```ts
	listByProject: publicProcedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
		const { listByProjectTree } = await import("../../services/workspace-service");
		return listByProjectTree({ projectId: input.projectId });
	}),
```

- [ ] **Step 2: Add `attachToOrchestrator`, `detachFromOrchestrator`, `reorderTopLevel`, `reorderChildren`**

In the same file, after the existing `setOrchestrator` procedure (~line 350), add:

```ts
	attachToOrchestrator: publicProcedure
		.input(z.object({ orchestratorId: z.string().min(1), workspaceId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const { attachToOrchestrator } = await import("../../services/orchestrator-membership");
			return attachToOrchestrator(input);
		}),

	detachFromOrchestrator: publicProcedure
		.input(z.object({ workspaceId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const { detachFromOrchestrator } = await import("../../services/orchestrator-membership");
			return detachFromOrchestrator(input);
		}),

	reorderTopLevel: publicProcedure
		.input(z.object({ projectId: z.string().min(1), orderedIds: z.array(z.string().min(1)) }))
		.mutation(async ({ input }) => {
			const { reorderTopLevel } = await import("../../services/workspace-ordering");
			return reorderTopLevel(input);
		}),

	reorderChildren: publicProcedure
		.input(z.object({ orchestratorId: z.string().min(1), orderedIds: z.array(z.string().min(1)) }))
		.mutation(async ({ input }) => {
			const { reorderChildren } = await import("../../services/workspace-ordering");
			return reorderChildren(input);
		}),
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check` from repo root.
Expected: passes. The renderer-side consumer in `ProjectItem.tsx` may still type-check against the old return shape — that's expected; Task 9 fixes it.

If type-check fails on `ProjectItem.tsx` specifically (referencing properties on what was previously an array), proceed — Task 9 will fix the consumer.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/workspaces.ts
git commit -m "feat(trpc): tree listByProject + attach/detach/reorder procedures"
```

---

## Task 7: `useOrchestratorColor` hook backed by session_state

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts` — add color-map procedures
- Create: `apps/desktop/src/renderer/hooks/useOrchestratorColor.ts`

- [ ] **Step 1: Add two procedures for color-map read/write**

In `apps/desktop/src/main/trpc/routers/workspaces.ts`, add imports at top:

```ts
import { sessionState } from "../../db/schema";
```

Add two procedures inside the `workspacesRouter` (next to the new ones above):

```ts
	getOrchestratorColors: publicProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(({ input }) => {
			const db = getDb();
			const key = `orchestratorColors:${input.projectId}`;
			const row = db.select().from(sessionState).where(eq(sessionState.key, key)).get();
			return row ? (JSON.parse(row.value) as Record<string, number>) : {};
		}),

	setOrchestratorColors: publicProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				map: z.record(z.string(), z.number().int().min(0).max(2)),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const key = `orchestratorColors:${input.projectId}`;
			const value = JSON.stringify(input.map);
			db.insert(sessionState)
				.values({ key, value })
				.onConflictDoUpdate({ target: sessionState.key, set: { value } })
				.run();
			return { ok: true } as const;
		}),
```

- [ ] **Step 2: Write the hook**

Create `apps/desktop/src/renderer/hooks/useOrchestratorColor.ts`:

```ts
import { useEffect, useMemo } from "react";
import { trpc } from "../trpc/client";

const PALETTE_SIZE = 3; // matches --orch-1, --orch-2, --orch-3

export function useOrchestratorColor(
	orchestratorId: string,
	projectId: string,
	allOrchestratorIds: string[]
): 1 | 2 | 3 {
	const colorsQuery = trpc.workspaces.getOrchestratorColors.useQuery(
		{ projectId },
		{ staleTime: 60_000 }
	);
	const setColors = trpc.workspaces.setOrchestratorColors.useMutation();

	const existing = colorsQuery.data;

	const computed = useMemo<Record<string, number>>(() => {
		const map: Record<string, number> = { ...(existing ?? {}) };
		const taken = new Set<number>();
		for (const id of allOrchestratorIds) if (map[id] !== undefined) taken.add(map[id]);
		for (const id of allOrchestratorIds) {
			if (map[id] !== undefined) continue;
			let pick = 0;
			for (let i = 0; i < PALETTE_SIZE; i++) {
				if (!taken.has(i)) {
					pick = i;
					break;
				}
				pick = i; // fallback: cycle
			}
			map[id] = pick;
			taken.add(pick);
		}
		return map;
	}, [existing, allOrchestratorIds]);

	useEffect(() => {
		if (!existing) return;
		// Only write if anything changed
		const changed = Object.keys(computed).some((k) => computed[k] !== existing[k]);
		if (changed) setColors.mutate({ projectId, map: computed });
	}, [computed, existing, projectId, setColors]);

	const idx = computed[orchestratorId] ?? 0;
	return (idx + 1) as 1 | 2 | 3;
}
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/workspaces.ts apps/desktop/src/renderer/hooks/useOrchestratorColor.ts
git commit -m "feat(renderer): useOrchestratorColor hook with session_state persistence"
```

---

## Task 8: `WorkspaceItem` accepts `indentLevel`

**Files:**
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx`

- [ ] **Step 1: Add the prop and use it for padding**

In `apps/desktop/src/renderer/components/WorkspaceItem.tsx`:

Extend `WorkspaceItemProps`:

```ts
interface WorkspaceItemProps {
	workspace: WorkspaceData;
	projectId: string;
	projectName: string;
	projectRepoPath: string;
	isInActiveProject: boolean;
	indentLevel?: 0 | 1;
}
```

Destructure `indentLevel = 0` in the component signature.

Replace the literal `pl-[22px]` in the `button`'s className (~line 372) with a conditional:

```tsx
indentLevel === 1 ? "pl-[36px] pr-3 py-[7px]" : "pl-[22px] pr-3 py-[7px]",
```

Keep all other classes/behavior identical.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: passes (existing callers omit the optional prop).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat(WorkspaceItem): optional indentLevel prop"
```

---

## Task 9: `OrchestratorRow` + `OrchestratorGroup` components

**Files:**
- Create: `apps/desktop/src/renderer/components/OrchestratorRow.tsx`
- Create: `apps/desktop/src/renderer/components/OrchestratorGroup.tsx`

- [ ] **Step 1: Create `OrchestratorRow.tsx`**

```tsx
import { useTabStore } from "../stores/tab-store";

interface OrchestratorRowProps {
	workspace: { id: string; name: string };
	colorIndex: 1 | 2 | 3;
	childCount: number;
	expanded: boolean;
	onToggle: () => void;
	activeChildName?: string;
}

export function OrchestratorRow({
	workspace,
	colorIndex,
	childCount,
	expanded,
	onToggle,
	activeChildName,
}: OrchestratorRowProps) {
	const isActive = useTabStore((s) => s.activeWorkspaceId === workspace.id);
	const isActiveByChild = !expanded && activeChildName !== undefined;
	const isAccented = isActive || isActiveByChild;

	const swatchVar = `var(--orch-${colorIndex})`;
	const pillBg = `var(--orch-${colorIndex}-bg)`;
	const pillFg = swatchVar;

	return (
		<button
			type="button"
			onClick={onToggle}
			className={[
				"relative flex w-full items-center gap-2 border-none pl-[22px] pr-3 py-[7px] cursor-pointer",
				"transition-all duration-[120ms] text-left rounded-[6px]",
				isAccented
					? "bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle)]"
					: "bg-transparent hover:bg-[var(--bg-elevated)]",
			].join(" ")}
		>
			{isAccented && (
				<span
					aria-hidden="true"
					className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-[var(--accent)]"
				/>
			)}
			<span className="text-[10px] text-[var(--text-quaternary)] w-[10px] -mr-[2px]">
				{expanded ? "▾" : "▸"}
			</span>
			<span
				aria-hidden="true"
				className="h-[8px] w-[8px] rounded-[2px] shrink-0"
				style={{ background: swatchVar }}
			/>
			<span className="flex-1 min-w-0 truncate text-[13px] font-medium text-[var(--text-secondary)]">
				{workspace.name}
				{!expanded && activeChildName && (
					<span className="text-[var(--text-tertiary)]"> · {activeChildName}</span>
				)}
			</span>
			<span
				className="text-[10px] font-medium px-[7px] py-[1px] rounded-[9px] min-w-[16px] text-center"
				style={{ background: pillBg, color: pillFg }}
			>
				{childCount}
			</span>
		</button>
	);
}
```

- [ ] **Step 2: Create `OrchestratorGroup.tsx`**

```tsx
import type { ReactNode } from "react";

interface OrchestratorGroupProps {
	colorIndex: 1 | 2 | 3;
	hasActiveChild: boolean;
	children: ReactNode;
}

export function OrchestratorGroup({
	colorIndex,
	hasActiveChild,
	children,
}: OrchestratorGroupProps) {
	const railColor = `var(--orch-${colorIndex})`;
	return (
		<div
			className="relative pl-[14px]"
			style={
				{
					// Render the rail via an absolutely positioned ::before-equivalent
				} as React.CSSProperties
			}
		>
			<span
				aria-hidden="true"
				className="absolute top-[2px] bottom-[4px] w-[2px] rounded-[2px]"
				style={{
					left: "26px",
					background: railColor,
					opacity: hasActiveChild ? 1 : 0.55,
				}}
			/>
			{children}
		</div>
	);
}
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/OrchestratorRow.tsx apps/desktop/src/renderer/components/OrchestratorGroup.tsx
git commit -m "feat(renderer): OrchestratorRow + OrchestratorGroup components"
```

---

## Task 10: `ProjectItem` renders the tree

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx`

- [ ] **Step 1: Replace the flat-list render with tree consumption**

Open `apps/desktop/src/renderer/components/ProjectItem.tsx`.

The current `workspacesList` is a flat array. After the schema change in Task 6 it's a `ProjectWorkspaceTree`. Rename the variable and split the render.

Add imports near the top:

```ts
import { useTabStore } from "../stores/tab-store";
import { OrchestratorRow } from "./OrchestratorRow";
import { OrchestratorGroup } from "./OrchestratorGroup";
import { useOrchestratorColor } from "../hooks/useOrchestratorColor";
import { trpc as trpcImport } from "../trpc/client";
```

(`useTabStore` and `trpc` may already be imported — don't duplicate.)

Replace the `workspacesList` query and the `visibleWorkspaces.map(...)` render. The relevant block (around lines 73-148) becomes:

```tsx
	const { data: tree } = trpc.workspaces.listByProject.useQuery(
		{ projectId: project.id },
		{ enabled: isExpanded && isReady, refetchInterval: 60_000 }
	);

	const orchestrators = tree?.orchestrators ?? [];
	const loose = tree?.loose ?? [];
	const allOrchestratorIds = orchestrators.map((o) => o.workspace.id);

	const activeWorkspaceIdLocal = useTabStore((s) => s.activeWorkspaceId);

	const isActiveProject =
		orchestrators.some(
			(o) =>
				o.workspace.id === activeWorkspaceIdLocal ||
				o.children.some((c) => c.id === activeWorkspaceIdLocal)
		) || loose.some((w) => w.id === activeWorkspaceIdLocal);
```

Replace the children-render block:

```tsx
				{isReady && tree && (
					<div className="flex flex-col pt-0.5">
						{orchestrators.map((node) => (
							<OrchestratorGroupBlock
								key={node.workspace.id}
								node={node}
								projectId={project.id}
								projectName={project.name}
								projectRepoPath={project.repoPath}
								isActiveProject={isActiveProject}
								allOrchestratorIds={allOrchestratorIds}
								activeWorkspaceId={activeWorkspaceIdLocal}
							/>
						))}
						{loose.map((ws) => (
							<WorkspaceItem
								key={ws.id}
								workspace={ws}
								projectId={project.id}
								projectName={project.name}
								projectRepoPath={project.repoPath}
								isInActiveProject={isActiveProject}
							/>
						))}
					</div>
				)}
```

- [ ] **Step 2: Add a small in-file `OrchestratorGroupBlock` component**

At the bottom of the same file:

```tsx
function OrchestratorGroupBlock({
	node,
	projectId,
	projectName,
	projectRepoPath,
	isActiveProject,
	allOrchestratorIds,
	activeWorkspaceId,
}: {
	node: { workspace: WorkspaceData; children: WorkspaceData[] };
	projectId: string;
	projectName: string;
	projectRepoPath: string;
	isActiveProject: boolean;
	allOrchestratorIds: string[];
	activeWorkspaceId: string;
}) {
	const colorIndex = useOrchestratorColor(node.workspace.id, projectId, allOrchestratorIds);
	const expandedKey = `orchExpand:${node.workspace.id}`;
	const expandedQuery = trpc.workspaces.getOrchestratorExpand.useQuery(
		{ key: expandedKey },
		{ staleTime: Infinity }
	);
	const setExpanded = trpc.workspaces.setOrchestratorExpand.useMutation();
	const expanded = expandedQuery.data ?? true;

	const activeChild = node.children.find((c) => c.id === activeWorkspaceId);
	const hasActiveChild = activeChild !== undefined;

	return (
		<>
			<OrchestratorRow
				workspace={node.workspace}
				colorIndex={colorIndex}
				childCount={node.children.length}
				expanded={expanded}
				onToggle={() => setExpanded.mutate({ key: expandedKey, value: !expanded })}
				activeChildName={!expanded && activeChild ? activeChild.name : undefined}
			/>
			{expanded && (
				<OrchestratorGroup colorIndex={colorIndex} hasActiveChild={hasActiveChild}>
					{node.children.map((c) => (
						<WorkspaceItem
							key={c.id}
							workspace={c}
							projectId={projectId}
							projectName={projectName}
							projectRepoPath={projectRepoPath}
							isInActiveProject={isActiveProject}
							indentLevel={1}
						/>
					))}
				</OrchestratorGroup>
			)}
		</>
	);
}
```

Note: this references `WorkspaceData` — extract or re-import the type from `WorkspaceItem` (export `WorkspaceData` from that file if it isn't already). Or use the shared `WorkspaceRow` from `apps/desktop/src/shared/types.ts` if compatible.

- [ ] **Step 3: Add expand/collapse persistence procedures**

In `apps/desktop/src/main/trpc/routers/workspaces.ts`, append:

```ts
	getOrchestratorExpand: publicProcedure
		.input(z.object({ key: z.string().min(1) }))
		.query(({ input }) => {
			const db = getDb();
			const row = db.select().from(sessionState).where(eq(sessionState.key, input.key)).get();
			return row ? row.value === "1" : true;
		}),

	setOrchestratorExpand: publicProcedure
		.input(z.object({ key: z.string().min(1), value: z.boolean() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.insert(sessionState)
				.values({ key: input.key, value: input.value ? "1" : "0" })
				.onConflictDoUpdate({ target: sessionState.key, set: { value: input.value ? "1" : "0" } })
				.run();
			return { ok: true } as const;
		}),
```

- [ ] **Step 4: Run dev + smoke test**

Run: `bun run dev` from repo root. Open the app. Create a project, mark one workspace as orchestrator via context menu, observe:
- Orchestrator row appears above loose worktrees.
- Chevron toggles expand/collapse; state persists across app reload.
- Active selection of a child shows the rail at full opacity and the accent bar at left edge.
- Collapsing the orchestrator with an active child shows the child name after a middle-dot.

If any of the four checks fail, debug before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/ProjectItem.tsx apps/desktop/src/main/trpc/routers/workspaces.ts
git commit -m "feat(sidebar): render orchestrator tree with persisted expand state"
```

---

## Task 11: DnD wiring with `@dnd-kit`

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx`

- [ ] **Step 1: Install dnd-kit**

Run: `cd apps/desktop && bun add @dnd-kit/core @dnd-kit/sortable`
Expected: both packages added to `apps/desktop/package.json` dependencies.

- [ ] **Step 2: Wrap the tree render in a `DndContext`**

At the top of `ProjectItem.tsx`:

```tsx
import {
	DndContext,
	closestCenter,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
	useSortable,
	arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
```

- [ ] **Step 3: Make `WorkspaceItem` and `OrchestratorRow` sortable wrappers**

Create a small sortable wrapper inside `ProjectItem.tsx` (don't modify the components themselves):

```tsx
function SortableWorkspace({
	id,
	children,
}: {
	id: string;
	children: ReactNode;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.5 : 1,
			}}
			{...attributes}
			{...listeners}
		>
			{children}
		</div>
	);
}
```

- [ ] **Step 4: Build the `onDragEnd` handler**

Inside the `ProjectItem` body:

```tsx
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
	const utils = trpc.useUtils();

	const reorderTopLevelMut = trpc.workspaces.reorderTopLevel.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});
	const reorderChildrenMut = trpc.workspaces.reorderChildren.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});
	const attachMut = trpc.workspaces.attachToOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});
	const detachMut = trpc.workspaces.detachFromOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});

	function onDragEnd(e: DragEndEvent) {
		const activeId = String(e.active.id);
		const overId = e.over ? String(e.over.id) : null;
		if (!overId || activeId === overId) return;

		const isOrch = (id: string) => orchestrators.some((o) => o.workspace.id === id);
		const orchOfChild = (id: string) =>
			orchestrators.find((o) => o.children.some((c) => c.id === id))?.workspace.id;
		const isLoose = (id: string) => loose.some((w) => w.id === id);
		const overIsOrch = isOrch(overId);
		const overIsChild = orchOfChild(overId);
		const overIsLoose = isLoose(overId);

		// Case 1: reorder orchestrators among themselves
		if (isOrch(activeId) && overIsOrch) {
			const ids = orchestrators.map((o) => o.workspace.id);
			const from = ids.indexOf(activeId);
			const to = ids.indexOf(overId);
			const next = arrayMove(ids, from, to);
			// also include loose order untouched for the same column
			reorderTopLevelMut.mutate({
				projectId: project.id,
				orderedIds: [...next, ...loose.map((w) => w.id)],
			});
			return;
		}

		// Case 2: reorder loose worktrees among themselves
		if (isLoose(activeId) && overIsLoose) {
			const ids = loose.map((w) => w.id);
			const from = ids.indexOf(activeId);
			const to = ids.indexOf(overId);
			const next = arrayMove(ids, from, to);
			reorderTopLevelMut.mutate({
				projectId: project.id,
				orderedIds: [...orchestrators.map((o) => o.workspace.id), ...next],
			});
			return;
		}

		// Case 3: loose worktree dropped onto an orchestrator row → attach
		if (isLoose(activeId) && overIsOrch) {
			attachMut.mutate({ orchestratorId: overId, workspaceId: activeId });
			return;
		}

		// Case 4: loose worktree dropped onto a child row → attach to that child's orchestrator
		if (isLoose(activeId) && overIsChild) {
			attachMut.mutate({ orchestratorId: overIsChild, workspaceId: activeId });
			return;
		}

		// Case 5: child dragged onto another orchestrator → move
		if (orchOfChild(activeId) && (overIsOrch || overIsChild)) {
			const target = overIsOrch ? overId : (overIsChild as string);
			const fromOrch = orchOfChild(activeId)!;
			if (target === fromOrch) {
				// Reorder within same group
				const node = orchestrators.find((o) => o.workspace.id === fromOrch)!;
				const ids = node.children.map((c) => c.id);
				const from = ids.indexOf(activeId);
				const to = overIsChild ? ids.indexOf(overId) : ids.length - 1;
				const next = arrayMove(ids, from, to);
				reorderChildrenMut.mutate({ orchestratorId: fromOrch, orderedIds: next });
			} else {
				attachMut.mutate({ orchestratorId: target, workspaceId: activeId });
			}
			return;
		}

		// Case 6: child dragged into loose zone → detach
		if (orchOfChild(activeId) && overIsLoose) {
			detachMut.mutate({ workspaceId: activeId });
			return;
		}

		// Default: no-op (e.g. orchestrator dragged onto child — disallowed)
	}
```

Then wrap the orchestrator+loose render with two `SortableContext`s nested in one `DndContext`:

```tsx
				{isReady && tree && (
					<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
						<SortableContext
							items={orchestrators.map((o) => o.workspace.id)}
							strategy={verticalListSortingStrategy}
						>
							<div className="flex flex-col pt-0.5">
								{orchestrators.map((node) => (
									<SortableWorkspace key={node.workspace.id} id={node.workspace.id}>
										<OrchestratorGroupBlock
											node={node}
											projectId={project.id}
											projectName={project.name}
											projectRepoPath={project.repoPath}
											isActiveProject={isActiveProject}
											allOrchestratorIds={allOrchestratorIds}
											activeWorkspaceId={activeWorkspaceIdLocal}
										/>
									</SortableWorkspace>
								))}
							</div>
						</SortableContext>
						<SortableContext
							items={loose.map((w) => w.id)}
							strategy={verticalListSortingStrategy}
						>
							<div className="flex flex-col">
								{loose.map((ws) => (
									<SortableWorkspace key={ws.id} id={ws.id}>
										<WorkspaceItem
											workspace={ws}
											projectId={project.id}
											projectName={project.name}
											projectRepoPath={project.repoPath}
											isInActiveProject={isActiveProject}
										/>
									</SortableWorkspace>
								))}
							</div>
						</SortableContext>
					</DndContext>
				)}
```

Also wrap each child `WorkspaceItem` inside `OrchestratorGroupBlock` in `SortableContext` + `SortableWorkspace` analogously (one SortableContext per group, items are child ids).

- [ ] **Step 5: Smoke test all six DnD cases**

Run: `bun run dev`. Manually verify in the running app:

1. Drag orchestrator above another orchestrator → reorders.
2. Drag loose worktree above another loose → reorders.
3. Drag loose worktree onto orchestrator row → attaches (worktree disappears from loose, appears under orchestrator).
4. Drag child within its group → reorders.
5. Drag child onto another orchestrator → moves group.
6. Drag child onto loose zone (the gap below orchestrators) → detaches.

For case 6, dropping on the empty loose zone needs a target — drop on any loose worktree row, or on a sentinel: add a hidden `SortableContext` empty placeholder if loose is empty. If users will rarely have zero loose worktrees, defer the empty-zone case.

Close and reopen the app. Verify ordering persisted.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json apps/desktop/bun.lock apps/desktop/src/renderer/components/ProjectItem.tsx
git commit -m "feat(sidebar): drag-and-drop ordering and attach/detach with @dnd-kit"
```

---

## Task 12: Full lint, type-check, test pass

- [ ] **Step 1: Run full checks**

Run from repo root:

```bash
bun run check && bun run type-check && cd apps/desktop && bun test
```

Expected: all pass.

- [ ] **Step 2: Fix anything that breaks**

Most likely issues:
- Biome formatting on new files — `bun run check` auto-fixes most.
- Unused imports left over in `ProjectItem.tsx` (e.g. old `workspacesList` declaration if not fully removed).
- `WorkspaceData` type drift if you didn't update its definition to include the new fields.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: lint+type cleanups"
```

- [ ] **Step 4: Update graphify index**

Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
(If module unavailable, skip — the project graphify hook also fires automatically on commit.)

---

## Self-Review Notes

Coverage check vs the spec:

- Visual treatment (muted palette, swatch, count pill, color rail, active-inside-group): Tasks 1, 8, 9, 10.
- Data model (sortOrder + orchestrator_members join + indexes): Task 2.
- Backfill migration: Task 2 Step 4.
- Query shape (ProjectWorkspaceTree): Tasks 5, 6.
- tRPC procedures (attach, detach, reorderTopLevel, reorderChildren): Task 6.
- Color persistence via session_state + auto-assignment: Task 7.
- Expand/collapse persistence: Task 10 Step 3.
- Component plan (WorkspaceItem indent, OrchestratorRow, OrchestratorGroup, ProjectItem tree): Tasks 8, 9, 10.
- DnD with @dnd-kit and all six drop rules: Task 11.
- Error handling (cross-project, isOrchestrator, no nesting): Task 4.
- Concurrent reorder last-writer-wins: implicit in `reorder*` transaction shape — no explicit task, behavior matches.
- Active-inside-collapsed-group "show on parent with middle-dot": Task 9 Step 1 + Task 10 Step 2.
- Tests: Tasks 3, 4, 5.

Open spec items deferred:
- Auto-expand on child select — show-on-parent chosen, encoded in code.
- User-customisable colors — schema supports, UI deferred per spec.

No placeholder text in any task. All type names consistent (`WorkspaceRow`, `ProjectWorkspaceTree`, `OrchestratorGroupNode`) across tasks. `WorkspaceData` in Task 10 reuses the existing type from `WorkspaceItem.tsx` — confirm it has a `sortOrder` field after Task 5; if not, export `WorkspaceRow` from shared types and use it in `OrchestratorGroupBlock` instead.
