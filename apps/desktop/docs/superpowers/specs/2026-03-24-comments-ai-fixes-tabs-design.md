# Comments & AI Fixes Tabs — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Replace the current single CommentsTab (which awkwardly combines raw comments, solve triggering, and AI fix review into three states) with two dedicated tabs in the right panel:

1. **Comments** — always-available flat overview of all PR review comments with reply/resolve actions
2. **AI Fixes** — shows unpushed AI fix results with collapsible commit groups, progress bar, and push workflow

## Problem

The current CommentsTab tries to be everything: comment viewer, solve trigger, in-progress indicator, and fix reviewer. This creates a confusing experience where the user loses access to comments while AI is working, and the solve trigger is hard to find.

## Design

### Tab Bar

When a workspace has a linked PR, the right panel tab bar becomes:

```
Changes | Files | Comments (N) | AI Fixes
```

- **Comments badge** shows total comment count
- **AI Fixes** has no badge (its content speaks for itself)
- Both tabs always visible — never hidden based on state

### Comments Tab

A flat, always-available overview of all PR review comments. Data source: `getWorkspaceComments` (live from GitHub/Bitbucket API).

**Layout:**
- **PR header**: title, PR number, branch info, total comment count
- **Solving banner** (conditional): small accent bar when AI is currently working, with link to terminal
- **Comment list**: scrollable list of all comments
- **Solve button**: pinned at bottom

**Per-comment card:**
- Header row: author name, clickable `file:line` (accent color, navigates to source), status badge (Resolved = green, Open = yellow)
- Body: comment text, whitespace-preserved
- Action row: Reply button (opens inline textarea), Resolve/Unresolve button

**Reply flow:**
- Click Reply → textarea expands below comment body
- Cancel / Post Reply buttons
- Post Reply calls GitHub/Bitbucket API to post the reply immediately (not queued)

**Resolve flow:**
- Click Resolve → calls GitHub API to resolve the thread (or Bitbucket equivalent)
- Badge updates to "Resolved", button becomes "Unresolve"

**Solve button:**
- Pinned at bottom: "Solve with AI (N comments)"
- Triggers `triggerSolve` mutation
- On success: creates AI Solver terminal tab, switches user to it
- Disabled while a solve session is in progress

### AI Fixes Tab

Shows unpushed AI fix results. Only has content when a solve session has produced results (status = "ready"). When no fixes exist, shows an empty state.

**Empty state:**
- "No AI fixes pending" message
- If no solve session exists: "Use the Comments tab to trigger AI solving"
- If session is in progress: solving banner with spinner

**Active state (session ready):**

**PR header section:**
- "PULL REQUEST #N" label + branch name (top-right)
- PR title (large, bold)
- Progress bar: green (resolved) / dark (pending) / red (unclear) segments
- Legend: "N resolved · N pending · N unclear"

**Commit Groups section:**
- "N COMMIT GROUPS" section header
- Each group is a collapsible card:
  - **Header row** (always visible, clickable to expand/collapse):
    - Expand/collapse chevron
    - Group label (truncated if long)
    - Count badge: "N / M" (resolved / total in group)
    - Action button: "Approve" (if all fixed) or "Review" (if not all reviewed)
  - **Sub-header** (always visible): commit hash (monospace) + changed file names
  - **Expanded content** (comments nested inside):
    - Each comment: author (bold) + line number, comment body, no colored left border
    - If comment has a draft reply: shown inline below in a subtle card with "Draft reply:" label
  - Groups can be individually approved or reverted

**Bottom section** (pinned):
- Summary line: "N draft replies ready · M needs your input" (or similar)
- Two buttons:
  - "Push changes & post replies" (accent/green, primary) — pushes all commits + posts approved replies + resolves threads
  - "Revert all" (outlined, secondary) — reverts all fix commits

### AI Fixes Tab — After Push

Once pushed, the AI Fixes tab returns to empty state. The pushed fixes are no longer shown (they're in git history now). If new comments arrive later, the cycle repeats.

## Component Changes

### Delete
- Current `CommentsTab.tsx` — replaced entirely by two new components

### Create
- `CommentsOverviewTab.tsx` — the Comments tab (flat comment list with reply/resolve/solve)
- `AIFixesTab.tsx` — the AI Fixes tab (commit groups, progress bar, push workflow)

### Modify
- `DiffPanel.tsx` — update tab bar to show 4 tabs, route to new components
- `SolveActionBar.tsx` — adapt or replace with the new bottom section (push + revert all)

### Keep
- Backend routers unchanged — `getWorkspaceComments`, `getSolveSessions`, `getSolveSession`, `triggerSolve`, `approveGroup`, `revertGroup`, `pushAndPost` all stay as-is
- `CommentFixFileTab.tsx` — still used when clicking files in AI Fixes groups

## Interaction Between Tabs

- **Comments tab** shows live platform comments. It reflects resolve/reply actions immediately.
- **AI Fixes tab** shows local uncommitted AI work. It only updates when AI finishes or user approves/reverts.
- **Solving banner** appears on both tabs while AI is working.
- **After push**: AI Fixes clears. Comments tab updates on next refetch (resolved comments show as resolved).
