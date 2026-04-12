# Unified PR Review Tab

## Problem

PROverviewTab and ReviewWorkspaceTab are two separate tabs for the same PR. When a review starts, ReviewWorkspaceTab opens in a new split pane and the PROverviewTab gets buried — no clear way back. The Comments tab in PRControlRail also had a mode where it replaced all platform comments with a compact jump-list when a review was active, hiding comments from other reviewers.

## Solution

Merge ReviewWorkspaceTab's features into PROverviewTab. One tab per PR, always. When a review draft is active, the tab gains review-specific UI; when no review exists, it shows the current read-only view unchanged.

## Layout — No Active Review (unchanged)

```
┌─────────────────────────────────────┐
│ PR Header (title, author, state,    │
│ CI, reviewers, branches)            │
├─────────────────────────────────────┤
│ AI Summary Card (collapsible)       │
├─────────────────────────────────────┤
│ Comments Feed                       │
│  ├─ Unresolved threads (flat)       │
│  └─ Resolved threads (flat)         │
└─────────────────────────────────────┘
```

## Layout — Active Review Draft

```
┌─────────────────────────────────────┐
│ PR Header (same rich header)        │
├─────────────────────────────────────┤
│ Status Strip                        │
│  approved/rejected/pending counts   │
│  progress bar · AI suggestion       │
│  Round N · Chain history link       │
├─────────────────────────────────────┤
│ AI Summary Card (collapsible)       │
├─────────────────────────────────────┤
│ File Group Cards (grouped by file)  │
│  ├─ src/foo.ts (3 comments)         │
│  │   ├─ AI comment — approve/reject │
│  │   ├─ GitHub thread — reply/resolve│
│  │   └─ AI comment — approve/reject │
│  ├─ src/bar.ts (1 comment)          │
│  │   └─ ...                         │
├─────────────────────────────────────┤
│ Chain History (collapsible)         │
╞═════════════════════════════════════╡
│ Bottom Bar: status · Dismiss · Submit│
└─────────────────────────────────────┘
```

Key differences from no-review mode:
- Status strip appears between header and summary (counts, progress bar, AI verdict suggestion, round number)
- Comments switch from flat chronological to grouped-by-file cards
- Both AI draft comments (approve/reject/edit) and GitHub threads (reply/resolve) appear together in their file groups, sorted by line number
- Bottom bar pinned with dismiss and submit review
- Chain history section at the bottom (collapsible)

## Review Mode Trigger

Driven by the presence of a matching draft:

```
hasActiveDraft = matchingDraft exists AND status not in [dismissed, submitted]
```

- No draft / dismissed / submitted → read-only mode
- queued / in_progress → review mode, status strip shows "Reviewing..."
- ready → review mode, full approve/reject/edit workflow
- cancelled / failed → review mode with status indicator, user can dismiss or re-review

## Component Changes

### Deleted
- `ReviewWorkspaceTab.tsx` — features fold into PROverviewTab

### Kept / Reused
- `ReviewFileGroupCard.tsx` — reused by PROverviewTab. Extended to accept a union of comment types: AI draft comments (approve/reject/edit actions) and GitHub platform threads (reply/resolve actions, multi-comment threads). The card's props grow to accept both kinds, and `CommentRow` renders different action buttons based on the comment source.
- `ReviewVerdictConfirmation.tsx` — reused in PROverviewTab's bottom bar

### Modified
- `PROverviewTab.tsx` — gains conditional review mode: status strip, grouped-by-file layout, bottom bar with dismiss/submit, chain history
- `tab-store.ts` — remove `review-workspace` tab kind and `addReviewWorkspaceTab` action
- `PRControlRail.tsx` — `triggerReview`/`triggerFollowUp` onSuccess callbacks stop opening a review workspace tab. Terminal still opens in a split pane. PROverviewTab auto-detects the draft.
- `PaneContent.tsx` — remove `review-workspace` case

### Data Flow

PROverviewTab already queries `getReviewDrafts` and `getReviewDraft`. No new queries or endpoints needed.

Comment grouping merges two sources:
- `aiDraftQuery.data.comments` — AI draft comments (keyed by `filePath`)
- `details.reviewThreads` — GitHub platform threads (keyed by `path`)

Within each file group, items sorted by line number.

### Dismiss Behavior

The dismiss button in the bottom bar calls `dismissPendingComments` (rejects unreviewed AI comments). The tab stays open and drops back to read-only mode since the draft transitions out of active state. Summary and accepted comments are preserved.

### Terminal Split

When a review triggers, the terminal for the AI agent still opens in a split pane beside the current view. The PROverviewTab detects the new draft via its existing polling query and switches to review mode automatically.
