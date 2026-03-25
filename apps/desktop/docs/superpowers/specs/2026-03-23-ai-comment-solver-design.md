# AI Comment Solver — Design Spec

**Date:** 2026-03-23
**Status:** Approved

## Overview

When a user is the **author** of a PR and reviewers leave comments, the AI Comment Solver automatically fetches those comments, groups them intelligently, fixes the code, and prepares everything for the user to review and push. This is the complement to the existing AI Review system (which handles the reviewer side).

## Core Principles

1. **Zero extra cost** — uses the user's existing CLI subscriptions (Claude Code, Gemini, Codex, OpenCode) via the MCP server. No direct AI API calls.
2. **Everything local until approved** — commits, replies, and thread resolutions stay local until the user explicitly pushes.
3. **Repo tab, not PR tab** — authored PRs are managed from the existing workspace in the Repo tab, since the user already has the branch there.
4. **Extend, don't rebuild** — reuses the existing MCP server, CLI preset system, orchestrator pattern, and right-panel UI components.

## Requirements Mapping

| # | Requirement | Design Decision |
|---|---|---|
| 1 | Authored PR lives in Repo tab | Workspace `prProvider`/`prIdentifier` fields link to authored PR. PR tab filters out authored PRs. |
| 2 | Checkout existing branch as worktree | `CreateWorktreeModal` gets "existing branch" mode using `checkoutBranchWorktree()`. Auto-detects linked PR. |
| 3 | AI auto-solves new comments | Comment poller detects new comments → queues solve session (configurable auto/manual). |
| 4 | Group comments before fixing | AI determines optimal grouping via `submit_grouping` MCP tool. No predetermined strategy. |
| 5 | One commit per comment group | `finish_fix_group` MCP tool stages and commits. System enforces one commit per group. |
| 6 | Review changes per comment, undo | Right panel shows per-group diffs with revert button (`git revert <hash>`). |
| 7 | Extend existing MCP | New solver tools added to `mcp-standalone/server.mjs`, mode determined by `SOLVE_SESSION_ID` env var. |
| 8 | Continuous until PR merged | Comment poller watches until PR closed. New comments trigger new solve sessions. |
| 9 | AI replies when unclear | `mark_comment_unclear(commentId, replyBody)` MCP tool drafts a reply. AI also makes best-effort fix. |
| 10 | Local until user pushes | "Push Changes & Post Replies" button does `git push` + posts replies + resolves threads. |

## Data Model

### New Tables

#### `commentSolveSessions`

One row per solving run. Analogous to `reviewDrafts`.

| Column | Type | Description |
|---|---|---|
| `id` | text (PK) | UUID |
| `prProvider` | text | `"github"` or `"bitbucket"` |
| `prIdentifier` | text | e.g., `"owner/repo#123"` |
| `prTitle` | text | PR title |
| `sourceBranch` | text | Source branch name |
| `targetBranch` | text | Target branch name |
| `status` | text | `"queued"`, `"in_progress"`, `"ready"`, `"submitted"`, `"failed"`, `"dismissed"` |
| `commitSha` | text | PR head SHA when solving started |
| `workspaceId` | text (FK) | References existing workspace in Repo tab |
| `createdAt` | integer | Timestamp (matches existing schema convention) |
| `updatedAt` | integer | Timestamp (matches existing schema convention) |

#### `commentGroups`

AI-determined groupings of related comments.

| Column | Type | Description |
|---|---|---|
| `id` | text (PK) | UUID |
| `solveSessionId` | text (FK) | References `commentSolveSessions.id` (cascade delete) |
| `label` | text | AI-generated description (e.g., "Fix error handling") |
| `status` | text | `"pending"`, `"fixed"`, `"approved"`, `"reverted"` |
| `commitHash` | text (nullable) | Git commit SHA created for this group |
| `order` | integer | Sequence in which groups are fixed |

#### `prComments`

Fetched review comments from the platform.

| Column | Type | Description |
|---|---|---|
| `id` | text (PK) | UUID |
| `solveSessionId` | text (FK) | References `commentSolveSessions.id` (cascade delete) |
| `groupId` | text (FK, nullable) | References `commentGroups.id`, null until grouped |
| `platformCommentId` | text | GitHub/Bitbucket comment ID |
| `author` | text | Comment author username |
| `body` | text | Comment text |
| `filePath` | text | File the comment is on |
| `lineNumber` | integer (nullable) | Line number |
| `side` | text (nullable) | `"LEFT"` or `"RIGHT"` |
| `threadId` | text (nullable) | Thread ID for threaded comments |
| `status` | text | `"open"`, `"fixed"`, `"unclear"`, `"wont_fix"` |
| `commitSha` | text (nullable) | Commit SHA the comment was made against (for line number accuracy) |

#### `commentReplies`

Draft replies to post back to the platform.

| Column | Type | Description |
|---|---|---|
| `id` | text (PK) | UUID |
| `prCommentId` | text (FK) | References `prComments.id` (cascade delete) |
| `body` | text | Draft reply text |
| `status` | text | `"draft"`, `"approved"`, `"posted"` |

### Extended Tables

#### `aiReviewSettings` — new fields

| Column | Type | Description |
|---|---|---|
| `autoSolveEnabled` | integer (bool) | Auto-solve when new comments detected (default: false) |
| `solvePrompt` | text (nullable) | Custom instructions for the solver (like `customPrompt` for reviews) |

#### `workspaces` — existing fields reused

- `prProvider` and `prIdentifier` — already exist, currently only set for `type="review"`. Now also set for `type="worktree"` workspaces linked to authored PRs.
- **Unique index change:** The existing unique index on `(project_id, pr_provider, pr_identifier)` must be changed to `(project_id, pr_provider, pr_identifier, type)` to allow both a review workspace and an authored workspace to reference the same PR without conflict.

## MCP Server Extension

The existing `mcp-standalone/server.mjs` gains a new mode. When `SOLVE_SESSION_ID` is set (instead of `REVIEW_DRAFT_ID`), solver tools are exposed.

### Environment Variables

| Variable | Purpose |
|---|---|
| `SOLVE_SESSION_ID` | UUID of the current solve session |
| `PR_METADATA` | JSON with PR details (same as review mode) |
| `DB_PATH` | Path to SQLite database |

### Solver Tools

#### Phase 1: Understand & Group

**`get_pr_comments`** — returns all unresolved comments.

Returns: `[{id, author, body, filePath, lineNumber, side, threadId}]`

**`submit_grouping`** — AI submits its chosen comment groupings.

Input: `[{label: string, commentIds: string[]}]`

Saves groups to `commentGroups` table, links comments via `groupId`.

#### Phase 2: Fix (per group)

**`start_fix_group(groupId)`** — signals which group AI is working on.

Returns the full comment details for that group.

**`mark_comment_fixed(commentId)`** — marks a comment as addressed.

Updates `prComments.status` to `"fixed"`.

**`mark_comment_unclear(commentId, replyBody)`** — flags unclear comment.

Updates `prComments.status` to `"unclear"`. Creates `commentReplies` record with `status="draft"`.

**`finish_fix_group(groupId)`** — stages all changes and commits.

Implementation:
1. `git add -A` in the worktree
2. Unstage MCP config files: `git reset HEAD .mcp.json .gemini/ opencode.json .codex/` (no-op if files don't exist)
3. `git commit -m "fix: {group.label}"`
4. Stores commit SHA in `commentGroups.commitHash`
5. Updates `commentGroups.status` to `"fixed"`

**Pre-conditions for solve session start:**
- If the worktree has uncommitted changes, the solve session is rejected with an error message asking the user to commit or stash first. This prevents unrelated changes from being swept into fix commits.
- Only one solve session can be active per workspace at a time. If a session is already `"queued"` or `"in_progress"`, new solve requests are rejected.

#### Phase 3: Complete

**`finish_solving`** — marks session as `"ready"` for user review.

### Solving Prompt Template

Written to a file the CLI reads (same pattern as review prompts):

```
PR Context:
- Title: {prTitle}
- Author: {prAuthor}
- Branch: {sourceBranch} → {targetBranch}

You are helping the PR author fix review comments. Reviewers have left feedback
that needs to be addressed through code changes.

Instructions:
1. Call get_pr_comments to fetch all unresolved comments
2. Analyze comments and group related ones using submit_grouping
   - Group by semantic similarity (comments about the same concern)
   - A file may have comments in different groups
   - AI determines optimal grouping
3. For each group (in order):
   a. Call start_fix_group(groupId)
   b. Read the relevant files and understand the codebase context
   c. Make code changes that address the comments
   d. For each comment in the group:
      - If you can fix it: call mark_comment_fixed(commentId)
      - If unclear: make a best-effort fix AND call mark_comment_unclear(commentId, replyBody)
        explaining your interpretation and asking for clarification
   e. Call finish_fix_group(groupId) to commit changes
4. Call finish_solving when all groups are done

{customSolvePrompt}
```

## Comment Poller

### New file: `comment-poller.ts`

Runs alongside `pr-poller.ts` and `commit-poller.ts`.

**Poll interval:** 60 seconds

**What it watches:** All workspaces where:
- `type = "worktree"`
- `prProvider` and `prIdentifier` are set (linked to authored PR)
- PR is still open (checked via PR poller cache)

**Detection logic:**
1. Fetch comments from GitHub/Bitbucket API for each linked PR
2. Compare against known `platformCommentId` values across ALL solve sessions for that PR (deduplicated by platform ID, regardless of session)
3. A comment is "new" if its `platformCommentId` has never been seen, OR if it was previously in a session that was dismissed/reverted (making it eligible for re-solving)
4. If new comments found:
   - `autoSolveEnabled = true` → queue solve session automatically
   - `autoSolveEnabled = false` → emit event for UI notification badge

**Comment fetching:**
- GitHub: `GET /repos/{owner}/{repo}/pulls/{number}/comments` (review comments) + `GET /repos/{owner}/{repo}/issues/{number}/comments` (general comments)
- Bitbucket: `GET /repositories/{workspace}/{repo}/pullrequests/{id}/comments`

### Auto-PR Detection on Workspace Creation

When a worktree workspace is created (new branch or checkout existing):
1. Check PR poller cache for open PRs matching the branch name where user is the author
2. If found: set `prProvider`/`prIdentifier` on the workspace
3. Comment poller starts watching automatically

## PR Tab Filtering

The PR tab (`PullRequestsTab.tsx`) is modified to **exclude** PRs where the user is the author. Only PRs where the user is a reviewer are shown.

This prevents:
- Duplicate PR entries across tabs
- Users accidentally creating review workspaces for their own PRs
- Confusing state where the same PR lives in both places

## Checkout Existing Branch

### `CreateWorktreeModal` changes

Add a toggle between two modes:
- **"New branch"** (current) — text input for branch name + base branch picker
- **"Existing branch"** (new) — searchable dropdown of remote branches not yet checked out as worktrees

**Backend:** Uses existing `checkoutBranchWorktree()` from `operations.ts`:
```
git fetch origin <branch>
git worktree add <path> <branch>
```

After creation, auto-detects PR linkage (see above).

## UI: Right Panel — Comment Solve Mode

### Panel Mode

New panel mode `"comment-solve"` added to `panelForWorkspace()` in `tab-store.ts`, alongside existing `"pr-review"`.

Activated when:
- Workspace has linked PR with comments
- User clicks workspace badge or "Solve Comments" action
- Solve session reaches "ready" status

### Component Structure

Reuses existing components where possible:

| Component | Source | Adaptation |
|---|---|---|
| Right panel container | Existing infrastructure | New mode: `"comment-solve"` |
| Diff renderer | `PRReviewFileTab` | Scoped to files changed per group |
| Comment display | Existing comment threading UI | Shows original reviewer comments |
| Submit modal pattern | `SubmitReviewModal` | "Push Changes & Post Replies" confirmation |

### New Components

**`CommentSolvePanel`** — main container for the right panel
- Header: PR title, comment count, overall status
- Group list with status badges (fixed/unclear/reverted)
- Group detail view (on click)
- Bottom action bar

**`CommentGroupItem`** — row in the group list
- Group label, status badge, comment count
- Commit hash display
- Click to select → shows detail

**`CommentGroupDetail`** — detail view for selected group
- Diff view (reused from `PRReviewFileTab`)
- Original comments that triggered the changes (with file/line context)
- For unclear groups: draft reply editor (inline textarea)
- Revert button → `git revert <commitHash>`

**`SolveActionBar`** — bottom bar
- "Push Changes & Post Replies" button
- Status summary (X groups fixed, Y unclear, Z reverted)

### Revert Behavior

Groups must be reverted in reverse order (last committed → first committed) to avoid merge conflicts. The UI disables the revert button on groups that have non-reverted groups after them. When a group is reverted:
1. `git revert <commitHash> --no-edit`
2. `commentGroups.status` → `"reverted"`
3. Associated `prComments` reset to `status="open"`
4. Associated `commentReplies` with `status="draft"` are deleted

### Dismiss Behavior

When a solve session in `"ready"` state is dismissed:
1. All fix commits are reverted in reverse order (`git revert` each)
2. All draft replies are deleted
3. Session status → `"dismissed"`
4. Comments go back to `"open"` status, available for future solve sessions

### Workspace Badge

`WorkspaceItem` in the Repo tab sidebar gets a notification badge when:
- New unresolved comments exist on the linked PR
- A solve session has reached "ready" status (fixes ready for review)

## Push & Post Replies Flow

Triggered by "Push Changes & Post Replies" button:

1. **Validate** — at least one group is in "fixed" or "approved" status (not all reverted)
2. **`git push`** — pushes all non-reverted commits to the remote branch
3. **Post replies** — for each `commentReplies` with `status="approved"` (draft replies must be explicitly approved before posting):
   - GitHub: `POST /repos/{owner}/{repo}/pulls/{number}/comments/{id}/replies`
   - Bitbucket: `POST /repositories/{workspace}/{repo}/pullrequests/{id}/comments` with `parent.id`
   - Update reply status → `"posted"`
4. **Resolve threads** — for comments marked "fixed", resolve the review thread (GitHub: resolve thread API; Bitbucket: update comment `resolved` field)
5. **Update session** — status → `"submitted"`
6. **Continue watching** — comment poller keeps monitoring for new comments

## Orchestrator Extension

The existing orchestrator pattern gets a parallel "solve" flow:

**`queueSolve(sessionId)`:**
1. Validate: no uncommitted changes in worktree (reject if dirty)
2. Validate: no other active solve session for this workspace
3. Update session status → `"in_progress"`
4. Capture current commit SHA
5. Build solve prompt (PR context + comments + custom instructions)
6. Write prompt file to `{userData}/solves/{sessionId}/`
7. Write `start-solve.sh` launch script
8. Setup MCP config with `SOLVE_SESSION_ID` env var
9. Return `SolveLaunchInfo` (sessionId, script path, worktreePath, etc.)

**Process launch:** The renderer receives `SolveLaunchInfo` and creates an "AI Solver" terminal tab in the workspace (same pattern as the review system's "AI Review" terminal). The terminal executes the `start-solve.sh` script. For auto-solve mode, the system auto-creates the terminal tab and launches it without user interaction — the user sees the terminal appear and can watch progress or switch to other work.

**State machine:**
```
queued → in_progress → ready → submitted
  ↓                      ↓
  └─→ failed → dismissed ←─┘
```

Same transitions as review drafts.

## tRPC Router Extension

New procedures added to `ai-review.ts` router (or a new `comment-solver.ts` router):

**Queries:**
- `getSolveSessions(workspaceId?)` — list solve sessions
- `getSolveSession(sessionId)` — session + groups + comments + replies
- `getUnresolvedComments(prIdentifier)` — comments not yet in a solve session

**Mutations:**
- `triggerSolve(workspaceId)` — start a solve session for a workspace's linked PR
- `approveGroup(groupId)` — transition group from `"fixed"` → `"approved"` (user confirms the fix is good)
- `revertGroup(groupId)` — `git revert <commitHash>`, update status (only allowed in reverse order)
- `updateReply(replyId, body, status?)` — edit a draft reply body and/or transition status (`"draft"` → `"approved"`)
- `deleteReply(replyId)` — remove a draft reply
- `pushAndPost(sessionId)` — push commits + post replies + resolve threads. Requires all non-reverted groups to be `"approved"` and all replies to be `"approved"` or deleted.
- `dismissSolve(sessionId)` — cancel/cleanup a solve session

## Settings Extension

`SettingsView.tsx` gets new fields under the AI section:

- **Auto-solve toggle** — `autoSolveEnabled` (default: off)
- **Solve prompt editor** — custom instructions for the solver (optional, like `customPrompt` for reviews)
