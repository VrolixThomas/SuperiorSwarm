# AI Review Summary Button in Comments Tab

## Problem

After the AI review agent finishes and posts a summary, the summary is displayed in the PROverviewTab. Once that tab is closed, there's no way to get back to it from the Comments tab in the PRControlRail sidebar.

## Solution

Add a small neutral "Summary" button in the CommentsTab's sort control bar. Clicking it opens the existing PROverviewTab which already renders the `AISummaryCard`.

## Changes

### `PRControlRail.tsx` — `CommentsTab` component

**New props:**
- `summaryMarkdown: string | null` — used only to conditionally render the button (truthy = show; null and empty string both hide it)
- `onShowSummary: () => void` — click handler

**Button placement:** Inside the existing sort control bar div (line ~555), between the thread count span and the sort dropdown. The button only renders when `summaryMarkdown` is truthy.

**Edge case — no threads:** The CommentsTab has an early return when `allThreads.length === 0` that renders before the sort bar. When a summary exists but there are no comment threads, always render the sort bar (with just the Summary button) instead of the "No comments yet" empty state.

**Styling:** Matches the sort dropdown's neutral style — `--text-tertiary` text color, `--border-subtle` border, same font size and padding. A small sparkle character (`✦`) before the label "Summary".

### `PRControlRail.tsx` — parent component (where `CommentsTab` is rendered)

Pass two new props to `<CommentsTab>`:
- `summaryMarkdown={aiDraftQuery.data?.summaryMarkdown ?? null}`
- `onShowSummary={() => activeWorkspaceId && openPROverview(activeWorkspaceId, prCtx)}`

Both values are already available in the parent scope — no new queries, state, or endpoints needed.

## What does NOT change

- No new tRPC endpoints
- No new tab types
- No new components
- No changes to PROverviewTab or AISummaryCard
- No database changes
