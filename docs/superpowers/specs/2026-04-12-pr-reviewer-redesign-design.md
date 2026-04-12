# PR Reviewer Redesign — Design Spec

**Date:** 2026-04-12
**Branch:** `pr-reviewer-redesign`
**Prior art:** PR #73 — Comment Solver Redesign v2

## Problem Statement

The AI PR reviewer has four core UX issues:

1. **Cramped sidebar:** The entire review triage flow (AI comments, approval, editing, summary, submit) is squeezed into `PRControlRail`'s "Comments" tab alongside file navigation. Not enough space to evaluate comments.
2. **No lifecycle control:** No way to cancel a running review, no visible progress while the agent works, and no indication of what round the review is on.
3. **Weak comment triage:** Comments are approve/reject in bulk via `SubmitReviewModal`. No per-comment granularity, no file grouping, no inline editing before submission.
4. **Invisible review chains:** Multi-round reviews (follow-up rounds after author pushes fixes) are tracked in the DB but invisible in the UI. The user can't see what was said in Round 1, what was resolved in Round 2, or what regressed.

## Design Decisions

### Approach

**New `ReviewWorkspaceTab` component** (Approach C). A purpose-built workspace tab component that renders instead of `PROverviewTab` when an active AI review draft exists. `PROverviewTab` stays unchanged for non-review contexts. `PRControlRail` gets simplified to a navigation-only role.

### Key Choices

- **File-grouped comments with per-comment granularity.** Comments are grouped by file path with "Approve All" at the group level and individual approve/edit/reject per comment. Mirrors how GitHub organizes PR review comments.
- **Simple cancel** over cancel-with-resume. Killing the agent keeps whatever draft comments were already written. The user can triage partial results and re-trigger a fresh review. No resume — re-running is cheap since the reviewer only writes text comments, not git commits.
- **Resolution delta annotations** over full timeline as the primary view. Each comment in a follow-up round is annotated with NEW / RESOLVED / STILL_OPEN / REGRESSED. A collapsible "Review History" section shows previous rounds as a compact timeline for reference.
- **Slim verdict confirmation** over the current heavy `SubmitReviewModal`. All triage happens in the tab; the submit flow is just verdict selection (Comment / Approve / Request Changes) + optional body.
- **AI-suggested verdict** shown as a recommendation in the status strip, not a pre-selected default. All three verdict buttons remain equal.

## §1 — ReviewWorkspaceTab

### Layout

The tab renders in the main workspace area with this structure:

```
┌─────────────────────────────────────────────────┐
│ [Terminal] [AI Reviewer] [retry-handler.ts ✕]   │  ← tab bar
├─────────────────────────────────────────────────┤
│ #142  feat/message-queue → main       [Cancel]  │  ← PR header
│ Add message queue retry logic and WebSocket...  │
├─────────────────────────────────────────────────┤
│ ●5 approved  ●1 rejected  ●2 pending    Rnd 2  │  ← status strip
│ ████████████████████░░░░░                       │  ← progress bar
│ AI suggests: Request Changes                    │
├─────────────────────────────────────────────────┤
│ ▼ AI Review Summary                             │  ← collapsible
│ ┌───────────────────────────────────────────────┐│
│ │ The retry logic uses linear backoff instead   ││
│ │ of exponential. Two race conditions found...  ││
│ └───────────────────────────────────────────────┘│
├─────────────────────────────────────────────────┤
│ ▼ src/queue/retry-handler.ts    3 comments      │  ← file group
│ │ L42  Use exponential backoff...  ✓ Approved   │
│ │      RESOLVED                                 │
│ │ L67  Race condition in active...  [Appr][Ed]  │
│ │      NEW                          [Rej][Diff] │
│ │ L89  Missing null check...       ✓ Approved   │
│ │      RESOLVED                                 │
│ ▶ src/ws/connection-pool.ts     2 comments      │  ← collapsed
│ ▶ src/config.ts                 1 comment  ✓    │  ← all approved
├─────────────────────────────────────────────────┤
│ ▶ Review History                   2 rounds     │  ← collapsible
├─────────────────────────────────────────────────┤
│ 2 comments pending review  [Dismiss] [Submit…]  │  ← bottom bar
└─────────────────────────────────────────────────┘
```

### Component: `ReviewWorkspaceTab`

New workspace tab component that renders instead of `PROverviewTab` when an active review draft exists.

**Props:** `workspaceId: string`

**Data:** Queries `aiReview.getReviewDraft(draftId)` — obtains `draftId` from the workspace record's `reviewDraftId` field. Polls every 3s while status is `queued` or `in_progress`.

**Sections:**
- **PR header:** PR number, branch pill (`source → target`), title, cancel button (visible when `queued` or `in_progress`), state and review decision pills
- **Status strip:** Approval pills (approved/rejected/pending counts), progress bar, round indicator, AI verdict suggestion
- **AI summary:** Collapsible markdown summary from the agent's `set_review_summary` call
- **File groups:** Expandable cards, first group with pending comments expanded by default. Each card contains: file path, comment count, approval summary, "Approve All" button, individual comments
- **Review history:** Collapsible timeline of previous rounds (see §5)
- **Bottom bar:** Actionable status message, Dismiss button, Submit Review button (disabled until all comments triaged)

### Component: `ReviewFileGroupCard`

One card per file with comments.

**Header:**
- Chevron (expand/collapse), file path (monospace, clickable — opens diff), comment count, approval summary badges, "Approve All" button

**Body (when expanded):**
- One row per comment showing:
  - Line number (monospace, left-aligned)
  - Comment body (markdown rendered)
  - Resolution delta badge: NEW / RESOLVED / STILL_OPEN / REGRESSED (for follow-up rounds, absent in round 1)
  - Action buttons: Approve / Edit / Reject / View in Diff →
  - If edited: inline textarea replaces comment body, with Save / Cancel

**File group states:**

| State | Header display | Body content |
|-------|---------------|--------------|
| All pending | Pending count badge, Approve All visible | Full comment list with action buttons |
| Partially approved | Mixed badges, Approve All for remaining | Full list, approved comments dimmed |
| All approved | Green checkmark, no Approve All | Collapsed by default, dimmed |
| All rejected | Red count, no Approve All | Collapsed by default, dimmed |

### Component: `ReviewVerdictConfirmation`

Slim inline panel that expands in-place at the bottom bar when user clicks "Submit Review." Replaces the current heavy `SubmitReviewModal` — no overlay/modal.

**Contents:**
- Three verdict buttons: Comment / Approve / Request Changes (equal weight)
- Optional body textarea
- Submit / Cancel actions
- No comment counts or pending warnings (already resolved in the tab)

### Component swap in PaneContent

In `PaneContent.tsx`, when rendering a workspace tab for a review workspace:
- Query the workspace's `reviewDraftId`
- If a non-dismissed draft exists → render `ReviewWorkspaceTab`
- Otherwise → render `PROverviewTab`

## §2 — Cancel Flow

### Trigger

"Cancel" button in the PR header, visible when draft status is `queued` or `in_progress`.

### Flow

1. **Kill agent process:** Read `pid` from `reviewDrafts`, call `process.kill(pid, 'SIGTERM')`. Handle ESRCH (already dead).
2. **Keep partial comments:** All draft comments written so far are preserved. The user can triage them.
3. **Transition draft:** `in_progress → cancelled` or `queued → cancelled`.
4. **Update UI:** ReviewWorkspaceTab shows partial comments as triageable, plus a "Re-review" button to start fresh.

### New draft status: `cancelled`

Added to the state machine:

```
queued       → in_progress, failed, dismissed, cancelled
in_progress  → ready, failed, dismissed, cancelled
ready        → submitted, failed, dismissed
submitted    → dismissed
failed       → queued, dismissed
cancelled    → dismissed
```

`cancelled` is distinct from `failed`:
- `cancelled` = user chose to stop. Show partial results + re-review option.
- `failed` = agent crashed. Same partial preservation, different messaging.

### tRPC mutation

```typescript
cancelReview: protectedProcedure
  .input(z.object({ draftId: z.string() }))
  .mutation(async ({ input }) => {
    // kill process via PID, transition to cancelled
  })
```

## §3 — Live Progress & Awareness

### During agent run (queued/in_progress)

- ReviewWorkspaceTab polls `getReviewDraft` every 3s
- Draft comments appear in real-time as the agent writes them via MCP `add_draft_comment`
- Status strip shows "Reviewing..." with a subtle animated indicator
- Cancel button visible in PR header
- File groups build up live as comments arrive

### On completion (in_progress → ready)

- Auto-focus the ReviewWorkspaceTab (switch to it if not active)
- Status strip updates from "Reviewing..." to approval counts
- AI summary section appears
- Cancel button hidden, triage controls appear

### PR list badges

Tracked PRs in the workspace sidebar show review status derived from the latest draft:
- `queued` / `in_progress` → "Reviewing..."
- `ready` → "N comments ready"
- `submitted` → "Submitted (Round N)"
- `cancelled` → "Cancelled"
- `failed` → "Failed"

## §4 — Comment Triage Workflow

### Per-comment actions

| Action | Effect | UI change |
|--------|--------|-----------|
| Approve | `draftComments.status → "approved"` | Comment dims, green checkmark |
| Edit | Opens inline textarea with current body | Textarea replaces body |
| Save edit | `status → "edited"`, `userEdit → newBody` | Shows edited body, "Edited" badge |
| Reject | `draftComments.status → "rejected"` | Comment removed from view (filtered) |
| View in Diff | Opens `PRReviewFileTab` for that file as sibling tab | Workspace tab opens |

### Approve All (per file group)

Approves all pending comments in the file group. Comments already approved or rejected are unaffected. Uses a batch mutation.

### Submit Review flow

1. User clicks "Submit Review" in bottom bar (enabled when zero pending comments remain)
2. `ReviewVerdictConfirmation` expands inline at the bottom bar (no modal overlay)
3. User picks verdict (Comment / Approve / Request Changes), optionally adds body
4. System calls `review-publisher.publishReview(draftId)` which:
   - Posts each approved/edited comment as a GitHub/Bitbucket inline comment
   - Posts the AI summary as the review body
   - Submits the review with the chosen verdict
5. Draft transitions to `submitted`
6. Commit poller starts watching for new commits (existing behavior)

### Batch mutation

New tRPC mutation for bulk approval:

```typescript
batchUpdateDraftComments: protectedProcedure
  .input(z.object({
    commentIds: z.array(z.string()),
    status: z.enum(["approved", "rejected"]),
  }))
  .mutation(...)
```

## §5 — Review Chain Visibility

### Resolution delta annotations

When a follow-up review round finishes (`finish_review` called), the system computes resolution deltas by comparing current-round comments against previous-round comments:

- **NEW** — Comment on a file/line that had no comment in the previous round
- **RESOLVED** — Previous comment's file/line has no new comment AND the platform thread is resolved (or code changed at that location)
- **STILL_OPEN** — Previous comment's file/line still has an issue flagged by the new round
- **REGRESSED** — A previously resolved comment has a new issue at the same location

These annotations are stored on `draftComments.roundDelta` (new nullable TEXT column) and displayed as colored badges next to each comment in the ReviewWorkspaceTab.

For round 1, no badges are shown (there's nothing to compare against).

### Review History section

Collapsible section at the bottom of ReviewWorkspaceTab, above the bottom bar.

**Collapsed state:** "Review History · N rounds"

**Expanded state:** A compact vertical timeline showing each round:

```
Round 1 · Apr 10 · 6 comments · Submitted
  3 resolved · 2 still open · 1 new issue found in Round 2

Round 2 · Apr 12 · 4 comments · Ready for review
  Current round
```

Each round entry shows: round number, date, comment count, status, and resolution summary relative to the next round (how many were resolved, how many persisted).

Clicking a past round's entry does not navigate anywhere — the history is informational. The full comment details for past rounds are available on the GitHub PR itself after submission.

### tRPC query

```typescript
getReviewChainHistory: protectedProcedure
  .input(z.object({ reviewChainId: z.string() }))
  .query(({ input }) => {
    // returns all drafts in the chain with comment counts and statuses
  })
```

## §6 — PRControlRail Simplification

### Current role

PRControlRail currently has three tabs: Changes, Comments, Files. The "Comments" tab renders the full comment thread list with triage actions.

### New role

When a ReviewWorkspaceTab is active (non-dismissed draft exists):
- **Comments tab** becomes a compact jump-list: shows file paths with comment counts. Clicking a file scrolls to that file group in ReviewWorkspaceTab or opens the diff tab.
- **Changes tab** — unchanged (shows branch diff summary)
- **Files tab** — unchanged (shows file tree)

The triage workflow moves entirely to ReviewWorkspaceTab. PRControlRail becomes navigation-only for review workspaces.

## §7 — Schema Changes

### New migration

```sql
-- Add cancel support and liveness tracking to review_drafts
ALTER TABLE review_drafts ADD COLUMN pid INTEGER;
ALTER TABLE review_drafts ADD COLUMN last_activity_at INTEGER;

-- Add resolution delta for follow-up rounds
ALTER TABLE draft_comments ADD COLUMN round_delta TEXT;
-- Values: 'new', 'resolved', 'still_open', 'regressed', NULL (round 1)
```

### State machine update

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  queued: ["in_progress", "failed", "dismissed", "cancelled"],
  in_progress: ["ready", "failed", "dismissed", "cancelled"],
  ready: ["submitted", "failed", "dismissed"],
  submitted: ["dismissed"],
  failed: ["queued", "dismissed"],
  cancelled: ["dismissed"],
};
```

### PID tracking

On `startReview` / `startFollowUpReview`, after launching the agent process, store the PID in `reviewDrafts.pid`. The MCP server already heartbeats via `last_activity_at` for the solver — extend this to review mode.

## §8 — What This Does NOT Cover

- Concurrent multi-PR review (one ReviewWorkspaceTab per workspace, one workspace per PR — existing constraint)
- Offline/disconnected review (requires GitHub/Bitbucket API access)
- Comment threading (AI comments are top-level, not threaded replies)
- Review assignment (who should review — out of scope, handled by GitHub)
- Changes to the MCP server tools (review tools remain the same — `add_draft_comment`, `set_review_summary`, `finish_review`, etc.)
- Changes to `PRReviewFileTab` (inline diff view stays as-is, comments still rendered as Monaco view zones)
