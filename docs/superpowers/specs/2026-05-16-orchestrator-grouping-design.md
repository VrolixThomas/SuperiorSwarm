# Orchestrator Grouping & Worktree Ordering — Design

**Date:** 2026-05-16
**Status:** Draft, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-05-12-agent-coordination-design.md`

## Problem

The MCP orchestrator mode lets one workspace coordinate others in the same
project, but the sidebar still renders worktrees as a flat list under each
repo. Two things are missing:

- **No visual relationship** between an orchestrator and the worktrees it
  manages. They sit side by side as peers, only the `Orchestrator` label on
  the parent hinting at the link.
- **No ordering.** Worktrees render in insertion order (`workspaces.listByProject`
  has no `ORDER BY`). When a project has 5+ worktrees the user can't pin the
  active ones, group related work, or even keep a stable layout across
  restarts.

Together this makes a project with two orchestrators and seven worktrees
hard to scan: which agents belong to which orchestrator, which are loose,
which is being worked on.

## Goals

- Show orchestrator → managed worktrees as a parent/child nesting under
  each repo.
- Stable, user-controlled ordering at two scopes: top-level rows within a
  project, and children within an orchestrator group.
- Drag-and-drop to reorder, attach a worktree to an orchestrator, and
  detach it.
- Reuse existing design tokens — no new color family, no new sidebar
  surface. Treatment must read as "subtler version of WorkspaceItem" not as
  a new component.
- Schema supports many-to-many orchestrator membership for future use; V1
  UI enforces single-parent.

## Non-Goals

- **Cross-project drag.** Each repo is registered once; a worktree belongs
  to exactly one project on disk. Cross-project drag is disallowed.
- **Nesting orchestrators inside orchestrators.** Two levels only:
  project → orchestrator → child worktree. Or project → loose worktree.
- **Multi-orchestrator attach UI** (cmd-drag to add to a second
  orchestrator). Schema allows it; UI defers it.
- **Folder/group entity.** No standalone "group" concept. The orchestrator
  workspace IS the group.

## Mental Model

Per project, every workspace is either:

- An **orchestrator** (`isOrchestrator = true`) shown as a collapsible
  parent row with a small colored swatch, name, and a count pill showing
  how many worktrees are attached.
- A **child** worktree attached to exactly one orchestrator, shown
  indented under that orchestrator with a colored guide rail at the indent
  gutter.
- A **loose** worktree attached to no orchestrator, shown at top level
  beneath the orchestrator section.

Top-level layout rule: **orchestrators always render above loose
worktrees**, never interleaved. Two zones, drag-reorder within each zone.

Once a worktree is attached, it disappears from the loose list — it lives
only under its orchestrator.

## Visual Treatment

The treatment maps onto the existing `WorkspaceItem` (`pl-[22px]`,
`py-[7px]`, `rounded-[6px]`, 13px name, 11px sub). Tokens reused:
`--bg-surface`, `--bg-elevated`, `--accent`, `--accent-subtle`,
`--text-tertiary`, `--text-secondary`, `--radius-sm`.

**Orchestrator color palette** — three muted tints, ~40% saturation,
assigned per orchestrator on first render and persisted so the color stays
stable across restarts:

| Token       | Value     | Usage                  |
|-------------|-----------|------------------------|
| `--orch-1`  | `#8a9ab0` | slate blue             |
| `--orch-2`  | `#b09a8a` | warm taupe             |
| `--orch-3`  | `#9ab08a` | sage                   |

Each color has a matching `--orch-N-bg` at 12% alpha for pill backgrounds.
`--accent` stays reserved for active selection. Existing `--term-*` colors
stay reserved for phase dots and status. Final mockup lives at
`.superpowers/brainstorm/73716-*/content/fidelity-mock-v2.html` for
reference.

### Orchestrator parent row

Same row metrics as `WorkspaceItem`. Extra elements:

- Leading chevron (▾ expanded / ▸ collapsed), 10px wide, `--text-quaternary`.
- 8×8 squared swatch in the orchestrator's color.
- Workspace name in `--text-secondary`, `font-weight: 500`.
- Trailing count pill: child count only, no "spans" word. Background
  `--orch-N-bg`, foreground `--orch-N`, 10px font, pill radius 9px.

When the orchestrator is collapsed and one of its children is the active
workspace, the orchestrator row takes the standard active treatment
(`--accent-subtle` background, 3px accent bar on left) and shows the child
name after a middle-dot: `auth-orch · auth-ui`.

### Child rows

Wrapped in a `.group` container with `padding-left: 14px` and a 2px-wide
absolutely-positioned colored rail at `left: 26px` (between the orchestrator's
left padding and where the child row's content starts). Rail uses the
orchestrator's color at `opacity: 0.55`. When the active workspace is one
of the children, the group gets `.has-active` and the rail brightens to
`opacity: 1`.

Child `WorkspaceItem` rows get `pl-[36px]` instead of `pl-[22px]`. Everything
else (name, sub, phase dot, swarm indicator, context menu) stays unchanged.
The 3px accent bar on the left edge for the active row still works because
it sits at `left: 0` while the rail is at `left: 26px` — no collision.

### Drag affordances

- **Grip** — 6-dot ⋮⋮ at `left: 6px`, opacity 0 → 0.55 on row hover.
- **Drop line** — 2px horizontal bar in the orchestrator's color between
  rows when the cursor is on a valid drop position.
- **Ghost** — dragged row gets dashed border in orchestrator color (or
  `--text-quaternary` for loose drag), 65% opacity.
- **Drop target** — orchestrator row being targeted for attach gets a 1px
  inset ring in its own color.

## Data Model

Add three things to `apps/desktop/src/main/db/schema.ts`:

### Join table: `orchestrator_members`

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
```

Why a join table over `parentWorkspaceId`: schema admits many-to-many
membership for future use (one worktree spanned by multiple orchestrators).
V1 UI enforces single-parent by checking the join before insert.

Application-level invariants (not enforced by DB):

- `orchestratorId` must reference a workspace where `isOrchestrator = true`.
- `workspaceId` must reference a workspace in the same `projectId` as the
  orchestrator.
- V1 only: at most one row per `workspaceId`.

### `sortOrder` column on `workspaces`

```ts
sortOrder: integer("sort_order").notNull().default(0),
```

Orders top-level rows within a project: orchestrators among orchestrators,
loose worktrees among loose worktrees. (Top-level zone rule keeps them
visually separated; `sortOrder` is one column for both, but the listByProject
query splits the result into two arrays.)

Integer ordering, renumber on each drop (write all sibling rows in the same
transaction). Fractional ordering was considered and rejected — rounding
ceremony outweighs the savings at this scale (single-digit children, low
double-digit top-level rows).

### Migration

Run via `bun run db:generate --name add_orchestrator_grouping`. Migration
must:

1. Add `sort_order` column to `workspaces` with default 0.
2. Backfill `sort_order` per project using existing `created_at` order so
   the first render after migration matches what users saw before.
3. Create `orchestrator_members` table + indexes.

## Query Shape

`workspaces.listByProject` returns a structured result instead of a flat
array:

```ts
{
  orchestrators: Array<{
    workspace: Workspace,
    children: Workspace[],   // sorted by orchestrator_members.sortOrder
  }>,                        // sorted by workspace.sortOrder
  loose: Workspace[],        // sorted by workspace.sortOrder
}
```

The renderer never needs to recompute "which orchestrator owns which
child"; the server hands back the assembled tree. Reviews (`type = "review"`)
stay filtered out as today.

## tRPC Surface

Add three procedures to `apps/desktop/src/main/trpc/routers/workspaces.ts`:

- `attachToOrchestrator({ orchestratorId, workspaceId, sortOrder })` —
  insert or move row in `orchestrator_members`. Removes existing membership
  row for `workspaceId` first (V1 single-parent).
- `detachFromOrchestrator({ workspaceId })` — delete the join row. The
  workspace's existing `sortOrder` decides its position in the loose zone
  (or set it to current max + 1 if previously attached).
- `reorder({ kind, projectId, orchestratorId?, orderedIds })` —
  `kind ∈ { "top-level", "children" }`. Rewrites `sortOrder` for the
  provided ids in one transaction. `orchestratorId` required when
  `kind = "children"`.

`workspaces.listByProject` return shape changes (see above). All callers
need to update — search confirms only `ProjectItem.tsx` consumes it today.

## Component Plan

`apps/desktop/src/renderer/components/`:

- **`WorkspaceItem.tsx`** — accept new optional props:
  - `indentLevel?: 0 | 1` (default 0; 1 changes left padding to 36px).
  - No other change to the row.
- **`OrchestratorRow.tsx`** *(new)* — renders the parent row: chevron,
  swatch, name, count pill. Owns expand/collapse local state (persist to
  `session_state` keyed by `orchestratorRowExpanded:${id}`).
- **`OrchestratorGroup.tsx`** *(new)* — wraps a list of child
  `WorkspaceItem`s, draws the colored rail, applies `.has-active`.
- **`ProjectItem.tsx`** — replace the flat `workspacesList.map(...)` with
  the new tree shape:
  1. For each orchestrator: render `OrchestratorRow`; if expanded, render
     `OrchestratorGroup` containing children.
  2. Render loose worktrees below.
- **`useOrchestratorColor(orchestratorId, projectId)`** *(new hook in
  `renderer/hooks/`)* — reads/writes a per-project color map from
  `session_state` keyed by `orchestratorColors:${projectId}` (JSON
  `{ [orchestratorId]: paletteIndex }`). New orchestrators take the
  lowest free palette index; if all three are used, cycle from 0.

DnD wiring lives in `ProjectItem` since it owns the visible tree. Library
choice: **`@dnd-kit/core` + `@dnd-kit/sortable`**. Reasons: pointer/keyboard
both supported (we have keyboard nav for the sidebar already), good
TypeScript, no virtual DOM thrashing on drag, MIT-licensed. Add to
`apps/desktop/package.json`.

DnD scopes:

- Top-level orchestrator zone — sortable list.
- Top-level loose zone — sortable list.
- Each `OrchestratorGroup` — sortable list, also a drop target for
  attach.
- Each `OrchestratorRow` (collapsed or expanded) — drop target for attach.

Drop rules enforced in `onDragEnd`:

- Worktree → orchestrator row OR group area = attach (or move between
  orchestrators).
- Child worktree → loose zone = detach.
- Orchestrator → another orchestrator = no-op.
- Cross-project = no-op (DnD context scoped per-project anyway).

## State Synchronization

Optimistic updates via `trpc.useUtils()`, same pattern as the existing
`deleteWorkspace.useMutation` in `WorkspaceItem.tsx`. On mutation:

1. Cancel any in-flight `listByProject` for this project.
2. Apply local edit to the cached tree.
3. Fire mutation. On error, roll back from snapshot. On settle, invalidate.

The orchestrator agent itself doesn't care about ordering — it reads
membership via tRPC, not the sidebar. Membership changes still fire the
existing project event bus so any subscribed agent sees updates.

## Error Handling

- Attempt to attach a workspace whose `projectId` differs from the
  orchestrator's: throw `BAD_REQUEST` from the tRPC procedure. Renderer
  should never construct this case (DnD context is per-project) but the
  guard is cheap.
- Attempt to attach to a workspace where `isOrchestrator = false`: same.
- Attempt to attach an orchestrator as a child of another orchestrator:
  same. No nesting.
- Concurrent reorder from two windows: last-writer-wins. Both writes
  rewrite the full sibling set in one transaction, so the second write
  produces a coherent (if surprising) ordering.

## Testing

Bun test suites:

- `tests/orchestrator-members.test.ts` *(new)* — attach/detach/move,
  cross-project guard, isOrchestrator guard.
- `tests/workspace-ordering.test.ts` *(new)* — sortOrder renumber math
  (insert middle, insert end, move within group, move across groups).
- `tests/list-by-project-tree.test.ts` *(new)* — listByProject returns the
  correct shape for: empty project, only loose, only orchestrators with
  children, mixed.

Renderer tests skipped — DnD behavior is tested manually per the project's
existing convention (no react-testing-library setup today).

## Open Questions

1. **Active inside collapsed group — auto-expand or show-on-parent?**
   The mockup shows the parent row inheriting the accent treatment and
   appending the child name. Auto-expand would be simpler but loses the
   "minimised" affordance the user explicitly asked for. Going with
   show-on-parent unless feedback comes in during implementation.
2. **User-customisable colors.** First cut uses auto-assignment via the
   per-project color map. If users want to recolor a specific
   orchestrator, add a context menu entry later — schema (map keyed by
   id) already supports it.

## Rollout

Single PR. Migration auto-applies on startup. No flag — the new tree
shape is a strict superset of the old flat list (empty orchestrator zone
is invisible).
