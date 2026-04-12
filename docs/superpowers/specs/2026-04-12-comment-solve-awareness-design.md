# Comment Solve Awareness — Design Spec

**Goal:** Make the Comments tab and Fixes tab aware of solve session state so users can see which comments were addressed, which are new, and navigate back to completed sessions.

**Three changes:**
1. Comments tab gets status badges + filter bar
2. Fixes tab shows submitted sessions and session history (instead of going blank)
3. "New" comment detection via set difference (no new backend polling logic)

---

## 1. Comments Tab — Badges + Filters

### New tRPC query: `getCommentSolveStatuses`

Returns a map of `platformCommentId → status` for a given workspace, where status is `"addressed"` or `"new"`.

**Logic:**
- Query all non-dismissed `commentSolveSessions` for the workspace
- If none exist, return empty map (no badges, no filters)
- Collect all `prComments.platformCommentId` from those sessions where `prComments.status` is `fixed`, `wont_fix`, or `unclear` → these are **addressed**
- Collect all `prCommentCache.platformCommentId` for the workspace
- Any cache ID not found in ANY session's `prComments` (regardless of status) → these are **new** (only when at least one submitted/ready session exists)
- Return `Record<string, "addressed" | "new">`

**Why a separate query:** `getWorkspaceComments` returns raw cache data and is used broadly. Adding session joins there would couple the two concerns. A separate query keeps them independent and is cheap to call alongside.

### Filter bar

Rendered in `CommentsOverviewTab` only when the status map is non-empty (i.e., at least one session exists).

**Pills:** All (count) | Addressed (count) | New (count) | Unaddressed (count)

- "All" is selected by default
- Selecting a filter is client-side — filters the `threads` array before rendering
- Counts derived from the status map + thread list
- "Unaddressed" count = threads with no entry in the status map

### Per-comment badges

On each `CommentThreadCard`, show a small pill badge in the header row (right-aligned, next to the existing Skip button):

- **"AI Addressed"** — green pill (`rgba(52,199,89,0.15)` bg, `#34c759` text). Shown when status map entry is `"addressed"`.
- **"New"** — orange pill (`rgba(255,159,10,0.12)` bg, `#ff9f0a` text). Shown when status map entry is `"new"`.
- **No badge** — comment has no entry in the status map (either no sessions exist, or comment was included in a session but is still `"open"`).

### Solve button behavior

When at least one submitted session exists:
- Pre-populate `skippedIds` with platformCommentIds that have status `"addressed"` in the status map
- This means "Solve with AI" defaults to targeting only new + unaddressed comments
- User can still un-skip addressed comments if they want to re-solve them

---

## 2. Fixes Tab — Submitted State + Session History

### Submitted session display

Currently `AIFixesTab` renders `ActiveState` only when `fullSession.status === "ready"`. Extend the condition to also include `"submitted"`.

The `ActiveState` component already shows the right compact layout (group list with status icons). For submitted sessions, all groups will show `✓` status. The "Open Solve Review" button stays functional — it opens the SolveReviewTab for that session so users can review what was done.

### New comments nudge

When the latest session has status `"submitted"`, check for new comments:
- Reuse the same `getCommentSolveStatuses` query
- Count entries with status `"new"`
- If count > 0, show an orange callout between the group list and the action button:

```
┌─────────────────────────────────────┐
│ 🟠 2 new comments since last solve  │
│    Open Comments tab to review       │
└─────────────────────────────────────┘
```

The callout text is a button that calls `useTabStore.getState().setActiveTab(...)` to switch to the Comments tab for this workspace.

### Session history list

Below the latest session summary (or below the empty state), render a history of all sessions for this workspace.

**Data:** Use the existing `getSolveSessions` query which returns all non-dismissed sessions. Sort newest-first (already done in `AIFixesTab`).

**Rendering:**
- Section header: "Solve History"
- Each row: session label (number based on creation order), status badge (colored pill: green "Submitted", blue "Ready", gray "Dismissed", red "Failed", blue "In Progress"), group count, comment count, relative timestamp
- Click handler: `useTabStore.getState().addSolveReviewTab(workspaceId, session.id)`
- Dismissed sessions: shown at 60% opacity
- Always visible (even when no active session — shows history of past work)

**Session numbering:** Sessions are numbered by creation order within the workspace. The query already returns them sorted by `createdAt`, so the index in the array (reversed) gives the number.

---

## 3. Data Flow

```
prCommentCache (platform comments)
    │
    ├── platformCommentId ──join──► prComments.platformCommentId
    │                                   │
    │                                   ├── status: fixed/wont_fix/unclear → "addressed"
    │                                   └── status: open/changes_requested → (in session but not resolved)
    │
    └── NOT in any prComments ──────────────────────────────► "new" (if submitted session exists)
```

No schema changes needed. No new tables. No new polling logic. The join is done server-side in the new `getCommentSolveStatuses` query.

---

## 4. Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/main/trpc/routers/comment-solver.ts` | Add `getCommentSolveStatuses` query |
| `apps/desktop/src/renderer/components/CommentsOverviewTab.tsx` | Add filter bar, badges, pre-skip logic |
| `apps/desktop/src/renderer/components/CommentThreadCard.tsx` | Accept optional `badge` prop for rendering |
| `apps/desktop/src/renderer/components/AIFixesTab.tsx` | Extend to submitted state, add new-comments nudge, add session history |

---

## 5. Edge Cases

- **No sessions exist:** Status map is empty. No filter bar, no badges, no history. Comments tab behaves exactly as before.
- **Session in progress:** Filter bar still shows based on prior sessions. The in-progress session's comments won't have final statuses yet, so they won't generate "addressed" badges.
- **Comment deleted on platform:** It disappears from `prCommentCache` on next poll. Its `prComments` row still exists but won't match any cache entry, so it's invisible. No orphan cleanup needed for this feature.
- **Multiple sessions for same PR:** Status map merges across all non-dismissed sessions. A comment addressed in session 1 stays "addressed" even if session 2 exists. A comment only in session 2 that's still "open" gets no badge.
- **Re-solving addressed comments:** User can un-skip "addressed" comments in the Comments tab to include them in a new solve. The addressed badge helps them decide whether to re-include.
