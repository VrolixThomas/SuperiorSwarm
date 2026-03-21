# Persistent PR Review Worktrees Design

## Overview

PR review worktrees should be created once and persist until the PR is merged, closed, or dismissed. Currently `startReview()` force-removes and recreates the worktree on every review attempt, causing race conditions when triggered multiple times and unnecessary churn.

## Goals

- Create worktree once on first need (PR open or review trigger), reuse thereafter
- Eliminate the force-remove-and-recreate pattern that causes "already exists" errors
- Clean up worktrees only when the PR lifecycle ends (merged/closed/dismissed)
- Support lazy creation from both PR browsing and AI review paths

## Worktree Lifecycle

| Event | Action |
|-------|--------|
| User opens a PR (repo is tracked) | Create worktree if none exists |
| AI review triggered (first or follow-up) | Create worktree if none exists, then `fetch + reset` to latest |
| New commits detected by poller | `fetch + reset` in existing worktree |
| PR merged/closed (detected by poller) | Remove worktree + clean up DB records |
| User dismisses review chain | Remove worktree + clean up DB records |

## Changes

### `startReview()` in `orchestrator.ts`

Remove the "remove stale worktree" block entirely. Replace with:

1. Check if a `reviewWorkspace` already exists for this PR with a valid worktree (DB record + directory exists on disk)
2. **If worktree exists** — reuse it: `git fetch origin && git reset --hard origin/{sourceBranch}`, capture new commit SHA
3. **If no worktree** — create via `checkoutBranchWorktree()`, create worktree + reviewWorkspace DB records
4. Continue with prompt writing, MCP config, launch script as normal

### `queueFollowUpReview()` in `orchestrator.ts`

Remove the worktree recreation block. The worktree should always exist at this point (created during first review or PR open). Just `fetch + reset` to update to latest code.

If the worktree is somehow missing (edge case), fall back to creating it — but this should not be the normal path.

### New: `ensureWorktree` tRPC endpoint

Add `reviewWorkspaces.ensureWorktree` mutation:

Input: `{ projectId, prProvider, prIdentifier, sourceBranch, targetBranch }`

Logic:
1. Check if reviewWorkspace exists for this PR
2. If worktree exists on disk → return it (no-op)
3. If no worktree → create via `checkoutBranchWorktree()`, create DB records, return path

Called from the renderer when the user clicks a PR in the sidebar (if the repo is tracked as a project).

### Cleanup on PR merge/close

In `commit-poller.ts`, when `pollChain()` detects a PR is merged or closed:

1. Find the review workspace for this PR
2. Remove the git worktree via `git worktree remove --force`
3. Delete the worktree DB record
4. Mark the review chain's latest draft as `dismissed`
5. Run `git worktree prune` to clean up

### Cleanup on dismiss

Update the `dismissReview` tRPC mutation to also remove the worktree:

1. Find the review workspace for the dismissed draft
2. If it has a worktree → `git worktree remove --force` + delete DB record
3. Set draft status to `dismissed` (existing behavior)

## What This Eliminates

- The `git worktree remove --force` + `rmSync` + `git worktree prune` block in `startReview()`
- The worktree recreation block in `queueFollowUpReview()`
- Race conditions from concurrent review triggers competing for the same worktree path
- "fatal: path already exists" errors from git
