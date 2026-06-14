# Unified Sidebar Bands — Design

**Date:** 2026-06-14
**Status:** Approved (design), pending implementation plan
**Segment affected:** the "Projects" segment of the left sidebar only. Tickets / PRs segments are untouched.

## Problem

The Projects segment stacks three sections that each use a different layout mechanism, so they look and behave inconsistently:

- **Folders** — pinned `shrink-0` band with a hard `max-h-[200px]` internal scroll cap (`ProjectList.tsx:29-40`).
- **Repositories** — `flex-1` band that takes all remaining height and scrolls (`ProjectList.tsx:43-53`).
- **Orchestrators** — a draggable split pane with its own collapse toggle and persisted pixel height (`SidebarSplit.tsx`, `CrossRepoOrchestratorGroup.tsx`).

There is no shared structure. The user cannot reorder them, cannot collapse them uniformly, and the "focus on one" behaviour only exists (accidentally) for Orchestrators via its bespoke split.

## Goals

1. **Choose order** — the three bands can be reordered by the user.
2. **Minimise fully** — any band collapses to just its header row.
3. **Easily switch** — one click on a band header opens/closes it (same gesture repos use today).
4. **Multiple open at once, or focus on one** — several bands open share the height; "focus" is simply the result of closing the others. No separate mode, icon, badge, or double-click.

## Non-Goals

- No change to the Projects / Tickets / PRs segmented control.
- No change to the inner content of any band (project tree, worktree drag-reorder, orchestrator rows all stay as-is).
- No new "focus mode" gesture or indicator — the expand state itself is the only signal.

## Chosen Model

**Stacked collapsible panes** (the VSCode Explorer model), chosen over an accordion (forces one-open) and tabs (loses multiple-open). All three bands become instances of one uniform `SidebarBand` component, rendered in a `SidebarBandStack` that owns order, open/closed state, and height distribution.

### Interaction rules (the whole set)

- **Click a band header** (or its chevron) → toggle that band open/closed. Identical to the repos expand-on-click gesture today.
- **Multiple bands open by default**; open bands share the available height.
- **Focus on one** = close the others. No dedicated gesture or state.
- **Reorder** = drag the `⋮⋮` grip in a band header. Order persists.
- **Resize** = drag the divider between two open bands. Height persists.
- Open/closed set, order, and heights all survive app restart.

### Height model

A direct N-band generalisation of today's `SidebarSplit` (which is the 2-pane case: Repositories flexes, Orchestrators is explicit/auto height):

- Each open band = fixed header + `overflow-y-auto` body.
- **One band is the flex band** that absorbs leftover height (`flex-1 min-h-0`, scrolls). Default = **Repositories** (the bulk list), preserving today's feel. If Repositories is closed, the flex role falls to the bottom-most open band that has no explicit height; if none qualifies, leftover space stays empty and bands sit at the top.
- A band with a **user-set pixel height** (from dragging its lower divider) renders `shrink-0` at that height with internal scroll.
- An open, non-flex band with no explicit height renders `shrink-0` at content height, with a `max-h` cap so a long list scrolls internally instead of pushing other bands off-screen.
- Heights are clamped by a generalised version of the existing `clampPaneHeight` (min px, max fraction of container).

This keeps the current "Folders small, Repositories takes the rest, Orchestrators resizable" behaviour as the default, while making all three bands uniform, reorderable, and individually collapsible.

> **Decision — why Repositories is the default flex band rather than every band growing equally:** equal `flex-grow` leaves dead whitespace under sparse bands (Folders with one item). Content-sizing the light bands and letting the bulk list absorb slack matches the current UX and avoids gaps.

## Architecture

### New components

- **`SidebarBand.tsx`** — generic collapsible band. Props: `id`, `title`, `count`, `onNew`, `newLabel`, `isOpen`, `onToggleOpen`, `dragHandleProps`, `heightStyle` (the resolved flex/explicit/auto style), `children` (body). Renders the (extended) `SidebarSectionHeader` + a body wrapper.
- **`SidebarBandStack.tsx`** — replaces `SidebarSplit.tsx`. Takes an ordered array of band descriptors `{ id, title, count, onNew, newLabel, body, defaultFlex }`. Reads order / open / heights from the store, renders bands inside a `@dnd-kit` `SortableContext` (drag-reorder via grip), draws draggable dividers between adjacent open bands, and assigns each band its resolved height style via the layout helper.
- **`FolderList.tsx`** / **`RepositoryList.tsx`** — the two halves of today's `ProjectList`, split so each band body has a single responsibility. `ProjectList.tsx` is removed (its two sections move into these bodies feeding the stack).
- **`OrchestratorList.tsx`** — the body of today's `CrossRepoOrchestratorGroup`, with the header + collapse logic removed (now owned by the band wrapper).

### Modified components

- **`SidebarSectionHeader.tsx`** — add an optional drag grip (`⋮⋮`) rendered when `dragHandleProps` is passed; keep the existing `onToggle`/`expanded` and `+ New` button. Clicking the title area toggles open (already supported).
- **`Sidebar.tsx`** — replace the `<SidebarSplit top={<ProjectList/>} bottom={<CrossRepoOrchestratorGroup/>}>` block (lines 139-145) with `<SidebarBandStack bands={[folders, repositories, orchestrators]} />`. The `orchCount`/`bottomAutoHeight` plumbing is absorbed into the band's auto-height handling.

### Removed

- `SidebarSplit.tsx` (replaced by `SidebarBandStack`).
- The Orchestrators-specific collapse state in `projects.ts` (`orchestratorPaneHeight`, `orchestratorPaneCollapsed`, and their setters) — superseded by the generic band store below.

### State — new store `stores/sidebar-bands.ts`

A dedicated zustand store (isolated from the grab-bag `projects.ts`):

```ts
type BandId = "folders" | "repositories" | "orchestrators";

interface SidebarBandsStore {
  order: BandId[];                       // default ["folders","repositories","orchestrators"]
  open: Record<BandId, boolean>;         // default all true
  heights: Record<BandId, number | null>;// null = auto/flex; number = explicit px
  toggleOpen: (id: BandId) => void;
  setOrder: (order: BandId[]) => void;
  setHeight: (id: BandId, height: number | null) => void;
}
```

- **Persistence:** single localStorage key `ss.sidebar.bands.v1`, holding `{order, open, heights}` as JSON. Hydrate once on mount (try/catch, fall back to defaults on parse error — existing pattern). Persist on every change.
- **Migration:** on first hydrate, if the old `ss.sidebar.orchCollapsed` key exists, seed `open.orchestrators` from it, then ignore the legacy keys. `ss.sidebar.orchHeight` is dropped (heights start at auto).

### Pure layout helper — `utils/sidebar-bands.ts`

Extract a pure function so the height logic is unit-testable in isolation:

```ts
computeBandLayout(
  order: BandId[],
  open: Record<BandId, boolean>,
  heights: Record<BandId, number | null>,
  flexBandId: BandId | null,
  containerHeight: number,
): Record<BandId, { hidden: boolean; style: "flex" | { heightPx: number } | "auto" }>
```

It resolves which open band flexes (default Repositories, else bottom-most auto band), clamps explicit heights (generalise the existing `clampPaneHeight`), and returns a per-band style descriptor the stack maps to className/style.

## Edge cases

- **No folders:** the Folders band is not rendered (parity with today's `hasFolders` guard). It reappears when a folder exists.
- **Empty Orchestrators:** band is always shown; when open and empty its body is empty and the header `+ New` is the entry point (parity with today). Auto height.
- **Single band open:** it becomes the flex band and fills the height — this is "focus on one".
- **All bands closed:** the stack is three stacked header rows; leftover space is empty.
- **Corrupt persisted JSON:** fall back to defaults.

## Testing

- `tests/sidebar-bands.test.ts` (Bun) over the pure pieces:
  - `computeBandLayout`: flex-band selection (default Repositories; fallback when closed; single-open fills), explicit-height clamping, hidden-band handling, all-closed.
  - Store reducers: `toggleOpen`, `setOrder` (reorder), `setHeight`, and the legacy-`orchCollapsed` migration seed.
- Manual QA in dev: reorder via grip, collapse each band, drag dividers, restart app and confirm order/open/heights persist; verify Tickets/PRs segments unchanged.

## Out-of-scope follow-ups (not in this plan)

- Keyboard shortcuts for collapse/reorder.
- Right-click "collapse others" menu item (deliberately omitted; focus = manual close).
