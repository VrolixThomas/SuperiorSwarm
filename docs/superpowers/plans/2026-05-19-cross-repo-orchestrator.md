# Cross-Repo Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class cross-repo orchestrator that lives outside any project, links multiple repos, and coordinates workspaces drawn from those repos — while leaving today's per-repo orchestrator untouched.

**Architecture:** New `cross_repo_orchestrators` table + `cross_repo_orchestrator_projects` join + `parent_kind` column on existing `orchestrator_members`. New tRPC router. New `cross-repo-orchestrator` MCP mode with merged-projects context. Per-orch aggregated event stream at `<userData>/events/cross-repo/<id>.jsonl`. New sidebar group rendered as a sibling to `Projects`. Agent process runs in a dedicated app-data cwd, not a git worktree.

**Tech Stack:** Drizzle ORM + better-sqlite3, tRPC over Electron IPC, React 19, Bun test runner, Biome lint/format, electron-vite build, MCP SDK (`@modelcontextprotocol/sdk`).

**Reference:** [Design spec](../specs/2026-05-19-cross-repo-orchestrator-design.md)

**Phases:**
1. Schema + service layer (TDD, no UI yet)
2. tRPC router for lifecycle
3. Event-sink aggregation
4. MCP mode + control-plane context
5. Agent runtime (start/stop)
6. Sidebar UI

Commit at the end of each task. After each phase, run `bun run check && bun run type-check && bun test` from `apps/desktop/`.

---

## Phase 1 — Schema + Service Layer

### Task 1: Add Drizzle schema entries for cross-repo orchestrator tables

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts` (append after `orchestratorMembers`, ~line 533)

- [ ] **Step 1: Add schema definitions**

Append to `apps/desktop/src/main/db/schema.ts`:

```ts
export const crossRepoOrchestrators = sqliteTable("cross_repo_orchestrators", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	workDir: text("work_dir").notNull(),
	agentKind: text("agent_kind").notNull(),
	status: text("status").notNull().default("idle"),
	colorIndex: integer("color_index"),
	sortOrder: integer("sort_order").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type CrossRepoOrchestrator = typeof crossRepoOrchestrators.$inferSelect;
export type NewCrossRepoOrchestrator = typeof crossRepoOrchestrators.$inferInsert;

export const crossRepoOrchestratorProjects = sqliteTable(
	"cross_repo_orchestrator_projects",
	{
		orchestratorId: text("orchestrator_id")
			.notNull()
			.references(() => crossRepoOrchestrators.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sortOrder: integer("sort_order").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.orchestratorId, t.projectId] }),
		index("xro_projects_proj_idx").on(t.projectId),
	]
);

export type CrossRepoOrchestratorProject = typeof crossRepoOrchestratorProjects.$inferSelect;
```

Then modify the `orchestratorMembers` table block to add `parentKind`:

```ts
export const orchestratorMembers = sqliteTable(
	"orchestrator_members",
	{
		orchestratorId: text("orchestrator_id").notNull(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		parentKind: text("parent_kind").notNull().default("workspace"),
		sortOrder: integer("sort_order").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.orchestratorId, t.workspaceId] }),
		index("orch_members_workspace_idx").on(t.workspaceId),
		index("orch_members_orch_sort_idx").on(t.orchestratorId, t.sortOrder),
		index("orch_members_parent_kind_idx").on(t.parentKind, t.orchestratorId),
	]
);
```

Note: `orchestratorId` FK to `workspaces` is removed because cross-repo IDs are not in `workspaces`. The application enforces referential integrity based on `parentKind`.

- [ ] **Step 2: Generate the migration**

Run from `apps/desktop/`:

```bash
bun run db:generate --name add_cross_repo_orchestrators
```

Expected output: new SQL file `src/main/db/migrations/0045_add_cross_repo_orchestrators.sql` and updated snapshot `meta/0045_snapshot.json`. Open the SQL and confirm it contains:
- `CREATE TABLE cross_repo_orchestrators`
- `CREATE TABLE cross_repo_orchestrator_projects`
- `ALTER TABLE orchestrator_members ADD COLUMN parent_kind`
- Drop of the previous `orchestrator_id` → `workspaces` FK constraint (Drizzle's `0045` will recreate the table to drop the FK)

If Drizzle's table recreation needs explicit data preservation, the generated migration should already include the `INSERT INTO __new ... SELECT FROM ...` step — verify it does.

- [ ] **Step 3: Smoke-test the migration runs cleanly**

```bash
bun test tests/helpers/db.ts # imports trigger migrate()
```

Or run any existing test that uses `setupTestDb()`:

```bash
bun test tests/orchestrator-membership.test.ts
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/migrations/0045_add_cross_repo_orchestrators.sql apps/desktop/src/main/db/migrations/meta/
git commit -m "feat(db): add cross_repo_orchestrators tables + parent_kind column"
```

---

### Task 2: Write failing tests for cross-repo orchestrator service

**Files:**
- Create: `apps/desktop/tests/cross-repo-orchestrator.test.ts`

- [ ] **Step 1: Add `seedCrossRepoOrchestrator` to the test helper**

Modify `apps/desktop/tests/helpers/db.ts` — append after `seedWorkspace`:

```ts
import { crossRepoOrchestrators, crossRepoOrchestratorProjects } from "../../src/main/db/schema";

export async function seedCrossRepoOrchestrator(opts: {
	name?: string;
	workDir?: string;
	agentKind?: string;
	projectIds?: string[];
}): Promise<string> {
	const id = `xro-${nanoid(8)}`;
	const now = new Date();
	getDb()
		.insert(crossRepoOrchestrators)
		.values({
			id,
			name: opts.name ?? `xro-test-${id}`,
			workDir: opts.workDir ?? `/tmp/xro-${id}`,
			agentKind: opts.agentKind ?? "claude",
			status: "idle",
			sortOrder: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	if (opts.projectIds) {
		for (let i = 0; i < opts.projectIds.length; i++) {
			getDb()
				.insert(crossRepoOrchestratorProjects)
				.values({
					orchestratorId: id,
					projectId: opts.projectIds[i]!,
					sortOrder: i,
					createdAt: now,
				})
				.run();
		}
	}
	return id;
}
```

- [ ] **Step 2: Write the failing test file**

Create `apps/desktop/tests/cross-repo-orchestrator.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	attachToCrossRepoOrchestrator,
	detachFromCrossRepoOrchestrator,
	listCrossRepoMembers,
	addProjectToCrossRepoOrchestrator,
	removeProjectFromCrossRepoOrchestrator,
} from "../src/main/services/cross-repo-orchestrator-membership";
import {
	seedCrossRepoOrchestrator,
	seedProject,
	seedWorkspace,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

describe("cross-repo-orchestrator-membership", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("attach succeeds when workspace's project is in the linked-projects list", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p1, p2] });
		const wsA = await seedWorkspace(p1, { name: "a" });
		const wsB = await seedWorkspace(p2, { name: "b" });

		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsA });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsB });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		expect(members.map((m) => m.workspaceId).sort()).toEqual([wsA, wsB].sort());
		expect(members.every((m) => m.parentKind === "cross_repo")).toBe(true);
	});

	test("attach rejects when workspace's project is not linked", async () => {
		const linked = await seedProject();
		const unlinked = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [linked] });
		const ws = await seedWorkspace(unlinked, { name: "x" });

		await expect(
			attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws })
		).rejects.toThrow(/not linked|project.*not.*member/i);
	});

	test("attach removes existing per-repo orchestrator membership (single-parent)", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const perRepo = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const ws = await seedWorkspace(p, { name: "a" });

		// First attach to per-repo orchestrator
		const { attachToOrchestrator } = await import(
			"../src/main/services/orchestrator-membership"
		);
		await attachToOrchestrator({ orchestratorId: perRepo, workspaceId: ws });

		// Then attach to cross-repo — should move
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });

		const xroMembers = await listCrossRepoMembers({ orchestratorId: xro });
		expect(xroMembers.map((m) => m.workspaceId)).toEqual([ws]);

		const { listMembership } = await import(
			"../src/main/services/orchestrator-membership"
		);
		const perRepoMembers = await listMembership({ orchestratorId: perRepo });
		expect(perRepoMembers.length).toBe(0);
	});

	test("detach removes the membership row", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const ws = await seedWorkspace(p, { name: "a" });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });
		await detachFromCrossRepoOrchestrator({ workspaceId: ws });
		expect((await listCrossRepoMembers({ orchestratorId: xro })).length).toBe(0);
	});

	test("addProject succeeds and appends to linked-projects list", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p1] });
		await addProjectToCrossRepoOrchestrator({ orchestratorId: xro, projectId: p2 });

		const ws = await seedWorkspace(p2, { name: "in-new-project" });
		// Should now be attachable
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });
		expect((await listCrossRepoMembers({ orchestratorId: xro })).length).toBe(1);
	});

	test("removeProject cascades — detaches all members from that project", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p1, p2] });
		const wsP1 = await seedWorkspace(p1, { name: "in-p1" });
		const wsP2 = await seedWorkspace(p2, { name: "in-p2" });

		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsP1 });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsP2 });

		await removeProjectFromCrossRepoOrchestrator({ orchestratorId: xro, projectId: p1 });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		expect(members.map((m) => m.workspaceId)).toEqual([wsP2]);
	});
});
```

- [ ] **Step 3: Run to confirm they fail**

```bash
cd apps/desktop && bun test tests/cross-repo-orchestrator.test.ts
```

Expected: failure with "Cannot find module '../src/main/services/cross-repo-orchestrator-membership'".

- [ ] **Step 4: Commit (red)**

```bash
git add apps/desktop/tests/cross-repo-orchestrator.test.ts apps/desktop/tests/helpers/db.ts
git commit -m "test(xro): add failing tests for cross-repo orchestrator membership"
```

---

### Task 3: Implement `cross-repo-orchestrator-membership` service

**Files:**
- Create: `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`

- [ ] **Step 1: Write the service**

Create `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`:

```ts
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "../../shared/control-plane";
import { getDb } from "../db";
import {
	crossRepoOrchestrators,
	crossRepoOrchestratorProjects,
	orchestratorMembers,
	workspaces,
} from "../db/schema";

export async function attachToCrossRepoOrchestrator(input: {
	orchestratorId: string;
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const xro = db
		.select({ id: crossRepoOrchestrators.id })
		.from(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.orchestratorId))
		.get();
	if (!xro) throw new NotFoundError(input.orchestratorId);

	const ws = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new NotFoundError(input.workspaceId);
	if (ws.isOrchestrator) {
		throw new Error("cannot attach an orchestrator workspace as a cross-repo member");
	}

	const link = db
		.select({ projectId: crossRepoOrchestratorProjects.projectId })
		.from(crossRepoOrchestratorProjects)
		.where(
			and(
				eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId),
				eq(crossRepoOrchestratorProjects.projectId, ws.projectId)
			)
		)
		.get();
	if (!link) {
		throw new ForbiddenError(
			"workspace's project is not linked to this cross-repo orchestrator"
		);
	}

	db.transaction((tx) => {
		// Single-parent: remove any existing membership (per-repo or cross-repo)
		tx.delete(orchestratorMembers)
			.where(eq(orchestratorMembers.workspaceId, input.workspaceId))
			.run();

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
				parentKind: "cross_repo",
				sortOrder: nextSort,
				createdAt: new Date(),
			})
			.run();
	});

	return { ok: true };
}

export async function detachFromCrossRepoOrchestrator(input: {
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new NotFoundError(input.workspaceId);

	db.transaction((tx) => {
		const deleted = tx
			.delete(orchestratorMembers)
			.where(
				and(
					eq(orchestratorMembers.workspaceId, input.workspaceId),
					eq(orchestratorMembers.parentKind, "cross_repo")
				)
			)
			.run();
		if (deleted.changes === 0) return;

		const maxRow = tx
			.select({ m: max(workspaces.sortOrder) })
			.from(workspaces)
			.where(eq(workspaces.projectId, ws.projectId))
			.get();
		const nextSort = (maxRow?.m ?? -1) + 1;

		tx.update(workspaces)
			.set({ sortOrder: nextSort, updatedAt: new Date() })
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	});

	return { ok: true };
}

export async function listCrossRepoMembers(input: {
	orchestratorId: string;
}): Promise<Array<{ workspaceId: string; sortOrder: number; parentKind: string; projectId: string }>> {
	const db = getDb();
	return db
		.select({
			workspaceId: orchestratorMembers.workspaceId,
			sortOrder: orchestratorMembers.sortOrder,
			parentKind: orchestratorMembers.parentKind,
			projectId: workspaces.projectId,
		})
		.from(orchestratorMembers)
		.innerJoin(workspaces, eq(workspaces.id, orchestratorMembers.workspaceId))
		.where(
			and(
				eq(orchestratorMembers.orchestratorId, input.orchestratorId),
				eq(orchestratorMembers.parentKind, "cross_repo")
			)
		)
		.orderBy(asc(orchestratorMembers.sortOrder))
		.all();
}

export async function addProjectToCrossRepoOrchestrator(input: {
	orchestratorId: string;
	projectId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const xro = db
		.select({ id: crossRepoOrchestrators.id })
		.from(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.orchestratorId))
		.get();
	if (!xro) throw new NotFoundError(input.orchestratorId);

	const maxRow = db
		.select({ m: max(crossRepoOrchestratorProjects.sortOrder) })
		.from(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId))
		.get();
	const nextSort = (maxRow?.m ?? -1) + 1;

	db.insert(crossRepoOrchestratorProjects)
		.values({
			orchestratorId: input.orchestratorId,
			projectId: input.projectId,
			sortOrder: nextSort,
			createdAt: new Date(),
		})
		.onConflictDoNothing()
		.run();

	return { ok: true };
}

export async function removeProjectFromCrossRepoOrchestrator(input: {
	orchestratorId: string;
	projectId: string;
}): Promise<{ detachedCount: number }> {
	const db = getDb();
	let detachedCount = 0;

	db.transaction((tx) => {
		// Find all member workspaces whose projectId is the one being removed
		const victims = tx
			.select({ workspaceId: orchestratorMembers.workspaceId })
			.from(orchestratorMembers)
			.innerJoin(workspaces, eq(workspaces.id, orchestratorMembers.workspaceId))
			.where(
				and(
					eq(orchestratorMembers.orchestratorId, input.orchestratorId),
					eq(orchestratorMembers.parentKind, "cross_repo"),
					eq(workspaces.projectId, input.projectId)
				)
			)
			.all();
		detachedCount = victims.length;

		if (victims.length > 0) {
			tx.delete(orchestratorMembers)
				.where(
					and(
						eq(orchestratorMembers.orchestratorId, input.orchestratorId),
						eq(orchestratorMembers.parentKind, "cross_repo"),
						inArray(
							orchestratorMembers.workspaceId,
							victims.map((v) => v.workspaceId)
						)
					)
				)
				.run();
		}

		tx.delete(crossRepoOrchestratorProjects)
			.where(
				and(
					eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId),
					eq(crossRepoOrchestratorProjects.projectId, input.projectId)
				)
			)
			.run();
	});

	return { detachedCount };
}

export async function listLinkedProjects(input: {
	orchestratorId: string;
}): Promise<string[]> {
	const db = getDb();
	return db
		.select({ projectId: crossRepoOrchestratorProjects.projectId })
		.from(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId))
		.orderBy(asc(crossRepoOrchestratorProjects.sortOrder))
		.all()
		.map((r) => r.projectId);
}
```

- [ ] **Step 2: Run tests**

```bash
cd apps/desktop && bun test tests/cross-repo-orchestrator.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 3: Commit (green)**

```bash
git add apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts
git commit -m "feat(xro): cross-repo orchestrator membership service"
```

---

### Task 4: CRUD service for the orchestrator entity itself

**Files:**
- Create: `apps/desktop/src/main/services/cross-repo-orchestrators.ts`
- Create: `apps/desktop/tests/cross-repo-orchestrator-crud.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/cross-repo-orchestrator-crud.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createCrossRepoOrchestrator,
	deleteCrossRepoOrchestrator,
	getCrossRepoOrchestrator,
	listCrossRepoOrchestrators,
	renameCrossRepoOrchestrator,
} from "../src/main/services/cross-repo-orchestrators";
import { setupTestDb, teardownTestDb } from "./helpers/db";

describe("cross-repo-orchestrators CRUD", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("create returns id with xro- prefix and persists row", async () => {
		const id = await createCrossRepoOrchestrator({
			name: "Auth migration",
			agentKind: "claude",
		});
		expect(id).toMatch(/^xro-/);
		const row = await getCrossRepoOrchestrator({ id });
		expect(row?.name).toBe("Auth migration");
		expect(row?.agentKind).toBe("claude");
		expect(row?.status).toBe("idle");
		expect(row?.workDir).toContain(id);
	});

	test("list returns rows ordered by sortOrder asc", async () => {
		const a = await createCrossRepoOrchestrator({ name: "a", agentKind: "claude" });
		const b = await createCrossRepoOrchestrator({ name: "b", agentKind: "claude" });
		const all = await listCrossRepoOrchestrators();
		expect(all.map((r) => r.id)).toEqual([a, b]);
	});

	test("rename updates name and updatedAt", async () => {
		const id = await createCrossRepoOrchestrator({ name: "old", agentKind: "claude" });
		const before = (await getCrossRepoOrchestrator({ id }))!;
		await new Promise((r) => setTimeout(r, 10));
		await renameCrossRepoOrchestrator({ id, name: "new" });
		const after = (await getCrossRepoOrchestrator({ id }))!;
		expect(after.name).toBe("new");
		expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
	});

	test("delete removes the row", async () => {
		const id = await createCrossRepoOrchestrator({ name: "doomed", agentKind: "claude" });
		await deleteCrossRepoOrchestrator({ id });
		expect(await getCrossRepoOrchestrator({ id })).toBeUndefined();
	});
});
```

Run to confirm it fails:

```bash
cd apps/desktop && bun test tests/cross-repo-orchestrator-crud.test.ts
```

Expected: module-not-found error.

- [ ] **Step 2: Implement the service**

Create `apps/desktop/src/main/services/cross-repo-orchestrators.ts`:

```ts
import { app } from "electron";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { asc, eq, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import { crossRepoOrchestrators, type CrossRepoOrchestrator } from "../db/schema";

function workDirFor(id: string): string {
	const base = app.getPath("userData");
	return join(base, "cross-repo-orchestrators", id);
}

export async function createCrossRepoOrchestrator(input: {
	name: string;
	agentKind: string;
}): Promise<string> {
	const id = `xro-${nanoid(8)}`;
	const db = getDb();
	const now = new Date();
	const dir = workDirFor(id);
	mkdirSync(dir, { recursive: true });

	const maxRow = db
		.select({ m: max(crossRepoOrchestrators.sortOrder) })
		.from(crossRepoOrchestrators)
		.get();
	const nextSort = (maxRow?.m ?? -1) + 1;

	db.insert(crossRepoOrchestrators)
		.values({
			id,
			name: input.name,
			workDir: dir,
			agentKind: input.agentKind,
			status: "idle",
			sortOrder: nextSort,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return id;
}

export async function getCrossRepoOrchestrator(input: {
	id: string;
}): Promise<CrossRepoOrchestrator | undefined> {
	return getDb()
		.select()
		.from(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.id))
		.get();
}

export async function listCrossRepoOrchestrators(): Promise<CrossRepoOrchestrator[]> {
	return getDb()
		.select()
		.from(crossRepoOrchestrators)
		.orderBy(asc(crossRepoOrchestrators.sortOrder))
		.all();
}

export async function renameCrossRepoOrchestrator(input: {
	id: string;
	name: string;
}): Promise<{ ok: true }> {
	getDb()
		.update(crossRepoOrchestrators)
		.set({ name: input.name, updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	return { ok: true };
}

export async function deleteCrossRepoOrchestrator(input: { id: string }): Promise<{ ok: true }> {
	const row = await getCrossRepoOrchestrator({ id: input.id });
	if (!row) return { ok: true };
	try {
		rmSync(row.workDir, { recursive: true, force: true });
	} catch {}
	getDb()
		.delete(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	return { ok: true };
}
```

- [ ] **Step 3: Mock `electron` in tests if needed**

If `app.getPath` is not available under `bun test`, check `apps/desktop/tests/preload-electron-mock.ts`. If it doesn't stub `getPath`, add:

```ts
// apps/desktop/tests/preload-electron-mock.ts (extend existing mock)
mock.module("electron", () => ({
	app: {
		getPath: (kind: string) =>
			kind === "userData" ? `/tmp/superiorswarm-test-${process.pid}` : "/tmp",
	},
}));
```

Verify the file's existing shape first — if it already exports `app`, just extend `getPath`.

- [ ] **Step 4: Run tests**

```bash
cd apps/desktop && bun test tests/cross-repo-orchestrator-crud.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/cross-repo-orchestrators.ts apps/desktop/tests/cross-repo-orchestrator-crud.test.ts apps/desktop/tests/preload-electron-mock.ts
git commit -m "feat(xro): cross-repo orchestrator CRUD service"
```

---

### Phase 1 Checkpoint

Run from `apps/desktop/`:

```bash
bun run check && bun run type-check && bun test
```

All existing tests must still pass. Commit any Biome auto-fixes:

```bash
git diff --quiet || git commit -am "chore: biome auto-fixes after phase 1"
```

---

## Phase 2 — tRPC Router

### Task 5: Add the tRPC router

**Files:**
- Create: `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts`
- Modify: `apps/desktop/src/main/trpc/routers/index.ts`

- [ ] **Step 1: Write the router**

Create `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts`:

```ts
import { z } from "zod";
import { router, publicProcedure } from "../index";
import {
	createCrossRepoOrchestrator,
	deleteCrossRepoOrchestrator,
	getCrossRepoOrchestrator,
	listCrossRepoOrchestrators,
	renameCrossRepoOrchestrator,
} from "../../services/cross-repo-orchestrators";
import {
	addProjectToCrossRepoOrchestrator,
	attachToCrossRepoOrchestrator,
	detachFromCrossRepoOrchestrator,
	listCrossRepoMembers,
	listLinkedProjects,
	removeProjectFromCrossRepoOrchestrator,
} from "../../services/cross-repo-orchestrator-membership";

export const crossRepoOrchestratorsRouter = router({
	list: publicProcedure.query(() => listCrossRepoOrchestrators()),

	get: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => getCrossRepoOrchestrator(input)),

	create: publicProcedure
		.input(
			z.object({
				name: z.string().min(1).max(120),
				agentKind: z.enum(["claude", "codex", "gemini", "opencode"]),
			})
		)
		.mutation(({ input }) => createCrossRepoOrchestrator(input)),

	rename: publicProcedure
		.input(z.object({ id: z.string(), name: z.string().min(1).max(120) }))
		.mutation(({ input }) => renameCrossRepoOrchestrator(input)),

	delete: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => deleteCrossRepoOrchestrator(input)),

	listLinkedProjects: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => listLinkedProjects({ orchestratorId: input.id })),

	linkProject: publicProcedure
		.input(z.object({ id: z.string(), projectId: z.string() }))
		.mutation(({ input }) =>
			addProjectToCrossRepoOrchestrator({ orchestratorId: input.id, projectId: input.projectId })
		),

	unlinkProject: publicProcedure
		.input(z.object({ id: z.string(), projectId: z.string() }))
		.mutation(({ input }) =>
			removeProjectFromCrossRepoOrchestrator({
				orchestratorId: input.id,
				projectId: input.projectId,
			})
		),

	listMembers: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => listCrossRepoMembers({ orchestratorId: input.id })),

	attachMember: publicProcedure
		.input(z.object({ id: z.string(), workspaceId: z.string() }))
		.mutation(({ input }) =>
			attachToCrossRepoOrchestrator({
				orchestratorId: input.id,
				workspaceId: input.workspaceId,
			})
		),

	detachMember: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(({ input }) => detachFromCrossRepoOrchestrator(input)),
});
```

- [ ] **Step 2: Register in root router**

Modify `apps/desktop/src/main/trpc/routers/index.ts`:

```ts
import { crossRepoOrchestratorsRouter } from "./cross-repo-orchestrators";
// ...
export const appRouter = router({
	// ... existing entries
	crossRepoOrchestrators: crossRepoOrchestratorsRouter,
});
```

- [ ] **Step 3: Type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts apps/desktop/src/main/trpc/routers/index.ts
git commit -m "feat(trpc): cross-repo orchestrators router"
```

---

## Phase 3 — Event Sink Aggregation

### Task 6: Failing test for cross-repo event aggregation

**Files:**
- Create: `apps/desktop/tests/orchestrator-event-sink-cross-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/orchestrator-event-sink-cross-repo.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	attachOrchestratorEventSink,
	crossRepoEventsFilePath,
	invalidateCrossRepoLinksCache,
	setEventsDir,
} from "../src/main/control-plane/orchestrator-event-sink";
import { EventBus } from "../src/main/control-plane/event-bus";
import {
	seedCrossRepoOrchestrator,
	seedProject,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";
import { getDb } from "../src/main/db";
import { crossRepoOrchestratorProjects } from "../src/main/db/schema";

describe("orchestrator-event-sink cross-repo aggregation", () => {
	let tmpDir: string;
	let bus: EventBus;
	let unsubscribe: () => void;

	beforeEach(() => {
		setupTestDb();
		tmpDir = mkdtempSync(join(tmpdir(), "xro-events-"));
		setEventsDir(tmpDir);
		bus = new EventBus();
		unsubscribe = attachOrchestratorEventSink(bus);
	});

	afterEach(() => {
		unsubscribe();
		teardownTestDb();
	});

	test("events for a linked project appear in that orchestrator's cross-repo jsonl", async () => {
		const p = await seedProject();
		const xroId = await seedCrossRepoOrchestrator({ projectIds: [p] });
		invalidateCrossRepoLinksCache(p);

		bus.publish(p, { event: "status", workspaceId: "ws-x", phase: "working", ts: "now" });

		const file = crossRepoEventsFilePath(xroId);
		expect(existsSync(file)).toBe(true);
		const content = readFileSync(file, "utf-8");
		expect(content).toContain('"workspaceId":"ws-x"');
		expect(content).toContain('"phase":"working"');
	});

	test("events for an unlinked project do not appear", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xroId = await seedCrossRepoOrchestrator({ projectIds: [p1] });
		invalidateCrossRepoLinksCache(p1);
		invalidateCrossRepoLinksCache(p2);

		bus.publish(p2, { event: "status", workspaceId: "ws-other", phase: "idle", ts: "now" });

		const file = crossRepoEventsFilePath(xroId);
		expect(existsSync(file)).toBe(false);
	});

	test("single event reaches multiple cross-repo orchestrators that link the same project", async () => {
		const p = await seedProject();
		const xro1 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const xro2 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		invalidateCrossRepoLinksCache(p);

		bus.publish(p, { event: "status", workspaceId: "ws-y", phase: "done", ts: "now" });

		expect(readFileSync(crossRepoEventsFilePath(xro1), "utf-8")).toContain("ws-y");
		expect(readFileSync(crossRepoEventsFilePath(xro2), "utf-8")).toContain("ws-y");
	});
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/desktop && bun test tests/orchestrator-event-sink-cross-repo.test.ts
```

Expected: import error for `crossRepoEventsFilePath` / `invalidateCrossRepoLinksCache`.

- [ ] **Step 3: Commit (red)**

```bash
git add apps/desktop/tests/orchestrator-event-sink-cross-repo.test.ts
git commit -m "test(xro): failing tests for cross-repo event aggregation"
```

---

### Task 7: Extend event sink to write cross-repo jsonl

**Files:**
- Modify: `apps/desktop/src/main/control-plane/orchestrator-event-sink.ts`

- [ ] **Step 1: Extend the sink**

Replace the body of `apps/desktop/src/main/control-plane/orchestrator-event-sink.ts` with:

```ts
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { crossRepoOrchestratorProjects, workspaces } from "../db/schema";
import type { EventBus } from "./event-bus";

let eventsDir: string | null = null;

const orchestratorPresence = new Map<string, boolean>();
const crossRepoLinks = new Map<string, string[]>(); // projectId → xro ids

export function setEventsDir(dir: string): void {
	eventsDir = dir;
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(dir, "cross-repo"), { recursive: true });
}

export function eventsFilePathForProject(projectId: string): string {
	if (!eventsDir) throw new Error("events dir not configured — call setEventsDir() at startup");
	return join(eventsDir, `${projectId}.jsonl`);
}

export function crossRepoEventsFilePath(orchestratorId: string): string {
	if (!eventsDir) throw new Error("events dir not configured — call setEventsDir() at startup");
	return join(eventsDir, "cross-repo", `${orchestratorId}.jsonl`);
}

export function invalidateOrchestratorPresenceCache(projectId: string): void {
	orchestratorPresence.delete(projectId);
}

export function invalidateCrossRepoLinksCache(projectId: string): void {
	crossRepoLinks.delete(projectId);
}

export function invalidateAllCrossRepoLinks(): void {
	crossRepoLinks.clear();
}

export function removeProjectEventsFile(projectId: string): void {
	try {
		rmSync(eventsFilePathForProject(projectId), { force: true });
	} catch {}
}

export function removeCrossRepoEventsFile(orchestratorId: string): void {
	try {
		rmSync(crossRepoEventsFilePath(orchestratorId), { force: true });
	} catch {}
}

export function attachOrchestratorEventSink(bus: EventBus): () => void {
	return bus.subscribeAll((projectId, ev) => {
		const line = `${JSON.stringify(ev)}\n`;
		try {
			if (projectHasOrchestrator(projectId)) {
				appendFileSync(eventsFilePathForProject(projectId), line, "utf-8");
			}
		} catch (err) {
			console.warn("[orchestrator-event-sink] per-repo write failed:", err);
			orchestratorPresence.delete(projectId);
		}

		try {
			const xros = crossRepoOrchestratorsForProject(projectId);
			for (const xroId of xros) {
				appendFileSync(crossRepoEventsFilePath(xroId), line, "utf-8");
			}
		} catch (err) {
			console.warn("[orchestrator-event-sink] cross-repo write failed:", err);
			crossRepoLinks.delete(projectId);
		}
	});
}

function projectHasOrchestrator(projectId: string): boolean {
	const cached = orchestratorPresence.get(projectId);
	if (cached !== undefined) return cached;
	const row = getDb()
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.projectId, projectId), eq(workspaces.isOrchestrator, true)))
		.get();
	const present = !!row;
	orchestratorPresence.set(projectId, present);
	return present;
}

function crossRepoOrchestratorsForProject(projectId: string): string[] {
	const cached = crossRepoLinks.get(projectId);
	if (cached !== undefined) return cached;
	const rows = getDb()
		.select({ orchestratorId: crossRepoOrchestratorProjects.orchestratorId })
		.from(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.projectId, projectId))
		.all();
	const ids = rows.map((r) => r.orchestratorId);
	crossRepoLinks.set(projectId, ids);
	return ids;
}
```

- [ ] **Step 2: Wire cache invalidation from the service layer**

Modify `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`. At the top:

```ts
import {
	invalidateCrossRepoLinksCache,
} from "../control-plane/orchestrator-event-sink";
```

After successful `db.insert(crossRepoOrchestratorProjects)` in `addProjectToCrossRepoOrchestrator`:

```ts
invalidateCrossRepoLinksCache(input.projectId);
```

After successful delete in `removeProjectFromCrossRepoOrchestrator` (inside the transaction — call after `tx` commits, so after the `db.transaction((tx) => { ... })` block):

```ts
invalidateCrossRepoLinksCache(input.projectId);
```

Also modify `cross-repo-orchestrators.ts` — at top:

```ts
import { removeCrossRepoEventsFile, invalidateAllCrossRepoLinks } from "../control-plane/orchestrator-event-sink";
```

In `deleteCrossRepoOrchestrator` after the DB delete:

```ts
removeCrossRepoEventsFile(input.id);
invalidateAllCrossRepoLinks();
```

(Coarse invalidation: deleting an orchestrator affects every project that linked it. Per-project tracking isn't worth it for delete.)

- [ ] **Step 3: Run tests**

```bash
cd apps/desktop && bun test tests/orchestrator-event-sink-cross-repo.test.ts tests/orchestrator-event-sink.test.ts
```

Expected: all pass. If the per-repo event-sink test fails due to the cross-repo dir change, inspect `setEventsDir` and confirm the `mkdirSync(..., { recursive: true })` for the `cross-repo` subdir doesn't break existing assumptions.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/control-plane/orchestrator-event-sink.ts apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts apps/desktop/src/main/services/cross-repo-orchestrators.ts
git commit -m "feat(events): aggregate workspace events into cross-repo orchestrator stream"
```

---

### Phase 3 Checkpoint

```bash
cd apps/desktop && bun run check && bun run type-check && bun test
```

---

## Phase 4 — MCP Mode + Control-Plane Context

### Task 8: Extend `context.resolve` to recognize cross-repo orch cwd

**Files:**
- Modify: `apps/desktop/src/main/control-plane/server.ts` (~line 147 `GET /context.resolve`)
- Modify: `apps/desktop/src/main/control-plane/task-registry.ts` (if it exists; otherwise: the type of the context payload)

- [ ] **Step 1: Find the task-registry contract**

```bash
cd apps/desktop && grep -rn "taskRegistry\.\|deps.taskRegistry" src/main/control-plane/ | head -10
```

Read the relevant types and confirm the `mode` field is a string. If a `Mode` union exists, extend it.

- [ ] **Step 2: Extend context resolution**

Modify `apps/desktop/src/main/control-plane/server.ts`. In the `GET /context.resolve` handler, after the `if (row?.workspaceId)` branch (~line 191), but before the fallthrough `respond(res, 200, requestId, { mode: "none" });`, add:

```ts
// Check whether realCwd matches a cross-repo orchestrator work_dir
if (realCwd) {
	const xro = getDb()
		.select({
			id: crossRepoOrchestrators.id,
			workDir: crossRepoOrchestrators.workDir,
		})
		.from(crossRepoOrchestrators)
		.all()
		.find((r) => {
			try {
				return realpathSync(r.workDir) === realCwd;
			} catch {
				return r.workDir === realCwd;
			}
		});
	if (xro) {
		const linkedProjectIds = getDb()
			.select({ projectId: crossRepoOrchestratorProjects.projectId })
			.from(crossRepoOrchestratorProjects)
			.where(eq(crossRepoOrchestratorProjects.orchestratorId, xro.id))
			.all()
			.map((r) => r.projectId);
		respond(res, 200, requestId, {
			mode: "cross-repo-orchestrator",
			crossRepoOrchestratorId: xro.id,
			linkedProjectIds,
			orchestratorEventsPath: crossRepoEventsFilePath(xro.id),
			isOrchestrator: true,
			modeContext: {},
		});
		return;
	}
}
```

Add imports at the top of the file:

```ts
import { crossRepoOrchestrators, crossRepoOrchestratorProjects } from "../db/schema";
import { crossRepoEventsFilePath } from "./orchestrator-event-sink";
```

- [ ] **Step 3: Add a new control-plane HTTP route for `workspaces.list` filtered to multiple projects**

In `apps/desktop/src/main/control-plane/server.ts`, find `case "GET /workspaces.list":` (~line 195). Today it accepts a single `projectId`. Extend to accept a comma-separated `projectIds` for cross-repo mode:

```ts
case "GET /workspaces.list": {
	const projectIdsRaw = url.searchParams.get("projectIds");
	if (projectIdsRaw) {
		const ids = projectIdsRaw.split(",").filter(Boolean);
		respond(res, 200, requestId, await listWorkspacesForProjects({ projectIds: ids }));
		return;
	}
	const parsed = listWorkspacesRequestSchema.safeParse({
		projectId: url.searchParams.get("projectId"),
	});
	if (!parsed.success) {
		respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
		return;
	}
	respond(res, 200, requestId, await listWorkspaces(parsed.data));
	return;
}
```

Add a `listWorkspacesForProjects` to `apps/desktop/src/shared/control-plane/index.ts` (or wherever `listWorkspaces` lives — find it with `grep -rn "export async function listWorkspaces" src/`). Implement it as:

```ts
export async function listWorkspacesForProjects(input: { projectIds: string[] }) {
	if (input.projectIds.length === 0) return [];
	return getDb()
		.select(/* same shape as listWorkspaces */)
		.from(workspaces)
		.where(inArray(workspaces.projectId, input.projectIds))
		.all();
}
```

Use the exact same row shape as `listWorkspaces` returns. Verify by reading the existing function.

- [ ] **Step 4: Type-check and commit**

```bash
cd apps/desktop && bun run type-check
git add apps/desktop/src/main/control-plane/server.ts apps/desktop/src/shared/control-plane/
git commit -m "feat(control-plane): resolve cross-repo orchestrator cwd, support multi-project workspaces.list"
```

---

### Task 9: Extend MCP server with `cross-repo-orchestrator` mode

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs`

- [ ] **Step 1: Add mode constants and dispatch**

In `apps/desktop/mcp-standalone/server.mjs`, after line 53 (`const IS_ORCHESTRATOR = ...`), add:

```js
const CROSS_REPO_ID = ctx.crossRepoOrchestratorId || null;
const LINKED_PROJECT_IDS = Array.isArray(ctx.linkedProjectIds) ? ctx.linkedProjectIds : [];
const isCrossRepoMode = MODE === "cross-repo-orchestrator";
```

After line 73 (`const isReviewMode = MODE === "review";`), add:

```js
const isWorkspaceAgentOrCrossRepo = isWorkspaceAgentMode || isCrossRepoMode;
```

- [ ] **Step 2: Wrap the orchestrator instructions for cross-repo**

Below the existing `ORCHESTRATOR_INSTRUCTIONS` constant (line 83), add:

```js
const CROSS_REPO_ORCH_INSTRUCTIONS = `You are a CROSS-REPO ORCHESTRATOR. You coordinate workspaces drawn from multiple repositories. Your linked project IDs: ${JSON.stringify(LINKED_PROJECT_IDS)}.

REQUIRED FIRST ACTION (do this before any user task work):
  Use the Monitor tool with command="tail -F -n 0 '${ORCHESTRATOR_EVENTS_PATH ?? ""}'" and persistent=true.

(The events file aggregates status/message events from ALL workspaces in your linked projects.)

Each new line is a JSON event (same shape as per-repo mode).

Coordination tools (superiorswarm namespace):
  - set_status({phase, statusText?, needs?}) — publish your own status
  - send_message({toWorkspaceId?, kind, content}) — DM or broadcast
  - read_messages({since?, includeBroadcasts?}) — query inbox
  - resume_agent({workspaceId, message}) — restart a child's session
  - list_workspaces({projectId?}) — list workspaces; omit projectId to merge across linked projects
  - get_workspace({workspaceId}) — workspace detail
  - create_worktree({projectId, branch, baseBranch?}) — REQUIRED projectId, must be one of your linked IDs
  - dispatch_agent({workspaceId, prompt, ...}) — workspaceId implies project
  - remove_worktree({workspaceId, force?}) — workspaceId implies project`;
```

- [ ] **Step 3: Switch instructions block**

Modify the `instructions:` selection (~line 119):

```js
instructions: isWorkspaceAgentMode
	? IS_ORCHESTRATOR
		? ORCHESTRATOR_INSTRUCTIONS
		: CHILD_INSTRUCTIONS
	: isCrossRepoMode
		? CROSS_REPO_ORCH_INSTRUCTIONS
		: undefined,
```

And the `ROLE_REMINDER` selection (~line 131):

```js
const ROLE_REMINDER = isCrossRepoMode
	? `[superiorswarm] CROSS-REPO ORCHESTRATOR reminder: keep Monitor(tail -F -n 0 '${ORCHESTRATOR_EVENTS_PATH ?? ""}', persistent=true) running. Pass projectId to create_worktree.`
	: IS_ORCHESTRATOR
		? `[superiorswarm] ORCHESTRATOR reminder: keep Monitor(tail -F -n 0 '${ORCHESTRATOR_EVENTS_PATH ?? ""}', persistent=true) running. On child phase=done/blocked, call resume_agent.`
		: "[superiorswarm] CHILD reminder: publish set_status at each phase transition; use send_message for questions to the orchestrator.";
```

- [ ] **Step 4: Register tools for cross-repo mode**

Find the block guarded by `if (isWorkspaceAgentMode)` (or wherever the orchestration tools — `list_workspaces`, `create_worktree`, etc. — are registered, ~line 905). Refactor the guard to:

```js
if (isWorkspaceAgentOrCrossRepo) {
	// ... existing registrations
}
```

Then inside the block, change the four affected tools to branch on mode:

**`list_workspaces`:**

```js
server.tool(
	"list_workspaces",
	isCrossRepoMode
		? "List workspaces across your linked projects. Pass projectId to scope to one."
		: "List all workspaces in the current project.",
	isCrossRepoMode
		? { project_id: z.string().optional().describe("Restrict to one linked project") }
		: {},
	async (args) => {
		if (isCrossRepoMode) {
			const ids = args.project_id ? [args.project_id] : LINKED_PROJECT_IDS;
			return call(
				"GET",
				`/workspaces.list?projectIds=${encodeURIComponent(ids.join(","))}`
			);
		}
		return call("GET", `/workspaces.list?projectId=${encodeURIComponent(PROJECT_ID)}`);
	}
);
```

**`get_workspace`:**

```js
server.tool(
	"get_workspace",
	"Get details about a specific workspace.",
	{ workspace_id: z.string() },
	async ({ workspace_id }) => {
		// Project is derived from workspace_id server-side; pass empty in cross-repo mode
		const projectId = isCrossRepoMode ? "" : PROJECT_ID;
		return call(
			"GET",
			`/workspaces.get?projectId=${encodeURIComponent(projectId)}&workspaceId=${encodeURIComponent(workspace_id)}`
		);
	}
);
```

Then update `apps/desktop/src/main/control-plane/server.ts` `GET /workspaces.get` handler to accept an empty `projectId` and look up the project from the workspace row. Verify the existing `listWorkspacesRequestSchema` / `getWorkspaceRequestSchema` tolerate empty string, or add an alternate code path.

**`create_worktree`:**

```js
server.tool(
	"create_worktree",
	isCrossRepoMode
		? "Create a new worktree in one of your linked projects. project_id is required."
		: "Create a new app-managed worktree for a new branch.",
	{
		branch: z.string(),
		base_branch: z.string().optional(),
		...(isCrossRepoMode
			? { project_id: z.string().describe("One of your linked project IDs") }
			: {}),
	},
	async ({ branch, base_branch, project_id }) => {
		const projectId = isCrossRepoMode ? project_id : PROJECT_ID;
		if (isCrossRepoMode && !LINKED_PROJECT_IDS.includes(projectId)) {
			throw new Error(`project_id ${projectId} is not in linked projects`);
		}
		return call("POST", "/workspaces.create", {
			projectId,
			branch,
			baseBranch: base_branch,
		});
	}
);
```

**`dispatch_agent`:**

```js
server.tool(
	"dispatch_agent",
	"Open a terminal in a workspace and run the configured CLI agent.",
	{
		workspace_id: z.string(),
		prompt: z.string(),
		cli_preset: z.enum(["claude", "codex", "gemini", "opencode"]).optional(),
		skip_permissions: z.boolean().optional(),
	},
	async ({ workspace_id, prompt, cli_preset, skip_permissions }) =>
		call("POST", "/workspaces.dispatch", {
			projectId: isCrossRepoMode ? null : PROJECT_ID,
			workspaceId: workspace_id,
			prompt,
			cliPreset: cli_preset,
			skipPermissions: skip_permissions,
		})
);
```

Update the `/workspaces.dispatch` handler in `server.ts` to tolerate `projectId === null` and derive the project from `workspaceId`.

**`remove_worktree`:** same pattern as `dispatch_agent` — pass `projectId: null` in cross-repo mode and derive from `workspaceId` server-side.

- [ ] **Step 5: Update `set_status` to identify the cross-repo orch as sender**

In `apps/desktop/mcp-standalone/server.mjs`, the `set_status` tool currently posts to `/workspaces.set_status` without a sender id (the server reads it from context). Verify by reading the body handler in `server.ts`. If the server reads it from the request context, the new `cross-repo-orchestrator` mode must populate a sender id of the form `xro-…`.

In `server.ts`, find `POST /workspaces.set_status` and ensure: when `mode === "cross-repo-orchestrator"`, the sender id stored in the `agent_status` table is `CROSS_REPO_ID` (passed from MCP via the bearer token / context payload). The MCP call should include `senderId: CROSS_REPO_ID` in the request body if not already in the bearer context.

If the existing code reads sender from the cwd-resolved context — no change needed; the new `cross-repo-orchestrator` resolution already supplies the id.

- [ ] **Step 6: Smoke test by hand (no automated test for MCP yet)**

```bash
cd apps/desktop && bun run dev
```

In the app:
1. Manually invoke `crossRepoOrchestrators.create` via DevTools (`window.api.trpc.crossRepoOrchestrators.create.mutate({name: "smoke", agentKind: "claude"})`).
2. Open a terminal in the resulting `work_dir`, run a one-shot MCP probe:
   ```bash
   cd "$(node -e "console.log(require('os').homedir())")/Library/Application Support/SuperiorSwarm/cross-repo-orchestrators/xro-…"
   SUPERIORSWARM_TASK_TOKEN="" ELECTRON_RUN_AS_NODE=1 /path/to/electron mcp-standalone/server.mjs
   ```
3. Expected: server emits `{mode: "cross-repo-orchestrator", crossRepoOrchestratorId: "xro-…", linkedProjectIds: []}` on initialize.

(This step is exploratory — no automated test. Record findings.)

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs apps/desktop/src/main/control-plane/server.ts
git commit -m "feat(mcp): cross-repo-orchestrator mode with multi-project tool routing"
```

---

### Phase 4 Checkpoint

```bash
cd apps/desktop && bun run check && bun run type-check && bun test
```

---

## Phase 5 — Agent Runtime

### Task 10: tRPC `startAgent` / `stopAgent` for cross-repo orchestrators

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts`
- Modify: `apps/desktop/src/main/services/cross-repo-orchestrators.ts`
- Locate: existing agent-spawn helper (`grep -rn "spawn.*claude\|dispatchCliAgent\|startAgent" src/main/`)

- [ ] **Step 1: Find the existing agent-spawn helper**

```bash
cd apps/desktop && grep -rln "ELECTRON_RUN_AS_NODE\|spawnAgent\|dispatchCli" src/main/ | head -5
```

Read whichever file handles spawning the CLI agent process for a workspace (it'll be the same code path called from `dispatch_agent` MCP tool / `/workspaces.dispatch` server route).

- [ ] **Step 2: Extract a reusable spawn helper**

Refactor the existing spawn helper to accept `{ cwd, agentKind, env: Record<string,string> }` rather than reading a workspace row. Move the workspace-specific code (looking up the worktree path) into the *caller* in `/workspaces.dispatch`. The signature should be:

```ts
export async function spawnCliAgent(opts: {
	cwd: string;
	agentKind: "claude" | "codex" | "gemini" | "opencode";
	taskToken: string;   // for context.resolve
	prompt?: string;
}): Promise<{ pid: number }> { ... }
```

- [ ] **Step 3: Implement `startCrossRepoOrchestratorAgent`**

In `apps/desktop/src/main/services/cross-repo-orchestrators.ts`, add:

```ts
import { spawnCliAgent } from "./cli-agent-spawner"; // or wherever extracted in step 2
import { taskRegistry } from "../control-plane/task-registry";

export async function startCrossRepoOrchestratorAgent(input: {
	id: string;
}): Promise<{ pid: number }> {
	const row = await getCrossRepoOrchestrator({ id: input.id });
	if (!row) throw new Error(`cross-repo orchestrator ${input.id} not found`);

	// Pre-register a context payload so context.resolve returns it
	// even before the agent's cwd matches anything on disk.
	const token = taskRegistry.put({
		mode: "cross-repo-orchestrator",
		crossRepoOrchestratorId: row.id,
		linkedProjectIds: await listLinkedProjects({ orchestratorId: row.id }),
		orchestratorEventsPath: crossRepoEventsFilePath(row.id),
		isOrchestrator: true,
		modeContext: {},
	});

	const result = await spawnCliAgent({
		cwd: row.workDir,
		agentKind: row.agentKind as "claude" | "codex" | "gemini" | "opencode",
		taskToken: token,
	});

	getDb()
		.update(crossRepoOrchestrators)
		.set({ status: "working", updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();

	return result;
}

export async function stopCrossRepoOrchestratorAgent(input: { id: string }): Promise<{ ok: true }> {
	// If the spawn helper tracks PIDs in the terminal-sessions table or
	// similar, look up and SIGTERM here. Otherwise: tell the user to close
	// the terminal manually.
	getDb()
		.update(crossRepoOrchestrators)
		.set({ status: "idle", updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	return { ok: true };
}
```

Add the imports for `crossRepoEventsFilePath`, `listLinkedProjects`, `taskRegistry`, `eq`.

- [ ] **Step 4: Expose via tRPC**

In `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts`, add:

```ts
startAgent: publicProcedure
	.input(z.object({ id: z.string() }))
	.mutation(({ input }) => startCrossRepoOrchestratorAgent(input)),
stopAgent: publicProcedure
	.input(z.object({ id: z.string() }))
	.mutation(({ input }) => stopCrossRepoOrchestratorAgent(input)),
```

- [ ] **Step 5: Type-check and commit**

```bash
cd apps/desktop && bun run type-check
git add apps/desktop/src/main/services/cross-repo-orchestrators.ts apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts apps/desktop/src/main/services/cli-agent-spawner.ts # or wherever extracted
git commit -m "feat(xro): start/stop agent runtime for cross-repo orchestrators"
```

---

## Phase 6 — Sidebar UI

### Task 11: Renderer types + tRPC hooks for the new entity

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (add `CrossRepoOrchestratorNode` type)

- [ ] **Step 1: Add shared types**

Append to `apps/desktop/src/shared/types.ts`:

```ts
export interface CrossRepoOrchestratorNode {
	id: string;
	name: string;
	colorIndex: number | null;
	status: string;
	repoCount: number;
	memberCount: number;
}

export interface CrossRepoMemberRow {
	workspaceId: string;
	workspaceName: string;
	projectId: string;
	projectName: string;
	sortOrder: number;
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/shared/types.ts
git commit -m "feat(types): cross-repo orchestrator renderer types"
```

---

### Task 12: `CrossRepoOrchestratorRow` component

**Files:**
- Create: `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx`
- Create: `apps/desktop/src/renderer/hooks/useCrossRepoOrchestratorColor.ts`

- [ ] **Step 1: Color hook (mirrors `useOrchestratorColor` but persists per cross-repo id)**

Create `apps/desktop/src/renderer/hooks/useCrossRepoOrchestratorColor.ts` — copy `useOrchestratorColor.ts`, replace `projectId` parameter with no parameter (cross-repo orchs have no project), and swap tRPC calls to a new pair on the `settings` router:

```ts
import { useEffect, useMemo, useRef } from "react";
import { trpc } from "../trpc/client";

const PALETTE_SIZE = 8;

export function useCrossRepoOrchestratorColor(
	orchestratorId: string,
	allOrchestratorIds: string[]
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
	const colorsQuery = trpc.settings.getCrossRepoOrchestratorColors.useQuery(undefined, {
		staleTime: 60_000,
	});
	const setColors = trpc.settings.setCrossRepoOrchestratorColors.useMutation();

	const mutateRef = useRef(setColors.mutate);
	mutateRef.current = setColors.mutate;

	const existing = colorsQuery.data;
	const idsKey = allOrchestratorIds.join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: idsKey is primitive
	const computed = useMemo<Record<string, number>>(() => {
		const map: Record<string, number> = { ...(existing ?? {}) };
		const taken = new Set<number>();
		for (const id of allOrchestratorIds) if (map[id] !== undefined) taken.add(map[id]);
		let assignedCount = 0;
		for (const id of allOrchestratorIds) {
			if (map[id] !== undefined) continue;
			let pick = 0;
			let placed = false;
			for (let i = 0; i < PALETTE_SIZE; i++) {
				if (!taken.has(i)) {
					pick = i;
					placed = true;
					break;
				}
			}
			if (!placed) pick = assignedCount % PALETTE_SIZE;
			map[id] = pick;
			taken.add(pick);
			assignedCount++;
		}
		return map;
	}, [existing, idsKey]);

	useEffect(() => {
		if (!existing) return;
		const changed = Object.keys(computed).some((k) => computed[k] !== existing[k]);
		if (changed) mutateRef.current({ map: computed });
	}, [computed, existing]);

	const idx = computed[orchestratorId] ?? 0;
	return (idx + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}
```

Add the tRPC procedures: in `apps/desktop/src/main/trpc/routers/settings.ts` (locate existing color-map endpoints via `grep -n "OrchestratorColors" src/main/trpc/routers/settings.ts`):

```ts
getCrossRepoOrchestratorColors: publicProcedure.query(() => readSetting("xro_color_map", {} as Record<string, number>)),
setCrossRepoOrchestratorColors: publicProcedure
	.input(z.object({ map: z.record(z.string(), z.number()) }))
	.mutation(({ input }) => writeSetting("xro_color_map", input.map)),
```

Find `readSetting` / `writeSetting` first — they should already exist alongside the per-repo orchestrator color setters.

- [ ] **Step 2: Row component**

Create `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx` — a smaller variant of `OrchestratorRow.tsx`. Skeleton:

```tsx
import { useState } from "react";
import { trpc } from "../trpc/client";
import { useCrossRepoOrchestratorColor } from "../hooks/useCrossRepoOrchestratorColor";

interface Props {
	orchestrator: { id: string; name: string };
	allOrchestratorIds: string[];
	expanded: boolean;
	onToggle: () => void;
	onRename?: () => void;
	onDelete?: () => void;
}

export function CrossRepoOrchestratorRow({
	orchestrator,
	allOrchestratorIds,
	expanded,
	onToggle,
	onRename,
	onDelete,
}: Props) {
	const colorIndex = useCrossRepoOrchestratorColor(orchestrator.id, allOrchestratorIds);
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestrator.id });
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestrator.id });
	const memberCount = members.data?.length ?? 0;
	const repoCount = linked.data?.length ?? 0;

	return (
		<div className="group flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--bg-elevated)] rounded-[var(--radius-md)]">
			<button onClick={onToggle} className="text-[var(--text-quaternary)]">
				{expanded ? "▾" : "▸"}
			</button>
			<span
				className={`block w-2 h-2 rounded-sm bg-[var(--orch-${colorIndex})]`}
				aria-hidden="true"
			/>
			<span className="text-[13px] text-[var(--text)] truncate">{orchestrator.name}</span>
			<span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
				{repoCount} {repoCount === 1 ? "repo" : "repos"} · {memberCount}
			</span>
		</div>
	);
}
```

Use the existing CSS tokens — Biome will flag inconsistencies. Match `OrchestratorRow.tsx`'s context-menu pattern for rename/delete; copy it minimally.

- [ ] **Step 3: Type-check, format, commit**

```bash
cd apps/desktop && bun run check && bun run type-check
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx apps/desktop/src/renderer/hooks/useCrossRepoOrchestratorColor.ts apps/desktop/src/main/trpc/routers/settings.ts
git commit -m "feat(ui): CrossRepoOrchestratorRow + color hook"
```

---

### Task 13: `CrossRepoOrchestratorGroup` (top-level sidebar section)

**Files:**
- Create: `apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx`
- Create: `apps/desktop/src/renderer/components/CreateCrossRepoOrchestratorModal.tsx`

- [ ] **Step 1: Group component**

Create `apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx`:

```tsx
import { useState } from "react";
import { trpc } from "../trpc/client";
import { CrossRepoOrchestratorRow } from "./CrossRepoOrchestratorRow";
import { CrossRepoOrchestratorBody } from "./CrossRepoOrchestratorBody";
import { CreateCrossRepoOrchestratorModal } from "./CreateCrossRepoOrchestratorModal";

export function CrossRepoOrchestratorGroup() {
	const orchs = trpc.crossRepoOrchestrators.list.useQuery();
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [showCreate, setShowCreate] = useState(false);

	const allIds = (orchs.data ?? []).map((o) => o.id);

	return (
		<div className="mt-2">
			<div className="flex items-center justify-between px-2 py-1">
				<span className="text-[10px] uppercase tracking-wider text-[var(--text-quaternary)]">
					Cross-repo orchestrators
				</span>
				<button
					onClick={() => setShowCreate(true)}
					className="text-[var(--text-quaternary)] hover:text-[var(--text)] text-xs"
					aria-label="New cross-repo orchestrator"
				>
					+
				</button>
			</div>
			{(orchs.data ?? []).map((o) => (
				<div key={o.id}>
					<CrossRepoOrchestratorRow
						orchestrator={o}
						allOrchestratorIds={allIds}
						expanded={!!expanded[o.id]}
						onToggle={() => setExpanded((p) => ({ ...p, [o.id]: !p[o.id] }))}
					/>
					{expanded[o.id] && <CrossRepoOrchestratorBody orchestratorId={o.id} />}
				</div>
			))}
			{showCreate && (
				<CreateCrossRepoOrchestratorModal onClose={() => setShowCreate(false)} />
			)}
		</div>
	);
}
```

- [ ] **Step 2: Body component (REPOS + MEMBERS sublists)**

Create `apps/desktop/src/renderer/components/CrossRepoOrchestratorBody.tsx`:

```tsx
import { trpc } from "../trpc/client";

export function CrossRepoOrchestratorBody({ orchestratorId }: { orchestratorId: string }) {
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestratorId });
	const projects = trpc.projects.list.useQuery();
	const utils = trpc.useUtils();
	const linkProject = trpc.crossRepoOrchestrators.linkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
		},
	});

	const projectsById = new Map((projects.data ?? []).map((p) => [p.id, p]));

	return (
		<div className="ml-4">
			<div className="text-[10px] uppercase tracking-wider text-[var(--text-quaternary)] px-2 py-1">
				Repos
			</div>
			{(linked.data ?? []).map((pid) => (
				<div key={pid} className="px-2 py-1 text-[12px] text-[var(--text-secondary)]">
					{projectsById.get(pid)?.name ?? pid}
				</div>
			))}
			<div className="px-2 py-1">
				<select
					className="bg-transparent border border-[var(--border)] rounded text-[11px] py-0.5"
					value=""
					onChange={(e) => {
						if (!e.target.value) return;
						linkProject.mutate({ id: orchestratorId, projectId: e.target.value });
					}}
				>
					<option value="">+ link repo…</option>
					{(projects.data ?? [])
						.filter((p) => !(linked.data ?? []).includes(p.id))
						.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
				</select>
			</div>

			<div className="text-[10px] uppercase tracking-wider text-[var(--text-quaternary)] px-2 py-1 mt-2">
				Members
			</div>
			{(members.data ?? []).map((m) => (
				<div key={m.workspaceId} className="px-2 py-1 text-[12px] text-[var(--text)]">
					{projectsById.get(m.projectId)?.name ?? m.projectId} / {m.workspaceId}
				</div>
			))}
		</div>
	);
}
```

(Refining workspace name rendering — replace `m.workspaceId` with the workspace name — requires either expanding `listMembers` to join the workspace name or fetching `workspaces.list` here. Pick whichever matches existing patterns.)

- [ ] **Step 3: Create modal**

Create `apps/desktop/src/renderer/components/CreateCrossRepoOrchestratorModal.tsx`:

```tsx
import { useState } from "react";
import { trpc } from "../trpc/client";

export function CreateCrossRepoOrchestratorModal({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [agentKind, setAgentKind] = useState<"claude" | "codex" | "gemini" | "opencode">("claude");
	const utils = trpc.useUtils();
	const create = trpc.crossRepoOrchestrators.create.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.list.invalidate();
			onClose();
		},
	});

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] p-5 w-[420px]">
				<h3 className="text-[14px] mb-3">New cross-repo orchestrator</h3>
				<label className="block text-[11px] mb-1">Name</label>
				<input
					className="w-full bg-transparent border border-[var(--border)] rounded px-2 py-1 mb-3"
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoFocus
				/>
				<label className="block text-[11px] mb-1">Agent</label>
				<select
					value={agentKind}
					onChange={(e) => setAgentKind(e.target.value as typeof agentKind)}
					className="w-full bg-transparent border border-[var(--border)] rounded px-2 py-1 mb-4"
				>
					<option value="claude">claude</option>
					<option value="codex">codex</option>
					<option value="gemini">gemini</option>
					<option value="opencode">opencode</option>
				</select>
				<div className="flex justify-end gap-2">
					<button onClick={onClose} className="px-3 py-1 text-[12px]">
						Cancel
					</button>
					<button
						onClick={() => create.mutate({ name: name.trim(), agentKind })}
						disabled={!name.trim() || create.isPending}
						className="px-3 py-1 text-[12px] bg-[var(--accent)] text-white rounded"
					>
						Create
					</button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Mount in `Sidebar.tsx`**

```bash
cd apps/desktop && grep -n "ProjectList\|<ProjectList" src/renderer/components/Sidebar.tsx
```

Find the rendering of `<ProjectList />` and add `<CrossRepoOrchestratorGroup />` directly below it.

- [ ] **Step 5: Visual smoke test**

```bash
cd apps/desktop && bun run dev
```

1. Open the sidebar — confirm "Cross-repo orchestrators" header appears.
2. Click `+` → create one named "Test". Confirm row appears.
3. Expand → confirm REPOS (empty) and MEMBERS (empty) sublists appear.
4. Link a project via the select → confirm REPOS shows the project.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/
git commit -m "feat(ui): cross-repo orchestrator sidebar group, create modal, expanded body"
```

---

### Task 14: Drag-drop attach from a workspace row

**Files:**
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx` (accept drops)
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx` or wherever workspace rows declare their draggable id (verify by reading the current per-repo orch drop handler)

- [ ] **Step 1: Inspect existing drag-drop wiring**

```bash
cd apps/desktop && grep -rn "useDroppable\|onDragEnd\|@dnd-kit" src/renderer/components/ | head -20
```

Read whichever component contains the per-repo orch drop handler. Replicate the receiver pattern on `CrossRepoOrchestratorRow`.

- [ ] **Step 2: Add `useDroppable` to the cross-repo row**

In `CrossRepoOrchestratorRow.tsx`:

```tsx
import { useDroppable } from "@dnd-kit/core";
// ...
const { setNodeRef, isOver } = useDroppable({
	id: `xro-drop-${orchestrator.id}`,
	data: { kind: "cross-repo-orchestrator", orchestratorId: orchestrator.id },
});
// add ref={setNodeRef} to the row's outer div, plus an `isOver` style hint
```

- [ ] **Step 3: Handle the drop**

In whichever component owns `<DndContext onDragEnd={...}>` (likely `Sidebar.tsx` or `ProjectList.tsx`), extend the `onDragEnd` switch to handle `over.data.current.kind === "cross-repo-orchestrator"`:

```ts
if (over?.data?.current?.kind === "cross-repo-orchestrator") {
	const orchId = over.data.current.orchestratorId as string;
	const workspaceId = active.id as string;
	attachMember.mutate({ id: orchId, workspaceId });
	return;
}
```

Use `trpc.crossRepoOrchestrators.attachMember`. On error (workspace's project not linked) show a toast — or accept the existing tRPC error surface for V1.

- [ ] **Step 4: Smoke test**

In `bun run dev`, drag a workspace onto a cross-repo orch row. Confirm it appears under MEMBERS after a refresh of the body view. If the project isn't linked, confirm the error shows in console (toast is V1.1).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx apps/desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(ui): drag-drop attach workspaces to cross-repo orchestrators"
```

---

### Task 15: Start-agent button on the orchestrator row

**Files:**
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx`

- [ ] **Step 1: Add the button**

```tsx
const start = trpc.crossRepoOrchestrators.startAgent.useMutation();
// inside JSX, before the count badge:
<button
	onClick={(e) => {
		e.stopPropagation();
		start.mutate({ id: orchestrator.id });
	}}
	disabled={start.isPending}
	className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--accent)] hover:underline"
>
	{start.isPending ? "starting…" : "start"}
</button>
```

(Status icon for running/idle is a follow-up; V1 just exposes the button.)

- [ ] **Step 2: Smoke test**

In `bun run dev`, create an orch, link a repo, click start → confirm the agent CLI launches in the work_dir (verify via process list or by opening the work_dir terminal).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx
git commit -m "feat(ui): start-agent button on cross-repo orchestrator row"
```

---

### Phase 6 Checkpoint

```bash
cd apps/desktop && bun run check && bun run type-check && bun test && bun run build
```

All gates green. The feature is end-to-end usable: create cross-repo orch via sidebar → link two repos → drag a workspace from each into it → click start → orchestrator agent runs in its app-data cwd → events from both repos stream into its `events.jsonl`.

---

## Final Self-Review Checklist (run before declaring done)

- [ ] Spec §2 (data model) — covered by Tasks 1, 3, 4
- [ ] Spec §3 (sidebar) — covered by Tasks 11–15
- [ ] Spec §4 (runtime cwd) — covered by Task 4 (`workDirFor`) and Task 10
- [ ] Spec §5 (event stream) — covered by Tasks 6, 7
- [ ] Spec §6 (MCP scope) — covered by Tasks 8, 9
- [ ] Spec §7 (membership rules) — covered by Task 3 (project-linked guard, single-parent, leaf-only via the `ws.isOrchestrator` reject)
- [ ] Spec §8 (migration / compat) — covered by Task 1; rollback path is `0045` drop
- [ ] Spec open question "agent kind selection" — covered by Task 13's create modal
- [ ] Spec open question "double-file write cost" — no UX implication confirmed in Task 7's tests

## Out of Scope (not in this plan)

- Reordering members within a cross-repo orchestrator (membership table has `sort_order`; UI ships as insertion-order only)
- Multi-parent membership
- Stop-agent UI flow beyond setting status (kill PID requires a follow-up)
- Toast for drop-rejected-because-project-not-linked (console log only in V1)
