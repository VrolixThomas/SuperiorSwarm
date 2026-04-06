# PR Review UX Overhaul

## Problem

After the v0.4.1 provider abstraction refactor and the `pr-review-branches-fix` branch work, the PR review system has several regressions and gaps:

1. **Summary card and retrigger button disappeared** from the Comments tab in the PR control rail. Root cause: draft matching by `prIdentifier` breaks when identifiers are inconsistent between creation and lookup.
2. **No manual trigger** — there is no user-facing button to start an AI review. The only trigger is the auto-trigger `useEffect`, which requires `autoReviewEnabled`. If auto-review is off, there is no way to start a review.
3. **Re-review is unreliable** — the retrigger button is hidden when `reviewChainId` is null, which happens whenever draft matching fails.
4. **No auto re-review on new commits** — when new commits are pushed to an already-reviewed PR, there is no mechanism to detect this and re-queue.
5. **Auto-trigger skips previously reviewed PRs** — once a draft exists (even `submitted` or `dismissed`), the auto-trigger won't fire again.

## Design

### 1. Unified Review Button

A single button in `PRControlRail`, always visible in the tab header bar (not inside the Comments tab — visible regardless of which tab is active).

**State machine for the button:**

| Draft state | Label | Action |
|---|---|---|
| No draft for this PR | "Start Review" | `triggerReview` |
| `queued` or `in_progress` | "Restart Review" | `cancelReview` → `triggerReview` |
| `ready` | "Re-review" | `triggerFollowUp` |
| `submitted` | "Re-review" | `triggerFollowUp` |
| `failed` | "Re-review" | `triggerFollowUp` |
| `dismissed` | "Re-review" | `triggerFollowUp` |

The button uses a refresh icon (matching the existing retrigger icon). "Start Review" state adds a sparkle badge. It is never hidden. Errors display inline via tooltip or small banner.

When no `reviewChainId` can be resolved but a draft exists, fall back to using `matchingDraft.id` as the chain ID (this is already partially implemented but the button visibility gate prevents it from being useful).

**Implementation location:** `PRControlRail.tsx` — move the retrigger button out of `CommentsTab` and into the `PRTabHeader` component or a new persistent toolbar row below it. The button needs access to `prCtx`, `matchingDraft`, and `draftReviewChainId`, which are already computed in the parent `PRControlRail` component.

### 2. Fix Draft Identifier Matching

The `prIdentifier` format must be identical at write time (review creation) and read time (UI lookup).

**Standard format:** `{owner}/{repo}#{number}`
- GitHub: `octocat/hello-world#42`
- Bitbucket: `myworkspace/myrepo#17`

**Fix points:**
- `triggerReview` in `ai-review.ts` router — receives `identifier` from the client, passes it through to `queueReview`. Verify this matches the format above.
- `triggerReviewWithCtx` in `PullRequestsTab.tsx` — constructs the identifier. Currently uses `${pr.repoOwner}/${pr.repoName}#${pr.number}` for GitHub and `${pr.workspace}/${pr.repoSlug}#${pr.id}` for Bitbucket. This is correct.
- `matchingDraft` lookup in `PRControlRail.tsx` — builds `prIdentifier` as `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`. This depends on `prCtx` being populated correctly.
- The root issue: `prCtx` must be set when opening the review workspace. Check all code paths that call `openPRReviewPanel` or `setActiveWorkspace` with `prCtx` to ensure `owner`, `repo`, and `number` are set correctly for both providers.

**Defensive fallback:** If the exact `prIdentifier` match returns no drafts, try matching by workspace ID (the draft is linked to a workspace which is linked to a project + PR). This provides a second lookup path.

### 3. Auto-Review Settings

Two independent boolean toggles in `AIReviewSettings`:

```
[x] Auto-review new PRs where I'm a reviewer
[x] Auto re-review when new commits are pushed
```

**Schema change** in `aiReviewSettings` table:
- Rename existing `autoReviewEnabled` to `autoReviewNewPRs` (or keep as-is and add a new column)
- Add `autoReReviewOnNewCommits` (integer, default 0)

**Preferred approach:** Keep `autoReviewEnabled` as-is for backwards compatibility (controls new PR auto-trigger). Add `autoReReviewOnCommit` as a new column.

### 4. Cancel + Restart

When the user clicks the unified button during an active review (`queued` or `in_progress`):

1. Call `cancelReview({ draftId })` — sets draft status to `dismissed`
2. Call `triggerReview(...)` — creates a new draft and starts a fresh review

This is two sequential mutations wrapped in the button's click handler. The UI shows a brief "Restarting..." state.

### 5. Commit-Based Auto Re-review

**PR poller extension:**
- Add `headCommitSha` field to `CachedPR` in `review-types.ts`
- The PR poller already fetches PR data — extract the head commit SHA from the API response (GitHub: `pullRequest.headRefOid`, Bitbucket: `source.commit.hash`)
- On each poll cycle, compare the cached `headCommitSha` with the new value
- If changed: emit a `onPRCommitChanged` event (similar to existing `onNewPRDetected`)

**Auto re-review handler (in `index.ts` or `auto-trigger.ts`):**
- Listen for `onPRCommitChanged`
- Check if `autoReReviewOnCommit` setting is enabled
- Check if there's an existing draft for this PR that is NOT `queued` or `in_progress`
- If eligible, call `maybeAutoTriggerFollowUp()` — a new function that finds the review chain and queues a follow-up

### 6. Relaxed Auto-Trigger for Previously Reviewed PRs

Change `shouldAutoTriggerReview` logic:
- Current: `if (existingDrafts.has(pr.identifier)) return false`
- New: only skip if there's a draft with `status === "queued"` or `status === "in_progress"`

This means:
- A PR with a `submitted` review can be auto-triggered again (useful when new commits arrive)
- A PR with a `failed` or `dismissed` review can be auto-triggered again
- The session-level `alreadyTriggered` set still prevents duplicate triggers within a single app session

**Also update the frontend auto-trigger** in `PullRequestsTab.tsx` (the `useEffect` at line 481) with the same relaxed logic.

## Files to Modify

### Backend
- `apps/desktop/src/main/db/schema-ai-review.ts` — add `autoReReviewOnCommit` column
- `apps/desktop/src/main/db/migrations/` — new migration for the column
- `apps/desktop/src/main/ai-review/auto-trigger.ts` — relax `shouldAutoTriggerReview`, add `maybeAutoTriggerFollowUp`
- `apps/desktop/src/main/ai-review/pr-poller.ts` — track `headCommitSha`, emit commit change events
- `apps/desktop/src/main/trpc/routers/ai-review.ts` — no changes needed (endpoints already exist)
- `apps/desktop/src/main/index.ts` — wire `onPRCommitChanged` handler
- `apps/desktop/src/shared/review-types.ts` — add `headCommitSha` to `CachedPR`

### Frontend
- `apps/desktop/src/renderer/components/PRControlRail.tsx` — move review button to persistent header, implement unified button logic
- `apps/desktop/src/renderer/components/PullRequestsTab.tsx` — relax auto-trigger `useEffect` to match backend logic
- `apps/desktop/src/renderer/components/settings/AIReviewSettings.tsx` — add second toggle

### Tests
- `apps/desktop/tests/ai-review-auto-trigger.test.ts` — update for relaxed logic, add commit-based re-trigger tests

## Out of Scope

- Bitbucket thread resolution in the comments tab (separate issue)
- Review prompt customization
- Multi-reviewer coordination
