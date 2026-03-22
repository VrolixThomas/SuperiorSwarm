# PR Review System Restructure — Design Spec

## Problem Statement

The PR review feature on the `automatic-pr-review` branch has three categories of issues:

1. **Worktree/tabgroup management is unreliable** — Review workspaces are invisible in the sidebar after creation, MCP config lands in the wrong directory, terminals start in wrong locations.
2. **Two conflicting PR views** — A correct view (PROverviewTab + PRControlRail) and an incorrect one (regular diff panel) are both reachable depending on how the workspace is activated.
3. **Changes tab doesn't show commits** — `prCtx.repoPath` points to the main repo instead of the worktree, so `getCommitsAhead` finds nothing.

Root causes: duplicate code paths for worktree creation (orchestrator vs router), a separate `review_workspaces` table that isn't integrated into the UI workspace system, and frontend PR polling that only runs when the PRs tab component is mounted.

## Design Overview

Full restructure: merge review workspaces into the unified workspace system, move PR polling to a background service in the main process, and establish a single code path for all workspace operations.

## Section 1: Unified Data Model

### Current State — Two Separate Tables

```
workspaces:        id, projectId, type("branch"|"worktree"), name, worktreeId, terminalId
review_workspaces: id, projectId, worktreeId, terminalId, prProvider, prIdentifier, reviewDraftId
```

### Proposed — Single Table with Review-Optional Fields

```sql
workspaces:
  id            TEXT PRIMARY KEY,
  projectId     TEXT NOT NULL,       -- FK → projects
  name          TEXT NOT NULL,       -- For review: derived from PR title, e.g. "PR #16: Create Claude.md"
  worktreeId    TEXT,                 -- FK → worktrees
  terminalId    TEXT,
  type          TEXT NOT NULL,       -- "branch" | "worktree" | "review"
  prProvider    TEXT,                 -- "github" | "bitbucket" (review only)
  prIdentifier  TEXT,                 -- "owner/repo#123" (review only)
  reviewDraftId TEXT,                 -- FK → review_drafts (current active draft, review only)
  createdAt     TIMESTAMP,
  updatedAt     TIMESTAMP,
  UNIQUE(projectId, prProvider, prIdentifier)  -- one review workspace per PR per project
```

**Unique constraint note:** SQLite treats NULL values as distinct in unique constraints. Since non-review workspaces have NULL `prProvider` and `prIdentifier`, the unconditional `UNIQUE(projectId, prProvider, prIdentifier)` constraint won't conflict — multiple non-review workspaces for the same project are allowed. Drizzle's schema DSL supports this directly; no hand-written SQL needed.

### Tables That Stay Unchanged

- `review_drafts` — review sessions, rounds, status, summary
- `draft_comments` — individual comments within a draft
- `ai_review_settings` — global AI config (preset, auto-review, skip-permissions, etc.)
- `worktrees` — physical git worktree records on disk

### Migration Strategy

New migration:
1. Add columns to `workspaces`: `prProvider`, `prIdentifier`, `reviewDraftId`, extend `type` check to include "review"
2. Add unique constraint on `(projectId, prProvider, prIdentifier)` — unconditional (NULL-safe, see note above)
3. Migrate any existing `review_workspaces` rows into `workspaces` (set `name` to `"PR #N: <title>"`, `type` to `"review"`)
4. Drop `review_workspaces` table

## Section 2: Backend Architecture

Three layers: background services, unified router + orchestrator, data.

### Layer 1: Background Services (Main Process)

#### PR Poller (NEW)

Replaces frontend-only TanStack Query polling in `PullRequestsTab`.

- Runs in main process on a timer (configurable interval, default ~60s)
- Checks GitHub/Bitbucket APIs for PRs where user is a reviewer
- Maintains an in-memory cache of known PRs and their state
- On new review request detected:
  - If `autoReviewEnabled`: creates workspace + worktree + triggers AI review automatically
  - If not: sends IPC event to renderer for badge/notification
- On PR merged/declined: triggers full cleanup
- Starts on app launch (if any GitHub/Bitbucket accounts are connected)

**Cache format and tRPC interface:**

The PR poller cache stores enriched PR data matching what the frontend currently fetches across 5+ separate queries. Exposed via a new `prPoller` tRPC router:

```typescript
// tRPC endpoints
prPoller.getCachedPRs.useQuery({ projectId? })  // all cached PRs, optionally filtered
prPoller.refreshNow.useMutation()                // force immediate poll

// Cache entry shape (per PR)
interface CachedPR {
  provider: "github" | "bitbucket";
  identifier: string;          // "owner/repo#123"
  number: number;
  title: string;
  state: "open" | "merged" | "declined" | "closed";
  sourceBranch: string;
  targetBranch: string;
  author: { login: string; avatarUrl: string };
  reviewers: Array<{ login: string; avatarUrl: string; state: string }>;
  ciStatus: string | null;     // "success" | "failure" | "pending" | null
  commentCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  updatedAt: string;           // ISO timestamp
  repoOwner: string;
  repoName: string;
  projectId: string;           // linked BranchFlux project
}
```

The `PullRequestsTab` renders from `prPoller.getCachedPRs` instead of making direct GitHub/Bitbucket API calls. Enrichment data (reviewers, CI status, comment counts) is fetched by the poller, not lazy-loaded by the frontend. This eliminates the multiple query waterfall and ensures data is available regardless of which tab the user is viewing.

#### Commit Poller (EXISTS — keep + fix)

- Watches submitted reviews for new commits (60s interval)
- On new commits detected:
  - If `autoReviewEnabled`: auto-queues follow-up review in existing workspace
  - If not: notifies renderer ("New commits" badge)
- On PR merged/declined: triggers full cleanup (currently incomplete — needs fix)
- Fix: use the same cleanup function as PR poller (see Cleanup section)

### Layer 2: Unified Router + Orchestrator

#### Unified `workspacesRouter` (MERGE)

Absorbs all of `review-workspaces.ts` router into `workspaces.ts`. Single router for all workspace types.

New/modified endpoints:
- `getOrCreateReview({ projectId, prProvider, prIdentifier, prTitle, sourceBranch, targetBranch })` — finds existing review workspace or creates one with worktree. This collapses the current two-step flow (`reviewWorkspaces.getOrCreate` then `reviewWorkspaces.ensureWorktree`/`reviewWorkspaces.createWorktree`) into a single call. The `prTitle` is used to set the workspace `name` field (e.g. `"PR #16: Create Claude.md"`). The `sourceBranch`/`targetBranch` are used for git worktree checkout. All call sites in `PullRequestsTab.tsx` that currently do the two-step flow must be refactored to use this single endpoint.
- `listByProject` — already exists, now also returns type="review" workspaces. Return type augmented with review-specific fields: `prProvider`, `prIdentifier`, `reviewDraftId`, plus joined data: `draftStatus` (from `review_drafts.status`), `draftCommitSha` (from `review_drafts.commitSha`). These fields are needed by the sidebar to display AI review status badges and PR identifiers.
- `createWorktree` — unified, handles both regular and review worktrees
- `removeWorktree` — unified, with dirty-check
- `attachTerminal` — unified
- `cleanupReviewWorkspace(workspaceId)` — full cleanup: kill terminal, remove worktree, delete workspace, dismiss drafts

Delete: `review-workspaces.ts` router entirely.

#### `aiReviewRouter` (SLIM DOWN)

Keeps review-content endpoints, delegates workspace operations to unified router:
- `triggerReview` — calls `workspacesRouter.getOrCreateReview()` for workspace, then orchestrator for AI setup
- `triggerFollowUp` — reuses existing workspace, calls orchestrator for re-review setup
- `updateDraftComment`, `addUserComment` — unchanged
- `submitReview` — unchanged, calls review-publisher
- `cancelReview` — stops the AI process, marks draft as "failed", but **keeps workspace and worktree intact** for retry. Does NOT call `cleanupReviewWorkspace()`.
- `dismissReview` — full cleanup via `workspacesRouter.cleanupReviewWorkspace()`. Destroys workspace, worktree, terminal, tabs.
- `getSettings`, `updateSettings` — unchanged

#### Orchestrator (REMOVE DUPLICATE CODE)

Stops doing its own worktree creation. Responsibilities narrowed to:
- Review lifecycle state management (queued → in_progress → ready → submitted)
- MCP config setup/teardown (write config to worktree, return cleanup function)
- Prompt building (initial + follow-up with previous comments context)
- Launch script generation (CLI command + args for terminal execution)
- Active review tracking (in-memory map for polling status changes)
- Stale review cleanup on app startup

Remove: `ensureReviewWorktree()` — this logic moves to `workspacesRouter.getOrCreateReview()`.

#### MCP Server (CONSOLIDATE)

Keep only the standalone CommonJS server (`mcp-standalone/server.mjs`). Delete the TypeScript/Drizzle version (`mcp-server.ts`).

Rationale: Claude Code runs with system Node.js, not Electron's bundled Node. The standalone server uses `better-sqlite3` directly and works correctly. Maintaining two implementations with diverging timestamp formats is a maintenance burden.

Fix: align timestamp format in standalone server to match Drizzle's Date objects (or standardize on Unix seconds everywhere).

#### Review Publisher (KEEP AS-IS)

No changes needed. Handles GitHub/Bitbucket comment publishing, file rename resolution, thread management correctly.

### Layer 3: Terminal Session Restoration

`terminal-sessions.ts` restore logic simplifies — no longer needs to query two workspace tables. Single join on `workspaces` (with type check) resolves workspace metadata for all session types.

## Section 3: Frontend Architecture

### Generalize `GitHubPRContext` to `PRContext`

The current `GitHubPRContext` type (in `src/shared/github-types.ts`) has GitHub-specific fields (`owner`, `repo`). Since the system supports both GitHub and Bitbucket, rename and generalize:

```typescript
// src/shared/review-types.ts (rename from github-types.ts or add alongside)
interface PRContext {
  provider: "github" | "bitbucket";
  owner: string;           // GitHub owner or Bitbucket workspace
  repo: string;            // Repository name
  number: number;           // PR number
  title: string;
  sourceBranch: string;
  targetBranch: string;
  repoPath: string;         // Always the worktree path, never the main repo
}
```

All components that currently take `GitHubPRContext` (`openPRReviewPanel`, `openPRReviewFile`, `openPROverview`, `PRControlRail`, `PROverviewTab`, etc.) should accept `PRContext` instead. The `provider` field enables provider-specific API calls where needed (e.g., thread resolution on GitHub vs Bitbucket).

### The "Two Views" Fix

Root cause: `setActiveWorkspace()` doesn't know the workspace type, so it always defaults to the regular diff panel.

Fix: `setActiveWorkspace()` checks workspace type from the store. If `type === "review"`:
- Automatically sets `rightPanel.mode` to `"pr-review"`
- Builds `prCtx` (now `PRContext`) from the workspace record (prProvider, prIdentifier, etc.)
- **Sets `prCtx.repoPath` to the worktree path** (from the `cwd` parameter). This is the single place where `repoPath` is set for review workspaces — all downstream components (`PRControlRail`, `ChangesTab`, `CommentsTab`, `PRReviewFileTab`) receive the correct path via `prCtx` without needing any changes themselves.

If `type !== "review"`: normal diff panel behavior, unchanged.

This eliminates the separate `openPRReviewPanel(workspaceId, prCtx)` call with its manually-constructed `prCtx` where `repoPath` was incorrectly set to the main repo.

### Tab Store Changes

**Change:**
- `setActiveWorkspace(id, cwd)` — auto-detect workspace type, set correct panel mode
- `openPRReviewPanel` — remove explicit `prCtx` parameter, derive from workspace record
- Store workspace metadata (type, prProvider, prIdentifier) alongside `activeWorkspaceId`

**Keep:**
- `openPRReviewFile` — file diff tabs work correctly
- `openPROverview` — overview tab creation works
- Pane store / layout tree — no changes needed
- Terminal tab management — works fine

### Changes Tab Commits Fix

In `PRControlRail.tsx`, `ChangesTab` currently uses `prCtx.repoPath` for git queries. This points to the main repo, not the worktree.

Fix: `prCtx.repoPath` is now set correctly at construction time in `setActiveWorkspace()` (see "Two Views" fix above). Since `PRControlRail` already reads `prCtx.repoPath` for all its git queries (`getCommitsAhead`, `getBranchDiff`, `SmartHeaderBar`, `RepoFileTree`), **no changes needed in `PRControlRail.tsx` itself** — the fix is entirely in how `prCtx` is constructed.

### PullRequestsTab Changes

**Remove:** Direct GitHub/Bitbucket API queries (TanStack Query calls to `trpc.github.getUserPRs`, etc.). Replace with reading from backend PR poller cache via tRPC query.

**Change:** `handlePRClick` calls unified `trpc.workspaces.getOrCreateReview()` instead of `trpc.reviewWorkspaces.getOrCreate()`.

**Keep:** PR card layout, status badges, reviewer avatars, CI status indicators, AI review status badges — all visual elements are good.

### Notification Flow

Main process sends IPC events to renderer:
- `"new-pr-review-request"` — PR poller found new PR, badge update
- `"ai-review-ready"` — AI finished review, show "AI Ready" badge
- `"new-commits-detected"` — Commit poller found changes, show "New commits" badge
- `"pr-closed"` — PR merged/declined, trigger UI cleanup

The existing green dot badge system on the PRs tab can be driven by these events instead of frontend queries.

## Section 4: Full PR Review Lifecycle

### Phase 1: Detection & Workspace Creation

**Auto-review ON:**
1. PR Poller detects new review request
2. Creates workspace (type="review") via unified router
3. Creates worktree (checkout PR source branch)
4. Creates review draft (status="queued")
5. Sets up MCP config in worktree root
6. Creates terminal, runs AI CLI with launch script
7. Notifies renderer: "AI reviewing PR #N"
8. User sees "AI Ready" badge when AI finishes

**Auto-review OFF:**
1. PR Poller detects new review request
2. Notifies renderer: "New PR #N for review" (badge)
3. User clicks PR in PRs tab sidebar
4. Creates workspace (type="review") via unified router
5. Creates worktree, terminal (cwd = worktree path)
6. User browses code, optionally triggers AI review manually

### Phase 2: AI Review Execution

1. AI CLI runs in terminal within the worktree directory
2. AI calls MCP tools via stdio → standalone MCP server
3. MCP server writes directly to SQLite (WAL mode, busy timeout)
4. Tools: `get_pr_metadata`, `add_draft_comment`, `set_review_summary`, `finish_review`
5. On `finish_review()`: draft status → "ready"
6. Orchestrator polling detects status change → cleans up MCP config → notifies renderer

### Phase 3: User Reviews AI Suggestions

1. User sees PROverviewTab with AI summary card + comments feed
2. Reviews each AI comment: approve / reject / edit
3. Can add own comments via file diff tabs (PRReviewFileTab)
4. Clicks "Submit Review" → SubmitReviewModal
5. Selects verdict: Comment / Approve / Request Changes
6. Review publisher posts approved comments to GitHub/Bitbucket
7. Draft status → "submitted"
8. Commit poller starts watching this PR for new commits

### Phase 4: Re-review Cycle

1. Commit poller detects HEAD SHA changed on PR
2. **Same workspace, same worktree, same tabgroup** — no new workspace
3. Worktree updated: `git fetch origin` + `git reset --hard origin/<branch>`
4. New review draft created (roundNumber++, linked via reviewChainId)
5. Workspace's `reviewDraftId` updated to new draft
6. If auto-review ON: AI triggered in existing terminal
7. If auto-review OFF: "New commits" badge, user triggers manually
8. Follow-up prompt includes previous comments + resolution status

### Phase 5: Cleanup on Merge/Decline

**Backend cleanup** (single `cleanupReviewWorkspace()` function):
1. Kill terminal process
2. Remove worktree from disk
3. `git worktree prune`
4. Delete worktree DB record
5. Delete workspace DB record
6. Mark all related drafts as "dismissed"
7. Clean up MCP config files and temp review directory

**Frontend cleanup** (triggered by IPC event):
1. Remove all tabs belonging to this workspace
2. Remove pane layout for this workspace
3. If this was the active workspace, switch to another
4. Remove PR from sidebar list
5. Brief toast notification: "PR #N merged, cleaned up"

### Review Draft State Machine

Valid transitions (enforce in orchestrator):
```
queued → in_progress → ready → submitted
any → failed
any → dismissed
```

Currently no validation exists. The orchestrator should reject invalid transitions.

## What to Keep (Working Correctly)

| Component | Status | Notes |
|-----------|--------|-------|
| PROverviewTab | Keep | Main area PR overview with AI summary + comments feed |
| PRControlRail | Keep | Right panel with Changes/Comments/Files tabs |
| PRReviewFileTab | Keep | File diff tabs with inline comments, Monaco editor |
| SubmitReviewModal | Keep | Review submission with verdict selection |
| ReviewPromptEditor | Keep | Custom prompt settings UI |
| SettingsView | Keep | AI review settings panel |
| review-publisher.ts | Keep | GitHub/Bitbucket comment publishing |
| cli-presets.ts | Keep | Multi-CLI support (Claude, Gemini, Codex, OpenCode) |
| review_drafts table | Keep | Review sessions and rounds |
| draft_comments table | Keep | Individual review comments |
| ai_review_settings table | Keep | Global AI config |
| Review chain mechanism | Keep | roundNumber, previousDraftId, reviewChainId |
| PR card visual design | Keep | Status badges, avatars, CI indicators |

## What to Remove

| Component | Reason |
|-----------|--------|
| `review_workspaces` table | Merged into `workspaces` |
| `review-workspaces.ts` router | Merged into `workspaces.ts` |
| `PRReviewPanel.tsx` | Already deleted, confirm gone |
| `mcp-server.ts` (TypeScript version) | Duplicate of standalone server |
| `ensureReviewWorktree()` in orchestrator | Logic moves to unified router |
| Frontend PR API polling in PullRequestsTab | Replaced by backend PR poller |
| Duplicate worktree creation code | Consolidated to single path |

## What to Change

| Component | Change |
|-----------|--------|
| `workspaces` table schema | Add prProvider, prIdentifier, reviewDraftId, extend type enum |
| `workspaces.ts` router | Absorb review workspace CRUD, add `getOrCreateReview`, `cleanupReviewWorkspace`. `listByProject` returns review fields (draftStatus, prIdentifier, etc.) |
| `ai-review.ts` router | Delegate workspace ops to unified router. Distinguish `cancelReview` (keep workspace) from `dismissReview` (full cleanup) |
| `orchestrator.ts` | Remove worktree creation, focus on MCP + prompt + lifecycle |
| `commit-poller.ts` | Use unified cleanup function, fix incomplete cleanup |
| `tab-store.ts` | `setActiveWorkspace` auto-detects type, builds `PRContext` with correct `repoPath` from worktree path, sets PR panel mode |
| `GitHubPRContext` → `PRContext` | Rename type, add `provider` field, update all consuming components |
| `PRControlRail.tsx` | Type rename only — `repoPath` fix is upstream in `setActiveWorkspace` |
| `PullRequestsTab.tsx` | Read from `prPoller.getCachedPRs`, single `getOrCreateReview` call (replaces two-step flow) |
| `terminal-sessions.ts` | Simplify restore to single workspace table query |
| `mcp-standalone/server.mjs` | Fix timestamp format consistency |

## Files Changed Summary

### New Files
- `src/main/ai-review/pr-poller.ts` — Background PR polling service
- `src/main/trpc/routers/pr-poller.ts` — tRPC router exposing PR poller cache (`getCachedPRs`, `refreshNow`)

### Deleted Files
- `src/main/trpc/routers/review-workspaces.ts`
- `src/main/ai-review/mcp-server.ts`
- `src/renderer/components/PRReviewPanel.tsx` (confirm already gone)

### Modified Files
- `src/main/db/schema.ts` — Add review fields to workspaces
- `src/main/db/schema-ai-review.ts` — Remove review_workspaces table definition
- `src/main/trpc/routers/workspaces.ts` — Absorb review workspace operations
- `src/main/trpc/routers/ai-review.ts` — Delegate workspace ops, distinguish cancel vs dismiss
- `src/main/trpc/routers/index.ts` — Remove reviewWorkspaces router import, add prPoller router
- `src/main/trpc/routers/terminal-sessions.ts` — Simplify restore query
- `src/main/ai-review/orchestrator.ts` — Remove worktree code, narrow scope
- `src/main/ai-review/commit-poller.ts` — Use unified cleanup
- `src/main/index.ts` — Start PR poller on launch
- `src/shared/github-types.ts` — Rename `GitHubPRContext` to `PRContext`, add `provider` field, move/keep in shared types
- `src/renderer/stores/tab-store.ts` — Type-aware workspace activation, build PRContext from workspace record
- `src/renderer/components/PRControlRail.tsx` — Use `PRContext` type (no logic changes needed — repoPath fix is upstream)
- `src/renderer/components/PROverviewTab.tsx` — Use `PRContext` type
- `src/renderer/components/PRReviewFileTab.tsx` — Use `PRContext` type
- `src/renderer/components/PullRequestsTab.tsx` — Backend-driven data via `prPoller.getCachedPRs`, unified workspace router calls
- `src/renderer/components/Sidebar.tsx` — Event-driven badge updates
- New migration file for schema changes
