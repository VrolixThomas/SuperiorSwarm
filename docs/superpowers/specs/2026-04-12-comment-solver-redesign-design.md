# Comment Solver Redesign — Design Spec

**Date:** 2026-04-12
**Branch:** `pr-comment-solver-redesign-v2`
**Prior art:** `refine-comment-solver-flow` branch (cherry-pick phases listed in §6)

## Problem Statement

The current comment solver has three core UX issues:

1. **No cancel/restart:** If the agent crashes or produces bad output mid-solve, there is no way to stop it or recover partial work. Stuck sessions are only cleaned up when the next solve starts.
2. **Crammed sidebar:** The entire review flow (PR info, progress, commit groups, comments, replies, approve/revert, push) is squeezed into the right-side DiffPanel alongside file explorer and branch changes. Not enough space to evaluate changes.
3. **Poor file visibility:** Changed files are shown as tiny monospace links in the group sub-header. No aggregate view of all files changed per commit. Files the agent touched but that had no comments are invisible.

Additionally, the follow-up flow is Claude-specific (`claude --continue`) and doesn't work across all supported agents (Gemini CLI, Codex, OpenCode).

## Design Decisions

### Approach

**Solve Review as a workspace tab** (Approach A). The solve review becomes a new tab type in the existing workspace tab system, sitting alongside terminal tabs. File diffs open as sibling workspace tabs via the existing `CommentFixFileTab`. The right panel (DiffPanel) remains independently available.

### Key Choices

- **Cancel with partial recovery** over simple kill or full control panel. Completed groups are preserved; user can re-solve remaining comments.
- **File list + comments as two sections** per group card. "Changed files" shows every file in the commit with `+/-` stats. "Comments addressed" shows comments grouped by file with resolution status. Files are clickable to open diffs.
- **Agent-agnostic follow-up** via prompt files rather than agent-specific resume commands. Works identically across Claude, Gemini, Codex, and OpenCode.
- **Live-updating tab** that auto-opens on solve trigger, shows groups appearing in real-time, and auto-focuses when the session reaches "ready".

## §1 — Solve Review Tab

### Layout

The tab renders in the main workspace area with this structure:

```
┌─────────────────────────────────────────────────┐
│ [Terminal] [✦ Solve Review ✕] [AI Solver]       │  ← tab bar
├─────────────────────────────────────────────────┤
│ #142  feat/message-queue → main   [Cancel solve]│  ← PR header
│ Add message queue retry logic and WebSocket...  │
├─────────────────────────────────────────────────┤
│ ●4 resolved  ●1 pending  ●1 unclear   3/4 appr │  ← status pills
│ ████████████████████░░░░░                       │  ← progress bar
├─────────────────────────────────────────────────┤
│ 4 COMMIT GROUPS                                 │
│                                                 │
│ ┌─ › Group name                    2/2  [Appr] ─┐
│ │ a1b2c3d                                       │
│ │ CHANGED FILES                                 │
│ │ ⬡ src/queue/retry-handler.ts    +42 −8    →  │
│ │ ⬡ src/queue/config.ts           +6  −2    →  │
│ │ ⬡ src/queue/types.ts            +12        →  │
│ │ ⬡ tests/queue/retry.test.ts     +31        →  │
│ │ COMMENTS ADDRESSED                            │
│ │ ⬡ retry-handler.ts                           │
│ │   @alice · line 42                            │
│ │   "Use exponential backoff..."   ✓ Fixed      │
│ │ ⬡ config.ts                                  │
│ │   @alice · line 18                            │
│ │   "Make retry configurable..."   ✓ Fixed      │
│ └───────────────────────────────────────────────┘
│                                                 │
│ ┌─ › Group name                    0/1 [Solv…] ─┐
│ └───────────────────────────────────────────────┘
├─────────────────────────────────────────────────┤
│ ⚠ 1 reply needs sign-off    [Dismiss] [Push…]  │  ← bottom bar
└─────────────────────────────────────────────────┘
```

### Component: `SolveReviewTab`

New workspace tab component replacing the sidebar `AIFixesTab` for solve review.

**Props:** `workspaceId: string`

**Data:** Queries `commentSolver.getSolveSessions(workspaceId)` to find the active session, then `commentSolver.getSolveSession(sessionId)` with 3s polling while status is `queued` or `in_progress`.

**Sections:**
- **PR header:** PR number, branch pill (`source → target`), title, cancel button (visible when `queued` or `in_progress`)
- **Progress strip:** Status pills (resolved/pending/unclear counts), approval fraction, thin progress bar
- **Commit groups:** Expandable cards, first group expanded by default. Each card contains:
  - Header: chevron, group label, ratio badge (e.g. `2/2`), action button (Approve / Approved badge / sign-off hint / Solving indicator)
  - Body (when expanded): commit hash, changed files section, comments addressed section
- **Bottom bar:** Actionable status message, Dismiss button, Push & post replies button (disabled until all groups approved and no draft replies)

### Component: `CommitGroupCard`

Redesigned from the current `CommitGroupCard` in `AIFixesTab.tsx`.

**Changed files section:**
- Label: "Changed files"
- Rows: one per file in the commit, showing file icon, path (monospace, blue, clickable), `+N −M` diff stats, hover arrow
- Click opens `CommentFixFileTab` as a sibling workspace tab (existing behavior)
- File list is obtained by running `git diff-tree --no-commit-id --name-status -r {commitHash}` and stored in the group data

**Comments addressed section:**
- Label: "Comments addressed"
- Comments grouped under their file path
- Each comment shows: avatar, author, line number, body, status tag (Fixed / Unclear / Changes requested)
- Unclear comments show draft reply with sign-off strip (Discard / Approve & post)
- Each comment gets a "Follow up" action (see §3)

### Group states

| Status | Header action | Body content |
|--------|--------------|--------------|
| `pending` | Solving indicator (blinking dot + "Solving") | Not expandable |
| `fixed` | "Approve" button | Full file list + comments |
| `approved` | "✓ Approved" badge | Full file list + comments |
| `reverted` | Dimmed, strikethrough label | Collapsed |

## §2 — Cancel with Partial Recovery

### Trigger

"Cancel solve" button in the PR header, visible when session status is `queued` or `in_progress`.

### Flow

1. **Kill agent process:** Read `pid` from `commentSolveSessions`, call `process.kill(pid, 'SIGTERM')`. Handle ESRCH (already dead).
2. **Preserve completed work:** Query `commentGroups` for this session. Groups with status `fixed` or `approved` (have a `commitHash`) are kept. Groups with status `pending` are deleted.
3. **Mark remaining comments:** Comments in deleted groups get `groupId` set to `null`, status reset to `open`.
4. **Transition session:** `in_progress → cancelled` or `queued → cancelled`.
5. **Update UI:** Solve Review tab shows completed groups (approvable/reviewable), plus a "Re-solve remaining" button.

### New session status: `cancelled`

Added to the state machine:

```
queued       → in_progress, failed, dismissed, cancelled
in_progress  → ready, failed, dismissed, cancelled
cancelled    → dismissed (terminal, can also re-solve)
```

`cancelled` is distinct from `failed`:
- `cancelled` = user chose to stop. Show completed work + re-solve option.
- `failed` = agent crashed. Show failed session UI (reset/keep-changes).

### Re-solve remaining

"Re-solve remaining" button calls `triggerSolve` with `excludeCommentIds` set to the platform comment IDs from completed groups. This creates a new session for just the unsolved comments. Both the old cancelled session and new session can coexist (old is read-only).

### tRPC mutation

```typescript
cancelSolve: protectedProcedure
  .input(z.object({ sessionId: z.string() }))
  .mutation(async ({ input }) => {
    // kill process, preserve completed groups, transition to cancelled
  })
```

## §3 — Follow-up Flow

### User interaction

Each comment in the "Comments addressed" section gets a "Follow up" action. Clicking it:

1. Opens an inline text area: "What should be changed?"
2. User types follow-up instructions
3. User submits

### Backend: follow-up prompt generation

On submit, system writes a follow-up prompt file to `{solveDir}/follow-up-{timestamp}.txt` containing:

```
You are following up on a previous comment solve session for PR: {prTitle}
Session ID: {sessionId}
Source: {sourceBranch} → Target: {targetBranch}

The user wants changes to group "{groupLabel}" (commit {commitHash}).

Original comment by @{author} on {filePath}:{lineNumber}:
"{commentBody}"

The AI solver marked this as: {status}

User's follow-up instructions:
"{followUpText}"

Use the SuperiorSwarm MCP tools. The session ID is already set.
Read the current code, make the requested changes, and call finish_fix_group when done.
```

### Agent launch

System launches the configured agent preset (whichever is active — Claude, Gemini, Codex, OpenCode) with the follow-up prompt file using the same `buildArgs` + `setupMcp` pattern. The MCP config is either still on disk from the initial solve or gets re-written.

This is agent-agnostic: every agent gets an explicit prompt file + MCP environment. No reliance on `claude --continue` or any agent-specific resume mechanism.

### Terminal management

- If the AI Solver terminal tab is still open for this workspace, switch to it and send the launch command
- If it was closed, create a new terminal tab with the same worktree cwd
- Terminal tab metadata stores `solveSessionId` and `presetName`

### State changes

- Comment status: `fixed → changes_requested` (new status)
- Group status: if it was `approved`, revoke back to `fixed`
- Follow-up text stored as a `followUpText` column on `prComments` (nullable, set when user submits follow-up)

## §4 — Tab Lifecycle

### Auto-open

When `triggerSolve` succeeds, two tabs are created:
1. **AI Solver** terminal tab — runs the agent launch script (existing behavior)
2. **Solve Review** tab — new, opens immediately showing the session in `queued` state

### Polling

While session is `queued` or `in_progress`, the Solve Review tab polls `getSolveSession` every 3 seconds. Groups appear live as the agent creates them.

### Auto-focus

When session transitions `in_progress → ready`, the Solve Review tab auto-focuses (switches to it if it exists but isn't active). This nudges the user to start reviewing.

### Close and reopen

- User can close the Solve Review tab via `✕`. Doesn't affect the session.
- To reopen: the "AI Fixes" tab in the right panel DiffPanel shows an "Open Solve Review" link when a non-dismissed session exists. Clicking it creates a new `SolveReviewTab` for that session.
- Workspace sidebar could also show a badge when an active session exists (optional, not required for v1).

### Tab metadata

```typescript
interface SolveReviewTabItem {
  kind: "solve-review";
  id: string;
  workspaceId: string;
  solveSessionId: string;
  title: "Solve Review";
}
```

Stored in the tab store alongside terminal tabs. Tab store changes:
- New `TabItem` variant for `kind: "solve-review"`
- `addSolveReviewTab(workspaceId, sessionId)` method
- `getSolveReviewTab(workspaceId)` to check if one exists before creating

### AI Solver terminal metadata

```typescript
// Extended terminal tab metadata
interface TerminalTabMeta {
  solveSessionId?: string;
  presetName?: string;
}
```

Used by follow-up flow to reconnect to the right terminal.

## §5 — File Change Tracking

### Problem

Currently, `commentGroups` stores `commitHash` but not the list of changed files. The UI can only show files that have comments, missing files the agent also touched.

### Solution

After `finish_fix_group` creates the commit, run:

```bash
git diff-tree --no-commit-id --name-status --numstat -r {commitHash}
```

Store the result as a JSON array on `commentGroups.changedFiles`:

```typescript
// Shape of each entry in the JSON array
interface ChangedFile {
  path: string;
  changeType: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
}
```

Single column avoids an extra table and join. The data is read-only after commit creation, so JSON is fine.

### Data flow

1. MCP tool `finish_fix_group` → creates commit → runs `git diff-tree` → stores file list
2. `getSolveSession` query → joins/includes changed files per group
3. `SolveReviewTab` → renders "Changed files" section from this data

## §6 — Reuse from `refine-comment-solver-flow`

### Cherry-pick as-is

| Phase | Commits | Description |
|-------|---------|-------------|
| Comment cache | `0e9e5cc6 → 81251b0d` | `pr_comment_cache` + `pr_comment_cache_meta` tables (migration 0026), `getPRCommentsIfChanged` on GitProvider, poller writes to cache, `getWorkspaceComments` reads from cache, `refreshWorkspaceComments` mutation |
| Solver recovery | `fbed07d9 → 937c2c8b` | `pid` + `last_activity_at` columns (migration 0027), PID recording on start, heartbeat updates via MCP tools, `recoverStuckSessions` startup sweep |
| Failed session UI | `c249f9fb → eaa712e3` | Failed session rendering, Reset + Keep Changes actions. **Adapt:** render in `SolveReviewTab` instead of sidebar `AIFixesTab` |
| Settings split | `2ab591fe` | AI Reviewer vs Comment Solver settings tabs |
| Unclear sign-off | `b13e8a52 → c0368346` | `approveReply` + `revokeGroup` endpoints, `addReply` defaults to approved, `updateReply` resets to draft, sign-off strip UI, bottom bar redesign. **Adapt:** integrate into new `CommitGroupCard` layout |

### Adapt (don't copy)

- `AIFixesTab.tsx` → logic moves to `SolveReviewTab.tsx` (workspace tab, not right panel)
- `CommitGroupCard` → redesigned with file list + comments sections
- `SolvingBanner.tsx` → removed (tab shows solving state directly)
- Follow-up button → rewritten for agent-agnostic prompt-file approach

### New work

| Item | Description |
|------|-------------|
| `SolveReviewTab` component | New workspace tab for solve review |
| Tab store changes | New tab type, metadata, auto-open/focus logic |
| `cancelSolve` mutation | Kill process, preserve completed groups, transition to `cancelled` |
| `cancelled` session status | New status + state machine transitions |
| "Re-solve remaining" flow | New solve with `excludeCommentIds` from completed groups |
| Follow-up prompt builder | `buildSolveFollowUpPrompt()` in `cli-presets.ts` or `solve-prompt.ts` |
| File change tracking | `git diff-tree` after commit, store per-group changed files |
| `changedFiles` JSON column | New column on `commentGroups` for per-group file lists |
| Right panel "Open Solve Review" link | Replace inline review with link to workspace tab |

## §7 — Schema Changes

### New migration (on top of migrations 0026 + 0027 from old branch)

```sql
-- Add 'cancelled' to session status (enforced in app code, not DB constraint)
-- Add changed_files JSON column to comment_groups
ALTER TABLE comment_groups ADD COLUMN changed_files TEXT; -- JSON array

-- Add 'changes_requested' to comment status (enforced in app code)
```

### State machine update

```typescript
const VALID_SESSION_TRANSITIONS: Record<string, string[]> = {
  queued: ["in_progress", "failed", "dismissed", "cancelled"],
  in_progress: ["ready", "failed", "dismissed", "cancelled"],
  ready: ["submitted", "failed", "dismissed"],
  submitted: ["dismissed"],
  failed: ["dismissed"],
  cancelled: ["dismissed"],
};

const VALID_COMMENT_STATUSES = [
  "open", "fixed", "unclear", "wont_fix", "changes_requested"
];
```

## §8 — What This Does NOT Cover

- Mobile/responsive layout (desktop only)
- Multi-session view (only the latest active session per workspace)
- Collaborative review (single user reviewing the solver's output)
- Partial push (all approved groups push together, not individually)
- Agent-side changes (MCP tools remain the same, agent prompt is the only interface)
