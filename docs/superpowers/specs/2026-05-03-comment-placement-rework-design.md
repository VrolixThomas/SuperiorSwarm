# Comment Placement Rework — Design Spec

**Date:** 2026-05-03
**Branch:** `rework-comment-solver-ui`
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-04-28-comment-readability-rework-design.md`

## Problem

The comment-readability rework (commits `4000fd6f..28611c7d` + `835ca2dd`) left one
gap: inline comment cards do not appear at the correct location in the diff
editor when a comment was placed on a deleted line. In the user's
diff-first workflow this is the primary review surface — the sidebar comment
must surface visibly in the actual file overview so the user can verify which
comments were addressed by which code changes.

Concretely: opening a comment-solver session whose PR has comments on lines that
were fully removed (e.g. `GreenTubeErrorDictionary.cs` line 8 in a file that was
deleted in the same PR), the inline card is invisible. The toggle says
`Comments: On` but no card renders next to the deleted line.

## Root cause

Comment `side` ("LEFT" = original, "RIGHT" = modified) is dropped at every hop
between GitHub and the renderer:

| Hop | File | Behaviour |
|----|----|----|
| GitHub API → adapter | `github-adapter.ts:106-142` | `RawCommentNode` interface omits `side`; mapper produces `NormalizedComment` without `side` |
| Adapter → cache | `comment-poller.ts:90-103` | Cache insert has no `side` field |
| Cache schema | `schema-comment-solver.ts:97-119` | `pr_comment_cache` has no `side` column |
| Cache → solve session | `create-and-queue-solve.ts:79-87` | Hardcodes `side: null as string | null` |
| Renderer | `useSolveCommentZones.tsx` | `commentSide(c)` falls back to `RIGHT` when `c.side === null` → all comments route to modified pane → comments on deleted lines mounted at virtual line in modified pane → invisible |

`SolveCommentInfo.side` is propagated correctly from `prComments.side` to the
renderer (see `comment-solver.ts:103`); the breakage is upstream.

## Goals

1. Inline comment cards render visibly at the correct line in the correct pane,
   in split-view, for every comment regardless of whether the line was added,
   modified, or deleted.
2. End-to-end propagation of `side` from GitHub API to renderer with no lossy
   hops.
3. Graceful fallback for the legacy/null-`side` case (already-cached PRs, future
   non-GitHub providers that don't emit `side`).
4. Inline mode does not silently drop deleted-line comments — the user is
   informed and can switch to split.

## Non-goals

- Adding code-snippet previews, minimap markers, or overview-ruler ticks. The
  user explicitly rejected adding more UI chrome — fix the existing inline card
  surface instead.
- Restructuring the sidebar. It stays exactly as it is (full `SolveCommentCard`
  per comment, grouped by group).
- Backfilling `side` for already-cached PR comments. The poller wipes and
  rewrites the cache on the next refresh, so the next poll re-populates `side`.
- Bitbucket / non-GitHub adapter side support. Out of scope; `side: null` will
  flow through and the renderer fallback handles it.
- Inline-diff-mode rendering of LEFT-side comments. We render a banner
  prompting the user to switch to split.

## Architecture

End-to-end propagation of `side` through the pipeline, with a renderer-side
fallback for null `side` values:

```
GitHub API (PR review comment has `side`)
                │
                ▼
github-adapter.ts: RawCommentNode { side?: "LEFT" | "RIGHT" }
                │
                ▼
NormalizedComment { side: "LEFT" | "RIGHT" | null }
                │
                ▼
comment-poller.ts: insert into pr_comment_cache (side text NULL)
                │
                ▼
create-and-queue-solve.ts: copy side → pr_comments.side
                │
                ▼
comment-solver tRPC: emit SolveCommentInfo { side }
                │
                ▼
useSolveCommentZones.resolveSide(comment, models) → "LEFT" | "RIGHT"
   • explicit side wins
   • null + lineNumber null               → "RIGHT" (file-level, pin to line 1)
   • null + lineNumber > mod lineCount    → "LEFT"
   • null + lineNumber > orig lineCount   → "RIGHT"
   • else                                 → "RIGHT"
```

## Data layer changes

### Migration

**Name:** `add_side_to_pr_comment_cache`

**SQL:**
```sql
ALTER TABLE pr_comment_cache ADD COLUMN side TEXT;
```

Generated via `bun run db:generate --name add_side_to_pr_comment_cache` per
project convention.

### Schema

`apps/desktop/src/main/db/schema-comment-solver.ts:97-119` — add `side: text("side")`
to the `prCommentCache` table definition.

### NormalizedComment

`apps/desktop/src/main/providers/types.ts:24-31` — extend the interface:

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

### github-adapter

`apps/desktop/src/main/providers/github-adapter.ts:106-142`:

- Add `side?: "LEFT" | "RIGHT"` to `RawCommentNode`.
- Mapper: `side: c.side ?? null`. Issue-thread comments naturally have no
  `side` and stay null (they're not anchored to a line).

### comment-poller

`apps/desktop/src/main/ai-review/comment-poller.ts:90-103` — add `side: c.side`
to the cache insert.

### create-and-queue-solve

`apps/desktop/src/main/ai-review/create-and-queue-solve.ts:86` — replace
`side: null as string | null` with `side: c.side ?? null`. The cached row's
`side` propagates to `pr_comments.side` and downstream.

## Renderer changes

### resolveSide helper

New helper inside `useSolveCommentZones.tsx`:

```ts
function resolveSide(
    comment: SolveCommentInfo,
    originalModel: monaco.editor.ITextModel | null,
    modifiedModel: monaco.editor.ITextModel | null
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

Replace existing `commentSide(c)` call sites with
`resolveSide(c, originalModel, modifiedModel)`. Models are read once per effect
via `editor.getOriginalEditor().getModel()` and
`editor.getModifiedEditor().getModel()`.

### File-level comment placement

Comments with `lineNumber: null` already fall through to `lineNumber ?? 1` in
the byLine grouping. Confirm this still anchors to line 1 of the modified pane
(RIGHT) and verify the inline card renders at the file's first line.

### Inline-mode banner

`SolveDiffPane.tsx`: add a `useMemo` that counts comments resolving to LEFT
when models are available. When `diffMode === "inline"` and that count > 0,
render a thin banner above the diff editor:

```
ⓘ 3 comments are on deleted lines — switch to Split view
```

Style: matches existing header bar tokens (border, bg-surface, 11px text). The
"Split view" text is a button that calls `setDiffMode("split")`.

The banner is in the diff pane (not the hook) because it's UI not editor state,
and because the count depends on `diffMode` which the hook doesn't observe.

### Already-shipped renderer pieces (keep)

- Per-side glyph rendering in gutter when toggle Off (commit `835ca2dd`)
- Active-line decoration (`solve-comment-active-line` + gutter bar) regardless
  of toggle (commit `835ca2dd`)
- Correct-pane reveal in `SolveDiffPane` `revealLineInCenter` effect
  (commit `835ca2dd`)

These all already use `comment.side` (via `commentSide`); they get the
`resolveSide` upgrade automatically.

## Testing

### Unit — renderer

New test file `apps/desktop/tests/resolveSide.test.ts`:

| # | side | lineNumber | mod lines | orig lines | expected |
|---|------|------------|-----------|------------|----------|
| 1 | "LEFT" | 5 | 100 | 100 | LEFT |
| 2 | "RIGHT" | 5 | 100 | 100 | RIGHT |
| 3 | null | null | 100 | 100 | RIGHT |
| 4 | null | 50 | 10 | 100 | LEFT |
| 5 | null | 50 | 100 | 100 | RIGHT |
| 6 | null | 5 | 100 | 100 | RIGHT |

`resolveSide` is exported from `useSolveCommentZones.tsx` for testability (it's
a pure function so this is cheap).

### Unit — schema

New test in `apps/desktop/tests/schema-comment-solver.test.ts` (or extend an
existing one): assert `pr_comment_cache.side` column exists after migrations
run. Use the in-memory SQLite helper if one already exists; otherwise add one.

### Unit — poller

Extend an existing poller test (or create `apps/desktop/tests/comment-poller.test.ts`):
feed a mock `git.getPRCommentsIfChanged` returning one comment with
`side: "LEFT"`, assert the cache row stores `side === "LEFT"`.

### No DOM tests

Per project policy (and prior spec), no DOM/Monaco tests. View-zone routing is
exercised via the manual smoke walkthrough.

### Manual smoke

After implementation, in `bun run dev`:

1. Open a PR with at least one comment on a deleted line and one on a modified
   line. Trigger a fresh poll (`comment-poller` wipe-and-rewrite) so the
   cache repopulates with `side`.
2. Solve session, open the file with the deleted-line comment in split mode.
3. Verify: inline card appears in the original (left) pane at the deleted
   line; active-line decoration tints that line; clicking the sidebar card
   scrolls original pane to it.
4. Switch to inline mode. Verify: banner appears at top of editor with the
   count and a clickable "Split view" link.
5. Comment on a modified line: inline card in modified (right) pane, active-line
   decoration in modified pane.
6. File-level comment (lineNumber null): inline card pinned at line 1 of
   modified pane.

## Acceptance criteria

1. `pr_comment_cache.side` column exists; migration runs cleanly on existing
   databases via `initializeDatabase()` startup path.
2. Polling a GitHub PR with mixed-side comments produces cache rows with the
   correct `side` values.
3. Comments on deleted lines render inline cards in the original (left) pane
   in split mode.
4. Comments on added/modified lines render inline cards in the modified (right)
   pane in split mode.
5. File-level comments (lineNumber null) render inline cards anchored to line 1
   of the modified pane.
6. Inline mode shows a banner with a count when there are deleted-line
   comments; clicking "Split view" switches mode.
7. `resolveSide` unit tests pass for all six cases above.
8. `bun run type-check` clean. Biome check on touched files clean (no new
   warnings).
9. Existing 25 solve-session-store + solve-sidebar tests still pass.

## Out of scope

- Code-snippet preview in sidebar — explicitly rejected by user.
- Minimap markers, overview-ruler ticks — explicitly rejected.
- Backfill of `side` for already-cached PR comments — the poller wipe-and-rewrite
  handles this on next poll.
- Inline-diff-mode rendering of LEFT-side comments — banner only.
- Bitbucket / other provider `side` support.
