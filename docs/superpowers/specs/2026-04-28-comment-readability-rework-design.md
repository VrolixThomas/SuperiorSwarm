# Comment Readability Rework — Design

**Status:** Draft (awaiting user approval)
**Date:** 2026-04-28
**Worktree:** `rework-comment-solver-ui`

## Problem

In the current Comment Solver UI, comment bodies are unreadable in the sidebar. Three iterations of layout (single-line, two-line with clamp, file-rebalance) all fail because a 320px column cannot host an avatar, author, file:line ref, status pill, AND a comment body without truncating one of them. Inline `SolveCommentWidget` view-zones in the diff render comment bodies in full at the right code line, but that affordance is invisible until the user scrolls the diff to the comment's line — and worse, when a file has many comments, the inline cards make the diff feel cluttered.

User-stated review flow: **comment received → AI solves → user reviews**. The review step requires the user to see, for each comment, both the original comment text in full and the code change that addressed it. The current design forces a choice between the two.

## Goal

Make every comment fully readable in the sidebar, keep the inline-at-the-line affordance for direct comment↔code binding, and let the user toggle the inline cards off when the diff feels busy.

## Non-Goals

- No restructuring of group/file model.
- No changes to AI solving, tRPC routers, or DB schema.
- No new keyboard shortcuts (existing j/k/J/K/a/r/p/Enter/Esc unchanged).
- No follow-up on deferred items from prior spec (`SolveActiveCommentBar`, deferred event subscribers).

## Architecture

Two surfaces render the same comment:

1. **Sidebar** — primary reading surface. Full markdown body, no truncation.
2. **Inline view-zone** — secondary on-line anchor in the Monaco diff. Toggleable.

A new shared component `<SolveCommentCard>` is the single source of truth for comment rendering. The two surfaces wrap it differently:

- **Inline** wrapper: existing view-zone container styling (mx-2, my-1, shadow-md, rounded border).
- **Sidebar** wrapper: full-width inside the comments subsection, no shadow, top-border separator between cards, subtle accent left-border when the comment is the active one.

A `commentsVisible: boolean` flag on each solve session governs whether view-zones are emitted. When off, a small `💬` glyph is rendered in the Monaco gutter at every comment line; clicking it toggles `commentsVisible` back on and selects that comment.

The sidebar widens from 320px to 400px to accommodate full markdown body width without word-wrap thrash.

## Components

### `SolveCommentCard` (new, extracted)

**File:** `apps/desktop/src/renderer/components/solve/SolveCommentCard.tsx`

**Responsibility:** Render one comment's avatar, author, file:line, status pill, full markdown body, follow-up affordance, draft-reply signoff, and edit-reply panel. **No layout assumption** — wrapper styling lives in the consumer.

**Props:**
```ts
interface Props {
  comment: SolveCommentInfo;
  workspaceId: string;
  variant: "inline" | "sidebar";
  isActive?: boolean; // for sidebar accent border; ignored for inline
  onSelect?: () => void; // sidebar uses to dispatch selectFile + selectComment
}
```

**Behavior:** All current `SolveCommentWidget` logic (follow-up state, reply edit state, mutations) moves here. The variant only affects outer container classes:
- `inline` → `mx-2 my-1 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-md` plus `border-l-2 border-[var(--accent)]` when `isActive`, `border-l-2 border-[var(--border-subtle)]` otherwise (transparent-equivalent so layout does not shift on toggle).
- `sidebar` → `w-full border-t border-[var(--border-subtle)] bg-[var(--bg-base)] cursor-pointer hover:bg-[var(--bg-elevated)]` plus `border-l-2 border-[var(--accent)]` when `isActive`, `border-l-2 border-transparent` otherwise.

**Why extract:** `SolveCommentWidget` already contains all behaviour we need in the sidebar. Duplicating its 200 lines is a maintenance trap. One source of truth keeps follow-up flows, reply editing, and status logic identical in both surfaces.

### `SolveCommentWidget` (becomes thin adapter)

**File:** `apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx`

**Responsibility after rework:** Trivial wrapper that renders `<SolveCommentCard variant="inline" comment={comment} workspaceId={workspaceId} />`. Kept as a separate file so `useSolveCommentZones` can keep using it as a stable React-root component.

### `SolveSidebar` (modified)

**File:** `apps/desktop/src/renderer/components/solve/SolveSidebar.tsx`

**Changes:**
- Comments subsection rows replaced by `<SolveCommentCard variant="sidebar" ...>` components. No clamp, no truncation, full markdown body.
- Each card is wrapped by a `<div>` that handles `onClick → selectFile + selectComment`, gets the `border-l-2 border-[var(--accent)]` when its comment id matches `activeCommentId`.
- A `useEffect` scrolls the active comment card into view (`scrollIntoView({ block: "nearest" })`) when `activeCommentId` changes.
- Files subsection unchanged.

### `SolveReviewTab` (modified)

**File:** `apps/desktop/src/renderer/components/SolveReviewTab.tsx`

**Changes:**
- Sidebar wrapper width `w-[320px]` → `w-[400px]`.

### `SolveDiffPane` (modified)

**File:** `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx`

**Changes:**
- Adds a "Comments" toggle button in the header next to Inline/Split. Reads `commentsVisible` from the session store; click flips it.
- Passes `commentsVisible` into `useSolveCommentZones` (see below).
- When `commentsVisible === false`, registers Monaco glyph-margin decorations on the modified-side editor at every line that has a comment. Clicking a glyph: `setCommentsVisible(sessionKey, true)` + `selectComment(sessionKey, c.id)`. Glyph: small `💬` rendered via a CSS class on the `glyphMarginClassName`.

### `useSolveCommentZones` (modified)

**File:** `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx`

**Changes:**
- New parameter `enabled: boolean`. When `false`, all view-zones are torn down (existing teardown path) and no new ones are created.
- Signature for re-diffing extended to include the `enabled` flag so a toggle correctly forces teardown.

### `solve-session-store` (modified)

**File:** `apps/desktop/src/renderer/stores/solve-session-store.ts`

**Changes:**
- New per-session field: `commentsVisible: boolean` (default `true`).
- New action: `setCommentsVisible(sessionKey, value: boolean)`.
- New action: `toggleCommentsVisible(sessionKey)`.
- Existing tests updated; new tests for the toggle.

## Data flow

```
SolveSessionStore                Components
─────────────────                ──────────
sessions.get(key)                  ┌──────────────┐
  .commentsVisible ────────────►  │ SolveDiffPane│ ─► header toggle button
  .activeCommentId ──┐            │              │ ─► useSolveCommentZones(enabled)
                     │            └──────────────┘
                     │            ┌──────────────┐
                     ├──────────► │ SolveSidebar │ ─► card.isActive
                     │            └──────────────┘
                     │
toggleCommentsVisible ◄── header button click
                      ◄── glyph click (also calls selectComment)
selectComment ◄── sidebar card click, glyph click, j/k handler
```

The toggle is **per-session, not global**. Two simultaneous solve sessions in different workspaces can have independent visibility settings. Default is **on**.

## Active comment sync

When `activeCommentId` changes (via j/k, sidebar click, or glyph click):

1. **Sidebar** — card with matching id renders accent left-border. `useEffect` calls `cardRef.scrollIntoView({ block: "nearest" })`.
2. **Diff** — modified editor reveals the comment's `lineNumber` (already implemented in `SolveDiffPane`). If `commentsVisible` is true, the inline view-zone for that comment also gains accent visual treatment via a `data-active` attribute that `SolveCommentCard` reads.
3. **No state churn** — both surfaces subscribe to `activeCommentId` from the store. No new event-bus events.

When `activeCommentId` is cleared (Esc), both accent treatments drop.

## Toggle UX details

- Button: `💬 Comments` with a small chevron, e.g., `💬 Comments: On`. When off, label reads `💬 Comments: Off`.
- Position: rightmost in the diff header, after the Inline/Split button.
- Click: flips state. No animation longer than 150ms. View-zones teardown via the existing path in `useSolveCommentZones`.
- Glyph (when off): `💬` in `glyphMarginClassName` decoration on the modified editor for every line with a comment. Click → `setCommentsVisible(sessionKey, true)` + `selectComment(sessionKey, comment.id)`.
- Persistence: in-memory only via the session store. Resets if the session is dropped.

## File-level comments

Comments with `lineNumber === null` (file-level) have no anchor line. They are listed in the sidebar comments subsection and gain a small `· file-level` subtitle in `SolveCommentCard`'s meta line. They do **not** receive a glyph-margin decoration. The toggle has no effect on them since they were never view-zones.

## Acceptance criteria

The project has no DOM/RTL test setup; UI-shape claims are verified by code inspection or manual run. Pure-function and store changes get unit tests.

1. **Code inspection:** `SolveCommentCard`'s body element has no `line-clamp-*` or `text-ellipsis` class. `SolveCommentWidget` is a thin wrapper that delegates to `SolveCommentCard variant="inline"`.
2. **Code inspection:** sidebar wrapper width in `SolveReviewTab.tsx` is `w-[400px]`.
3. **Manual:** Toggle "💬 Comments: On" → "Off" tears down all view-zones in the active diff editor; modified-side editor gains a `💬` glyph in the gutter at each comment's line.
4. **Manual:** Clicking a glyph flips toggle back to On and the clicked comment becomes active (sidebar card highlighted, diff scrolls to its line).
5. **Manual:** Clicking a sidebar card calls `selectFile` + `selectComment`; if the file changes, the diff loads it and scrolls to the comment line. The clicked card gets the accent left-border.
6. **Unit test (solve-session-store.test.ts):** initial `commentsVisible` is `true`; `setCommentsVisible(key, false)` flips it; `toggleCommentsVisible(key)` toggles; `dropSession` resets it.
7. **Existing tests pass:** `solve-session-store.test.ts` and `solve-sidebar.test.ts` continue to pass.
8. **Type-check passes:** `bun run type-check` is clean.

## Out of scope

- Persisting `commentsVisible` across app restarts.
- Animating glyph→card transitions.
- Scroll-spy that auto-selects a comment as it enters viewport.
- Changing inline widget styling (only the wrapper changes when shared).
- Any change to file rows in the sidebar.
- Re-introducing the deferred `SolveActiveCommentBar` from the previous spec.

## Decisions (locked)

| Question | Answer |
|---|---|
| Sidebar width | 400px |
| Default toggle state | On |
| Gutter glyph when off | Yes; click → flip on + select that comment |
| Sidebar card body | Full markdown via `MarkdownRenderer` |
| Toggle scope | Per session (in solve-session-store) |
