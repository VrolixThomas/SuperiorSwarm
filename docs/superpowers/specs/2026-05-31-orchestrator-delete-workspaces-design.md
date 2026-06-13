# Cross-repo orchestrator: delete its dispatched workspaces

**Date:** 2026-05-31
**Status:** Approved (design)

## Problem

Deleting a cross-repo orchestrator (`deleteCrossRepoOrchestrator`) removes only the
orchestrator row, its `orchestrator_members` link rows, its coordinator `workDir`, and its
events file. The member workspaces it dispatched (each a real git worktree on disk plus
`workspaces` / `worktrees` rows) are left orphaned: detached from the orchestrator but still
present in the sidebar and on disk. There is no way, at delete time, to also clean up the
worktrees the orchestrator created.

## Goal

When deleting an orchestrator, offer to also permanently remove the worktree workspaces it
created via dispatch. Workspaces it merely attached (via MCP) and any repo main/`branch`
workspace are never touched.

## Decisions (locked)

- **Scope: only dispatched workspaces.** A provenance flag marks members created by
  `dispatchAcrossRepos`. Only those are removed. A worktree workspace the orchestrator merely
  attached is left alone. This matches the request's wording ("worktrees it made").
- **Dirty handling: force-delete everything.** Removal passes `force: true`; worktrees are
  removed even with uncommitted changes (work is lost). One clean sweep, no partial state.
- **UX: two-step choice.** The delete flow asks an explicit keep-vs-delete question for the
  workspaces, separate from the delete-the-orchestrator confirmation. Reuses the existing
  `window.confirm` idiom (no new modal component, per the project's understated-UI preference).
- **Backward compatible.** Removal is opt-in: the `delete` procedure defaults to not removing
  workspaces, so any existing caller keeps today's behavior.

## Architecture

Five units. One DB column, two service changes, one query field, one renderer change.

### Unit 1 — Provenance column on `orchestrator_members`

`apps/desktop/src/main/db/schema.ts`

Add to the `orchestratorMembers` table definition (after `parentKind`):

```ts
createdByDispatch: integer("created_by_dispatch", { mode: "boolean" })
	.notNull()
	.default(false),
```

Generate the migration descriptively:

```bash
bun run db:generate --name add_member_created_by_dispatch
```

The column means: "this orchestrator created this workspace, so deleting the orchestrator may
delete the workspace." Existing rows backfill to `false` (the safe default — attached, not
created).

### Unit 2 — Stamp provenance on dispatch

`apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`

`attachToCrossRepoOrchestrator` gains an optional input field
`createdByDispatch?: boolean` (default `false`), written into the
`tx.insert(orchestratorMembers).values({...})` call as
`createdByDispatch: input.createdByDispatch ?? false`.

`apps/desktop/src/main/services/cross-repo-orchestrators.ts`

In `dispatchAcrossRepos`, the `attachToCrossRepoOrchestrator(...)` call passes
`createdByDispatch: true`. All other callers of `attachToCrossRepoOrchestrator` (the MCP
attach path) omit it, so they default to `false`.

### Unit 3 — Delete with optional workspace removal

`apps/desktop/src/main/services/cross-repo-orchestrators.ts`

`deleteCrossRepoOrchestrator` input gains `removeWorkspaces?: boolean`. When `true`, before any
deletion runs:

1. Select the `workspaceId`s of members of this orchestrator where
   `parentKind = "cross_repo"` AND `createdByDispatch = true`. Capture them into an array
   first (do not delete while iterating).
2. For each captured `workspaceId`, call `removeWorkspace({ workspaceId, force: true })`
   inside a `try/catch`. `force: true` skips the uncommitted-changes check; `removeWorkspace`
   disposes terminals, deletes the `worktrees` + `workspaces` rows, and schedules on-disk
   worktree cleanup. Wrapping each call means one failure (workspace already gone, lock) does
   not abort the others. `removeWorkspace` throws on `type: "branch"`, but dispatched
   workspaces are always `type: "worktree"`, so that guard never trips here.

Then the existing cleanup proceeds unchanged: delete remaining `orchestrator_members` rows for
this orchestrator, delete the `cross_repo_orchestrators` row, `rmSync` the `workDir`,
`removeCrossRepoEventsFile`, `invalidateAllCrossRepoLinks`. (Removing a workspace cascades its
own member row away via the existing `onDelete: "cascade"` FK on
`orchestrator_members.workspaceId`; the explicit member-row delete then clears the attached /
branch members that remain.)

When `removeWorkspaces` is falsy, behavior is exactly today's.

`apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts`

The `delete` procedure input becomes
`z.object({ id: z.string(), removeWorkspaces: z.boolean().default(false) })` and forwards
`removeWorkspaces` to `deleteCrossRepoOrchestrator`.

### Unit 4 — Expose provenance in the members query

`apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`

`listCrossRepoMembers` adds `createdByDispatch: orchestratorMembers.createdByDispatch` to its
`.select({...})` and `createdByDispatch: boolean` to its declared return-type array shape, so
the renderer can count how many workspaces a delete would remove.

### Unit 5 — Two-step delete UX

`apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx`

Replace the current single-confirm `onDelete` with a two-step flow:

```tsx
onDelete={async () => {
	if (!window.confirm(`Delete "${o.name}"?`)) return;
	const members = await utils.crossRepoOrchestrators.listMembers.fetch({ id: o.id });
	const n = members.filter((m) => m.createdByDispatch).length;
	let removeWorkspaces = false;
	if (n > 0) {
		removeWorkspaces = window.confirm(
			`Also permanently delete ${n} worktree workspace${n === 1 ? "" : "s"} this ` +
				`orchestrator created, including any uncommitted changes? Cancel keeps them.`
		);
	}
	deleteMut.mutate({ id: o.id, removeWorkspaces });
}}
```

- Step 1 gates deleting the orchestrator (unchanged behavior).
- Step 2 appears only when the orchestrator created at least one workspace. OK removes them;
  Cancel keeps them but the orchestrator is still deleted (wording makes this explicit).
- `deleteMut.onSuccess` additionally calls `utils.workspaces.listByProject.invalidate()`
  (alongside the existing `crossRepoOrchestrators.list.invalidate()`) so removed worktrees
  disappear from the sidebar immediately. The sidebar lists workspaces via
  `trpc.workspaces.listByProject` (see `App.tsx`, `SidebarRail.tsx`, `WorkspaceItem.tsx`);
  invalidating with no argument refreshes every project's list.

## Data flow

```
dispatchAcrossRepos → attachToCrossRepoOrchestrator({ createdByDispatch: true })
  → orchestrator_members.createdByDispatch = true

delete click
  → confirm "Delete?"  (gates orchestrator deletion)
  → listMembers.fetch → count where createdByDispatch
  → confirm "Also delete N workspaces?"  (gates workspace removal)
  → delete.mutate({ id, removeWorkspaces })
      → deleteCrossRepoOrchestrator
          → if removeWorkspaces: removeWorkspace({ id, force: true }) per dispatched member
          → delete member links → delete xro row → rm workDir → events cleanup
```

## Error handling

- Each `removeWorkspace` call is wrapped per-workspace; a single failure is logged and skipped,
  and the rest of the removals plus the orchestrator deletion still complete.
- `force: true` means no `blocked_uncommitted` short-circuit; the user already consented to
  losing uncommitted work via step 2's explicit wording.
- The `delete` procedure's `removeWorkspaces` defaults to `false`, so a delete with no second
  confirmation (count 0, or user cancelled step 2) behaves exactly as today.

## Out of scope

- Removing workspaces the orchestrator only attached (provenance `false`).
- Any change to a repo's main/`branch` workspace (already protected by `removeWorkspace`).
- The `dispatchAcrossRepos` task-delivery gap (tracked separately).
- A custom delete modal — the two `window.confirm` steps are intentional.

## Testing

- `dispatchAcrossRepos` sets `createdByDispatch = true` on the member it creates; a plain
  `attachToCrossRepoOrchestrator` call leaves it `false`.
- `deleteCrossRepoOrchestrator({ removeWorkspaces: true })` removes the dispatched worktree
  members (their `workspaces` and `worktrees` rows are gone) while leaving an attached member's
  workspace and a `branch`-type workspace intact, and still deletes the orchestrator row.
- `deleteCrossRepoOrchestrator({ removeWorkspaces: false })` (or omitted) deletes the
  orchestrator and member links but leaves every workspace row present (current behavior).
- `listCrossRepoMembers` returns `createdByDispatch` for each member.
- Renderer change is presentational/control-flow: verify via renderer type-check
  (`npx tsc --project tsconfig.renderer.json --noEmit`) + Biome + manual smoke (two confirms
  appear; cancelling step 2 still deletes the orchestrator; removed worktrees leave the
  sidebar).
