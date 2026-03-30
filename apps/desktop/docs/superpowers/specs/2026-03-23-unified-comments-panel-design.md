# Unified Comments Panel — Design Spec

**Date:** 2026-03-23
**Status:** Approved

## Overview

Unify the right panel experience for workspaces with linked PRs. Instead of a separate `"comment-solve"` panel mode that replaces the entire right panel, add a "Comments" tab alongside the existing "Changes" and "Files" tabs. The Comments tab shows PR review comments at all times and provides the solve trigger, review, and push workflow.

## Problem

The current implementation has two separate right panel experiences — the standard `Changes | Files` panel and the `CommentSolvePanel` which completely replaces it. Users can't navigate back, the comment UI only appears after triggering a solve, and there's no awareness of comments until the solver runs.

## Design

### 1. Unified Tab Bar

The right panel tab bar extends from `Changes | Files` to `Changes | Files | Comments` when the active workspace has `prProvider` and `prIdentifier` set (linked to a PR). Tab order is fixed: Changes, Files, Comments.

- The existing global `PanelMode` keeps `"diff" | "explorer" | "pr-review"` — the `"comment-solve"` value is removed. The Comments tab is **not** a new panel mode but a local `useState` within `DiffPanelContent` that overlays on top of the existing modes.
- When the local tab is "changes" or "files", the existing `PanelMode`-based rendering applies as before (`togglePanelMode()` switches between `"diff"` and `"explorer"`). When the local tab is "comments", the `CommentsTab` component renders instead.
- The Comments tab badge shows unresolved comment count

### 2. Comments Tab — Three States

#### State 1: Unsolved (no active session)

- PR header: title, number, branch info
- Comment cards matching `PRControlRail`'s `CommentThreadCard` styling patterns (Tailwind classes: `rounded-[6px] border-[var(--border-subtle)] bg-[var(--bg-surface)]`)
- Each comment shows: author avatar+name, file:line (monospace), comment body
- **Skip-to-exclude**: all comments included by default. Clicking a comment toggles "Skipped" state (dims to 40% opacity, "Skipped" badge). Skipped comments are excluded from the solve.
- Bottom: "Solve Comments with AI (N of M)" button

#### State 2: In progress

- PR header with "solving..." status
- Spinner with "AI is analyzing and fixing comments..."
- Note: "Watch progress in the AI Solver terminal tab"
- Auto-refetch while session is queued/in_progress

#### State 3: Solved (session ready)

- PR header with dismiss button
- Groups listed with their changed files:
  - Group header: label, status badge (Fixed/Approved/Reverted/Pending), commit hash. Note: "Unclear" is a comment-level status, not a group status. If a group contains unclear comments, show a warning icon next to the group badge.
  - Each file in the group listed as a clickable row:
    - Files with comments: checkmark icon + file path + comment preview (truncated)
    - Files modified without a comment: file icon + path + "modified" label
    - Active file (currently viewing in main pane): blue left border + accent background
  - Group actions: Approve, Revert buttons
  - For comments with "unclear" status and draft replies: reply text + Approve Reply / Edit / Delete actions shown per-comment
- Bottom: status summary + "Push Changes & Post Replies" button (disabled until all non-reverted groups approved and all replies approved/deleted)

### 3. Diff Review — File Opens in Main Pane

Clicking a file in the Comments tab opens a diff tab in the main content area:

- Reuses the existing `DiffEditor` component with its **inline/split toggle** (already built in the Changes tab)
- The diff shows the group's commit: `git diff <commitHash>~1 <commitHash>` for that file
- **Comment annotations**: reviewer comments rendered as toggleable view zones at the exact line they reference
  - Toggle button in the diff header bar to show/hide comment annotations
  - Each annotation shows: author avatar+name, comment body, "Fixed by AI" or "Needs clarification" status
- **Comment annotations are a follow-up enhancement.** V1 uses the standard DiffEditor without view zones. The comment info is visible in the right panel's CommentsTab alongside the diff. View zone annotations can be added later using Monaco's `IViewZone` API.
- **Prev/Next navigation**: buttons in the diff header to step through files within the group
- Tab title: `filename (fix)` to distinguish from regular diff tabs

### 4. Error & Edge States

- **State 1 fetch failure**: If PR comment fetching fails (network error, auth expired), show an error message with "Retry" button. Do not crash the tab.
- **State 2 failure**: If the solve session transitions to `"failed"`, show error message with the failure reason and a "Retry" button that cleans up the failed session and allows re-triggering.
- **Session persistence**: When switching between workspaces and back, CommentsTab re-fetches session state via `getSolveSessions`. The session's state in the DB is the source of truth — no local state needs to be preserved across workspace switches.

### 5. Skip-to-Exclude Selection

- All comments are included by default
- Clicking a comment card in the unsolved state toggles its "Skipped" status
- Skipped comments: 40% opacity, "Skipped" badge
- The solve button updates: "Solve Comments with AI (N of M)" where N = included, M = total
- `triggerSolve` mutation receives optional `excludeCommentIds: string[]` — these platform comment IDs are not inserted into `prComments`

### 6. Component Changes

#### Delete
- `CommentSolvePanel.tsx` — content moves into `CommentsTab.tsx`
- `"comment-solve"` from `PanelMode` type in `tab-store.ts`
- `panelForWorkspace()` comment-solve detection logic
- `openCommentSolvePanel()` from tab store
- `comment-solve` routing case in `DiffPanel.tsx`

#### Create
- `CommentsTab.tsx` — new component containing all three states of the Comments tab. Extracted from `CommentSolvePanel.tsx` and adapted to live inside the DiffPanel tab system.

#### Modify
- `DiffPanel.tsx` — extend `PanelHeader` to render three tabs when PR is linked. Add local tab state. Route "Comments" tab to `CommentsTab`. When a file is clicked in CommentsTab, open a diff tab in the main pane.
- `CommentGroupItem.tsx` — adapt to show file list per group (currently shows flat comment list)
- `CommentGroupDetail.tsx` — adapt for inline use within CommentsTab (no longer a separate detail panel)
- `WorkspaceItem.tsx` — keep "Solve Comments" in context menu as secondary trigger. Remove the `triggerSolve` terminal-launching logic (CommentsTab handles it now).
- `tab-store.ts` — remove `"comment-solve"` from PanelMode, remove `openCommentSolvePanel`, remove comment-solve detection from `panelForWorkspace()`. Add `"comment-fix-file"` to `TabItem` union type. Add `openCommentFixFile({ workspaceId, groupId, filePath, commitHash })` method. Add dedup key helper (like `diffFileKey`).

#### Backend
- `comment-solver.ts` router:
  - Add new query `getWorkspaceComments({ workspaceId })` — fetches live PR comments from GitHub/Bitbucket for the workspace's linked PR. Abstracts over both platforms, returns a unified comment list `{platformId, author, body, filePath, lineNumber}[]`. Used by CommentsTab State 1 to show comments before any solve session exists.
  - Add optional `excludeCommentIds: string[]` to `triggerSolve` input. Filter these out before inserting into `prComments`.
  - Add new query `getFileAtCommit({ repoPath, commitHash, filePath })` — returns file content at a specific commit via `git show <commitHash>:<filePath>`. Used by the diff viewer to show base and modified content for fix commits. (Alternatively, add to the `diff` router.)

### 7. Diff Tab for Comment Fixes

A new tab kind `"comment-fix-file"` in the pane system:

```typescript
{
  kind: "comment-fix-file";
  id: string;
  workspaceId: string;
  groupId: string;
  filePath: string;
  commitHash: string;
  title: string;
}
```

`PaneContent.tsx` renders this tab kind using the existing `DiffEditor` with:
- Base content: file at `commitHash~1`
- Modified content: file at `commitHash`
- Optional comment overlay view zones (toggleable)
- Inline/split mode toggle (reusing existing DiffEditor controls)
