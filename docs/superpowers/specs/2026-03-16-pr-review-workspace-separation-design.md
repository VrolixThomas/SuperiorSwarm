# PR Review Workspace Separation Design

## Problem

When a PR review is triggered, the orchestrator creates a `worktrees` + `workspaces` record using the same tables as regular repo work. The Repos tab `listByProject` query has no filtering, so review worktrees (named `Review: {title}`) leak into the Repos tab alongside the user's actual work. There is no structural distinction between review and work worktrees — only a naming convention.

The PR review lifecycle (AI review, commenting, re-review on new commits, resolution tracking) is a distinct domain that should live entirely within the PRs tab, separate from the user's development work.

## Goals

- PR reviews (where user is a reviewer, not author) live entirely in the PRs tab
- Review worktrees are invisible to the Repos tab without any filtering
- Each PR gets a persistent workspace in the main content area (tabs, splits, terminals persist across switches)
- The full PR lifecycle is supported: review, comment, new commits, re-review, merge/close
- Rich sidebar list items show at-a-glance status for all reviewer PRs

## Non-Goals

- PRs where the user is the author (handled separately later)
- Bitbucket enrichment for reviewer status and CI (deferred — start with GitHub)
- Real-time webhooks for PR updates (polling is sufficient for now)

## Design

### 1. Database Schema

#### New table: `review_workspaces`

```sql
CREATE TABLE review_workspaces (
  id TEXT PRIMARY KEY,
  review_draft_id TEXT REFERENCES review_drafts(id) ON DELETE SET NULL,
  worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pr_provider TEXT NOT NULL,        -- "github" | "bitbucket"
  pr_identifier TEXT NOT NULL,      -- "owner/repo#123"
  terminal_id TEXT,
  created_at INTEGER NOT NULL,      -- Drizzle mode: "timestamp"
  updated_at INTEGER NOT NULL,      -- Drizzle mode: "timestamp"
  UNIQUE(project_id, pr_provider, pr_identifier)
);
```

- `review_draft_id` is **nullable** — a review workspace can exist for manual review without an AI review draft. Only set when an AI review is triggered.
- `worktree_id` is nullable — the review workspace exists before a worktree is created. Set when a worktree is created (AI review trigger or manual "Open Worktree").
- `pr_provider` + `pr_identifier` identify the PR independently of a review draft, supporting manual-only reviews.
- `terminal_id` tracks the attached terminal session — ephemeral, cleared on app startup during hydration (IDs reset across sessions).
- On worktree cleanup, `worktree_id` is set to NULL but the review workspace persists.
- The `UNIQUE(project_id, pr_provider, pr_identifier)` constraint enables the `getOrCreate` upsert pattern via `INSERT ... ON CONFLICT`.

#### Modified: `review_drafts`

- **Remove** `worktree_path` column (was a string path, not a proper FK)
- **Remove** `summary_file_path` column (review artifacts now live in app data directory under `reviews/{draftId}/`)
- The worktree is now reachable via: `review_drafts → review_workspaces → worktrees`

#### Modified: `pane_layouts`

- **Drop FK constraint** on `workspace_id` (currently references `workspaces.id`)
- Keep `workspace_id` as a plain `TEXT PRIMARY KEY` — it now serves as a generic scope key that can reference either `workspaces.id` or `review_workspaces.id`
- The in-memory pane-store already treats this as an arbitrary string key, so no store changes needed

#### Modified: `terminal_sessions`

- **Drop FK constraint** on `workspace_id` (currently references `workspaces.id`)
- Keep `workspace_id` as a plain `TEXT NOT NULL` column
- Allows terminal sessions to be saved/restored for both repo and review workspaces

#### Unchanged: `workspaces`

- Exclusively for regular repo work
- The Repos tab `listByProject` query needs zero changes — review data is never inserted here

#### Unchanged: `worktrees`

- Shared between repo and review worktrees (the filesystem abstraction is the same)
- Ownership is determined by which table references them: `workspaces.worktree_id` (repo) vs `review_workspaces.worktree_id` (review)

### 2. PR Sidebar List Items

PRs are grouped by repository (same as current layout). Each list item shows rich, at-a-glance information.

#### Data strategy

1. **Initial load** — fast REST search returns PRs immediately (title, number, author, branch, draft status)
2. **Background enrichment** — for each PR where user is a reviewer, fire a new `getPRListDetails` tRPC endpoint that batches `getPRDetails` GraphQL calls to fetch: per-reviewer status, CI state, unresolved thread count, files changed, head commit OID, mergeable status. Cached in TanStack Query with 30-60s stale time. The existing `getPRDetails` GraphQL query already fetches most of these fields — the new endpoint wraps it for batch use from the list view.
3. **Activity detection** — compare `headCommitOid` from enriched data against `review_drafts.commitSha`. If they differ, flag as "new commits since your last review."

#### Fields per list item

| Field | Source |
|-------|--------|
| Title + PR number | REST search |
| Source branch → target branch | REST search / enrichment |
| Author + avatar | GraphQL enrichment |
| Per-reviewer avatars with status borders (approved = green, changes requested = yellow, pending = gray) | GraphQL enrichment |
| CI status (passing/failing/pending) | GraphQL enrichment |
| Unresolved comment count | GraphQL enrichment |
| Files changed count (+additions/-deletions) | GraphQL enrichment |
| New commits since last review indicator | `headCommitOid` vs `review_drafts.commitSha` |
| Draft PR indicator | REST search |
| Merge conflict indicator | GraphQL `mergeable` field |
| Time since last update | REST/GraphQL timestamps |
| AI review status (queued/reviewing/ready/submitted/failed) | `review_drafts` query |

#### Bitbucket

Shows a simpler list item with available data (title, author, branch, timestamps). Enrichment for reviewer status and CI deferred to a future iteration.

### 3. PR Workspace — Main Content Area

Clicking a PR in the sidebar opens a persistent workspace in the main content area, keyed by `review_workspace.id`.

#### Review workspace creation timing

A `review_workspace` record is created **on first interaction** with a PR — either:
- User clicks a reviewer PR in the sidebar for the first time
- User triggers "Review with AI" on a PR

The renderer calls a `reviewWorkspaces.getOrCreate({ projectId, prProvider, prIdentifier })` tRPC mutation that upserts by `(project_id, pr_provider, pr_identifier)`. This avoids a background sync job while ensuring the record exists before any tabs or layouts are created.

#### First open behavior

1. Call `getOrCreate` to ensure the `review_workspace` record exists
2. Check user's configured default view preference (stored in settings, defaults to `pr-overview`)
3. Create the initial tab based on that preference
4. A new layout tree is created in `pane-store` keyed by the `review_workspace.id`

#### Subsequent opens

Restore the exact state where the user left off — same tabs, same splits, same active tab. Identical to switching between repo workspaces.

#### Available tab types

- `pr-overview` — summary, comment threads, review actions
- `terminal` — shell in the review worktree (disabled if no worktree exists yet)
- `pr-review-file` — inline diff with commenting
- `file` — plain file editor in the review worktree
- `diff-file` — diff between branches

#### Workspace switching

- Clicking a PR → `setActiveWorkspace(reviewWorkspaceId, cwd, { rightPanel })` (extended existing action with optional panel override)
  - `cwd` is resolved as: `worktrees.path` if a worktree exists, otherwise the project's `repoPath` as fallback
  - `rightPanel` override is set to `{ open: true, mode: "pr-review", diffCtx: null, prCtx }` — this prevents the default `defaultPanelForCwd()` from applying diff mode
- Clicking a repo workspace → same `setActiveWorkspace(workspaceId, cwd)` as today (no override, defaults to diff mode)
- Both use the same `activeWorkspaceId` field, so the pane-store and `MainContentArea` render the correct layout
- The tab/pane rendering pipeline is identical for both workspace types

The `setActiveWorkspace` signature change: add an optional third parameter `options?: { rightPanel?: RightPanelState }`. When provided, it overrides the `defaultPanelForCwd()` call. When omitted, existing behavior is unchanged.

#### Session persistence

- Terminal sessions in review workspaces are saved/restored alongside repo workspace sessions (enabled by dropping FK constraints on `terminal_sessions` and `pane_layouts`)
- The renderer's periodic save (`collectSnapshot()` in `App.tsx`) must include terminals from both workspace types in the save payload — the `saveTerminalSessions` function does a destructive `DELETE WHERE id NOT IN (currentIds)`, so omitting review workspace terminals would purge them
- The `restoreSession` tRPC endpoint is modified to return workspace metadata from both `workspaces` and `review_workspaces` tables (joined by `workspace_id`), so the renderer can resolve `cwd` paths and workspace types during hydration. Return shape adds a `workspaceType: "repo" | "review"` and `prCtx` (for review workspaces) alongside each session
- `review_workspaces.terminal_id` is cleared on app startup during hydration (terminal IDs are ephemeral counters that reset across sessions)
- Review workspace tabs include `prCtx` for PR Overview and diff tab restoration

### 4. Worktree Lifecycle

#### Creation

Two paths to worktree creation:

1. **AI Review trigger** — user clicks "Review with AI." Orchestrator creates `review_workspace` (via `getOrCreate`), creates worktree, updates `review_workspaces.worktree_id` and `review_workspaces.review_draft_id`. AI agent runs in a terminal tab within the PR workspace.
2. **Manual review** — user clicks "Open Worktree" from PR Overview tab. Creates worktree on demand via `reviewWorkspaces.createWorktree(reviewWorkspaceId)`. No `review_draft` is created — `review_draft_id` stays NULL.

#### Orchestrator changes

The following functions in `orchestrator.ts` must be updated:

- **`queueReview()`** — call `reviewWorkspaces.getOrCreate()` instead of preparing a `workspaces` insert. Store the `reviewWorkspaceId` on the in-memory `activeReviews` map.
- **`startReview()`** — insert into `worktrees` table (same as now), then UPDATE `review_workspaces.worktree_id` and `review_workspaces.review_draft_id` (instead of inserting into `workspaces`). Remove the `workspaces` insert entirely.
- **`cleanupReview()`** — resolve worktree path via `review_workspaces → worktrees.path` join instead of reading `review_drafts.worktreePath` directly.
- **`cleanupStaleReviews()`** — same join-based path resolution. Query: `SELECT w.path FROM review_drafts rd JOIN review_workspaces rw ON rw.review_draft_id = rd.id JOIN worktrees w ON rw.worktree_id = w.id WHERE rd.status = 'in_progress'`.
- **`ReviewLaunchInfo` interface** — return `reviewWorkspaceId` instead of `workspaceId`.

#### Cleanup triggers

| Event | Action |
|-------|--------|
| PR merged or closed | Auto-delete worktree from disk, remove `worktrees` record, null out `review_workspaces.worktree_id`. Keep `review_workspace` + `review_draft` for history. |
| User manually closes | Same — "Remove Worktree" action removes worktree but preserves review data. |
| App startup (stale detection) | Check `review_drafts` with status `in_progress` — resolve worktree path via join, clean up MCP configs, mark as failed. |
| Review submitted | Worktree stays alive (supports re-review cycle). Only cleaned on merge/close/manual. |

#### PR merge/close detection

- Piggyback on existing PR list refresh polling (~30-60s)
- When a PR transitions to merged/closed, trigger worktree cleanup automatically
- Show notification: "PR #142 was merged — worktree cleaned up"

#### Manual cleanup UX

- Right-click PR in sidebar → "Remove Worktree"
- Button in PR Overview tab
- Confirmation dialog (removes local files)

#### What persists after cleanup

- `review_workspace` record (layout can be restored if PR reopens)
- `review_draft` + `draft_comments` (review history)
- PR remains in sidebar as long as it's open (or recently closed)

### 5. Migration

Clean break — no state preservation needed (not in production).

1. Create `review_workspaces` table via Drizzle migration
2. Drop `worktree_path` and `summary_file_path` columns from `review_drafts`
3. Drop FK constraint on `pane_layouts.workspace_id` (keep column as plain text PK)
4. Drop FK constraint on `terminal_sessions.workspace_id` (keep column as plain text)
5. Capture `worktree_id` and `worktrees.path` values from `workspaces` rows where `name LIKE 'Review: %'` (joined with `worktrees`), then delete those `workspaces` rows
6. Remove review worktree directories from disk using the captured paths (best-effort, ignore errors for missing directories)
7. Delete the captured `worktrees` rows (orphaned review worktrees) — use the IDs from step 5
8. Delete all `review_drafts` rows (clean slate for AI reviews)
8. Orphaned pane layouts (keyed by old workspace IDs) are discarded on hydration — if a workspace ID isn't found in either `workspaces` or `review_workspaces`, the layout is dropped

### 6. tRPC Router Changes

#### New: `review-workspaces` router

- `getOrCreate({ projectId, prProvider, prIdentifier })` — upserts a review workspace by `(project_id, pr_provider, pr_identifier)`, returns the record
- `listByProject(projectId)` — returns review workspaces joined with `review_drafts` (if any) and `worktrees` (if any)
- `get(reviewWorkspaceId)` — single review workspace with full details
- `createWorktree(reviewWorkspaceId)` — creates worktree for manual review (no AI), updates `worktree_id`
- `removeWorktree(reviewWorkspaceId)` — removes worktree from disk and DB, nulls `worktree_id`, keeps review data
- `attachTerminal(reviewWorkspaceId, terminalId)` — assigns terminal to review workspace

#### Modified: `ai-review` router

- `triggerReview` — calls `reviewWorkspaces.getOrCreate()`, then creates worktree, updates `review_workspaces.worktree_id` and `review_draft_id`. No longer inserts into `workspaces`.
- `getReviewDrafts` — joins with `review_workspaces` for workspace IDs

#### Modified: `session-persistence`

- `savePaneLayouts` — works unchanged (FK dropped, column is now plain text)
- `saveTerminalSessions` — works unchanged (FK dropped)
- `restoreSession` — queries both `workspaces` and `review_workspaces` to resolve workspace IDs and their `cwd` paths

#### Unchanged: `workspaces` router

- `listByProject` remains untouched — review data is never inserted here in the new model

### 7. `githubBranchPrs` table

The existing `github_branch_prs` table links workspaces to GitHub PRs for the "author" flow (linking a PR to a workspace where the user is developing). This table is **not used** for the reviewer flow. Review workspaces identify their PR via the `pr_provider` + `pr_identifier` fields directly on the `review_workspaces` table.
