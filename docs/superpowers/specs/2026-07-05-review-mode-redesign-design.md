# Review Mode: Full-Window PR Review Redesign

**Date:** 2026-07-05
**Status:** Approved for planning
**Scope:** PR review flow only (GitHub/Bitbucket PRs + AI draft comments). The local branch/working-tree review (`review/ReviewTab.tsx`, comment solver) is untouched and will adopt these patterns in a later pass.

## 1. Problem

The PR review experience is squeezed into a ~19%-wide right rail (`PRControlRail`) plus a center tab. Everything competes for space: a 3-tab segmented control, review-trigger button, file list, progress bar, comment cards, an AI-suggestions badge bar, and a submit bar all stack in one narrow column. Text sizes run 9-11px. Reading agent review comments and keeping an overview of review progress are the two biggest pain points (confirmed with the user).

Structural problems compound the visual ones:

- Four separate thread renderers (`CommentThreadCard`, `PROverviewTab`'s `AICommentCard`/`GitHubThreadCard`, `ReviewFileGroupCard`'s rows, `PRReviewFileTab`'s `ThreadWidget`), each re-implementing reply, accept/decline, and resolve with different styling and keyboard handling.
- Two parallel submit flows (`SubmitReviewModal` from the rail, `ReviewBottomBar`/`ReviewVerdictConfirmation` on the overview).
- The same threads are listed in the rail Comments tab and the center Overview with different affordances; a user can accept an AI comment in at least three places.
- Oversized files: `PRReviewFileTab.tsx` 1380 lines, `PRControlRail.tsx` 1131, `PROverviewTab.tsx` 1077.

What works and must be preserved: inline comments anchored in the diff (Monaco view zones), the keyboard model (j/k/v/c), viewed-file tracking, the AI draft triage lifecycle (pending, accepted, declined, edited, submitted), and the agent-review trigger that runs in a terminal.

## 2. Goals

- Reviewing a PR gets the entire window. No more sharing space with the workspace shell.
- Reading comments is comfortable: real reading widths, 12-13px body text, clear thread hierarchy.
- Navigation is always visible: one navigator that shows where you are, what is done, and what is left.
- One thread component, one submit flow, one place for every action.
- Keyboard-first triage of AI draft comments.
- Understated visual language consistent with the existing token system. No new colors, no decoration.

**Non-goals:** redesigning the local review flow, changing the AI review backend (tRPC routers, polling, draft lifecycle), changing the diff engine (Monaco stays), multi-file side-by-side review.

## 3. Approaches considered

1. **Refine in place.** Keep the 3-column shell, restyle the rail and cards. Lowest risk, but the rail stays ~250-350px wide; the core "everything is cramped" problem is unsolvable at that width. Rejected.
2. **Full-window Review Mode with inline threads plus a dedicated reading view.** Review becomes its own full-window surface: left navigator, one content column with three views (Overview, Changes, Comments). Threads stay inline in the diff and also get a spacious reading/triage surface. **Chosen.**
3. **Conversation-rail model** (Xcode review style). Full takeover, but threads live in a wide right panel scroll-synced to the diff. Rejected: the user explicitly likes inline comments in code; scroll-sync is complex and splits attention between two columns.

## 4. Design

### 4.1 Entry and exit

- Clicking a PR row (sidebar PR list, `GitHubPRList`, `PullRequestsTab`) or any "review" affordance opens **Review Mode**: a full-window surface that replaces the 3-pane shell. Implemented as a conditional top-level render in `App.tsx`: when `review-mode-store` holds an active PR context, render `ReviewModeShell` instead of the panel group. The workspace shell (and its stores) keeps its state; closing Review Mode restores the exact previous layout.
- Exit: back chevron in the header, or `Esc` when no composer/popover is open.
- The old flow (`openPRReviewPanel` setting the right panel to `pr-review` mode) is removed. `DiffPanel` returns to working-tree duty only. `PRControlRail`, `PROverviewTab`, `PRReviewFileTab`, `ReviewFileGroupCard`, `SubmitReviewModal`, and `ReviewVerdictConfirmation` are deleted once Review Mode replaces them.

### 4.2 Layout

Three regions. No right panel.

```
+------------------------------------------------------------------+
| Header: back | title #123 | branch -> branch | CI | views | Submit |
+----------------+-------------------------------------------------+
| Navigator      | Content column                                  |
| (280px,        |   Overview page (max 760px, centered), or       |
|  resizable     |   Changes: file header + Monaco diff (fluid), or|
|  220-360,      |   Comments: reading list (max 760px, centered)  |
|  collapsible)  |                                                 |
|                |                                                 |
+----------------+-------------------------------------------------+
| (optional bottom drawer: agent terminal, collapsible)            |
+------------------------------------------------------------------+
```

**Header (48px):**
- Left: back chevron, PR title (14px/600, single line, truncated), `#number`, draft/open state chip.
- Center: view switcher, a 3-segment control: **Overview / Changes / Comments**. Comments segment shows a count badge (open + pending drafts). Shortcuts `1`/`2`/`3`.
- Right: agent status chip (see 4.7), **Start Review / Re-review** secondary button, **Submit review** primary button (accent, shows count when accepted drafts exist: "Submit review · 4").

**Navigator (left, 280px default, resizable 220-360px, collapsible):**
- Top: PR meta block: repo name, `source -> target` branch chips, author, CI status line, review-state summary (approved/changes-requested chips per reviewer).
- Section **Files** (with "12/18 viewed" progress in the section header, thin progress line under it): rows show change-type dot (green add / blue modify / red delete), filename with dimmed directory prefix, right-aligned comment-count bubble and viewed check. Active file gets a 2px accent left bar. Clicking opens Changes view at that file. Directory grouping flattened (path prefix dimmed) rather than a tree, matching current behavior; the full repo file tree is dropped from Review Mode (it belongs to the workspace, not review).
- Section **Comments**: filter control (All / Needs attention / Resolved) plus thread rows: `file:line` in 11px mono, one-line excerpt in 12px, status dot (purple = AI pending, amber = open GitHub thread, green = resolved, accent ring = active). Clicking opens Comments view scrolled to that thread.
- Sections are independently collapsible; both lists virtualized if row counts warrant.

**Content column:** hosts exactly one view at a time. Overview and Comments use a centered 760px max-width reading column; Changes is full-width for the diff.

### 4.3 Overview view

Read-only summary page (submission moves entirely to the header popover):

- Title block: PR title (18px/600), number, author, dates.
- PR description as rendered markdown (13px body, comfortable line height).
- **AI review summary card**: latest review round's summary markdown, round number, timestamp; previous rounds collapsible. This is the existing `AISummaryCard` content, restyled.
- Status strip: files changed, additions/deletions, comment counts by state (pending / accepted / declined / open / resolved) as plain stat items, each clickable to jump to the Comments view pre-filtered.
- Review-round history (the existing `getReviewChainHistory` data) as a simple list.

### 4.4 Changes view

The Monaco diff surface, evolved from `PRReviewFileTab`:

- Sticky file header (36px): path (13px mono), change stats (+/-), viewed toggle, split/unified toggle, markdown preview toggle (existing modes), prev/next file arrows.
- Monaco `DiffEditor` unchanged in engine: view zones for inline threads, gutter decorations (purple AI draft, amber unresolved, green resolved, accent active), gutter "+" on valid diff lines, `validDiffLines` logic preserved.
- **Inline thread widget redesigned** as the `inline` variant of the unified `ThreadCard` (4.6): 13px body, single card with subtle border, actions on a single row, resolved threads collapse to a one-line chip ("Resolved · author · expand"). "Collapse all / expand all" control in the file header.
- The `ActiveThreadBar` (bottom bar showing active thread) is removed; the active thread is indicated by the accent gutter decoration and navigator highlight instead.
- File-to-file movement: j/k (existing), or navigator clicks. Thread-to-thread within the file: n/p.

### 4.5 Comments view (new: the reading and triage surface)

This is the answer to "reading comments/threads is the biggest pain." A centered 760px column listing every thread, grouped by file with sticky mini file headers (12px mono path + per-file counts).

Each thread is the `full` variant of `ThreadCard`:

- **Header row:** AI badge (existing `.ai-badge` purple pill) or author avatar + name, `file:line` in mono (clickable: jumps to Changes view at that line), status chip (Pending / Accepted / Declined / Open / Resolved / Submitted / Error), relative time.
- **Diff context snippet:** 3-5 lines of the surrounding diff, syntax highlighted, target line tinted. Read-only, rendered from hunk data (not Monaco; a lightweight pre block reusing `detectLanguage`). Gives every comment its code context without leaving the reading flow.
- **Body:** rendered markdown at 13px.
- **Replies:** indented 16px under the root comment, same layout.
- **Action row (always visible, this is the triage surface):** AI drafts get Accept / Edit / Decline; GitHub threads get Reply / Resolve. Ghost buttons, 12px.
- **Reply/edit composer** expands inline within the card. Enter submits, Shift+Enter newline, Esc closes (existing idiom).

Top of the view: filter chips with live counts: All / Pending / Accepted / Declined / Open / Resolved. The navigator's condensed filter maps onto these: "Needs attention" = Pending + Open; "Resolved" = Resolved + Declined + Submitted. Both controls write the same store field, so the two surfaces never disagree.

Triage keyboard model (when Comments view is focused): j/k next/prev thread (scrolls, sets active), a accept, x decline, e edit, r reply, o open in Changes at the line. Active thread gets an accent border.

### 4.6 One thread component

New `ThreadCard` with three densities, replacing all four current renderers:

- `inline`: mounted in Monaco view zones (Changes view).
- `full`: Comments view and Overview.
- `row`: navigator Comments section (compact one-liner).

One `ReplyComposer`, one `ThreadActions` row, one status-chip component, one markdown body. All accept a `UnifiedThread` (existing union of `GitHubReviewThread` and `AIDraftThread`) plus a callbacks object. The `matchingDraft` status-priority sorter, currently copy-pasted in three files, moves to a single `lib/pr-review-threads.ts`.

### 4.7 Agent review status and terminal

Triggering a review still spawns the launch script in a terminal, but the terminal no longer hijacks a split pane:

- The header shows an **agent status chip** while a review runs: pulsing dot + "Reviewing..." + elapsed time, with a cancel action (existing `aiReview.cancelReview`).
- Clicking the chip opens a **bottom drawer** (~300px, collapsible) hosting the terminal tab for the run. Closed by default; power users can watch, everyone else sees the chip.
- Draft freshness keeps the existing 5s polling; as drafts land, the Comments count badge and navigator update live.

### 4.8 Single submit flow

One **Submit review** button (header, primary). Opens an anchored popover (~400px):

- Verdict segmented control: Comment / Approve / Request changes.
- Optional summary textarea.
- List of accepted AI drafts to be posted (each row: file:line + excerpt + remove button).
- Submit button with per-comment progress; failures mark the row with an error state and a retry, successes mark `submitted` (existing semantics from `SubmitReviewModal.tsx:34-120` preserved).

`SubmitReviewModal`, `ReviewBottomBar`, and `ReviewVerdictConfirmation` are deleted. The overview's verdict duplication goes away.

### 4.9 Keyboard model (consolidated)

Global in Review Mode: `1/2/3` switch views, `Esc` closes composer/popover first, then exits Review Mode, `Cmd+Enter` submits any open composer, `Cmd+.` toggles navigator.

Per view, j/k always moves through the view's primary list: files in Changes, threads in Comments. Changes keeps `v` (viewed), `c` (comment at line), `n/p` (threads within file). Comments adds `a/x/e/r/o` as in 4.5. Implemented in one `useReviewKeymap` hook replacing `PRReviewKeyboardListener` + scattered handlers; the existing `pr-review-events.ts` window-event bus is retired in favor of store-driven state.

### 4.10 Visual language

- **Type ramp:** 18/600 page title, 14/600 header title, 13 body, 12 secondary and labels, 11 floor (mono paths, timestamps). Nothing below 11px. Kills the current 9-10px usage.
- **Spacing:** 8pt-derived: 8/12/16/24. Cards pad 12-16px. Section gaps 24px.
- **Color:** existing tokens only. Navigator on `--bg-surface`, content on `--bg-base`, cards `--bg-surface` with `--border-subtle`, radius `--radius-md`. Accent reserved for the primary action, active states, and focus. AI purple appears only in the badge and gutter decoration. Semantic colors only in status dots/chips and diff stats.
- **Motion:** 120ms opacity/transform fades (`--transition-fast`). No slides, no springs.
- **Density principle:** the navigator is allowed to be compact (12px rows); the content column is never compact.

### 4.11 State and data flow

- New `stores/review-mode-store.ts` (zustand): `{ activePR: { workspaceId, prContext } | null, activeView, navigatorCollapsed, drawerOpen }` plus open/close actions.
- `stores/pr-review-session-store.ts` is reused as-is for per-PR state (activeFilePath, activeThreadId, scroll positions, file/thread order).
- All server state stays in tRPC queries exactly as today (`github.*`, `aiReview.*`, `projects.getPRDetails`); no data-layer changes.
- `tab-store` loses `openPRReviewPanel` / `openPROverview` / `swapPRReviewFile` / the `pr-review` right-panel mode once callers migrate; PR list rows call `reviewModeStore.open(workspaceId, prContext)` instead.

### 4.12 Component structure

New directory `src/renderer/components/review-mode/`:

```
ReviewModeShell.tsx        header + navigator + content + drawer composition
ReviewHeader.tsx           title, view switcher, agent chip, submit button
SubmitReviewPopover.tsx
AgentStatusChip.tsx
navigator/
  ReviewNavigator.tsx      meta block + sections
  FileSection.tsx
  ThreadSection.tsx
views/
  OverviewView.tsx
  ChangesView.tsx          file header + DiffEditor + zone wiring
  CommentsView.tsx         filters + grouped ThreadCards
thread/
  ThreadCard.tsx           inline | full | row variants
  ReplyComposer.tsx
  ThreadActions.tsx
  DiffContextSnippet.tsx
hooks/
  useReviewKeymap.ts
  useInlineCommentZones.ts   extracted from PRReviewFileTab
  useThreadDecorations.ts    extracted
  useGutterPlusButton.ts     extracted
lib/
  pr-review-threads.ts       unified sort/status/grouping (single source)
```

Every file stays under ~300 lines; the Monaco hooks are extracted verbatim first, then adapted.

### 4.13 Error handling

- Submit: per-comment error rows with retry (existing behavior, one place now).
- PR fetch failure: content column shows an inline error state with retry; Review Mode stays open.
- Agent review launch failure: toast + chip shows error state.
- Thread mutations (reply/resolve/accept): optimistic where currently optimistic, otherwise inline spinner on the acted-on card; errors restore state and show inline message on the card.

### 4.14 Testing

- Unit tests (bun test) for `lib/pr-review-threads.ts` (sorting, grouping, status mapping, filter counts), the submit loop extracted to a pure helper, and keymap dispatch logic.
- Existing `ai-review` tests untouched (backend unchanged).
- Manual verification pass: open real PR, trigger agent review, triage drafts via keyboard, submit review, confirm on GitHub.

## 5. Out of scope

- Local branch/working-tree review redesign (adopts `ThreadCard` and the visual rules in a later pass).
- Multi-file side-by-side review, review templates, notification surfaces.
- Backend changes to draft storage, polling cadence, or provider APIs.

## 6. Rollout

Direct replacement in one feature branch, no feature flag: the app is pre-1.0 and the old components are deleted in the same series of PRs once Review Mode covers every current capability (checked against the capability list in section 1).
