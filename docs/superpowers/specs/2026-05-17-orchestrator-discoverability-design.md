Orchestrator Discoverability & Adaptability — Design
=====================================================

**Date:** 2026-05-17
**Status:** Draft, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-05-16-orchestrator-grouping-design.md`

## Problem

The `orchestrator-ordering` branch shipped a working nested-tree sidebar
for orchestrator → child worktrees, with DnD reordering and attach/detach.
The mechanic works. **Discoverability does not.**

Six concrete gaps surfaced after walking the implemented UI:

1. **Role is invisible on the parent row.** The literal word
   "Orchestrator" never renders on `OrchestratorRow`. The only role
   signal is an 8×8 colored swatch and a numeric pill. A user who hasn't
   read documentation sees a colored dot and a number — neither tells
   them this row is structurally different.
2. **Promotion is buried.** Marking a worktree as an orchestrator
   requires a right-click on the worktree row. There is no primary
   affordance for it anywhere in the sidebar.
3. **Attaching a worktree to an orchestrator is DnD-only.** No menu
   item, no keyboard path, no inline button. DnD has no visible grip —
   the spec called for one, but it never landed.
4. **Empty/zero-child orchestrators give no guidance.** An expanded
   orchestrator with zero children renders nothing under the rail. It
   looks identical to a collapsed populated group.
5. **No hover explanations.** Swatch, count pill, rail — zero tooltips.
6. **Color palette doesn't scale.** Three hardcoded colors cycle. The
   4th orchestrator in a project collides with the 1st. No path to
   distinguish them.

Underlying frame: the orchestrator concept is **first-class** and the
audience is **progressive** — a newcomer should find it, a power user
should scale to many.

## Goals

- Make the orchestrator role legible on every parent row, without
  shouting.
- Surface two creation paths (promote in place, dedicated create) as
  primary affordances, not menu-only.
- Keep DnD as the primary attach gesture but make it discoverable
  (visible grip, drop-zone affordances, first-drag coachmark) and add a
  menu fallback for keyboard / non-DnD users.
- Render a useful empty-state inside zero-child orchestrators.
- Expand the color palette to 8 distinct hues so most real projects
  avoid collisions.
- Show a single one-time tip inside projects that have no orchestrator
  yet, so the concept exists in the user's mental model on day one.

## Non-Goals

- **User-customisable orchestrator colors.** Auto-assigned only. Future
  spec.
- **Bulk attach (multi-select).** Single-item operations only.
- **Renaming the "Orchestrator" concept itself.** The word stays.
- **Cross-project drag.** Out of scope, same as the previous spec.
- **Icon customisation per orchestrator.** Single shared icon tinted
  with the orchestrator's color.
- **Multi-orchestrator membership UI.** Schema already supports it; UI
  defers as before.

## Mental Model (unchanged)

Per project, every workspace is either an orchestrator, a child of one
orchestrator, or a loose worktree. Orchestrators render above loose
worktrees in the project's tree. This spec changes how each of those
rows *looks* and how the user *acts on* them — the model is the same.

## Section 1 — Parent-row role indicator (always-visible icon)

Replace the current 8×8 colored swatch on `OrchestratorRow` with a
**12×12 network/hierarchy glyph** tinted with the orchestrator's color
token. The glyph reads universally as "this row is a parent of others".

Glyph spec:

- Inline SVG, 12×12 viewBox, 1.5px stroke, no fill.
- Shape: one node at top, two nodes at bottom-left and bottom-right,
  short connecting lines. (Approximate the SF Symbol
  `point.3.connected.trianglepath.dotted` look, but as a hand-rolled
  SVG to avoid font dependencies.)
- Stroke color: `var(--orch-N)` for the orchestrator's palette index.
- `aria-label="Orchestrator"`.

Tooltip on hover: `"Orchestrator"`. Implementation: native `title`
attribute on the icon element is acceptable for V1 (matches the rest of
the sidebar's tooltip style). A richer tooltip primitive can come
later.

Count pill stays unchanged in visual treatment. Add `title` attribute:
`"{n} worktrees attached"` (singular form when `n === 1`).

The right-side area of the row gains an **overflow `⋮` button**
(`apps/desktop/src/renderer/components/OrchestratorRow.tsx`) that:

- Renders to the right of the chevron toggle.
- Opacity 0 by default, opacity 1 on row hover or when the menu is
  open. (Keyboard focus also forces opacity 1.)
- On click, opens the existing `OrchestratorContextMenu` at the
  button's position. The right-click handler stays in place — both
  paths use the same menu.
- The menu gains two items in addition to today's `Unset orchestrator`:
  - `Rename…` — opens the existing rename flow used elsewhere for
    workspaces. (If no such flow exists yet, fall back to a
    `window.prompt` for V1 — implementation plan resolves this.)
  - `Detach all worktrees` — calls `detachFromOrchestrator` for each
    child via a single tRPC procedure to be added (see "Section 3 —
    tRPC additions" below).

No change to chevron, name, or count-pill positions. The overflow
button slides in *between* the count pill and the chevron.

Active-child treatment on collapsed orchestrators (today's
`auth-orch · auth-ui` middle-dot pattern) stays unchanged.

## Section 2 — Creation entry points

Two surfaced paths, both primary.

### 2a. Dedicated "+ Orchestrator" button on the project header

Today, `ProjectItem` renders a single `+` button via
`RepoGroup`'s `rightContent` slot, calling `openCreateWorktreeModal`.
Replace this single button with a tight two-button cluster:

```
[+W]  [+O]
 │     └─ New Orchestrator — opens CreateOrchestratorModal
 └────── New Worktree — opens CreateWorktreeModal (existing)
```

Both buttons share the existing 20×20 box geometry, the existing
quaternary→secondary hover treatment, and use plain 14px text glyphs.
Glyphs are literal characters `+W` and `+O` in `font-mono` style —
preferred over icons here because the two-letter form is unambiguous
and fits the project's existing minimal aesthetic. Tooltips:
`"New Worktree"` and `"New Orchestrator"`.

If horizontal space is tight (long project names already truncate via
`RepoGroup`), the two buttons stay aligned to the right and the name
truncates as today.

### 2b. CreateOrchestratorModal

New component:
`apps/desktop/src/renderer/components/CreateOrchestratorModal.tsx`.

Structure mirrors `CreateWorktreeModal` (same modal shell, same
`useProjectStore` open/close pattern). Fields:

1. **Name** — text input, same validation as worktree name.
2. **Base branch** — same picker as `CreateWorktreeModal`.
3. **Attach existing worktrees** — collapsible section. Renders a
   checkbox list of the current loose worktrees in this project (fetched
   via the same `workspaces.listByProject` query that's already keyed
   on the project). Empty state inside this section reads
   `"No loose worktrees available."` Section starts collapsed if the
   project has zero loose worktrees, expanded otherwise.

Submit handler:

1. Calls the existing `workspaces.create` procedure to create the
   worktree.
2. Calls `workspaces.setOrchestrator` to flip the flag.
3. For each checked worktree, calls `workspaces.attachToOrchestrator`.
4. Awaits all three steps before closing the modal. On any step's
   failure, the modal stays open and surfaces the error.

A single new tRPC procedure
`workspaces.createOrchestrator({ projectId, name, baseBranch, attachWorkspaceIds })`
that performs all three steps inside one transaction is **preferred**
to chained client calls. The procedure returns the created workspace
row. The implementation plan resolves which path to take based on
transaction boundaries already in the workspace service.

Store wiring: add `openCreateOrchestratorModal(projectId)` to
`useProjectStore`, mirror the existing worktree open/close pattern.

### 2c. Promote-in-place — hover affordance on worktree rows

Right-click `Set as orchestrator` on a loose worktree stays as-is. Add
a visible primary path:

- On hover of a loose `WorkspaceItem` (not on children of an existing
  orchestrator), render a small `↥` button at the right edge of the
  row, adjacent to where the context-menu trigger lives.
- Button is 14×14, opacity 0 → 0.55 on row hover.
- Tooltip: `"Promote to orchestrator"`.
- Click calls the same `handleSetOrchestrator` callback that the
  context menu calls today. No new tRPC surface.

Children of an existing orchestrator do **not** show the promote
button (no nesting orchestrators inside orchestrators — already a
non-goal of the prior spec). The promote button is gated on
`indentLevel === 0 && !workspace.isOrchestrator`.

## Section 3 — Attach UX (DnD primary, menu fallback)

DnD already works end-to-end. Discoverability gaps fixed in five
sub-changes:

### 3a. Visible grip on sortable rows

Implement the `⋮⋮` 6-dot grip the prior spec called for but didn't
land. Location: `left: 4px` of any `SortableWorkspace`, sized 8×12,
opacity 0 by default, opacity 0.55 on row hover or while dragging.
Color: `var(--text-quaternary)`.

This lives in `SortableWorkspace` in `ProjectItem.tsx` so it covers
both orchestrator rows and child/loose worktree rows uniformly.

The grip is purely a visual cue — `@dnd-kit`'s pointer sensor already
listens on the whole row via the spread `{...listeners}` in
`SortableWorkspace`, so clicking the grip does the same thing as
grabbing anywhere else.

### 3b. First-drag coachmark

The first time in a session a user hovers a grip on any row, render a
small floating coachmark next to the grip:

```
Drag to reorder, or onto an
orchestrator row to attach.
```

11px, two lines, `--bg-elevated` background, 1px `--border` outline,
12px padding, max-width 220px. Dismisses on:

- First successful drag end (any kind).
- Click anywhere outside the coachmark.
- The user closing the sidebar.

Once dismissed, never re-show in the session. Persistence across
sessions: store dismissal in `session_state` keyed by
`orchDragCoachmark:dismissed = true`. Once true, never show again on
that machine.

### 3c. Drop-zone affordances during drag

When a drag is active (`useDndMonitor` or the existing `onDragStart`
in `ProjectItem.tsx`):

- Every orchestrator row in the active project gets a 1px **dashed
  inset ring** in its own `--orch-N` color. Implemented via a
  conditional class on `OrchestratorRow` toggled from a new
  `isDropTargetCandidate` prop passed down from `ProjectItem`.
- The boundary between the orchestrator zone and the loose zone gets a
  small inline label `"Loose worktrees — drop here to detach"`, 10px
  `--text-quaternary`, rendered only while a child workspace is being
  dragged (i.e. only when detach is a meaningful action).

### 3d. Menu fallback for attach/detach

On a loose `WorkspaceItem` context menu, insert a new submenu
`"Attach to ▸"` above `Delete Worktree`. Submenu lists every
orchestrator in the same project, rendered as:

```
[network-icon in --orch-N]  orchestrator-name
```

Empty state for the submenu (project has no orchestrators yet):
`"No orchestrators in this project. Create one →"` — clicking it
closes the context menu and opens `CreateOrchestratorModal`.

On a child `WorkspaceItem` context menu, insert `"Detach from
orchestrator"` above `Delete Worktree`. Calls
`workspaces.detachFromOrchestrator`.

### 3e. Keyboard path

When a `WorkspaceItem` row is focused, `⌘⇧A` opens the same
`Attach to…` submenu at the row position. When focused row is a child,
`⌘⇧D` calls detach directly (with no confirmation — detach is
non-destructive).

Both keybindings are registered in the existing global keymap (search
for existing `useKeyboardShortcut` or equivalent hook in the renderer;
the implementation plan identifies the exact integration point).

## Section 4 — Empty-state inside zero-child orchestrators

When `node.children.length === 0` **and** the orchestrator is
expanded, render an indented placeholder inside `OrchestratorGroup`
instead of nothing:

```
[▾] [glyph] auth-orch                            ⊟ 0   ⋮
    │
    │   No worktrees attached.
    │   Drag a worktree here, or use Attach…
    │   from a worktree's context menu.
```

Treatment:

- Two-line text. Line 1: 11px `--text-tertiary`. Line 2: 11px
  `--text-quaternary`.
- Padded to match a child row's `pl-[36px]` so it sits under the rail.
- The colored rail still draws (it already does in
  `OrchestratorGroup`). Empty state lives inside that rail.
- No border, no background — purely typographic.
- Vertical padding 8px top, 8px bottom.

When the first child attaches, the placeholder disappears via the
normal re-render (no animation needed in V1).

## Section 5 — Color palette to 8

Today: `--orch-1`, `--orch-2`, `--orch-3` defined in
`apps/desktop/src/renderer/styles.css` at lines ~70–75 (dark theme)
and ~150–155 (light theme). Extend both blocks to `--orch-1` through
`--orch-8` with matching `-bg` variants.

Palette (dark theme):

| Token       | Value      | Hue       |
|-------------|------------|-----------|
| `--orch-1`  | `#8a9ab0`  | slate blue |
| `--orch-2`  | `#b09a8a`  | warm taupe |
| `--orch-3`  | `#9ab08a`  | sage green |
| `--orch-4`  | `#b08a9a`  | mauve |
| `--orch-5`  | `#8ab0a8`  | teal |
| `--orch-6`  | `#a8a08a`  | sand |
| `--orch-7`  | `#9a8ab0`  | lavender |
| `--orch-8`  | `#b0a08a`  | dusty gold |

Each gets a matching `--orch-N-bg` at 12% alpha for pill backgrounds,
same pattern as today.

Hue spacing approximately every 45° on the HSL wheel, all at ~38%
saturation, ~62% lightness. Light-theme adapts by darkening lightness
to ~46% — match the existing `contrast-and-light-mode` design's
approach for orchestrator tokens.

`useOrchestratorColor` hook (in
`apps/desktop/src/renderer/hooks/useOrchestratorColor.ts`) widens its
return type from `1 | 2 | 3` to `1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`. The
palette index assignment algorithm stays: take the lowest free index
among the orchestrators that already exist in the project's color
map; if all 8 are used, cycle from 0.

`OrchestratorRow` prop `colorIndex` widens to the same union. No other
component signature changes.

## Section 6 — One-time onboarding tip

When an expanded project has **zero orchestrators** *and* the user has
never dismissed this tip, render a single dismissable hint at the
bottom of the project's worktree list (below the loose zone, inside
the `RepoGroup` children):

```
─────────────────────────────────────────────
[network-glyph]  Orchestrators coordinate
                 multiple agents. Create one →
─────────────────────────────────────────────       [×]
```

Click anywhere on the tip except the `×` opens
`CreateOrchestratorModal` for this project. The `×` dismisses
permanently.

Treatment:

- Inline 1px top border `--border-subtle`, no other borders.
- 11px text, two lines maximum.
- Glyph at left in `--text-tertiary` (the orchestrator network glyph
  from Section 1, but in muted tone — no orchestrator-color tint).
- 12px padding all sides.
- Right-aligned `×` button, 14×14, opacity 0.55 → 1 on hover.

Persistence: `session_state` key `orchTip:dismissed = true`. Once true
on this machine, never render again. Also auto-suppresses (without
writing the key) if *any* project on this machine has at least one
orchestrator — the user has clearly found the feature.

The tip is rendered by `ProjectItem`, not at the app level — each
project independently surfaces it, and it disappears the moment the
project has its first orchestrator or the user dismisses.

## Data Model Changes

None. Everything in this spec rides on the schema added by the prior
`orchestrator-grouping` spec.

The only new persistent state is in `session_state` (already a
key-value table used by orchestrator color persistence today):

- `orchDragCoachmark:dismissed` — boolean.
- `orchTip:dismissed` — boolean.

Both are global per machine (no project scoping). The
`getOrchestratorExpand` / `setOrchestratorExpand` procedures in
`apps/desktop/src/main/trpc/routers/workspaces.ts` (lines ~555–570)
are typed to a `boolean` value and already round-trip through
`session_state` — reuse them by passing the new keys
(`orchDragCoachmark:dismissed`, `orchTip:dismissed`). No new tRPC
surface needed for these flags.

## tRPC Surface Changes

Add up to three procedures to
`apps/desktop/src/main/trpc/routers/workspaces.ts`:

1. **`createOrchestrator`** *(preferred if transaction boundaries
   allow)* —
   `({ projectId, name, baseBranch, attachWorkspaceIds }) → Workspace`.
   Creates the worktree, marks `isOrchestrator=true`, attaches the
   listed loose worktrees, all in one transaction. Returns the new
   workspace row.
2. **`detachAllFromOrchestrator`** —
   `({ orchestratorId }) → { detachedCount: number }`. Removes every
   row in `orchestrator_members` for this orchestrator in one
   transaction. Used by the `Detach all worktrees` overflow item.
(No third procedure needed — coachmark and tip flags reuse the
existing `getOrchestratorExpand` / `setOrchestratorExpand` pair with
new keys, per the State note below.)

Existing procedures (`setOrchestrator`, `unsetOrchestrator`,
`attachToOrchestrator`, `detachFromOrchestrator`,
`reorderTopLevel`, `reorderChildren`) are unchanged.

## Renderer Component Plan

`apps/desktop/src/renderer/components/`:

- **`OrchestratorRow.tsx`** — swatch → 12px network SVG glyph; add
  `title` to glyph and pill; add overflow `⋮` button with the
  extended menu (`Rename…`, `Detach all worktrees`, `Unset
  orchestrator`); accept new prop `isDropTargetCandidate?: boolean`
  to drive dashed-ring treatment during drag.
- **`OrchestratorGroup.tsx`** — render zero-child empty-state when
  `children` count is zero.
- **`WorkspaceItem.tsx`** — add hover-revealed `↥` promote button
  (gated on `indentLevel === 0 && !workspace.isOrchestrator`); add
  `Attach to ▸` and `Detach from orchestrator` items to its context
  menu (gated by `indentLevel`).
- **`ProjectItem.tsx`** — wire two-button cluster (`+W`, `+O`) in
  `rightContent`; render zero-orchestrator onboarding tip below the
  loose zone; track drag state to drive `isDropTargetCandidate`;
  render the inline "Loose worktrees" detach label when dragging a
  child.
- **`CreateOrchestratorModal.tsx`** *(new)* — name + base branch +
  attach-existing section, mirrors `CreateWorktreeModal`.
- **`SortableWorkspace`** (currently inline in `ProjectItem.tsx`) —
  extract or extend with the visible grip and first-drag coachmark.
  Extraction is preferred for testability; implementation plan
  decides.
- **`useOrchestratorColor.ts`** — widen union to 1…8.

Theme tokens:

- **`styles.css`** (or wherever orchestrator tokens currently live) —
  add `--orch-4` through `--orch-8` and matching `-bg` variants for
  both dark and light theme blocks.

## State Synchronization

Same optimistic update pattern already used. New mutations
(`createOrchestrator`, `detachAllFromOrchestrator`) follow the
existing `onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId })`
shape.

The coachmark and tip dismiss flags hit `session_state` and don't
need invalidation cascade — they're rendered from local state hydrated
once on mount.

## Error Handling

- `createOrchestrator` partial failure (worktree created but
  `setOrchestrator` fails): the procedure runs inside a transaction;
  the whole thing rolls back. The modal surfaces the error and
  remains open with form state intact.
- `detachAllFromOrchestrator` on an orchestrator with zero children
  is a no-op success (returns `{ detachedCount: 0 }`).
- Attach submenu shown for a worktree whose project has been deleted
  mid-action: the submenu's `listByProject` cache invalidates; show
  the empty-state if cache returns nothing.
- Coachmark and tip rendering must tolerate
  `session_state` reads returning `undefined` (first run on this
  machine) — treat undefined as "not dismissed".

## Accessibility

- Network glyph: `aria-label="Orchestrator"`, `role="img"`.
- Overflow `⋮` button: `aria-label="Orchestrator options"`,
  `aria-haspopup="menu"`, `aria-expanded` reflects menu state.
- Promote `↥` button: `aria-label="Promote to orchestrator"`.
- Grip `⋮⋮`: `aria-hidden="true"` — pure decoration, since
  keyboard reorder is handled by `@dnd-kit`'s keyboard sensor on the
  whole row (left to the implementation plan; today the project does
  not wire a keyboard sensor — keyboard DnD is documented as a
  follow-up if not already enabled).
- Coachmark: rendered with `role="status"` and dismisses on `Escape`.
- Empty-state text: just text, no special ARIA needed.

## Testing

Bun test suites:

- `tests/create-orchestrator.test.ts` *(new)* — happy path,
  rollback on each failure point, attach-existing covers loose
  worktrees in the same project only.
- `tests/detach-all.test.ts` *(new)* — orchestrator with N children
  detaches all; zero-child no-op; cross-project guard.

Renderer tests skipped — DnD, grip, coachmark, and modal are tested
manually per the project's existing convention.

Manual QA checklist (lives in the implementation plan, not here):

- First-run experience in a fresh project: tip appears, dismiss
  persists.
- Create orchestrator via `+O` with zero loose worktrees: section
  collapsed, submit creates an empty orchestrator.
- Create orchestrator via `+O` with 3 loose worktrees, attach 2:
  result has 2 children + 1 still loose.
- Promote button visible on hover of a loose worktree; not visible on
  a child.
- Drag a loose worktree onto an orchestrator: dashed ring appears on
  every orchestrator, attach fires, ring disappears.
- Coachmark appears on first grip hover, dismisses on first drag,
  never reappears after page reload.
- Overflow menu: `Rename`, `Detach all`, `Unset` — all work.
- Color palette: 4th, 5th, ... 8th orchestrator in a project each
  get a distinct color.

## Open Questions

1. **`Rename…` integration.** Does a workspace-rename flow exist
   today? Search of the renderer turns up no obvious primitive. If
   none exists, V1 falls back to `window.prompt`. Implementation plan
   answers.
2. **Keyboard DnD sensor.** `@dnd-kit/core` ships a
   `KeyboardSensor`. Not currently wired in `ProjectItem.tsx`.
   Wiring it is cheap; doing so unblocks fully accessible reorder
   without the menu fallback for power keyboard users. The
   implementation plan should include it.
3. **Tooltip primitive.** Native `title` attributes are inconsistent
   across platforms. A small `Tooltip` component (Radix or hand-rolled)
   would polish this spec considerably. Out of scope for V1 unless
   trivial; if added, it should also cover today's count pill and
   swatch (now glyph) consistently.

## Rollout

Single PR on top of the orchestrator-grouping branch (or a follow-up
PR if that branch ships first). No migration. No feature flag. All
new affordances are additive to the existing tree; absent any
orchestrator, the only visible change is the `+O` button next to
`+W` and the one-time tip.
