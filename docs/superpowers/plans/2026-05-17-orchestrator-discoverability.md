# Orchestrator Discoverability & Adaptability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the orchestrator-grouping feature legible, discoverable, and adaptable — six independent UX improvements layered on the existing nested-tree sidebar.

**Architecture:** Additive renderer + backend changes on top of `feat(orchestrator)` branch. Five new tRPC procedures (`renameWorkspace`, `detachAllFromOrchestrator`, `createOrchestrator`, plus widened `setOrchestratorColors` zod). One new modal (`CreateOrchestratorModal`). Six modifications to existing renderer components (`OrchestratorRow`, `OrchestratorGroup`, `WorkspaceItem`, `ProjectItem`, `useOrchestratorColor`, `styles.css`). Persistent flags reuse the existing `getOrchestratorExpand` / `setOrchestratorExpand` tRPC pair with new keys.

**Tech Stack:** Electron + React 19 + TypeScript, tRPC over Electron IPC, SQLite + Drizzle ORM, `@dnd-kit`, Biome, Bun test runner.

**Source spec:** `docs/superpowers/specs/2026-05-17-orchestrator-discoverability-design.md`

---

## File Structure

**Created**

- `apps/desktop/src/renderer/components/CreateOrchestratorModal.tsx` — modal for `+O` flow
- `apps/desktop/tests/detach-all.test.ts` — covers `detachAllFromOrchestrator`
- `apps/desktop/tests/create-orchestrator.test.ts` — covers `createOrchestrator`
- `apps/desktop/tests/rename-workspace.test.ts` — covers `renameWorkspace`

**Modified**

- `apps/desktop/src/renderer/styles.css` — extend palette tokens 3→8 (dark + light)
- `apps/desktop/src/renderer/hooks/useOrchestratorColor.ts` — palette size 3→8, widen return union
- `apps/desktop/src/main/services/orchestrator-membership.ts` — add `detachAllFromOrchestrator`
- `apps/desktop/src/main/services/workspace-service.ts` — add `renameWorkspace`, add `createOrchestrator`
- `apps/desktop/src/main/trpc/routers/workspaces.ts` — three new procedures, one widened zod, plus reuse existing `getOrchestratorExpand`/`setOrchestratorExpand` for new flag keys
- `apps/desktop/src/renderer/stores/projects.ts` — add `openCreateOrchestratorModal` state and actions
- `apps/desktop/src/renderer/components/OrchestratorRow.tsx` — glyph + tooltips + overflow `⋮` + extended menu + `isDropTargetCandidate`
- `apps/desktop/src/renderer/components/OrchestratorGroup.tsx` — zero-child empty state
- `apps/desktop/src/renderer/components/WorkspaceItem.tsx` — hover-promote `↥` + Attach/Detach context menu items
- `apps/desktop/src/renderer/components/ProjectItem.tsx` — `+W`/`+O` twin buttons + drag-state tracking + grip + coachmark + drop-zone label + onboarding tip + keyboard shortcuts + mount `CreateOrchestratorModal`

---

## Conventions

- Tests live under `apps/desktop/tests/`. Run from the desktop workspace: `cd apps/desktop && bun test tests/<file>`.
- Lint/type check via `bun run check && bun run type-check` from the repo root.
- Commit messages follow Conventional Commits (look at recent commits like `feat(orchestrator): support multiple orchestrators per project`). **Do NOT add `Co-Authored-By` trailers.**
- Renderer changes are tested manually (no react-testing-library in the project). Each renderer task includes an explicit "Manual sanity check" step before committing.

---

## Task 1: Extend orchestrator palette tokens from 3 to 8

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Open the file and find the orchestrator token block (search `--orch-1`).** It appears twice — once in the dark-theme `:root` block around lines 70–75, once in the light-theme block around lines 150+.

- [ ] **Step 2: Replace the dark-theme block with all 8 tokens.** Find:

```css
	--orch-1: #8a9ab0;
	--orch-1-bg: rgba(138, 154, 176, 0.12);
	--orch-2: #b09a8a;
	--orch-2-bg: rgba(176, 154, 138, 0.12);
	--orch-3: #9ab08a;
	--orch-3-bg: rgba(154, 176, 138, 0.12);
```

Replace with:

```css
	--orch-1: #8a9ab0;
	--orch-1-bg: rgba(138, 154, 176, 0.12);
	--orch-2: #b09a8a;
	--orch-2-bg: rgba(176, 154, 138, 0.12);
	--orch-3: #9ab08a;
	--orch-3-bg: rgba(154, 176, 138, 0.12);
	--orch-4: #b08a9a;
	--orch-4-bg: rgba(176, 138, 154, 0.12);
	--orch-5: #8ab0a8;
	--orch-5-bg: rgba(138, 176, 168, 0.12);
	--orch-6: #a8a08a;
	--orch-6-bg: rgba(168, 160, 138, 0.12);
	--orch-7: #9a8ab0;
	--orch-7-bg: rgba(154, 138, 176, 0.12);
	--orch-8: #b0a08a;
	--orch-8-bg: rgba(176, 160, 138, 0.12);
```

- [ ] **Step 3: Find the light-theme block (search the second `--orch-1` occurrence, around line 150) and replace with the darker-lightness equivalent.** Find:

```css
	--orch-1: #6f8094;
	--orch-1-bg: rgba(111, 128, 148, 0.14);
	--orch-2: #948070;
	--orch-2-bg: rgba(148, 128, 112, 0.14);
```

…and the matching `--orch-3` two-line pair that follows. Replace the whole block with:

```css
	--orch-1: #6f8094;
	--orch-1-bg: rgba(111, 128, 148, 0.14);
	--orch-2: #948070;
	--orch-2-bg: rgba(148, 128, 112, 0.14);
	--orch-3: #708048;
	--orch-3-bg: rgba(112, 128, 72, 0.14);
	--orch-4: #946f80;
	--orch-4-bg: rgba(148, 111, 128, 0.14);
	--orch-5: #70948c;
	--orch-5-bg: rgba(112, 148, 140, 0.14);
	--orch-6: #8c8470;
	--orch-6-bg: rgba(140, 132, 112, 0.14);
	--orch-7: #80708c;
	--orch-7-bg: rgba(128, 112, 140, 0.14);
	--orch-8: #948870;
	--orch-8-bg: rgba(148, 136, 112, 0.14);
```

> Light-theme values keep the same hue family as dark-theme but at ~46% lightness so they have enough contrast on a light background. The existing `--orch-3` in light theme today is the only entry that should be re-checked manually — adjust if it doesn't match the rest of the project's light-mode contrast curve.

- [ ] **Step 4: Run formatter to keep CSS tidy.** From repo root:

```bash
bun run format
```

Expected: no errors, file rewritten in place.

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "feat(theme): extend orchestrator palette to 8 colors"
```

---

## Task 2: Widen color persistence + hook to 8-color palette

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts:540` (the `setOrchestratorColors` zod validator)
- Modify: `apps/desktop/src/renderer/hooks/useOrchestratorColor.ts`

- [ ] **Step 1: In `workspaces.ts`, find the `setOrchestratorColors` input zod (around line 540).** It looks like:

```ts
.input(
	z.object({
		projectId: z.string().min(1),
		map: z.record(z.string(), z.number().int().min(0).max(2)),
	})
)
```

Change `max(2)` to `max(7)`:

```ts
.input(
	z.object({
		projectId: z.string().min(1),
		map: z.record(z.string(), z.number().int().min(0).max(7)),
	})
)
```

- [ ] **Step 2: Open `useOrchestratorColor.ts` and bump the palette size constant.** Find:

```ts
const PALETTE_SIZE = 3; // matches --orch-1, --orch-2, --orch-3
```

Replace with:

```ts
const PALETTE_SIZE = 8; // matches --orch-1 through --orch-8
```

- [ ] **Step 3: Widen the return type union.** Find the function signature and the cast at the bottom:

```ts
): 1 | 2 | 3 {
```

```ts
return (idx + 1) as 1 | 2 | 3;
```

Replace both with the 1..8 union:

```ts
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
```

```ts
return (idx + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
```

- [ ] **Step 4: Update consumers' type expectations.** Search for the narrow union elsewhere:

```bash
grep -rn "1 | 2 | 3" apps/desktop/src/renderer/components/OrchestratorRow.tsx apps/desktop/src/renderer/components/OrchestratorGroup.tsx
```

Each match in those two files — the `colorIndex` prop — change to `1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`.

- [ ] **Step 5: Type check.** From repo root:

```bash
bun run type-check
```

Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/src/main/trpc/routers/workspaces.ts apps/desktop/src/renderer/hooks/useOrchestratorColor.ts apps/desktop/src/renderer/components/OrchestratorRow.tsx apps/desktop/src/renderer/components/OrchestratorGroup.tsx
git commit -m "feat(orchestrator): widen color palette index to 1..8"
```

---

## Task 3: Backend — `detachAllFromOrchestrator` service + test

**Files:**
- Modify: `apps/desktop/src/main/services/orchestrator-membership.ts`
- Create: `apps/desktop/tests/detach-all.test.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/desktop/tests/detach-all.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	attachToOrchestrator,
	detachAllFromOrchestrator,
	listMembership,
} from "../src/main/services/orchestrator-membership";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

describe("detachAllFromOrchestrator", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("detaches all children of the given orchestrator", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: a });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: b });

		const result = await detachAllFromOrchestrator({ orchestratorId: orch });

		expect(result.detachedCount).toBe(2);
		expect((await listMembership({ orchestratorId: orch })).length).toBe(0);
	});

	test("returns detachedCount=0 when orchestrator has no children", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const result = await detachAllFromOrchestrator({ orchestratorId: orch });
		expect(result.detachedCount).toBe(0);
	});

	test("leaves children of other orchestrators untouched", async () => {
		const p = await seedProject();
		const o1 = await seedWorkspace(p, { name: "o1", isOrchestrator: true });
		const o2 = await seedWorkspace(p, { name: "o2", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });
		await attachToOrchestrator({ orchestratorId: o1, workspaceId: a });
		await attachToOrchestrator({ orchestratorId: o2, workspaceId: b });

		await detachAllFromOrchestrator({ orchestratorId: o1 });

		expect((await listMembership({ orchestratorId: o1 })).length).toBe(0);
		expect((await listMembership({ orchestratorId: o2 })).map((m) => m.workspaceId)).toEqual([b]);
	});
});
```

- [ ] **Step 2: Run test, confirm it fails.**

```bash
cd apps/desktop && bun test tests/detach-all.test.ts
```

Expected: fail with `detachAllFromOrchestrator is not a function` or import error.

- [ ] **Step 3: Implement `detachAllFromOrchestrator` in `orchestrator-membership.ts`.** Append after the existing `detachFromOrchestrator` function:

```ts
export async function detachAllFromOrchestrator(input: {
	orchestratorId: string;
}): Promise<{ detachedCount: number }> {
	const db = getDb();

	const orch = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, input.orchestratorId))
		.get();
	if (!orch) throw new NotFoundError(input.orchestratorId);
	if (!orch.isOrchestrator) {
		throw new Error(`workspace ${input.orchestratorId} is not an orchestrator`);
	}

	let detachedCount = 0;
	db.transaction((tx) => {
		const rows = tx
			.select({ workspaceId: orchestratorMembers.workspaceId })
			.from(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
			.all();
		detachedCount = rows.length;

		if (rows.length === 0) return;

		tx.delete(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
			.run();

		const maxRow = tx
			.select({ m: max(workspaces.sortOrder) })
			.from(workspaces)
			.where(eq(workspaces.projectId, orch.projectId))
			.get();
		let nextSort = (maxRow?.m ?? -1) + 1;
		const now = new Date();
		for (const r of rows) {
			tx.update(workspaces)
				.set({ sortOrder: nextSort, updatedAt: now })
				.where(eq(workspaces.id, r.workspaceId))
				.run();
			nextSort++;
		}
	});

	return { detachedCount };
}
```

- [ ] **Step 4: Run test again, confirm it passes.**

```bash
cd apps/desktop && bun test tests/detach-all.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/main/services/orchestrator-membership.ts apps/desktop/tests/detach-all.test.ts
git commit -m "feat(orchestrator): add detachAllFromOrchestrator service"
```

---

## Task 4: Backend — `workspaces.detachAllFromOrchestrator` tRPC procedure

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts`

- [ ] **Step 1: Add the procedure next to `detachFromOrchestrator` (around line 361).** Insert below the existing `detachFromOrchestrator: publicProcedure ...` block:

```ts
	detachAllFromOrchestrator: publicProcedure
		.input(z.object({ orchestratorId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const { detachAllFromOrchestrator } = await import(
				"../../services/orchestrator-membership"
			);
			return detachAllFromOrchestrator(input);
		}),
```

- [ ] **Step 2: Run type check.**

```bash
bun run type-check
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/desktop/src/main/trpc/routers/workspaces.ts
git commit -m "feat(trpc): expose detachAllFromOrchestrator"
```

---

## Task 5: Backend — `renameWorkspace` service + tRPC + test

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts`
- Create: `apps/desktop/tests/rename-workspace.test.ts`

> No workspace-rename surface exists today. The Rename… overflow item in Task 9 calls this procedure. V1 renames the **display name only** — it does not rename the underlying git branch or worktree directory (out of scope; can be added later as a second-tier action). The procedure validates the new name is non-empty and unique within the project.

- [ ] **Step 1: Write the failing test.** Create `apps/desktop/tests/rename-workspace.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { workspaces } from "../src/main/db/schema";
import { renameWorkspace } from "../src/main/services/workspace-service";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

describe("renameWorkspace", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("updates the display name", async () => {
		const p = await seedProject();
		const id = await seedWorkspace(p, { name: "old-name" });
		await renameWorkspace({ workspaceId: id, name: "new-name" });
		const row = getDb().select().from(workspaces).where(eq(workspaces.id, id)).get();
		expect(row?.name).toBe("new-name");
	});

	test("rejects empty name", async () => {
		const p = await seedProject();
		const id = await seedWorkspace(p, { name: "x" });
		await expect(renameWorkspace({ workspaceId: id, name: "   " })).rejects.toThrow(/empty/i);
	});

	test("rejects duplicate name within the same project", async () => {
		const p = await seedProject();
		await seedWorkspace(p, { name: "alpha" });
		const beta = await seedWorkspace(p, { name: "beta" });
		await expect(renameWorkspace({ workspaceId: beta, name: "alpha" })).rejects.toThrow(
			/already in use/i
		);
	});

	test("allows duplicate name across different projects", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		await seedWorkspace(p1, { name: "shared" });
		const id = await seedWorkspace(p2, { name: "other" });
		await expect(renameWorkspace({ workspaceId: id, name: "shared" })).resolves.toBeDefined();
	});
});
```

- [ ] **Step 2: Run test, confirm fail.**

```bash
cd apps/desktop && bun test tests/rename-workspace.test.ts
```

Expected: fail with `renameWorkspace is not exported`.

- [ ] **Step 3: Add `renameWorkspace` to `workspace-service.ts`.** Append at the end of the file (or alongside other named exports):

```ts
export async function renameWorkspace(input: {
	workspaceId: string;
	name: string;
}): Promise<{ ok: true }> {
	const trimmed = input.name.trim();
	if (trimmed.length === 0) {
		throw new Error("name cannot be empty");
	}
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new Error(`workspace ${input.workspaceId} not found`);

	const dup = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(
			and(
				eq(workspaces.projectId, ws.projectId),
				eq(workspaces.name, trimmed),
				ne(workspaces.id, input.workspaceId)
			)
		)
		.get();
	if (dup) throw new Error(`name "${trimmed}" already in use in this project`);

	db.update(workspaces)
		.set({ name: trimmed, updatedAt: new Date() })
		.where(eq(workspaces.id, input.workspaceId))
		.run();
	return { ok: true };
}
```

If `and` / `ne` are not already imported at the top of `workspace-service.ts`, add them to the existing `drizzle-orm` import line.

- [ ] **Step 4: Add the tRPC procedure.** In `workspaces.ts`, next to `setOrchestrator` (around line 332), insert:

```ts
	renameWorkspace: publicProcedure
		.input(z.object({ workspaceId: z.string().min(1), name: z.string() }))
		.mutation(async ({ input }) => {
			const { renameWorkspace } = await import("../../services/workspace-service");
			return renameWorkspace(input);
		}),
```

- [ ] **Step 5: Run test, confirm pass.**

```bash
cd apps/desktop && bun test tests/rename-workspace.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/src/main/trpc/routers/workspaces.ts apps/desktop/tests/rename-workspace.test.ts
git commit -m "feat(workspaces): rename workspace display name"
```

---

## Task 6: Backend — `createOrchestrator` service + tRPC + test

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts`
- Create: `apps/desktop/tests/create-orchestrator.test.ts`

> Composes the existing `createWorkspace`, `setOrchestrator`, and `attachToOrchestrator` flows. The git-side work (`createWorkspace`) is not inside a SQLite transaction — it cannot be, because it does filesystem work. If the post-create SQLite steps fail, the worktree on disk is left intact and an error surfaces; the user can manually clean up. This matches the existing failure mode of `workspaces.create`.

- [ ] **Step 1: Write the failing test.** Create `apps/desktop/tests/create-orchestrator.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { workspaces } from "../src/main/db/schema";
import { listMembership } from "../src/main/services/orchestrator-membership";
import { createOrchestrator } from "../src/main/services/workspace-service";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

describe("createOrchestrator", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("creates a workspace flagged as orchestrator", async () => {
		const p = await seedProject({ defaultBranch: "main" });
		const result = await createOrchestrator({
			projectId: p,
			name: "auth-orch",
			baseBranch: "main",
			attachWorkspaceIds: [],
		});
		const row = getDb().select().from(workspaces).where(eq(workspaces.id, result.id)).get();
		expect(row?.isOrchestrator).toBe(true);
		expect(row?.name).toBe("auth-orch");
	});

	test("attaches listed loose worktrees in order", async () => {
		const p = await seedProject({ defaultBranch: "main" });
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });

		const result = await createOrchestrator({
			projectId: p,
			name: "orch",
			baseBranch: "main",
			attachWorkspaceIds: [a, b],
		});

		const members = await listMembership({ orchestratorId: result.id });
		expect(members.map((m) => m.workspaceId)).toEqual([a, b]);
	});

	test("rejects attach of a workspace from another project", async () => {
		const p1 = await seedProject({ defaultBranch: "main" });
		const p2 = await seedProject({ defaultBranch: "main" });
		const foreign = await seedWorkspace(p2, { name: "foreign" });
		await expect(
			createOrchestrator({
				projectId: p1,
				name: "orch",
				baseBranch: "main",
				attachWorkspaceIds: [foreign],
			})
		).rejects.toThrow();
	});
});
```

> `seedProject({ defaultBranch })` — check `tests/helpers/db.ts` to confirm the helper accepts a default-branch arg. If it doesn't, extend the helper as part of this task (it's already a setup helper for these tests).

- [ ] **Step 2: Run test, confirm fail.**

```bash
cd apps/desktop && bun test tests/create-orchestrator.test.ts
```

Expected: fail on import (`createOrchestrator is not exported`).

- [ ] **Step 3: Implement in `workspace-service.ts`.** Append:

```ts
export async function createOrchestrator(input: {
	projectId: string;
	name: string;
	baseBranch: string;
	attachWorkspaceIds: string[];
}): Promise<{
	id: string;
	projectId: string;
	name: string;
	worktreeId: string;
	isOrchestrator: true;
}> {
	const created = await createWorkspace({
		projectId: input.projectId,
		branch: input.name,
		baseBranch: input.baseBranch,
	});

	// Mark as orchestrator. setOrchestrator validates the workspace exists and
	// belongs to the project — same guards as the standalone call path.
	await setOrchestrator(
		{ projectId: input.projectId, workspaceId: created.workspaceId },
		{ workspaceId: created.workspaceId }
	);

	const { attachToOrchestrator } = await import("./orchestrator-membership");
	for (const wsId of input.attachWorkspaceIds) {
		await attachToOrchestrator({
			orchestratorId: created.workspaceId,
			workspaceId: wsId,
		});
	}

	return {
		id: created.workspaceId,
		projectId: input.projectId,
		name: input.name,
		worktreeId: created.worktreeId,
		isOrchestrator: true,
	};
}
```

- [ ] **Step 4: Add the tRPC procedure.** Insert in `workspaces.ts` after `create: publicProcedure ...` block:

```ts
	createOrchestrator: publicProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				name: z.string().min(1),
				baseBranch: z.string().min(1),
				attachWorkspaceIds: z.array(z.string().min(1)).default([]),
			})
		)
		.mutation(async ({ input }) => {
			const { createOrchestrator } = await import("../../services/workspace-service");
			return createOrchestrator(input);
		}),
```

- [ ] **Step 5: Run test, confirm pass.**

```bash
cd apps/desktop && bun test tests/create-orchestrator.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/src/main/trpc/routers/workspaces.ts apps/desktop/tests/create-orchestrator.test.ts apps/desktop/tests/helpers/db.ts
git commit -m "feat(orchestrator): createOrchestrator composes create + flag + attach"
```

---

## Task 7: Renderer — `useProjectStore` modal state

**Files:**
- Modify: `apps/desktop/src/renderer/stores/projects.ts`

- [ ] **Step 1: Add the modal state and actions to the `ProjectStore` interface.** Find the existing `createWorktreeProjectId` field and the matching open/close action. Right below them, add:

```ts
	isCreateOrchestratorModalOpen: boolean;
	createOrchestratorProjectId: string | null;
	openCreateOrchestratorModal: (projectId: string) => void;
	closeCreateOrchestratorModal: () => void;
```

- [ ] **Step 2: Wire the initial state and the action implementations** inside the `create<ProjectStore>((set) => ({ ... }))` block. Add next to the existing `openCreateWorktreeModal` / `closeCreateWorktreeModal`:

```ts
	isCreateOrchestratorModalOpen: false,
	createOrchestratorProjectId: null,
	openCreateOrchestratorModal: (projectId) =>
		set({ isCreateOrchestratorModalOpen: true, createOrchestratorProjectId: projectId }),
	closeCreateOrchestratorModal: () =>
		set({ isCreateOrchestratorModalOpen: false, createOrchestratorProjectId: null }),
```

- [ ] **Step 3: Type check.**

```bash
bun run type-check
```

- [ ] **Step 4: Commit.**

```bash
git add apps/desktop/src/renderer/stores/projects.ts
git commit -m "feat(store): add openCreateOrchestratorModal action"
```

---

## Task 8: Renderer — `CreateOrchestratorModal` component

**Files:**
- Create: `apps/desktop/src/renderer/components/CreateOrchestratorModal.tsx`

- [ ] **Step 1: Read `CreateWorktreeModal.tsx` end-to-end.** This new modal mirrors its modal shell, base-branch dropdown, and submit error handling. The only differences: (a) no `mode` toggle (orchestrators are always "new branch"), and (b) it has an `Attach existing worktrees` checkbox list.

- [ ] **Step 2: Create the file.** Paste the full component:

```tsx
import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export function CreateOrchestratorModal() {
	const {
		isCreateOrchestratorModalOpen,
		createOrchestratorProjectId,
		closeCreateOrchestratorModal,
	} = useProjectStore();

	const projectId = createOrchestratorProjectId ?? "";

	const [name, setName] = useState("");
	const [baseBranch, setBaseBranch] = useState("");
	const [attachIds, setAttachIds] = useState<Set<string>>(new Set());
	const [attachSectionOpen, setAttachSectionOpen] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const baseBranchInitialized = useRef(false);
	const utils = trpc.useUtils();

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: projectId },
		{ enabled: isCreateOrchestratorModalOpen && projectId !== "" }
	);

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId },
		{ enabled: isCreateOrchestratorModalOpen && projectId !== "" }
	);

	const treeQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId },
		{ enabled: isCreateOrchestratorModalOpen && projectId !== "" }
	);

	const looseWorkspaces = treeQuery.data?.loose ?? [];

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	useEffect(() => {
		if (!isCreateOrchestratorModalOpen) {
			// Reset form when the modal closes.
			setName("");
			setBaseBranch("");
			setAttachIds(new Set());
			setAttachSectionOpen(false);
			setErrorMsg(null);
			baseBranchInitialized.current = false;
		}
	}, [isCreateOrchestratorModalOpen]);

	useEffect(() => {
		if (projectQuery.data && !baseBranchInitialized.current) {
			baseBranchInitialized.current = true;
			setBaseBranch(projectQuery.data.defaultBranch);
		}
	}, [projectQuery.data]);

	useEffect(() => {
		// Default the attach section to expanded when there are loose worktrees.
		if (looseWorkspaces.length > 0) setAttachSectionOpen(true);
	}, [looseWorkspaces.length]);

	const createMutation = trpc.workspaces.createOrchestrator.useMutation({
		onSuccess: (workspace) => {
			utils.workspaces.listByProject.invalidate({ projectId });
			const repoPath = projectQuery.data?.repoPath;
			const projectName = projectQuery.data?.name ?? "Project";
			if (repoPath) {
				const normalizedPath = repoPath.replace(/\/+$/, "");
				const cwd = `${normalizedPath}-worktrees/${workspace.name}`;
				const title = `${projectName}: ${workspace.name}`;
				const store = useTabStore.getState();
				store.setActiveWorkspace(workspace.id, cwd);
				const tabId = store.addTerminalTab(workspace.id, cwd, title);
				attachTerminal.mutate({ workspaceId: workspace.id, terminalId: tabId });
			}
			closeCreateOrchestratorModal();
		},
		onError: (err) => setErrorMsg(err.message),
	});

	if (!isCreateOrchestratorModalOpen) return null;

	const canSubmit = name.trim().length > 0 && baseBranch.trim().length > 0;

	function toggleAttach(id: string) {
		setAttachIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function handleSubmit() {
		setErrorMsg(null);
		createMutation.mutate({
			projectId,
			name: name.trim(),
			baseBranch: baseBranch.trim(),
			attachWorkspaceIds: Array.from(attachIds),
		});
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-[440px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-md)]">
				<h2 className="mb-3 text-[14px] font-medium text-[var(--text)]">
					New orchestrator
				</h2>

				<label className="block text-[12px] text-[var(--text-secondary)]">
					Name
					<input
						className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[13px] text-[var(--text)]"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="auth-orch"
						autoFocus
					/>
				</label>

				<label className="mt-3 block text-[12px] text-[var(--text-secondary)]">
					Base branch
					<input
						className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[13px] text-[var(--text)]"
						value={baseBranch}
						onChange={(e) => setBaseBranch(e.target.value)}
						list="orchestrator-base-branch-list"
					/>
					<datalist id="orchestrator-base-branch-list">
						{(branchesQuery.data ?? []).map((b) => (
							<option key={b.name} value={b.name} />
						))}
					</datalist>
				</label>

				<div className="mt-3">
					<button
						type="button"
						onClick={() => setAttachSectionOpen((v) => !v)}
						className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)]"
					>
						<span>{attachSectionOpen ? "▾" : "▸"}</span>
						<span>Attach existing worktrees (optional)</span>
					</button>
					{attachSectionOpen && (
						<div className="mt-2 max-h-[160px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
							{looseWorkspaces.length === 0 && (
								<div className="text-[11px] text-[var(--text-tertiary)]">
									No loose worktrees available.
								</div>
							)}
							{looseWorkspaces.map((w) => (
								<label
									key={w.id}
									className="flex items-center gap-2 py-[3px] text-[13px] text-[var(--text)]"
								>
									<input
										type="checkbox"
										checked={attachIds.has(w.id)}
										onChange={() => toggleAttach(w.id)}
									/>
									<span className="truncate">{w.name}</span>
								</label>
							))}
						</div>
					)}
				</div>

				{errorMsg && (
					<div className="mt-3 text-[12px] text-[var(--term-red)]">{errorMsg}</div>
				)}

				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={closeCreateOrchestratorModal}
						className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-3 py-1 text-[13px] text-[var(--text-secondary)]"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={!canSubmit || createMutation.isPending}
						onClick={handleSubmit}
						className="rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[13px] text-[var(--bg-base)] disabled:opacity-50"
					>
						{createMutation.isPending ? "Creating…" : "Create"}
					</button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Type check.**

```bash
bun run type-check
```

Expected: no errors. If `trpc.workspaces.createOrchestrator` is unknown, double-check Task 6 procedure is on the router.

- [ ] **Step 4: Manual sanity check.** The modal is not yet wired into the UI — it'll be wired in Task 11. Skip runtime test for now.

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/renderer/components/CreateOrchestratorModal.tsx
git commit -m "feat(renderer): CreateOrchestratorModal with attach-existing section"
```

---

## Task 9: Renderer — `OrchestratorRow` glyph + tooltips

**Files:**
- Modify: `apps/desktop/src/renderer/components/OrchestratorRow.tsx`

- [ ] **Step 1: Replace the 8×8 colored swatch with a 12×12 SVG network glyph.** Find the existing `<span>` swatch:

```tsx
				<span
					aria-hidden="true"
					className="h-[8px] w-[8px] rounded-[2px] shrink-0"
					style={{ background: swatchVar }}
				/>
```

Replace with an inline SVG:

```tsx
				<svg
					role="img"
					aria-label="Orchestrator"
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					className="shrink-0"
				>
					<title>Orchestrator</title>
					<circle cx="6" cy="2.5" r="1.4" stroke={swatchVar} strokeWidth="1.2" />
					<circle cx="2.5" cy="9.5" r="1.4" stroke={swatchVar} strokeWidth="1.2" />
					<circle cx="9.5" cy="9.5" r="1.4" stroke={swatchVar} strokeWidth="1.2" />
					<path
						d="M6 4 L3 8 M6 4 L9 8"
						stroke={swatchVar}
						strokeWidth="1.2"
						strokeLinecap="round"
					/>
				</svg>
```

- [ ] **Step 2: Add a tooltip to the count pill.** Find the existing pill `<span>`:

```tsx
				<span
					className="text-[10px] font-medium px-[7px] py-[1px] rounded-[9px] min-w-[16px] text-center"
					style={{ background: pillBg, color: pillFg }}
				>
					{childCount}
				</span>
```

Add a `title` attribute on the pill, and pluralize:

```tsx
				<span
					className="text-[10px] font-medium px-[7px] py-[1px] rounded-[9px] min-w-[16px] text-center"
					style={{ background: pillBg, color: pillFg }}
					title={`${childCount} ${childCount === 1 ? "worktree" : "worktrees"} attached`}
				>
					{childCount}
				</span>
```

- [ ] **Step 3: Manual sanity check.** From repo root, start dev:

```bash
bun run dev
```

Expand a project with at least one orchestrator. Confirm:
- 12px network glyph renders in the orchestrator's color (not the old square dot).
- Hovering the glyph shows tooltip "Orchestrator".
- Hovering the count pill shows tooltip "N worktree(s) attached".
- The chevron and overflow area on the right are unchanged.

Stop dev with `Ctrl-C`.

- [ ] **Step 4: Commit.**

```bash
git add apps/desktop/src/renderer/components/OrchestratorRow.tsx
git commit -m "feat(OrchestratorRow): network glyph + count pill tooltip"
```

---

## Task 10: Renderer — `OrchestratorRow` overflow `⋮` menu

**Files:**
- Modify: `apps/desktop/src/renderer/components/OrchestratorRow.tsx`
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx` (passes new callbacks down)

> The existing `OrchestratorContextMenu` only renders `Unset orchestrator`. Extend it with `Rename…` and `Detach all worktrees`. Add a visible `⋮` button (hover-revealed) that opens the same menu. Right-click already opens it — keep that path too.

- [ ] **Step 1: Extend `OrchestratorRowProps`.** Add three optional callbacks:

```ts
interface OrchestratorRowProps {
	workspace: { id: string; name: string };
	colorIndex: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
	childCount: number;
	expanded: boolean;
	onToggle: () => void;
	onActivate: () => void;
	activeChildName?: string;
	onUnsetOrchestrator?: () => void;
	onRename?: () => void;
	onDetachAll?: () => void;
	isDropTargetCandidate?: boolean; // wired in Task 17, declared here to avoid double-edit
}
```

- [ ] **Step 2: Extend `OrchestratorContextMenu` to render the two new items.** Find the component definition and update its props:

```tsx
function OrchestratorContextMenu({
	position,
	onClose,
	onUnsetOrchestrator,
	onRename,
	onDetachAll,
	canDetachAll,
}: {
	position: { x: number; y: number };
	onClose: () => void;
	onUnsetOrchestrator: () => void;
	onRename?: () => void;
	onDetachAll?: () => void;
	canDetachAll: boolean;
}) {
```

Inside the return block, above the existing `Unset orchestrator` item, add the new items:

```tsx
			{onRename && (
				<div
					role="menuitem"
					tabIndex={0}
					className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
					onClick={onRename}
					onKeyDown={(e) => {
						if (e.key === "Enter") onRename();
					}}
				>
					Rename…
				</div>
			)}
			{onDetachAll && canDetachAll && (
				<div
					role="menuitem"
					tabIndex={0}
					className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
					onClick={onDetachAll}
					onKeyDown={(e) => {
						if (e.key === "Enter") onDetachAll();
					}}
				>
					Detach all worktrees
				</div>
			)}
```

- [ ] **Step 3: Add the overflow `⋮` button to `OrchestratorRow`.** Insert immediately before the existing chevron button:

```tsx
			<button
				type="button"
				aria-label="Orchestrator options"
				aria-haspopup="menu"
				aria-expanded={contextMenu !== null}
				onClick={(e) => {
					e.stopPropagation();
					const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
					setContextMenu({ x: rect.right, y: rect.bottom });
				}}
				className="flex shrink-0 items-center justify-center px-1 py-[7px] bg-transparent border-none cursor-pointer rounded-[6px] hover:bg-[var(--bg-overlay)] opacity-0 group-hover:opacity-100 focus:opacity-100"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" className="text-[var(--text-quaternary)]">
					<circle cx="6" cy="2" r="1.1" />
					<circle cx="6" cy="6" r="1.1" />
					<circle cx="6" cy="10" r="1.1" />
				</svg>
			</button>
```

- [ ] **Step 4: Add the `group` class to the row container so the `group-hover:` selector works.** Find the outer `<div>` of the row that has classes like `relative flex items-center w-full rounded-[6px] transition-colors duration-[120ms]` and add `group` to the class list:

```tsx
		<div
			className={[
				"group relative flex items-center w-full rounded-[6px] transition-colors duration-[120ms]",
				isAccented ? "bg-[var(--accent-subtle)]" : "bg-transparent hover:bg-[var(--bg-elevated)]",
			].join(" ")}
```

- [ ] **Step 5: Pass the new callbacks when rendering `OrchestratorContextMenu`.** Find the existing render block:

```tsx
			{contextMenu && onUnsetOrchestrator && (
				<OrchestratorContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onUnsetOrchestrator={() => {
						onUnsetOrchestrator();
						setContextMenu(null);
					}}
				/>
			)}
```

Replace with:

```tsx
			{contextMenu && onUnsetOrchestrator && (
				<OrchestratorContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onUnsetOrchestrator={() => {
						onUnsetOrchestrator();
						setContextMenu(null);
					}}
					onRename={
						onRename
							? () => {
								onRename();
								setContextMenu(null);
							}
							: undefined
					}
					onDetachAll={
						onDetachAll
							? () => {
								onDetachAll();
								setContextMenu(null);
							}
							: undefined
					}
					canDetachAll={childCount > 0}
				/>
			)}
```

- [ ] **Step 6: Wire callbacks from `ProjectItem.tsx`.** In `OrchestratorGroupBlock`, alongside the existing `unsetOrchestratorMut`, add:

```tsx
	const renameMut = trpc.workspaces.renameWorkspace.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId }),
	});

	const detachAllMut = trpc.workspaces.detachAllFromOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId }),
	});

	const handleRename = useCallback(() => {
		const next = window.prompt("Rename orchestrator", node.workspace.name);
		if (next === null) return;
		const trimmed = next.trim();
		if (trimmed.length === 0 || trimmed === node.workspace.name) return;
		renameMut.mutate({ workspaceId: node.workspace.id, name: trimmed });
	}, [node.workspace.id, node.workspace.name, renameMut]);

	const handleDetachAll = useCallback(() => {
		detachAllMut.mutate({ orchestratorId: node.workspace.id });
	}, [node.workspace.id, detachAllMut]);
```

And pass these into `<OrchestratorRow ... onRename={handleRename} onDetachAll={handleDetachAll} />`.

- [ ] **Step 7: Manual sanity check.** Start dev. Hover an orchestrator row — the `⋮` button appears at the right of the count pill. Click it: menu appears with `Rename…`, `Detach all worktrees`, `Unset orchestrator`. `Rename…` prompts via `window.prompt`. `Detach all` empties the group. Right-click on the row still opens the same menu.

- [ ] **Step 8: Commit.**

```bash
git add apps/desktop/src/renderer/components/OrchestratorRow.tsx apps/desktop/src/renderer/components/ProjectItem.tsx
git commit -m "feat(OrchestratorRow): overflow menu with rename and detach-all"
```

---

## Task 11: Renderer — `+W`/`+O` twin buttons + mount modal

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx`
- Modify: `apps/desktop/src/renderer/components/CreateWorktreeModal.tsx` and project root render entry (verify modal is already mounted globally; if not, also mount `CreateOrchestratorModal` next to it)

- [ ] **Step 1: Find the existing `rightContent` slot in `ProjectItem.tsx`.** It currently renders one `<button>` with `+`. Replace with two buttons inside a tight flex:

```tsx
			rightContent={
				isReady ? (
					<div className="flex items-center gap-0.5">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								openCreateWorktreeModal(project.id);
							}}
							className={[
								"flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded font-mono text-[11px]",
								"transition-colors duration-[120ms]",
								isActiveProject
									? "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
									: "text-[#3a3a42] hover:text-[#505058]",
							].join(" ")}
							title="New Worktree"
						>
							+W
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								openCreateOrchestratorModal(project.id);
							}}
							className={[
								"flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded font-mono text-[11px]",
								"transition-colors duration-[120ms]",
								isActiveProject
									? "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
									: "text-[#3a3a42] hover:text-[#505058]",
							].join(" ")}
							title="New Orchestrator"
						>
							+O
						</button>
					</div>
				) : undefined
			}
```

- [ ] **Step 2: Pull `openCreateOrchestratorModal` from the store at the top of `ProjectItem`.** Find the existing line:

```tsx
	const openCreateWorktreeModal = useProjectStore((s) => s.openCreateWorktreeModal);
```

Append:

```tsx
	const openCreateOrchestratorModal = useProjectStore((s) => s.openCreateOrchestratorModal);
```

- [ ] **Step 3: Mount `CreateOrchestratorModal` once at the app root.** Locate where `CreateWorktreeModal` is rendered (likely `src/renderer/App.tsx` or similar — grep `<CreateWorktreeModal`). Add `<CreateOrchestratorModal />` adjacent to it.

```bash
grep -rn "CreateWorktreeModal" apps/desktop/src/renderer --include="*.tsx" | head
```

Modify that file to import and render the new modal alongside the existing one.

- [ ] **Step 4: Manual sanity check.** Start dev. Confirm `+W` and `+O` both show on each ready project. `+O` opens the new modal. Submit with empty name disabled. Submit with name + no attach: creates an orchestrator. Submit with checked loose worktrees: attaches them.

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/renderer/components/ProjectItem.tsx apps/desktop/src/renderer/App.tsx
git commit -m "feat(sidebar): +W/+O twin buttons, mount CreateOrchestratorModal"
```

> If `CreateWorktreeModal` is mounted from a different file, substitute that path in the `git add`.

---

## Task 12: Renderer — `WorkspaceItem` hover promote `↥` button

**Files:**
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx`

- [ ] **Step 1: Find where `WorkspaceItem`'s outer button is rendered (around line 411).** The row needs `group` on its container `<div className="relative">` so a hover affordance can opacity-toggle.

Change:

```tsx
		<div className="relative">
```

to:

```tsx
		<div className="group relative">
```

- [ ] **Step 2: Render the `↥` button absolutely-positioned at the right of the row, gated on `indentLevel === 0 && !workspace.isOrchestrator`.** Insert immediately after the closing `</button>` of the row but before the context-menu render:

```tsx
			{indentLevel === 0 && !workspace.isOrchestrator && workspace.type === "worktree" && (
				<button
					type="button"
					aria-label="Promote to orchestrator"
					title="Promote to orchestrator"
					onClick={(e) => {
						e.stopPropagation();
						handleSetOrchestrator();
					}}
					className="absolute right-7 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-[14px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-55 focus:opacity-100 transition-opacity duration-[120ms]"
				>
					↥
				</button>
			)}
```

> The `right-7` (28px) keeps clear of the existing right-edge controls; verify visually in Step 3 and adjust to the exact pixel value if you see overlap.

- [ ] **Step 3: Manual sanity check.** Start dev. Hover a loose worktree — `↥` appears. Click — workspace becomes an orchestrator (it moves into the orchestrator zone). Children of an existing orchestrator do not show `↥`.

- [ ] **Step 4: Commit.**

```bash
git add apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat(WorkspaceItem): hover promote-to-orchestrator button"
```

---

## Task 13: Renderer — `WorkspaceItem` context menu: `Attach to ▸` + `Detach`

**Files:**
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx`

> The context menu today renders `Set as orchestrator` / `Unset orchestrator` / `Delete Worktree`. Insert `Attach to…` (for loose worktrees with at least one orchestrator in the project) and `Detach from orchestrator` (for children). The submenu is a flat list of orchestrators in the project, each row shows the network glyph in that orchestrator's color and the orchestrator name. Falls back to a single "Create one →" item when the project has no orchestrators.

- [ ] **Step 1: Pass the orchestrator list down to the menu.** In `WorkspaceItem`, fetch the tree (a stale-tolerant read is enough — when the menu opens, the cache is fresh because `ProjectItem` already drives the query):

```tsx
	const treeQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId },
		{ staleTime: 60_000 }
	);
	const orchestratorsInProject = (treeQuery.data?.orchestrators ?? []).map((o) => ({
		id: o.workspace.id,
		name: o.workspace.name,
	}));
```

- [ ] **Step 2: Add `attachToOrchestrator` and `detachFromOrchestrator` mutations.** Alongside the existing mutations:

```tsx
	const attachMut = trpc.workspaces.attachToOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId }),
	});
	const detachMut = trpc.workspaces.detachFromOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId }),
	});
```

- [ ] **Step 3: Compute current parent (used to gate the `Detach` item).**

```tsx
	const isChildOfOrchestrator = (treeQuery.data?.orchestrators ?? []).some((o) =>
		o.children.some((c) => c.id === workspace.id)
	);
```

- [ ] **Step 4: Extend the `WorkspaceContextMenu` props.** Find the props interface and add:

```ts
	orchestrators: Array<{ id: string; name: string }>;
	onAttachTo?: (orchestratorId: string) => void;
	onDetach?: () => void;
	onCreateOrchestrator?: () => void;
	canAttach: boolean;
	canDetach: boolean;
```

- [ ] **Step 5: Render the submenu inside the menu.** Below the existing `Set as orchestrator` item and above `Delete Worktree`, insert:

```tsx
			{canAttach && (
				<div className="relative" onMouseEnter={() => setAttachOpen(true)} onMouseLeave={() => setAttachOpen(false)}>
					<div
						role="menuitem"
						tabIndex={0}
						className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)] flex items-center justify-between"
					>
						<span>Attach to</span>
						<span className="text-[var(--text-quaternary)]">▸</span>
					</div>
					{attachOpen && (
						<div className="absolute left-full top-0 ml-1 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]">
							{orchestrators.length === 0 && (
								<div
									role="menuitem"
									tabIndex={0}
									className="px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[var(--bg-overlay)] text-[var(--text-tertiary)]"
									onClick={onCreateOrchestrator}
								>
									No orchestrators in this project. Create one →
								</div>
							)}
							{orchestrators.map((o) => (
								<div
									key={o.id}
									role="menuitem"
									tabIndex={0}
									className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] text-[var(--text)]"
									onClick={() => onAttachTo?.(o.id)}
								>
									{o.name}
								</div>
							))}
						</div>
					)}
				</div>
			)}
			{canDetach && onDetach && (
				<div
					role="menuitem"
					tabIndex={0}
					className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
					onClick={onDetach}
				>
					Detach from orchestrator
				</div>
			)}
```

Also add `const [attachOpen, setAttachOpen] = useState(false);` at the top of `WorkspaceContextMenu`.

- [ ] **Step 6: Wire the props at the `WorkspaceContextMenu` call site.** In the existing render:

```tsx
				orchestrators={orchestratorsInProject}
				onAttachTo={(orchId) => {
					attachMut.mutate({ orchestratorId: orchId, workspaceId: workspace.id });
					setContextMenu(null);
				}}
				onDetach={() => {
					detachMut.mutate({ workspaceId: workspace.id });
					setContextMenu(null);
				}}
				onCreateOrchestrator={() => {
					useProjectStore.getState().openCreateOrchestratorModal(projectId);
					setContextMenu(null);
				}}
				canAttach={!workspace.isOrchestrator && indentLevel === 0}
				canDetach={isChildOfOrchestrator}
```

- [ ] **Step 7: Manual sanity check.** Start dev. Right-click a loose worktree → `Attach to ▸` shows; hovering it lists orchestrators in this project; click one → row moves under that orchestrator. Right-click a child → `Detach from orchestrator` appears; click → row moves to the loose zone. Right-click a loose worktree in a project with zero orchestrators → submenu shows `Create one →` which opens `CreateOrchestratorModal`.

- [ ] **Step 8: Commit.**

```bash
git add apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat(WorkspaceItem): attach/detach context-menu items + submenu"
```

---

## Task 14: Renderer — Keyboard shortcuts ⌘⇧A / ⌘⇧D

**Files:**
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx`

> The simplest path is a `keydown` handler on the workspace row itself — it's already a focusable `<button>`. ⌘⇧A on a loose worktree opens the same submenu programmatically (positioned at the row); ⌘⇧D on a child fires detach.

- [ ] **Step 1: Add a `keydown` handler to the row's outer `<button>`.** Find the existing `onClick={handleClick}` and add:

```tsx
					onKeyDown={(e) => {
						const mod = e.metaKey || e.ctrlKey;
						if (mod && e.shiftKey && (e.key === "a" || e.key === "A")) {
							e.preventDefault();
							if (!workspace.isOrchestrator && indentLevel === 0) {
								const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
								setContextMenu({ x: rect.right - 200, y: rect.bottom });
							}
						}
						if (mod && e.shiftKey && (e.key === "d" || e.key === "D")) {
							e.preventDefault();
							if (isChildOfOrchestrator) {
								detachMut.mutate({ workspaceId: workspace.id });
							}
						}
					}}
```

- [ ] **Step 2: Manual sanity check.** Focus a loose worktree (Tab through the sidebar or click once) → ⌘⇧A opens the context menu with the `Attach to ▸` submenu visible. Focus a child → ⌘⇧D detaches it without confirmation.

- [ ] **Step 3: Commit.**

```bash
git add apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat(WorkspaceItem): keyboard shortcuts for attach/detach"
```

---

## Task 15: Renderer — Visible drag grip on `SortableWorkspace`

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx`

- [ ] **Step 1: Add a visible `⋮⋮` grip inside `SortableWorkspace`.** Find the existing `SortableWorkspace` component at the top of the file. Update it to render the grip as a positioned overlay over the row:

```tsx
function SortableWorkspace({
	id,
	children,
}: {
	id: string;
	children: ReactNode;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
	});
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
			className="group/sortable relative"
		>
			<span
				aria-hidden="true"
				className="absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-quaternary)] opacity-0 group-hover/sortable:opacity-55 transition-opacity duration-[120ms] select-none"
			>
				⋮⋮
			</span>
			{children}
		</div>
	);
}
```

> The grip is `pointer-events-none` because `@dnd-kit`'s pointer sensor listens on the wrapper `<div>` (which has `{...listeners}` spread). The grip is purely a visual cue; clicking and dragging the row works as before.

- [ ] **Step 2: Manual sanity check.** Hover any sortable row (orchestrator, child, loose) — the `⋮⋮` glyph appears at `left: 4px`. Drag works exactly as before.

- [ ] **Step 3: Commit.**

```bash
git add apps/desktop/src/renderer/components/ProjectItem.tsx
git commit -m "feat(sidebar): visible drag grip on hover"
```

---

## Task 16: Renderer — Drop-zone affordances during drag (dashed ring + loose label)

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx`
- Modify: `apps/desktop/src/renderer/components/OrchestratorRow.tsx`

> When a drag is active, every orchestrator row gets a 1px dashed inset ring in its color, and an inline "Loose worktrees — drop here to detach" label appears between the orchestrator zone and the loose zone when the dragged item is a child.

- [ ] **Step 1: Track drag state in `ProjectItem`.** Add at the top of the component:

```tsx
	const [draggingId, setDraggingId] = useState<string | null>(null);
```

Update `<DndContext>`:

```tsx
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragStart={(e) => setDraggingId(String(e.active.id))}
					onDragEnd={(e) => {
						setDraggingId(null);
						onDragEnd(e);
					}}
					onDragCancel={() => setDraggingId(null)}
				>
```

- [ ] **Step 2: Compute helpers.** Inside the component, derive:

```tsx
	const draggedIsChild =
		draggingId !== null &&
		orchestrators.some((o) => o.children.some((c) => c.id === draggingId));

	const draggedIsLoose = draggingId !== null && loose.some((w) => w.id === draggingId);
```

- [ ] **Step 3: Apply `isDropTargetCandidate` to every `OrchestratorRow`.** In `OrchestratorGroupBlock`, accept a new prop `isDropTargetCandidate?: boolean` and pass it through to `<OrchestratorRow ... isDropTargetCandidate={...} />`. From the parent in `ProjectItem`, pass `isDropTargetCandidate={draggingId !== null && draggingId !== node.workspace.id}`.

- [ ] **Step 4: In `OrchestratorRow`, render the dashed ring.** Update the outer `<div>`'s class composition:

```tsx
		<div
			className={[
				"group relative flex items-center w-full rounded-[6px] transition-colors duration-[120ms]",
				isAccented ? "bg-[var(--accent-subtle)]" : "bg-transparent hover:bg-[var(--bg-elevated)]",
				isDropTargetCandidate ? "ring-1 ring-dashed" : "",
			].join(" ")}
			style={
				isDropTargetCandidate
					? { boxShadow: `inset 0 0 0 1px ${swatchVar}`, ...{} }
					: undefined
			}
```

> Tailwind has no `ring-dashed`. The inline `boxShadow` simulates a 1px inset; if you want the dashed appearance, swap to `outlineStyle: "dashed", outlineWidth: 1, outlineOffset: -1, outlineColor: swatchVar`. Pick whichever lands cleaner visually during manual QA.

- [ ] **Step 5: Render the "Loose worktrees" label** between the orchestrator zone and the loose zone, only while a child is being dragged. Find the second `<SortableContext>` (the loose one). Immediately before it, insert:

```tsx
						{draggedIsChild && (
							<div className="px-[22px] py-1 text-[10px] text-[var(--text-quaternary)]">
								Loose worktrees — drop here to detach
							</div>
						)}
```

- [ ] **Step 6: Manual sanity check.** Drag a loose worktree — every orchestrator row shows a 1px dashed/inset ring in its own color. Drag a child — additionally the "Loose worktrees — drop here to detach" label appears between zones; dropping onto the loose zone fires detach. Drop the dragged element anywhere valid — rings/labels disappear.

- [ ] **Step 7: Commit.**

```bash
git add apps/desktop/src/renderer/components/ProjectItem.tsx apps/desktop/src/renderer/components/OrchestratorRow.tsx
git commit -m "feat(sidebar): drop-zone rings + loose-zone drop label during drag"
```

---

## Task 17: Renderer — First-drag coachmark

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx`

> The coachmark renders once per machine. State persists via `getOrchestratorExpand` / `setOrchestratorExpand` keyed by `orchDragCoachmark:dismissed`. It dismisses on first successful drag end OR when the user clicks the dismiss button.

- [ ] **Step 1: Add a query + mutation for the dismiss flag.** In `ProjectItem`:

```tsx
	const coachmarkKey = "orchDragCoachmark:dismissed";
	const coachmarkQuery = trpc.workspaces.getOrchestratorExpand.useQuery(
		{ key: coachmarkKey },
		{ staleTime: Number.POSITIVE_INFINITY }
	);
	const dismissCoachmark = trpc.workspaces.setOrchestratorExpand.useMutation({
		onSuccess: (_d, vars) => {
			utils.workspaces.getOrchestratorExpand.setData({ key: vars.key }, vars.value);
		},
	});
	const coachmarkDismissed = coachmarkQuery.data === true;
	const [coachmarkAnchor, setCoachmarkAnchor] = useState<{ x: number; y: number } | null>(null);
```

> The existing procedure's reader uses `row.value === "1"` and defaults to `true` (meaning "expanded"). For this flag, default-true is the wrong default — we want it to show on first run. Compensate inline: treat `coachmarkQuery.data === true` as dismissed, `false` as undismissed, `undefined` as undismissed. Since the procedure returns `true` when the row is absent, we **invert the meaning** for this key: set the row to value `"0"` when dismissed and treat anything else as not-yet-dismissed.

Adjust accordingly:

```tsx
	const coachmarkDismissed = coachmarkQuery.data === false;
```

And the dismiss call writes `value: false`:

```tsx
	function handleDismissCoachmark() {
		dismissCoachmark.mutate({ key: coachmarkKey, value: false });
		setCoachmarkAnchor(null);
	}
```

- [ ] **Step 2: On first grip hover, position the coachmark.** Add to `SortableWorkspace` a hover handler that, the first time a grip is hovered in this session and the flag is not dismissed, sets `coachmarkAnchor` to the grip's coordinates. Since `SortableWorkspace` is defined inside `ProjectItem.tsx`, pass `onGripHover?: (rect: DOMRect) => void` as a prop and hook it up.

Inside `SortableWorkspace`, add to the grip `<span>`:

```tsx
			<span
				ref={(el) => {
					if (el && onGripHover) {
						el.addEventListener("mouseenter", () => onGripHover(el.getBoundingClientRect()), { once: true });
					}
				}}
				…rest…
			>⋮⋮</span>
```

And replace `aria-hidden="true"` `pointer-events-none` with `pointer-events-auto` for the hover handler to receive events; keep the listeners untouched on the wrapper.

> Alternative cleaner pattern: lift the "first-grip-hover" detection into `ProjectItem` via `onMouseEnter` on the wrapper `<div>` of each `SortableWorkspace`. If the inline solution above gets ugly, that's fine too.

- [ ] **Step 3: Render the coachmark popover** in `ProjectItem`:

```tsx
			{!coachmarkDismissed && coachmarkAnchor && (
				<div
					role="status"
					className="fixed z-50 max-w-[220px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[11px] text-[var(--text-secondary)] shadow-[var(--shadow-md)]"
					style={{ left: coachmarkAnchor.x + 16, top: coachmarkAnchor.y }}
					onKeyDown={(e) => {
						if (e.key === "Escape") handleDismissCoachmark();
					}}
				>
					<div className="leading-snug">
						Drag to reorder, or onto an orchestrator row to attach.
					</div>
					<button
						type="button"
						className="mt-2 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
						onClick={handleDismissCoachmark}
					>
						Got it
					</button>
				</div>
			)}
```

- [ ] **Step 4: Auto-dismiss on first drag end.** In the `<DndContext>` `onDragEnd` handler, after the existing `onDragEnd(e)` call:

```tsx
					if (!coachmarkDismissed) {
						dismissCoachmark.mutate({ key: coachmarkKey, value: false });
					}
```

- [ ] **Step 5: Manual sanity check.**

In a fresh DB (or with the `orchDragCoachmark:dismissed` row removed):
- Hover a grip — coachmark appears.
- Click "Got it" — coachmark disappears, never returns.
- Reload the app — coachmark stays dismissed.

In another fresh DB:
- Hover a grip — coachmark appears.
- Start and complete any drag — coachmark disappears and is recorded as dismissed.

- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/src/renderer/components/ProjectItem.tsx
git commit -m "feat(sidebar): first-drag coachmark with one-time dismissal"
```

---

## Task 18: Renderer — `OrchestratorGroup` zero-child empty state

**Files:**
- Modify: `apps/desktop/src/renderer/components/OrchestratorGroup.tsx`

- [ ] **Step 1: Render a placeholder when there are zero children.** Update the component to inspect its children list. `OrchestratorGroup` currently takes `children` as React children — switch the call site in `ProjectItem.tsx` to pass an explicit `childCount` prop, or count children inside the group via `React.Children.count(children)`.

Open `OrchestratorGroup.tsx` and find the current return. Add:

```tsx
			{React.Children.count(children) === 0 && (
				<div className="pl-[36px] py-2">
					<div className="text-[11px] text-[var(--text-tertiary)] leading-snug">
						No worktrees attached.
					</div>
					<div className="text-[11px] text-[var(--text-quaternary)] leading-snug">
						Drag a worktree here, or use Attach… from a worktree's context menu.
					</div>
				</div>
			)}
```

Make sure `import React from "react"` (or `import { Children } from "react"`) is present at the top.

- [ ] **Step 2: Manual sanity check.** Use `Detach all worktrees` on an orchestrator (Task 10). The expanded group should show the two-line empty-state message indented under the rail. Attach one worktree — message disappears.

- [ ] **Step 3: Commit.**

```bash
git add apps/desktop/src/renderer/components/OrchestratorGroup.tsx
git commit -m "feat(OrchestratorGroup): zero-child empty-state placeholder"
```

---

## Task 19: Renderer — Onboarding tip for projects with no orchestrator

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx`

- [ ] **Step 1: Add tip-dismiss state, mirroring the coachmark pattern.** At the top of `ProjectItem`:

```tsx
	const tipKey = "orchTip:dismissed";
	const tipQuery = trpc.workspaces.getOrchestratorExpand.useQuery(
		{ key: tipKey },
		{ staleTime: Number.POSITIVE_INFINITY }
	);
	const dismissTip = trpc.workspaces.setOrchestratorExpand.useMutation({
		onSuccess: (_d, vars) => {
			utils.workspaces.getOrchestratorExpand.setData({ key: vars.key }, vars.value);
		},
	});
	const tipDismissed = tipQuery.data === false; // same inverted convention as coachmark
```

- [ ] **Step 2: Auto-suppress when any project on this machine has at least one orchestrator.** Use a coarse heuristic: the tree query already gives us `orchestrators` for this project. To check across projects without a heavy global query, suppress the tip only when (a) the current project has at least one orchestrator OR (b) the user dismissed it. This is approximate but acceptable for V1 — refine to a global check later if needed:

```tsx
	const shouldShowTip = isReady && !tipDismissed && orchestrators.length === 0;
```

- [ ] **Step 3: Render the tip below the loose zone.** Inside `<RepoGroup>` children, after the second `<SortableContext>`:

```tsx
						{shouldShowTip && (
							<div className="mt-1 flex items-start gap-2 border-t border-[var(--border-subtle)] px-3 py-3">
								<svg
									role="img"
									aria-label=""
									width="12"
									height="12"
									viewBox="0 0 12 12"
									fill="none"
									className="mt-[2px] shrink-0 text-[var(--text-tertiary)]"
								>
									<circle cx="6" cy="2.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
									<circle cx="2.5" cy="9.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
									<circle cx="9.5" cy="9.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
									<path d="M6 4 L3 8 M6 4 L9 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
								</svg>
								<button
									type="button"
									className="flex-1 text-left text-[11px] text-[var(--text-secondary)] leading-snug"
									onClick={() => openCreateOrchestratorModal(project.id)}
								>
									Orchestrators coordinate multiple agents. Create one →
								</button>
								<button
									type="button"
									aria-label="Dismiss tip"
									className="text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
									onClick={() => dismissTip.mutate({ key: tipKey, value: false })}
								>
									×
								</button>
							</div>
						)}
```

- [ ] **Step 4: Manual sanity check.** Open a project with zero orchestrators — the tip appears under the loose worktree list. Click the body of the tip — `CreateOrchestratorModal` opens. Click `×` — tip dismisses and never reappears for any project (on this machine). Confirm by reloading the app.

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/renderer/components/ProjectItem.tsx
git commit -m "feat(sidebar): one-time orchestrator onboarding tip"
```

---

## Task 20: Final pass — lint, type, manual QA checklist

- [ ] **Step 1: Run all backend tests.** From the desktop workspace:

```bash
cd apps/desktop && bun test
```

Expected: all tests pass, including `detach-all`, `create-orchestrator`, `rename-workspace`, and the existing `orchestrator-membership`, `workspace-ordering`, `list-by-project-tree`, and `agent-coordination` suites.

- [ ] **Step 2: Lint + type check.** From repo root:

```bash
bun run check && bun run type-check
```

Expected: no errors.

- [ ] **Step 3: Manual QA pass.** Start dev (`bun run dev`) and walk through each scenario:

  - Fresh project, no orchestrators: onboarding tip appears under the loose zone.
  - Click the tip: `CreateOrchestratorModal` opens.
  - Create an orchestrator with name "alpha", no attach: row appears in orchestrator zone with network glyph in color 1, count `0`, expanded empty-state under the rail.
  - Create a second orchestrator "beta": color 2, distinct hue.
  - Repeat through "theta" (8 total): each gets a distinct color. 9th cycles.
  - Drag a loose worktree onto "alpha": ring appears on every orchestrator row during the drag; row attaches, count increments.
  - Drag the same worktree onto "beta": moves between orchestrators.
  - Drag the worktree into the loose zone: `Loose worktrees — drop here to detach` label appears mid-drag; row detaches.
  - First grip hover: coachmark appears with "Drag to reorder, or onto an orchestrator row to attach." Click "Got it" — dismisses permanently.
  - Right-click a loose worktree: `Attach to ▸` lists orchestrators; click one → attaches.
  - Right-click a child: `Detach from orchestrator` → detaches.
  - Focus a loose worktree, press ⌘⇧A: attach submenu opens.
  - Focus a child, press ⌘⇧D: detaches.
  - Hover an orchestrator: `⋮` button appears at the right. Click → menu has `Rename…`, `Detach all worktrees`, `Unset orchestrator`. Rename via `window.prompt` updates the name.
  - Hover an orchestrator's count pill: tooltip "N worktree(s) attached".
  - Hover the network glyph: tooltip "Orchestrator".
  - Switch to light theme (if app supports it): all 8 orch colors still distinct.

- [ ] **Step 4: If any of the above fails, fix it inline and commit incrementally** with descriptive messages (`fix(orchestrator): …`).

- [ ] **Step 5: Open a PR.** Suggested title: `feat(orchestrator): discoverability & adaptability pass`. Reference the spec in the description.

---

## Self-Review Notes (post-write)

- **Spec coverage:** Six spec sections → tasks 1–19. Section 1 (parent-row indicator) → tasks 9 + 10. Section 2 (creation entry points) → tasks 6 + 8 + 11 + 12. Section 3 (attach UX) → tasks 13 + 14 + 15 + 16 + 17. Section 4 (empty state) → task 18. Section 5 (palette) → tasks 1 + 2. Section 6 (onboarding) → task 19. Backend foundation → tasks 3 + 4 + 5.
- **Type consistency:** `colorIndex: 1|2|3|4|5|6|7|8` used in tasks 2, 9, 10 — matches.
- **Procedure names:** `renameWorkspace`, `detachAllFromOrchestrator`, `createOrchestrator` consistent across task 3–6 (service), task 4/5/6 (tRPC), and task 8/10/13 (renderer).
- **Coachmark/tip inverted-default convention:** documented in task 17 step 1. Task 19 reuses the same convention explicitly.
- **No placeholders:** every step has either exact code, an exact command, or a concrete manual check. The two "verify mount location of `CreateWorktreeModal`" notes in task 11 require the engineer to grep — the command is given inline.
