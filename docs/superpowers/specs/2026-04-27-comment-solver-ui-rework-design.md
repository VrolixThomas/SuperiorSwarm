# Comment Solver UI Rework — Design

**Date:** 2026-04-27
**Branch:** `rework-comment-solver-ui`
**Status:** Approved (sections 1–5)

## Problem

Reviewing AI-fixed PR comments today requires bouncing between two tabs:

1. The `Solve Review` tab — lists commit groups with their comments and a `Changed files` strip.
2. A spawned `comment-fix-file` tab per file — opens when the user clicks a changed file, shows the Monaco diff for that file alone.

Pain points observed in the current flow:

- **Tab ping-pong.** Every file inspection round-trips through two tabs. Reviewing a 5-file group takes 10+ tab clicks.
- **Implicit page resets.** Returning to `Solve Review` loses scroll context. The auto-active-tab effect (`SolveReviewTab.tsx:38`) yanks focus on status flips. The diff tab always opens at line 1.
- **No visual link comment ↔ change.** The comment that asked for the fix lives inside the `Solve Review` tab card. The code that addresses it lives in a different tab. The user must mentally bridge the two views to verify "did the fix actually do what was asked?"

## Goal

Re-shape the comment solver review so it feels like the existing `ReviewTab` (working/branch changes) and `PRReviewFileTab` (PR review): a single tab with a sidebar-driven file list and a Monaco diff editor, with comments rendered as inline view-zone widgets at the lines they fixed.

## Non-goals

- Cross-group file aggregation ("if the same file is in two groups, show stacked diffs").
- Comment-on-comment threading inside the widget.
- Drift detection between the solve session's commits and the current branch tip.
- Changes to the `commentSolver` tRPC router or the underlying solve session model.

## Architecture

### Tab model

`SolveReviewTab` becomes the only tab involved. The legacy per-file `comment-fix-file` tab kind is removed entirely:

- `apps/desktop/src/renderer/components/CommentFixFileTab.tsx` — deleted.
- `tab-store.openCommentFixFile` — deleted.
- `TabItem` discriminator `kind: "comment-fix-file"` — removed; type guard sites and `findTabInWorkspace` predicates updated.
- File tabs are not persisted across renderer reloads (only terminal sessions are — see `tab-store.hydrate`), so no hydration migration is needed.

The auto-active-tab effect at `SolveReviewTab.tsx:38` is kept — it correctly raises the Solve tab to the front when the session goes `in_progress → ready`. No other code raises focus.

### Per-session UI store

New file: `apps/desktop/src/renderer/stores/solve-session-store.ts`. Mirrors `pr-review-session-store.ts`. Keyed by `solveSessionId`. Holds:

- `selectedFilePath: string | null` — currently-viewed file.
- `expandedGroupIds: Set<string>` — sidebar group expand state.
- `scrollByFilePath: Map<string, number>` — Monaco `scrollTop` per file. Restoring this on selection change is what eliminates the "page resets" feel.
- `activeCommentId: string | null` — drives the active-thread bar and line highlight.
- `fileOrder: string[]` — flattened (group → file) order, recomputed when the session data changes; used for `j/k` navigation.
- `setSelectedFile`, `setScroll`, `getScroll`, `toggleGroupExpanded`, `setActiveComment`, `setFileOrder`, `selectNextFile`, `selectPrevFile`, `selectNextGroup`, `selectPrevGroup` actions.

The store does not persist to disk; it lives for the lifetime of the renderer process. Reopening the Solve tab in a fresh session starts clean.

### Server data

No new tRPC endpoints. Existing endpoints used:

- `commentSolver.getSolveSession` — already wired with 3s polling while queued/in-progress.
- `commentSolver.approveGroup` / `revokeGroup` / `pushGroup` / `pushAndPost` / `cancelSolve` / `dismissSolve` — unchanged.
- `commentSolver.requestFollowUp` / `updateReply` / `approveReply` / `deleteReply` — unchanged.
- `diff.getFileContent` — used per-file with `staleTime: 60_000`. Commit hashes per group are immutable, so the React Query cache effectively never refetches a file content within a session.

## Components

### Layout

```
┌─ SolveReviewTab ───────────────────────────────────────────────┐
│ Header: PR id · branch chip · status · [Cancel solve]          │
│ feat/PR-2879 greentube-error-translations                      │
│ ◉ resolved 6  ○ pending 0  △ unclear 0                         │
│ Approval ··················· 3/5 approved   ━━━━━━░░░          │
├──────────────────┬─────────────────────────────────────────────┤
│ Sidebar (260px)  │  Toolbar: <path> · <hash> · ← N comments → │
│                  │  · Inline/Split · Viewed                   │
│ ▼ Dictionary…    ├─────────────────────────────────────────────┤
│   3/3 [Approve]  │  ActiveCommentBar (when comment focused)   │
│   ⬡ Conv.cs +12 │  ┌─────────────────────────────────────┐   │
│   ⬡ Conv2.cs +1 │  │  DiffEditor (Monaco)                │   │
│ ▼ Drop dual…     │  │  view-zone: SolveCommentWidget      │   │
│   1/1 [Push&post]│  │    line 87: "Unknown — line 8"      │   │
│   ⬡ Foo.cs       │  │    body…  ✓ Fixed  [Follow up]      │   │
│ ▶ Test fixt…     │  │    Draft reply: …  [Edit][Discard]  │   │
│   ✓ Pushed       │  │                  [Approve & post]   │   │
│ ▶ Hotfix vs…     │  │                                     │   │
│   pending        │  └─────────────────────────────────────┘   │
└──────────────────┴─────────────────────────────────────────────┤
│ Bottom bar: [Revert remaining]    [Push 3 approved] (success)  │
└────────────────────────────────────────────────────────────────┘
```

### New components

#### `solve/SolveSidebar.tsx`

Vertical list keyed by group. Each group renders a `SolveSidebarGroup`:

- Header: chevron, group label, ratio badge (`fixed/total`), draft-reply chip (`✉ N draft`), and the `GroupAction` button cluster (Approve / Revoke / Push & post / ✓ Pushed / ● Solving), reused from the current `SolveCommitGroupCard`.
- Body (when expanded): file rows. Each row shows hex tile, filename, `+/−` line counts. Selected row highlighted with `var(--bg-active)`; clicking sets `selectedFilePath` in the store.
- Reverted groups: header dimmed, strikethrough, body never expands.
- Empty-commit groups (no `commitHash`): group header still selectable; body shows zero files.

#### `solve/SolveDiffPane.tsx`

Receives `groupId`, `filePath`. Reads `commitHash` from the session, runs the same `getFileContent(commitHash~1)` / `getFileContent(commitHash)` pair as `CommentFixFileTab` does today, feeds them into `<DiffEditor renderSideBySide={diffMode === "split"} readOnly />`. Toolbar mirrors `PRReviewFileTab`'s: filename, short hash, comment-nav arrows, viewed checkbox (optional, see open question below), Inline/Split toggle.

Inline comments are rendered with a `useInlineCommentZones` hook copied from `PRReviewFileTab.tsx:455-633` and adapted to take `SolveCommentInfo[]` instead of `UnifiedThread[]`. The signature/diff/registry mechanism is preserved verbatim — it is the reason editing a follow-up textarea survives background refetches.

When `commitHash` is null, the diff editor is replaced by a comments-only `<div>` listing each `SolveCommentWidget` vertically.

#### `solve/SolveCommentWidget.tsx`

The body that was inline in `SolveCommitGroupCard.CommentItem`, lifted into a shared component so both the diff view-zone and the comments-only fallback can render it identically. Renders:

- Author avatar + name + line number.
- Markdown body via `MarkdownRenderer`.
- Status pill (`✓ Fixed` / `? Unclear` / `↻ Changes requested` / `— Won't fix` / `Pending`).
- `Follow up` button → expands `<textarea>` with Cancel / Request changes (existing flow, existing mutation).
- Follow-up display when `comment.followUpText` set.
- `DraftReplySignoff` block (extracted from current card) when `comment.reply?.status === "draft"`.

#### `solve/SolveActiveCommentBar.tsx`

Mirrors `ActiveThreadBar`. Sits above the diff editor when `activeCommentId` is set and that comment is in the current file. Shows author, line, status, and quick actions: `Follow up`, `Approve & post` (when there's a draft reply), `Center` (re-reveals the line in the editor).

### Reused as-is

- `DiffEditor` (Monaco wrapper).
- `MarkdownRenderer`.
- `GroupAction` cluster from current `SolveCommitGroupCard` (extracted into `solve/GroupAction.tsx`).
- `RatioBadge` (extracted similarly).
- `ReviewHintBar` for the bottom hint strip.
- The current `PRHeader`, `ProgressStrip`, `BottomBar` sub-components inside `SolveReviewTab.tsx` — unchanged in markup, repositioned around the new sidebar/main layout.

### Removed

- `apps/desktop/src/renderer/components/CommentFixFileTab.tsx`
- `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx` (entirely; its parts are extracted into the components above)
- `tab-store.openCommentFixFile` action and the `comment-fix-file` tab kind
- The `ChangedFilesSection`, `CommentsAddressedSection`, and `CommentItem` sub-components inside `SolveCommitGroupCard.tsx` (their content moves into `SolveSidebar` and `SolveCommentWidget`).

## Data flow

### Selection drives queries

When `selectedFilePath` (and therefore the implied `selectedGroup`) changes:

```ts
const selectedFile = sidebarFiles.find(f => f.path === selectedFilePath);
const selectedGroup = groups.find(g => g.id === selectedFile.groupId);
const commitHash = selectedGroup.commitHash;

const originalQuery = trpc.diff.getFileContent.useQuery(
  { repoPath, ref: `${commitHash}~1`, filePath: selectedFile.path },
  { enabled: !!commitHash, staleTime: 60_000 }
);
const modifiedQuery = trpc.diff.getFileContent.useQuery(
  { repoPath, ref: commitHash, filePath: selectedFile.path },
  { enabled: !!commitHash, staleTime: 60_000 }
);

const fileComments = useMemo(
  () => selectedGroup.comments.filter(c => c.filePath === selectedFile.path),
  [selectedGroup.comments, selectedFile.path]
);
```

`fileComments` memo is keyed on `[selectedGroup.comments, selectedFile.path]` so that background refetches that produce structurally-equivalent comment data don't churn the view-zones — `useInlineCommentZones` already diffs by signature, but skipping the prop change at the React boundary saves the diff entirely in the common case.

### Cache strategy

- Commit hashes are immutable per group. Once a file is fetched, switching away and back never refetches.
- `selectedGroup.comments` is read from the in-memory session query data; no per-comment queries.
- Per-file scroll position lives in the store. When `selectedFilePath` changes, the diff pane reads the stored `scrollTop` and seeds the editor with it on first paint (matches `PRReviewFileTab.tsx:1182-1198` pattern).

### Mutations

Existing mutations all retain their `onSuccess: () => utils.commentSolver.invalidate()` shape. The session refetch flows through `getSolveSession`, which is the single source of truth for groups, comments, and reply state.

### Auto-selection

- **On tab mount:** if `selectedFilePath` is unset, pick the first file of the first non-reverted, non-empty-commit group.
- **On session refetch:** if the previously-selected file no longer exists (rare — only on revert), fall back to the same first-file rule. Otherwise keep the user's selection.
- **On group status flip while a file is selected:** never reselect. The sidebar action button updates; the diff pane stays on the user's file.
- **On status `in_progress → ready`:** the existing tab-focus effect raises the Solve Review tab. No file selection change.

## Keyboard & interaction

The Solve Review tab uses the same event-bus pattern as PR review (`apps/desktop/src/renderer/lib/pr-review-events.ts`). Add `solve-review-events.ts` mirroring it.

| Key | Action |
|-----|--------|
| `j` / `k` | Next / prev file in `fileOrder` |
| `J` / `K` | Next / prev group (jump to first file of group) |
| `n` / `N` | Next / prev unresolved comment within current file |
| `Enter` | Open follow-up textarea on the active comment |
| `a` | Approve current group |
| `r` | Revoke current group |
| `p` | Push current group; if no group is focused, push-all |
| `Esc` | Clear active comment / close any open follow-up textarea |
| `[` / `]` | Collapse / expand current sidebar group |
| `Cmd+\` | Toggle sidebar visibility |

A `ReviewHintBar` strip at the bottom of the diff pane surfaces the most-used keys.

### Focus rules

- Tab loads → main pane focused so `j/k` works immediately (mirrors `ReviewTab`).
- Follow-up textarea focused → swallows `j/k`/`a`/`p`/`r`.
- `Esc` on textarea → close textarea, restore focus to main pane.

### Live-solving state

While `session.status === "in_progress"`:

- Sidebar groups with `status === "pending"` show the existing blink dot + "Solving" label.
- Their file list is replaced by a 1–3 line skeleton until `commitHash` materializes.
- Already-completed groups remain interactive (approve, push, follow-up).
- Header `Cancel solve` button stays visible.

## Edge cases

| Case | Handling |
|------|----------|
| Group `commitHash` is null (no code change, comments only) | Sidebar group has no files. Selecting the group header shows comments-only stack in main pane (no diff editor). |
| Group `status === "reverted"` | Sidebar item dimmed + strikethrough, not selectable, files hidden, `j/k` skips it. |
| Comment `lineNumber === null` (file-level comment) | Rendered in a "File comments" view-zone at line 1, prefixed `↳ file-level`. |
| Comment whose `filePath` isn't in `changedFiles` (commented on but unchanged) | Listed in sidebar under the group, marked `(unchanged)`. Diff pane fetches `getFileContent(commitHash)` for both sides, yielding an empty diff with the comments inline. |
| Background refetch while editing a follow-up textarea | View-zone diff-by-signature preserves the React root; textarea state survives. |
| Group flips `pending → ready` while user is on one of its files | File appears in sidebar, no auto-jump. If the first group was solving and is now ready and previously had `defaultExpanded`, expand it. |
| Push success | `GroupAction` flips to `✓ Pushed`. Selected file stays selected. |
| Session is `queued` | Empty pane: "Waiting for solver…". Sidebar empty until first group lands. |
| Session is `cancelled` | Sidebar shows whatever groups landed before cancel. The current "Re-solve remaining comments" button stays as today (still TODO-disabled). |
| Tab is closed and reopened mid-session | Store is lost (intentional). Auto-select rule reapplies. |

## Migration plan

Each step compiles, lints, and runs:

1. **Extract sub-components.** Pull `CommentItem` and `DraftReplySignoff` out of `SolveCommitGroupCard.tsx` into `solve/SolveCommentWidget.tsx`. Pull `GroupAction` and `RatioBadge` out into `solve/GroupAction.tsx` and `solve/RatioBadge.tsx`. No behavior change. `SolveCommitGroupCard.tsx` re-imports them.
2. **Add `solve-session-store.ts`** with the shape described above. Not yet wired.
3. **Add `solve-review-events.ts`** mirroring `pr-review-events.ts`. Not yet wired.
4. **Build `solve/SolveSidebar.tsx`** using the extracted `GroupAction` / `RatioBadge`. Not yet wired into the tab.
5. **Build `solve/SolveDiffPane.tsx`** with the `useInlineCommentZones` adaptation. Not yet wired.
6. **Build `solve/SolveActiveCommentBar.tsx`**.
7. **Wire `SolveReviewTab.tsx`** to the new layout. Header / progress strip / bottom bar move into the new shell as siblings of the new sidebar/main pane. The old commit-group card list is replaced by `<SolveSidebar />` + `<SolveDiffPane />`.
8. **Add keyboard handlers** in `SolveReviewTab.tsx` using the new event bus. Wire `[ ]`, `j/k`, `J/K`, `n/N`, `a`, `r`, `p`, `Enter`, `Esc`, `Cmd+\`.
9. **Delete legacy.** Remove `CommentFixFileTab.tsx`, `tab-store.openCommentFixFile`, the `comment-fix-file` discriminator, and any `findTabInWorkspace` predicates referencing it. Drop `SolveCommitGroupCard.tsx` once nothing imports it.

## Testing

- **Unit:** `solve-session-store` selection invariants (no out-of-bounds, no select on a reverted group, scroll persistence round-trip, `fileOrder` rebuild on session refetch).
- **Component:** `SolveSidebar` — group expand/collapse, action button per status, reverted styling, empty-commit-group rendering. `SolveCommentWidget` — status colors, follow-up flow, draft-reply sign-off.
- **Integration:** render `SolveReviewTab` with mocked `getSolveSession` data covering: pending session, mid-solve session, ready session with mixed group states, all-pushed session, reverted-group session. Verify `j/k` cycles files, `n` cycles unresolved comments, `a/p/r` call the right mutations, sidebar reflects status flips without remounting the editor (assert editor instance identity stable across refetch).
- **Existing tests:** `commentSolver` tRPC tests untouched. PR review tests unaffected.

## Open questions

- **Viewed checkbox?** PR review has per-file viewed state. Solve review's notion of "I've checked this fix" is closer to "I've approved this group", which is already a separate concept. Recommend: omit the per-file viewed checkbox in phase 1 to avoid duplicating semantics. Revisit if users want a per-file ack distinct from group approval.
- **Hint bar wording.** The exact hint strings in `ReviewHintBar` should match what's already established in `ReviewTab`/`PRReviewFileTab` for consistency. Final copy decided during implementation.

## Phase 2 candidates

- Cross-group file aggregation (same file in multiple groups, stacked diffs).
- Comment-on-comment threading inside the widget.
- Drift detection between session commits and the current branch tip.
- Per-file viewed state if user feedback requests it.
