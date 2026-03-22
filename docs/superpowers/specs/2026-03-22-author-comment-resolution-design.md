# Author-Side PR Comment Resolution

**Date:** 2026-03-22
**Status:** Draft

## Problem

When a user authors a PR and receives review comments, they must manually read each comment, understand the requested change, make the code edit, and push. This is tedious for straightforward feedback (null checks, renames, validation). An AI agent should be able to resolve actionable comments automatically, while the user retains full control over what gets committed and pushed.

## Design Decisions

- **Runs in the user's existing workspace** — no separate worktree. The branch is already checked out, the user isn't actively developing during PR review, and follow-up conversation with the AI should happen in the same terminal.
- **Lives in the repo section, not the PR section** — the PR section is for reviewing other people's PRs. The author's workspace stays where it was created.
- **Commit-group-centric** — the AI creates one commit per logical group of related comments. This makes undo clean (`git revert <sha>`) and gives a natural unit for review.
- **Hybrid agent session** — AI runs to completion then signals done, but the terminal session stays alive for follow-up questions ("why did you change this?", "do it differently").
- **Smart auto-resolve** — AI autonomously decides which comments are actionable vs discussion/questions. No upfront triage step. User reviews after the fact.
- **Platform replies on push, not per-comment** — one reply per thread ("Addressed in abc123"), behaving like a human developer would.

## Prerequisites

### Workspace-to-PR Linking

For the author-side flow to work, the user's branch workspace must be linked to its open PR. This happens via:
- **PR poller auto-linking**: when the PR poller detects a PR whose `sourceBranch` matches a workspace's branch name within the same project, it auto-sets `prProvider` and `prIdentifier` on the workspace. This is a new behavior added to the PR poller.
- **Manual linking**: user can link a PR to their workspace from the sidebar (future, not required for MVP — auto-linking covers the common case).

### `CachedPR` Role Tracking

The `CachedPR` type in `review-types.ts` needs a new `role: "author" | "reviewer"` field. The PR poller already fetches authored and review-requested PRs separately — the role must be preserved through the `mapGitHubPR` / `mapBitbucketPR` conversion instead of being discarded.

### Bitbucket Comment Fetching

The existing Bitbucket integration has no function to list PR comments. A new `getBitbucketPRComments(workspace, repoSlug, prId)` function must be added to `bitbucket.ts`, returning comments with file path, line number, author, and body. This mirrors the existing `getPRDetails` GraphQL query on the GitHub side.

### Bitbucket Comment Count

The PR poller's `mapBitbucketPR` currently hardcodes `commentCount: 0`. This must be updated to fetch actual comment counts from the Bitbucket API so the notification system works for Bitbucket PRs.

## Architecture

```
User's branch workspace (repo section)
    │
    ├── Right Panel: "pr-comments" mode
    │   ├── Comments tab — unresolved review comments from platform
    │   ├── Resolved tab — commit groups with comment mappings
    │   └── Changes tab — file list of AI modifications
    │
    ├── "Resolve with AI" triggers resolution session
    │   ├── Fetches unresolved review comments from GitHub/Bitbucket
    │   ├── Builds resolution prompt with comments + codebase context
    │   ├── Launches CLI agent in workspace terminal (same MCP pattern)
    │   └── Agent makes one commit per logical group
    │
    ├── MCP Server (extended with new tools)
    │   ├── get_review_comments()
    │   ├── resolve_and_commit(comment_ids[], message)
    │   ├── skip_comment(comment_id, reason)
    │   └── finish_resolution()
    │
    └── Post-resolution actions
        ├── View Diff — opens commit in Monaco diff editor
        ├── Revert — git revert <sha>, moves comments back to unresolved
        ├── Ask AI — pre-fills terminal prompt for follow-up
        └── Push Changes — git push + platform replies
```

## Data Model

### `resolutionSessions`

Tracks each AI resolution run within a workspace.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workspaceId | FK → workspaces | The user's branch workspace |
| prProvider | text | "github" \| "bitbucket" |
| prIdentifier | text | "owner/repo#123" |
| commitShaBefore | text | HEAD before agent ran (enables revert-all) |
| status | text | "running" \| "done" \| "failed" |
| createdAt | timestamp | When the session started |
| updatedAt | timestamp | Last status change |

### `resolutionGroups`

One row per commit the AI creates. Maps 1:1 to git commits.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| sessionId | FK → resolutionSessions | Parent session |
| commitSha | text | The actual git commit hash |
| commitMessage | text | The commit message |
| status | text | "applied" \| "reverted" |
| createdAt | timestamp | When the commit was made |
| updatedAt | timestamp | Last status change |

### `resolutionComments`

Maps platform review comments to resolution groups.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| groupId | FK → resolutionGroups | Nullable — null if skipped |
| sessionId | FK → resolutionSessions | Parent session |
| platformCommentId | text | GitHub comment nodeId or Bitbucket comment ID |
| platformThreadId | text | GitHub thread nodeId (nullable — Bitbucket has no threads) |
| filePath | text | File the comment is on (nullable for general comments) |
| lineNumber | integer | Line number (nullable) |
| author | text | Reviewer username |
| body | text | Comment text (cached for display) |
| status | text | "resolved" \| "skipped" \| "pending" |
| skipReason | text | Why the AI skipped it (nullable) |
| updatedAt | timestamp | Last status change |

### Settings additions

Two new fields on the existing `aiReviewSettings` table:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| autoResolveThreads | boolean | false | Auto-resolve GitHub threads on push |
| postReplyOnPush | boolean | true | Post "Addressed in..." replies on push |

## MCP Tools

Extended on the existing MCP standalone server (`mcp-standalone/server.mjs`).

### `get_review_comments()`

Returns all unresolved comments for the current resolution session.

```json
[
  { "id": "abc", "author": "john_dev", "filePath": "auth.ts", "lineNumber": 42, "body": "Missing null check..." },
  { "id": "def", "author": "john_dev", "filePath": "auth.ts", "lineNumber": 58, "body": "Same null check..." }
]
```

### `resolve_and_commit(comment_ids: string[], message: string)`

Called after the agent makes file changes for a group of related comments.

1. Detects which files were modified by diffing working tree against HEAD
2. Stages only those specific files (`git add <file1> <file2> ...` — never `git add -A`)
3. Creates commit with the provided message
4. Records commit → comment mapping in `resolutionGroups` and `resolutionComments`
5. Returns `{ groupId, commitSha }`

### `skip_comment(comment_id: string, reason: string)`

Marks a comment as skipped. Used for discussion questions, opinions, or comments that don't require code changes.

Returns `{ status: "skipped" }`

### `finish_resolution()`

Signals the agent is done. Updates session status to "done".

Returns `{ resolved: number, skipped: number, groups: number }`

## Agent Prompt

```
You are resolving review comments on PR #{number}: "{title}"
Branch: {sourceBranch} → {targetBranch}

## Review comments to resolve:
1. [comment-id-abc] john_dev on auth.ts:42
   "Missing null check on user.session"

2. [comment-id-def] john_dev on auth.ts:58
   "Same null check for session.token"

3. [comment-id-ghi] sarah_r on api.ts:15
   "Add zod schema validation to request body"

4. [comment-id-jkl] sarah_r (general)
   "Have you considered using a rate limiter?"

## Instructions:
- Read the code and understand each comment in context
- Make the requested code changes
- Group related comments into a single commit (e.g., similar fixes across a file)
- Call resolve_and_commit() after each logical group with the comment IDs and a clear commit message
- Call skip_comment() for discussion questions, opinions, or comments that don't require code changes — include a brief reason
- Only modify files directly related to the comments you are resolving — do not touch unrelated files
- Write commit messages that describe what was fixed, not which comment asked for it
- Call finish_resolution() when all comments have been resolved or skipped
- Do NOT reply to comments on the platform — that happens after the user reviews and pushes
```

## UI Components

### Modified

**`Sidebar.tsx` / workspace items in repo section**
- Badge on workspace when linked PR has unresolved review comments (e.g., "3 comments")
- Clicking badge opens right panel in `pr-comments` mode

**`tab-store.ts`**
- New right panel mode: `"pr-comments"` with active session ID and selected tab state

**`PRReviewFileTab.tsx`**
- Reused for "View Diff" on resolution groups — shows the commit's diff with related review comments as context

### New

**`PRCommentsRail.tsx`** — the main right panel component for author-side comment resolution

Three tabs:

**Comments tab:**
- Fetches unresolved review comments from GitHub/Bitbucket via tRPC
- Displays as cards: author avatar, file:line, comment body, status badge
- Unresolved comments at top, already-resolved dimmed below
- Bottom sticky bar: "{N} comments can be resolved" + "Resolve with AI" button

**Resolved tab:**
- Queries `resolutionGroups` + `resolutionComments` from DB
- Each group card shows: commit message, SHA, "View Diff" button, "Revert" button
- Under each group: list of comments it resolved (checkmark + author + file + body summary)
- Skipped section at bottom: comment body + skip reason + "Ask AI about this" button
- Bottom sticky bar: progress indicator + "Push Changes" button

**Changes tab:**
- File list derived from resolution commits (files touched by the AI)
- Clickable to open in diff editor
- Shows +/- line counts per file

**`resolution.ts` tRPC router:**
- `startResolution(workspaceId)` — creates session, fetches comments from platform, builds prompt, launches agent
- `getResolutionSession(workspaceId)` — returns current/latest session with groups and comments
- `revertGroup(groupId)` — runs `git revert`, updates group status to "reverted", comments back to "pending"
- `revertAll(sessionId)` — reverts all applied groups in reverse order via `git revert` (safe, no history rewriting). Falls back to `git revert --no-commit` + single commit if too many groups.
- `pushChanges(workspaceId)` — pushes branch, posts platform replies per resolved thread

### Untouched

The reviewer-side components are completely separate: `PRControlRail.tsx`, `PROverviewTab.tsx`, `SubmitReviewModal.tsx`, `review-publisher.ts`.

## Platform Integration

### On Push

When the user clicks "Push Changes":

1. `git push` the branch
2. For each resolved group, collect unique threads/comments:
   - **GitHub**: group resolved comments by `platformThreadId`, post one reply per thread: "Addressed in {commitSha} — {commitMessage}". If `autoResolveThreads` is enabled, resolve the thread.
   - **Bitbucket**: reply to each `platformCommentId`: "Addressed in {commitSha} — {commitMessage}". No thread resolution (Bitbucket limitation).
3. Skipped comments get no automatic reply

### GitHub

- Reply via `addReviewThreadReply(platformThreadId, body)` (existing GraphQL mutation)
- Resolve via `resolveThread(platformThreadId)` (existing GraphQL mutation)
- Thread ID is stored in `resolutionComments.platformThreadId`, sourced from `getPRDetails` reviewThreads data

### Bitbucket

- Reply via `replyToPRComment(workspace, repoSlug, prId, platformCommentId, body)` (existing)
- No thread resolution (Bitbucket limitation)

## Notification & Discovery

### PR Poller Extension

The existing `pr-poller.ts` already tracks PRs every 60 seconds. Extension:
- Track `commentCount` changes on PRs where `role === "author"`
- Fire `onNewReviewComments(prIdentifier, newCount)` event when count increases
- Renderer receives via IPC notification (same pattern as `onNewPRDetected`)

### Visual Indicators

- Sidebar workspace badge: "N comments" on workspaces with linked author PRs that have unresolved comments
- Right panel auto-refresh if already in `pr-comments` mode
- Optional: Electron system notification ("Your PR got N new review comments")

## Edge Cases

### Agent Crash / Early Exit

If the agent process exits (crash, user kills it, terminal closed) without calling `finish_resolution()`, the session stays in `"running"` status. The main process monitors the agent's PTY exit event. On exit, if the session is still `"running"`, it updates status to `"failed"`. Any commits already made remain (they're valid git commits). The user can still see partially resolved groups in the Resolved tab and revert or keep them.

### Concurrent Sessions

If "Resolve with AI" is clicked while a session is `"running"`, the request is rejected with a message: "A resolution session is already running." The user must wait for it to finish or cancel it (kill the terminal / cancel button marks session as failed).

### Renamed Files

When fetching review comments, if a comment references a file path that was renamed in the PR, the comment's `filePath` is remapped to the current name using the PR's file rename data (same `buildPathMaps` pattern used by the reviewer-side publisher). The agent receives the current file path so it can find the code.

### Comments on Deleted Lines

If a comment references a line that no longer exists (due to prior edits), the agent receives the comment with context but without a precise line target. The prompt instructs it to use the comment body and surrounding context to locate the relevant code.

## Re-running Resolution

- If the user reverts some groups and wants the AI to retry, they click "Resolve with AI" again
- New `resolutionSessions` row is created
- Only currently unresolved comments are passed to the agent (previously resolved ones are excluded)
- Previous sessions remain in DB for history

## Scope Boundaries

**In scope:**
- Adding `role` field to `CachedPR` and preserving it through PR poller mapping
- Auto-linking workspaces to PRs via branch name matching in the PR poller
- Adding `getBitbucketPRComments()` to the Bitbucket API wrapper
- Fixing Bitbucket `commentCount` in the PR poller (currently hardcoded to 0)
- Fetching review comments from GitHub and Bitbucket
- AI agent resolving comments with commit-per-group
- Right panel UI with comments/resolved/changes tabs
- Revert per-group and revert-all
- Push with platform replies
- Sidebar notification badges
- Follow-up conversation in terminal

**Out of scope (future):**
- Auto-triggering resolution when comments arrive (always manual "Resolve with AI" for now)
- Inline editing of AI changes before committing (user can modify via terminal follow-up)
- Squashing resolution commits before push (user can do manually)
- Cross-PR resolution (resolving comments across multiple PRs at once)
