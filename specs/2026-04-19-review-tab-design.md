# Review Tab — Design Spec

**Date:** 2026-04-19
**Branch:** `sup-33/improve-review-process-v2`
**Status:** Design — approved; implementation plan pending.

---

## 1. Problem

The right-sidebar Changes panel (`DiffPanel.tsx` → `BranchChanges.tsx` + working-changes section) lists working-tree and branch-diff files, but navigating them is slow: every file click opens a new `diff-file` tab; there are no keyboard shortcuts; there is no "reviewed" tracking; there is no integrated flow for editing a file while reviewing it.

## 2. Goal

Build a new **Review tab** — a workspace tab (alongside terminal and file tabs) — that drives review of working-tree + branch changes via keyboard: `j`/`k` to move between files, `1`/`2`/`3` to scope (All / Working / Branch), `e` to open the current file for editing in a split pane, `v` to mark viewed, `Esc` to close the edit pane. Clicking any file in the existing right-sidebar Changes list opens the Review tab focused on that file — replacing the current `openDiffFile` behavior for working/branch sources (commit/PR diffs still use `diff-file`). The sidebar highlights the currently-selected file and dims files outside the active scope.

## 3. Non-goals

- Not touching the `diff-file` tab flow for commit / PR viewing.
- Not adding a new file list inside the Review tab (sidebar is the list).
- Not rebuilding the diff renderer — reuse existing `DiffEditor` and `FileEditor`.
- No server-side review coordination (single-user local feature).
- No per-line comments, suggestions, or approval state — out of scope.

## 4. User-facing behavior

### Opening the Review tab
- **Shortcut** `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Win/Linux) — opens or focuses Review tab for the active workspace. If the tab is created fresh (not already open), scope defaults to `"all"` and `selectedFilePath` is set to the first file in the merged working+branch list (or `null` if both are empty).
- **Sidebar click** — clicking any file in working-changes or branch-changes sections opens/focuses Review tab with that file selected. Scope is set to the section clicked (click in working-changes → scope `"working"`; click in branch-changes → scope `"branch"`). If a Review tab is already open, it is reused and its scope is updated to the clicked section.
- No dedicated button is added.

### Keybinds (active only when Review tab is the focused tab and no input/Monaco has focus)

| Key   | Action                                              |
|-------|-----------------------------------------------------|
| `j`   | Next file in scope (stop at end, no wrap)           |
| `k`   | Previous file in scope (stop at start, no wrap)     |
| `1`   | Set scope = All                                     |
| `2`   | Set scope = Working                                 |
| `3`   | Set scope = Branch                                  |
| `v`   | Toggle viewed for current file                      |
| `e`   | Open current file in editable split pane (right)    |
| `Esc` | Close edit split pane (when one is open)            |

### Scope filter
- Review tab traverses files of the active scope. Sidebar **always shows all files** but applies `opacity-40` to files outside the active scope (not hidden).
- Switching scope while the currently-selected file is out-of-scope → selects the first file of the new scope.
- Empty scope → Review tab shows "No {scope} changes"; j/k/e/v become no-ops.

### Viewed state (persisted, content-hash invalidated)
- `v` marks the current file as viewed for the current workspace, storing its current SHA-256 content hash.
- Viewed rows in the sidebar show a green dot (matching the existing pattern for viewed files).
- If the file's content changes after it was marked viewed, the hash mismatch auto-unmarks it (no DB write needed — comparison is live).
- Pressing `v` on an already-viewed file unmarks it (deletes the row).
- Progress bar on the Review tab shows `{reviewedCount} of {totalInScope} reviewed` + percentage.

### Edit pane (`e` → split)
- Press `e` → split the Review tab's pane horizontally. Review stays left, a `file` tab opens right with the current file in `FileEditor` (editable).
- Pressing `e` again on a different file **reuses** the same split pane (swap the file tab in place — no pane churn, no flicker).
- Edits auto-save on 500 ms debounce (existing FileEditor behavior).
- **Optimistic refresh**: on save, the modified content is immediately written to an in-memory overlay in `review-session-store`. The Review tab's `DiffEditor` reads the modified side as `overlay.get(path) ?? queryData.modified`. On the next `getWorkingTreeDiff` refetch (triggered by `saveFileContent`'s mutation invalidation), the overlay is cleared and the server result becomes the truth. This avoids both flicker and stale-display.
- `Esc` closes the edit split pane. Any unflushed debounced save is force-flushed first. If the save errors, the pane stays open with an inline error banner.

### Tab close
- Closing the Review tab clears `activeSession` in the store: sidebar highlight/dim is removed; the edit split pane (if open) closes too.

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Workspace                                                       │
│ ┌─────────────────────────────────┐  ┌───────────────────────┐  │
│ │ Pane row (tabs: term, review…)  │  │ Right sidebar         │  │
│ │ ┌─────────────┬───────────────┐ │  │ DiffPanel             │  │
│ │ │ ReviewTab   │ FileEditor    │ │  │ ├─ WorkingChanges     │  │
│ │ │ (diff)      │ (edit pane,   │ │  │ └─ BranchChanges      │  │
│ │ │             │  on `e`)      │ │  │     ↑ highlights +    │  │
│ │ └─────────────┴───────────────┘ │  │       dims by scope   │  │
│ └─────────────────────────────────┘  └───────────────────────┘  │
│                                                                 │
│  review-session-store (Zustand) ← single source of truth        │
│     { activeSession: { scope, selectedFilePath, viewedCache,    │
│                        editSplitPaneId, editOverlay } | null }  │
│                                                                 │
│  action-store registers: j k e v esc 1 2 3   (when review tab)  │
│  Cmd+Shift+R → open/focus Review tab (global, workspace-wide)   │
│                                                                 │
│  tRPC review router → SQLite `review_viewed`                    │
│  tRPC diff router (existing) → getFileContent, saveFileContent  │
└─────────────────────────────────────────────────────────────────┘
```

State lives in a new `review-session-store` (Zustand). Both the Review tab and the sidebar subscribe to it; this is the only cross-component channel. Keybinds are registered in the existing `action-store` with a `when` guard, giving them free command-palette integration.

## 6. Components and files

### New files

| Path                                                                                 | Purpose                                                  |
|--------------------------------------------------------------------------------------|----------------------------------------------------------|
| `apps/desktop/src/renderer/stores/review-session-store.ts`                            | Zustand store (the session, scope, selection, overlay)   |
| `apps/desktop/src/renderer/components/review/ReviewTab.tsx`                           | Tab content — `DiffEditor` + progress bar + empty state  |
| `apps/desktop/src/renderer/components/review/ReviewProgressBar.tsx`                   | "X of Y reviewed" + percentage                           |
| `apps/desktop/src/renderer/actions/review-actions.ts`                                 | Registers j/k/e/v/esc/1/2/3 + `Cmd+Shift+R`              |
| `apps/desktop/src/main/trpc/routers/review.ts`                                        | `getViewed`, `setViewed`, `unsetViewed`                  |
| `apps/desktop/src/main/db/migrations/XXXX_add_review_viewed_table.sql`                | Drizzle migration (descriptive name per CLAUDE.md)       |
| `apps/desktop/src/shared/review-types.ts`                                             | `ReviewScope`, `ReviewSession`, `ViewedEntry`            |

### Modified files

| Path                                                        | Change                                                                                                  |
|-------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `apps/desktop/src/renderer/stores/tab-store.ts`             | Add `review` kind to `TabItem` union; `openReviewTab(workspaceId, args)` action; `closeReviewTab` helper |
| `apps/desktop/src/renderer/components/panes/PaneContent.tsx` | Dispatch `review` kind → `<ReviewTab>`                                                                  |
| `apps/desktop/src/renderer/components/panes/PaneTabBar.tsx` | Tab icon for `review`                                                                                   |
| `apps/desktop/src/renderer/components/BranchChanges.tsx`    | Subscribe to `review-session-store`: highlight `selectedFilePath`, dim out-of-scope rows; click handler calls `openReviewTab(scope: "branch", filePath)` |
| Working-changes component (in `DiffPanel.tsx` or its own file; locate during implementation) | Same treatment as BranchChanges (scope: "working")        |
| `apps/desktop/src/main/db/schema.ts`                        | Add `reviewViewed` table definition                                                                     |
| `apps/desktop/src/main/trpc/router.ts` (or equivalent root) | Mount `review` router                                                                                   |
| `apps/desktop/src/renderer/actions/core-actions.ts`         | Register `Cmd+Shift+R` → `openReviewTab`                                                                |

### Store shape

```ts
interface ReviewSession {
  workspaceId: string;
  scope: "all" | "working" | "branch";
  selectedFilePath: string | null;
  editSplitPaneId: string | null;
  editOverlay: Map<string, string>; // in-memory optimistic content by filePath
}

interface ReviewSessionStore {
  activeSession: ReviewSession | null;

  openReviewTab: (workspaceId: string, args?: { scope?: ReviewScope; filePath?: string }) => void;
  closeReviewTab: () => void;

  selectFile: (path: string) => void;
  nextFile: (files: DiffFile[]) => void;  // stop-at-end
  prevFile: (files: DiffFile[]) => void;  // stop-at-start

  setScope: (scope: ReviewScope) => void;

  toggleViewed: (path: string, contentHash: string) => Promise<void>;
  isViewed: (path: string, currentHash: string) => boolean;

  openEditSplit: (file: DiffFile) => void;
  closeEditSplit: () => Promise<void>;
  pushOptimisticContent: (path: string, content: string) => void;
  clearOptimisticContent: (path: string) => void;
}
```

## 7. Data flow

### Sidebar click → Review tab
1. User clicks a file in `BranchChanges` or working-changes.
2. Click handler calls `reviewSessionStore.openReviewTab(workspaceId, { scope: <clicked_section>, filePath })`.
3. Store checks `tab-store` for an existing `review` tab in this workspace; reuses if present, else creates one via `tab-store.addReviewTab()`.
4. Store sets `activeSession = { workspaceId, scope, selectedFilePath: filePath, editSplitPaneId: null, editOverlay: new Map() }`.
5. Review tab mounts, subscribes to `getWorkingTreeDiff` + `getBranchDiff`, computes `scopedFiles`, locates `selectedFile`.

### j / k navigation
1. Action fires (only when Review tab is focused tab and no input has focus).
2. `nextFile(scopedFiles)` / `prevFile(scopedFiles)` — compute new index, clamp to [0, len-1] (stop at ends).
3. Store updates `selectedFilePath`.
4. Review tab re-renders with new diff. Sidebar re-renders highlight.

### 1 / 2 / 3 scope change
1. Action fires. `setScope(newScope)`.
2. Store recomputes scoped list.
3. If `selectedFilePath` ∉ scoped → select first in scoped (or `null` if empty).
4. Sidebar re-renders dim classes.

### `v` toggle viewed
1. Get current SHA-256 hash of the file's working-tree content (computed in renderer, cached 5s in store to avoid rehashing on every sidebar render).
2. If `isViewed` → mutation `unsetViewed({ workspaceId, filePath })`.
3. Else → mutation `setViewed({ workspaceId, filePath, contentHash })`.
4. Optimistic cache update to avoid sidebar flicker. Invalidate `getViewed` on success.

### `e` edit split
1. Action fires.
2. `openEditSplit(selectedFile)`:
   - If `editSplitPaneId` is set and pane still alive AND the pane's active tab is already for `selectedFile.path` → no-op on pane/tab state; just shift keyboard focus to the edit pane.
   - Else if `editSplitPaneId` is set and pane alive but for a different file → **reuse pane**: swap in a new `file` tab for `selectedFile` (new Monaco model, since it's a different file; pane container is preserved so no layout flicker).
   - Else → call `paneStore.splitPane(reviewPaneId, "horizontal", fileTab)`, store returned pane id in `editSplitPaneId`.
3. Editor mounts, takes focus.

### Save in edit pane (optimistic flow)
1. User types → FileEditor debounces 500 ms.
2. On debounce fire: `pushOptimisticContent(filePath, content)` → `saveFileContent` mutation.
3. Review tab's `DiffEditor` modified-side reads `editOverlay.get(path) ?? query.modified`. Monaco `setValue` is called only when the string differs from the current model value (avoids cursor jump inside the diff editor when it's focused somewhere else, though Review diff is read-only).
4. Mutation success → invalidates `getWorkingTreeDiff` → React Query refetches.
5. On refetch settle, `clearOptimisticContent(path)` — server truth takes over.
6. Mutation error → toast error → clear overlay → DiffEditor snaps back to server truth. Edit pane keeps its own content (user can retry).

### `Esc` close edit pane
1. Action fires.
2. `closeEditSplit()` → force-flush any pending FileEditor debounced save (await save mutation).
3. On success: `paneStore.removePane(editSplitPaneId)`; `activeSession.editSplitPaneId = null`; clear `editOverlay` for that file.
4. On save error: keep pane open; show inline banner "Failed to save, retry or close without saving?"; user chooses.

## 8. Schema + migration

```ts
// apps/desktop/src/main/db/schema.ts (add)
export const reviewViewed = sqliteTable(
  "review_viewed",
  {
    workspaceId: text("workspace_id").notNull(),
    filePath:    text("file_path").notNull(),
    contentHash: text("content_hash").notNull(),
    viewedAt:    integer("viewed_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.filePath] }),
    index("idx_review_viewed_workspace").on(t.workspaceId),
  ],
);
```

Generate migration with descriptive name:
```
bun run db:generate --name add_review_viewed_table
```
(Per CLAUDE.md rule — never use default auto-generated names.)

## 9. Error handling and edge cases

| Situation                                        | Behavior                                                                                                |
|--------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| File deleted while selected                      | Select next in scope; if scope empty, `selectedFilePath = null` + empty state.                          |
| File deleted while edit pane open                | FileEditor shows "File no longer exists"; auto-close pane after 2s; clear `editSplitPaneId`.            |
| Save error                                       | Toast + clear overlay → diff snaps back to server; edit pane retains its content.                       |
| Concurrent external edit (e.g., terminal)        | Poll picks up change; if overlay present, keep overlay (last-write-wins); else DiffEditor updates.       |
| Scope filter empties current file                | On scope change, select first in-scope file; edit pane stays showing old file until `Esc`.              |
| Keybinds while typing                            | Doc-level keydown guarded: `activeTab.kind === "review"` AND `activeElement` not in input/textarea/Monaco. `Esc` intercepted inside edit Monaco only when edit pane is open. |
| Review tab closed mid-session                    | Store `activeSession = null`; sidebar highlight/dim cleared; edit pane closed.                          |
| Workspace switch                                 | Each `activeSession` is workspace-scoped. Switch → new empty session (or existing tab if already opened). |
| Migration idempotency                            | Drizzle auto-applies on startup; migration uses standard Drizzle generation.                            |

## 10. Testing

### Unit (`bun test`)
- `review-session-store.test.ts`
  - `nextFile` / `prevFile` stop at ends.
  - Scope filter selects first in-scope file when current out-of-scope.
  - Optimistic overlay set/clear.
  - Viewed hash comparison: stored hash matches → viewed; differs → not viewed.
- `review.router.test.ts`
  - `setViewed` / `getViewed` / `unsetViewed` with real SQLite (existing test DB pattern).
  - Primary-key conflict handled (upsert).

### Integration
- `ReviewTab.test.tsx` — mount with mocked diff queries; assert j/k moves selection; `e` dispatches `splitPane`; `v` calls `setViewed`.
- `sidebar-highlight.test.tsx` — change store `scope` + `selectedFilePath`; assert `BranchChanges` rows apply correct highlight / dim classes.

### Manual acceptance (before PR)
- Click branch file → Review tab opens with that file selected.
- Click working file → same, with scope = working.
- `Cmd+Shift+R` → Review tab opens/focuses.
- `j`/`k` moves through scoped files; stops at ends.
- `1`/`2`/`3` switches scope; sidebar dims non-scope files; selection jumps in if out-of-scope.
- `e` → split pane opens with editable file; type + wait 500 ms → save; diff on left updates without flicker (optimistic path).
- `e` on different file → reuses same split pane (no extra pane created).
- `Esc` → closes edit pane, Review back to full width.
- `v` → green dot appears in sidebar; restart app → still marked; edit file externally → mark disappears (hash mismatch).
- Close Review tab → sidebar highlight/dim cleared.

## 11. Out of scope for this iteration
- Viewed-state sync across devices.
- Review sessions that span multiple commits or PR contexts.
- Inline comments / approval / request-changes flow.
- Customizable keybinds (use existing action-store defaults; user can rebind via command palette once that exists).

## 12. Follow-ups (explicitly deferred)
- Persist `activeSession` across app restart (currently session is in-memory only; user reopens Review tab on next launch).
- Scope badges on sidebar section headers (e.g., "Working 3 reviewed / 5 total"). Useful but not needed for MVP.
- Sub-tab support for diff vs inline toggle inside Review tab — inherit from existing `DiffEditor` split/inline button.
