# PR Review UI Redesign

## Problem

The current PR review UI suffers from two core issues:

1. **Too cramped** — everything is stacked vertically in a narrow right sidebar (PR header, AI summary button, file list, comment overview, submit review), leaving no room to breathe.
2. **Flat visual hierarchy** — all elements have the same density, making it hard to quickly assess PR status or identify what needs attention.

## Design Goals

- Give each zone the space it needs rather than cramming everything into one panel
- Clear visual hierarchy: status at a glance, details on demand
- Support the AI-first review flow: AI reviews first, user triages and augments, then submits
- Files, terminals, and the PR overview can coexist as tabs

## Architecture: Hybrid Sidebar + Dashboard

Three zones work together:

### 1. Left Sidebar — Segmented Navigation

Replace the current single scrollable panel (repos + tickets + PRs stacked) with a segmented control at the top of `Sidebar.tsx`: **Repos | Tickets | PRs**. Each tab gets the full sidebar height.

The "Add Repository" button stays above the segmented control (it's global, not per-tab). The active workspace/project selector also stays above the segmented control — it must remain visible regardless of which segment is active since it determines the context for all tabs. The Settings button in the sidebar footer stays as-is. The `SidebarRail` collapsed view is unchanged — when collapsed, the segmented tabs are hidden and the rail icons remain.

**Modified files:** `Sidebar.tsx` (add segmented control, conditional rendering), `PullRequestsTab.tsx` (extract into standalone panel used by the PRs segment), `ProjectList.tsx` and `TicketsTab.tsx` (wrapped as segment content, no internal changes).

**PR tab specifics:**
- PRs grouped by repository with clean section headers (not collapsible nesting)
- Each PR row: `#number`, title, metadata line (file count, age), and AI status badge
- Active PR highlighted with accent-colored left border and subtle background
- Notification dot on the PRs segment tab when AI reviews are ready or need attention

**AI status badges (unchanged):**
- "AI Ready" — green, clickable to open review
- "Reviewing…" — yellow with animated pulse
- "Queued" — gray
- "Failed — Retry" — red, clickable to dismiss/retry
- "Review with AI" — neutral, clickable to trigger

### 2. Right Sidebar — Minimal Control Rail

Replaces `PRReviewPanel` inside `DiffPanel.tsx` (not `App.tsx`). When `rightPanel.mode === "pr-review"`, render `PRControlRail` instead of the current `PRReviewPanel`. The diff and explorer modes of the right panel remain unchanged — `PRControlRail` only shows in PR review mode.

Contains only essentials:

**Status line** (top):
- Single row: colored status dot + "Review Required · CI ✓" (or equivalent)

**File list** (middle, takes remaining space):
- Progress bar with `viewed/total` count
- File rows: viewed checkmark (✓ or ○), monospace filename, comment count badge
- Active file highlighted with accent left border
- Click opens file as diff tab in main area

**AI suggestions badge** (below file list):
- Single clickable row: AI badge + "N suggestions" + chevron
- Clicking scrolls the dashboard to the comments section (or switches to the dashboard tab)

**Submit Review button** (bottom):
- Single green button, always visible
- Opens the submit modal

**Empty state:**
- When no PR is selected: centered icon + "No active review" + "Select a PR to start reviewing"

### 3. Main Area — PR Overview Dashboard Tab

A full-width tab that auto-opens when entering a PR review. Lives alongside file diff tabs and terminal tabs.

**Tab type:** New `pr-overview` tab kind, replacing the `ai-review-summary` tab type. The tab item carries `prCtx: GitHubPRContext` (owner, repo, number, title, branches, repoPath) so it can query all necessary data. Dedup key: `pr-overview:${owner}/${repo}#${number}`.

**Auto-open trigger:** When `openPRReviewPanel()` is called (clicking a PR in the left sidebar), it also calls a new `openPROverview(workspaceId, prCtx)` action on the tab store that opens/focuses the PR Overview tab. If the user closes the tab, it does not reopen unless they click the PR again. The `openAIReviewSummary` action is removed.

**Session persistence:** The `serializeLayout` / `deserializeLayout` functions in `App.tsx` serialize `pr-overview` tabs by storing `prCtx`. On restore, the tab re-fetches data via the standard tRPC queries.

**PR Header:**
- Large title (18px, high contrast)
- Metadata line: `#number by author · targetBranch ← sourceBranch · N files changed`
- Status pills: rounded, color-coded (amber = review required, green = CI passing, etc.)
- Reviewer avatars with initials + approval state

**AI Summary Card:**
- Violet border and subtle violet background tint
- AI badge + "Review Summary" label
- Rendered markdown (using existing `MarkdownRenderer` component)
- Collapsible if the summary is long

**Unified Comments Feed:**
- Reuses the existing `UnifiedThread` type from `github-types.ts` to merge GitHub review threads and AI draft threads
- Section header: "Comments" + total count
- Each comment is a card with:
  - **Source indicator**: AI badge (violet) or reviewer avatar
  - **Clickable `file:line`** link — opens the file diff tab and scrolls to that line
  - **Comment body** — rendered text
  - **Actions**:
    - AI suggestions: Accept / Dismiss buttons
    - Human threads: Reply / Resolve buttons
- **Color coding via left border**:
  - Violet (`#a78bfa`) = AI suggestion
  - Amber (`#fbbf24`) = unresolved human thread
  - Green dimmed = resolved thread (reduced opacity)
- Resolved threads shown at bottom, dimmed

### 4. Submit Review Modal

Triggered by the "Submit Review" button in the sidebar.

**Content:**
- PR title + number in the header
- **Pending actions summary**: count of accepted (`status === "approved"`) AI comments that will be posted, warning if untriaged (`status === "pending"`) suggestions remain
- **Review body textarea** — optional overall comment
- **Three verdict buttons**: Comment (neutral), Approve (green), Request Changes (red)

The existing standalone "Post Comments" action (from the old banner) is removed — all posting happens through the submit modal.

**On submit:**
1. Post all accepted AI comments as GitHub review threads via `createReviewThread`
2. Update draft comment statuses to "submitted" via `aiReview.updateDraftComment`
3. Submit review verdict via `github.submitReview`
4. Invalidate `github.getPRDetails`, `github.getMyPRs`, refetch AI draft data
5. Close modal

## Component Structure

```
Left Sidebar (existing, modified):
  SegmentedControl: Repos | Tickets | PRs
  └─ PRListPanel (when PRs tab active)
       └─ PRRow (per PR, with AI status badge)

Right Sidebar (new):
  PRControlRail
  ├─ StatusLine
  ├─ FileNavigator (progress bar + file list)
  ├─ AISuggestionsBadge
  └─ SubmitButton

Main Area Tabs (existing tab system):
  PROverviewTab (new tab kind: "pr-overview", replaces "ai-review-summary")
  ├─ PRHeader
  ├─ AISummaryCard
  └─ CommentFeed
       └─ CommentCard (per comment, AI or human)

  PRReviewFileTab (existing, unchanged)
  TerminalTab (existing, unchanged)

Submit Modal (new):
  SubmitReviewModal
  ├─ PendingActionsSummary
  ├─ ReviewBodyTextarea
  └─ VerdictButtons
```

## Data Flow

No backend changes required. All data comes from existing tRPC queries:

- `github.getPRDetails` — PR metadata, files, review threads, CI, reviewers
- `github.getViewedFiles` — file viewed state
- `aiReview.getReviewDrafts` / `aiReview.getReviewDraft` — AI review status, summary, draft comments
- `aiReview.updateDraftComment` — accept/dismiss AI suggestions
- `github.createReviewThread` — post accepted AI comments
- `github.submitReview` — submit verdict
- `github.getMyPRs` — invalidated after submission to update PR list
- `github.addReviewThreadReply` — reply to threads
- `github.resolveThread` — resolve threads

The sidebar and dashboard share the same TanStack Query cache, so actions in one immediately reflect in the other.

## Files to Modify

**New files:**
- `PROverviewTab.tsx` — dashboard tab component (replaces `AIReviewSummaryTab.tsx`)
- `PRControlRail.tsx` — right sidebar control rail
- `SubmitReviewModal.tsx` — submit review modal

**Modified files:**
- `tab-store.ts` — replace `ai-review-summary` tab kind with `pr-overview` (carries `prCtx`), add `openPROverview` action, remove `openAIReviewSummary`
- `PaneContent.tsx` — render `PROverviewTab` for `pr-overview` tab kind
- `DiffPanel.tsx` — render `PRControlRail` when `rightPanel.mode === "pr-review"` (replacing `PRReviewPanel`)
- `App.tsx` — update `serializeLayout`/`deserializeLayout` for `pr-overview` tab persistence; filter out stale `ai-review-summary` tabs on deserialize for migration
- `Sidebar.tsx` — add segmented control (Repos | Tickets | PRs) with conditional rendering
- `PullRequestsTab.tsx` — extract as standalone panel for PRs segment
- `styles.css` — add styles for new components (modal, control rail, segmented control)

**Removed/deprecated files:**
- `PRReviewPanel.tsx` — replaced by `PRControlRail` + `PROverviewTab`
- `AIReviewSummaryTab.tsx` — merged into `PROverviewTab`
- `CommentOverview.tsx` — logic absorbed into `PROverviewTab`'s comment feed

## Design Tokens

All colors use existing CSS custom properties and the established palette:

- Accent: `#0a84ff` (active states, progress bar)
- AI/Violet: `#a78bfa` (AI badges, AI comment borders)
- Success/Green: `#30d158` (approved, CI passing, accept buttons)
- Warning/Amber: `#fbbf24` (unresolved threads, review required)
- Error/Red: `#ff453a` (failed, request changes)
- Backgrounds: `var(--bg-base)` through `var(--bg-overlay)`
- Text: `var(--text)` through `var(--text-quaternary)`
- Borders: `var(--border-subtle)`

## Implementation Notes

- `PRReviewPanel.tsx` must be removed before `CommentOverview.tsx`, since `PRReviewPanel` imports `CommentOverview`. If done incrementally, build the new components first, swap them in, then remove the old files.
- Existing persisted `ai-review-summary` tabs will have no `prCtx`. Add a guard in `deserializeLayout` to filter these out so users don't hit runtime errors on upgrade.
