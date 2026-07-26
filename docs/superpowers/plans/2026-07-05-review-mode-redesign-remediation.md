# Review Mode Redesign Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Review Mode redesign reachable and shippable by fixing the entry cutover, submit flow, agent drawer, and the reviewed regressions in filtering, badges, keyboard handling, and triage state.

**Architecture:** Keep Review Mode as the full-window overlay and route every PR review entry point through `review-mode-store`. Shared behavior lives in renderer libs (`pr-review-threads`, `pr-review-submit`, `review-mode-nav`) so navigator, comments, changes, and submit surfaces cannot diverge.

**Tech Stack:** Electron + React 19 + TypeScript, zustand, tRPC, Monaco diff editor, bun test.

---

### Task 1: Regression Tests And Shared Thread Semantics

**Files:**
- Modify: `apps/desktop/tests/pr-review-threads.test.ts`
- Modify: `apps/desktop/tests/review-mode-store.test.ts`
- Create: `apps/desktop/tests/pr-review-submit.test.ts`
- Modify: `apps/desktop/src/renderer/lib/pr-review-threads.ts`
- Modify: `apps/desktop/src/renderer/stores/review-mode-store.ts`

- [ ] Add failing tests for condensed filters, file badges excluding declined/submitted AI drafts, accepted-edit status preservation, stale terminal reset, and submit-loop outcomes.
- [ ] Implement `ReviewCommentFilter`, `matchesReviewFilter`, `filtersForReviewFilter`, `draftStatusAfterEdit`, and corrected `fileCommentCounts`.
- [ ] Reset stale terminal state on `reviewModeStore.open()`.
- [ ] Verify: `bun test tests/pr-review-threads.test.ts tests/review-mode-store.test.ts tests/pr-review-submit.test.ts`.

### Task 2: Review Surface Regression Fixes

**Files:**
- Modify: `apps/desktop/src/renderer/components/review-mode/ReviewModeShell.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/navigator/ThreadSection.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/views/CommentsView.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/hooks/useReviewKeymap.ts`
- Modify: `apps/desktop/src/renderer/components/review-mode/thread/ThreadCard.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/thread/ThreadActions.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/thread/ReplyComposer.tsx`
- Modify: `apps/desktop/src/renderer/lib/review-mode-nav.ts`

- [ ] Use multi-bucket filters across navigator, comments view, and keymap.
- [ ] Save edits to accepted comments as `user-pending`.
- [ ] Render AI resolution indicators in `ThreadCard`.
- [ ] Prevent polling from overwriting dirty composers.
- [ ] Clear stale active thread when opening a file without a thread.
- [ ] Keep new review-mode type at 11px or larger and use light-theme-safe semantic dot colors.

### Task 3: Entry Cutover And Keyboard Conflict

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`
- Modify: `apps/desktop/src/renderer/lib/pr-review-nav.ts`
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/review/PRReviewKeyboardListener.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/ReviewModeShell.tsx`

- [ ] Route old `openPRReviewPanel`, `openPROverview`, `openPRReviewFile`, and `swapPRReviewFile` APIs into Review Mode compatibility helpers.
- [ ] Stop review workspaces from auto-opening the old `pr-review` rail/overview.
- [ ] Remove direct `rightPanel: pr-review`, `openPROverview`, and `splitPROverviewRight` from PR list launch paths.
- [ ] Gate the legacy keyboard listener when Review Mode is active.
- [ ] Focus the Review Mode shell on open so hidden terminals do not consume shortcuts.
- [ ] Make navigator width resizable within 220-360px.

### Task 4: Header Submit Popover

**Files:**
- Create: `apps/desktop/src/renderer/lib/pr-review-submit.ts`
- Create: `apps/desktop/src/renderer/components/review-mode/SubmitReviewPopover.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/ReviewModeShell.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/ReviewHeader.tsx`

- [ ] Implement the pure `postAcceptedDrafts` helper with per-comment success/error handling.
- [ ] Add header popover with verdict segmented control, summary textarea, accepted draft list, remove action, and result feedback.
- [ ] Invalidate PR details, GitHub PR list, and AI draft queries on success.

### Task 5: Agent Status And Terminal Drawer

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/AgentStatusChip.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/TerminalDrawer.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/useReviewAgentActions.ts`
- Modify: `apps/desktop/src/renderer/components/review-mode/ReviewModeShell.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/ReviewHeader.tsx`

- [ ] Move Start Review/Re-review/Restart logic into a Review Mode hook.
- [ ] On launch success, add and attach a terminal tab, write the launch script, store terminal metadata, and open the drawer.
- [ ] Render status chip with cancel action for queued/in-progress drafts.
- [ ] Render bottom terminal drawer using the existing `Terminal` component.

### Task 6: Verification And Review

**Files:**
- All files touched above.

- [ ] Run focused Biome checks on touched files.
- [ ] Run focused tests for thread helpers, keymap, store, and submit helper.
- [ ] Run filtered renderer TypeScript diagnostics for review-mode and shared libs.
- [ ] Run `git diff --check`.
- [ ] Request a subagent code review and fix any blocking findings.
