# AI Comments in PR Review View — Design Spec

## Goal

Integrate AI draft review comments into the existing PR review experience instead of having a separate panel. AI comments appear inline in the Monaco diff editor alongside GitHub review threads, with accept/decline actions. A unified comment overview in the right panel lets users browse and sort all comments.

## Architecture Overview

No new panel modes. Everything operates within the existing `pr-review` mode and `PRReviewFileTab` infrastructure. AI draft comments are fetched from the local SQLite DB and merged with GitHub review threads in the renderer.

## Data Flow

### Sources
- **GitHub threads:** `trpc.github.getPRDetails` returns `reviewThreads[]` (existing)
- **AI draft comments:** `trpc.aiReview.getReviewDraft` returns `comments[]` from `draft_comments` table (existing)

### Merging
The `PRReviewFileTab` component queries both sources. AI comments are transformed into a unified thread-like structure with an `isAIDraft: true` flag and `draftCommentId` for wiring accept/decline. The merge happens in the renderer — no new tRPC endpoints needed.

### Matching AI Comments to PRs
AI draft comments are linked to a PR via the `review_drafts.prIdentifier` field (format: `owner/repo#number`). When a PR review is opened, the renderer checks if a review draft exists for that PR identifier and fetches its comments.

## Inline Comment UI (PRReviewFileTab)

### AI Comment Appearance
- Rendered using the same `ThreadWidget` component as regular GitHub comments
- **Visual distinction:** Subtle blue-purple left border (`border-left: 2px solid var(--accent)` or a dedicated AI accent color). Small "AI" badge pill (e.g., `bg-[rgba(120,100,255,0.15)] text-[#a78bfa]`) next to the author name "BranchFlux AI"
- Same layout, font, spacing as regular comments

### Accept/Decline Buttons
- Appear below the comment body, only for AI draft comments
- **Accept:** Small button, subtle green styling. Marks draft as `approved` in DB, adds to local pending list for batch submission
- **Decline:** Small button, muted/ghost styling. Marks draft as `rejected` in DB, removes the view zone — comment disappears from editor
- Regular GitHub threads have no accept/decline buttons — completely unchanged

### Gutter Decoration
- AI draft comments use a blue-purple gutter dot (distinct from amber for unresolved GitHub threads and green for resolved ones)
- CSS class: `.pr-thread-ai-draft-gutter` with appropriate color

### View Zone Management
- AI draft comments create view zones identically to GitHub threads (via `useInlineCommentZones`)
- Declined comments remove their view zone immediately
- The existing thread navigation arrows (prev/next unresolved comment) include AI draft comments in the count

## Right Panel Comment Overview (PRReviewPanel)

### Location
New collapsible section added **below** the existing file list in `PRReviewPanel`, above the Submit Review area.

### Header
- Section title: "Comments (N)" where N is total count
- Sort dropdown on the right with options: "By file", "By reviewer", "Latest first"

### Comment Entries
Each entry is a compact row showing:
- Small avatar or icon (GitHub user avatar, or AI icon for draft comments)
- Author name (truncated)
- File path and line number (truncated, monospace)
- Comment body preview (first line, ellipsized)
- AI draft comments display the same "AI" badge pill as inline
- Accepted comments show a subtle checkmark
- Declined comments are hidden (not shown in list)

### Click Action
Clicking a comment entry:
1. Opens the file tab via `openPRReviewFile()` if not already open
2. Scrolls the editor to center the commented line via `revealLineInCenter()`

### Grouping Modes
- **By file:** Comments grouped under file path headers, same order as file list
- **By reviewer:** Grouped under reviewer name sections. AI comments grouped under "BranchFlux AI"
- **Latest first:** Flat chronological list, newest at top

## Submit Review Integration

### Flow
When the user clicks Comment/Approve/Request:
1. Collect all accepted AI draft comments from the pending list
2. For each accepted comment, call `createReviewThread` to post to GitHub (file path, line number, body, commit SHA)
3. Submit the review verdict via `submitReview` (existing)
4. On success, update draft comments in DB to status `submitted`

### Error Handling
- If some comments fail to post (file deleted, line out of range), the review still submits
- User sees feedback: "Review submitted. 2 of 3 AI comments posted. 1 failed."
- Failed comments remain in `approved` status for manual retry

### No Regression
If no AI draft comments exist for a PR, the submit flow is identical to today. Zero impact on users not using AI review.

## Files to Modify

| File | Changes |
|------|---------|
| `PRReviewFileTab.tsx` | Fetch AI drafts, merge with GitHub threads, extend ThreadWidget for AI comments |
| `PRReviewPanel.tsx` | Add comment overview section with sort dropdown below file list |
| `styles.css` | Add `.pr-thread-ai-draft-gutter` decoration class, AI badge styles |
| `tab-store.ts` | Add pending accepted comments state for batch submission |
| `github.ts` (tRPC router) | Extend `submitReview` to post accepted AI comments before verdict |

## Files NOT Modified

| File | Reason |
|------|--------|
| `DraftReviewPanel.tsx` | Replaced by inline integration — may be removed later |
| `DraftCommentCard.tsx` | No longer needed for primary flow |
| `PRSummaryViewer.tsx` | Orthogonal, can be wired later |
| `DiffPanel.tsx` | No new panel modes needed |

## Out of Scope

- AI review triggering UI (handled by existing "Review with AI" button)
- Settings view for AI review configuration
- Auto-detection of new review requests
- Bitbucket integration for comment posting
