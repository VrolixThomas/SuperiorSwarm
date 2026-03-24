# Comments & AI Fixes Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single CommentsTab with two dedicated tabs: a Comments overview tab and an AI Fixes tab with commit groups, progress bar, and push workflow.

**Architecture:** Delete the existing 904-line `CommentsTab.tsx` and replace with two focused components: `CommentsOverviewTab.tsx` (flat comment list with reply/resolve/solve) and `AIFixesTab.tsx` (commit groups with progress bar and push). Update `DiffPanel.tsx` tab bar to show 4 tabs and route accordingly.

**Tech Stack:** React 19, TypeScript, tRPC, Zustand, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-24-comments-ai-fixes-tabs-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/renderer/components/CommentsOverviewTab.tsx` | Flat PR comment list with reply/resolve actions + solve trigger |
| `src/renderer/components/AIFixesTab.tsx` | Commit groups with progress bar, approve/revert, push workflow |

### Modified Files

| File | Changes |
|---|---|
| `src/renderer/components/DiffPanel.tsx` | Add "ai-fixes" to tab type, add AI Fixes tab button, route to new components |

### Deleted Files

| File | Reason |
|---|---|
| `src/renderer/components/CommentsTab.tsx` | Replaced by CommentsOverviewTab + AIFixesTab |

### Kept As-Is

| File | Reason |
|---|---|
| `src/renderer/components/SolveActionBar.tsx` | Adapted within AIFixesTab (may inline if needed) |
| `src/renderer/components/CommentFixFileTab.tsx` | Still used for viewing file diffs |
| All backend routers | No backend changes needed |

---

## Task 1: Create CommentsOverviewTab

**Files:**
- Create: `apps/desktop/src/renderer/components/CommentsOverviewTab.tsx`

- [ ] **Step 1: Create CommentsOverviewTab component**

Props: `{ workspaceId: string }`

Read the following files first for patterns:
- `apps/desktop/src/renderer/components/PRControlRail.tsx` lines 700-870 — comment card styling (Tailwind classes, card structure)
- The `UnsolvedState` function in the current `apps/desktop/src/renderer/components/CommentsTab.tsx` — for solve trigger logic and solving banner

**Component structure:**

```
CommentsOverviewTab
├── PRHeader (title, #number, branch, comment count)
├── SolvingBanner (conditional — shown when session is queued/in_progress)
├── Comment list (scrollable, flex-1 overflow-y-auto)
│   └── CommentCard × N
│       ├── Header: author name + clickable file:line (accent, navigates) + status badge
│       ├── Body: comment text (whitespace-pre-wrap)
│       ├── Reply textarea (expandable, one at a time)
│       └── Actions: Reply | Resolve/Unresolve
└── Solve button (pinned bottom, shrink-0)
```

**Data:**
- Comments: `trpc.commentSolver.getWorkspaceComments({ workspaceId })`
- Sessions: `trpc.commentSolver.getSolveSessions({ workspaceId })` — to check if solving is in progress and to disable solve button
- Workspace metadata: `useTabStore((s) => s.workspaceMetadata[workspaceId])` — for PR title, number, branch

**Per-comment card styling** (match PRControlRail):
- Card: `rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]`
- Header: `flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1`
- Author: `text-[10px] font-medium text-[var(--text-secondary)]`
- File link: `font-mono text-[10px] text-[var(--accent)] hover:underline cursor-pointer` — onClick calls `useTabStore.getState().openFile(workspaceId, cwd, filePath, lang, { lineNumber, column: 1 })`
- Status badge: Resolved = `bg-[#2d5a2d] text-[#6fdb6f]`, Open = `bg-[#8a6d2b] text-[#ffd54f]`
- Body: `px-3 py-2 text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap`
- Actions row: `flex gap-4px px-3 py-1.5 border-t border-[var(--border-subtle)]` with Reply and Resolve buttons

**Reply flow:**
- Local state: `replyingTo: string | null`, `replyText: string`
- One textarea at a time
- Post Reply: for now, just closes textarea (actual API posting is a follow-up)

**Resolve flow:**
- For now, just a visual toggle (actual API call is a follow-up). Can be wired later to `trpc.github.resolveThread`

**Solve button:**
- `"Solve with AI (N comments)"` — pinned at bottom
- Calls `trpc.commentSolver.triggerSolve({ workspaceId })`
- On success: creates AI Solver terminal tab, runs launch script (same pattern as current CommentsTab)
- Disabled while session is in progress (check `getSolveSessions`)

**Solving banner:**
- Small accent bar at top when session status is "queued" or "in_progress"
- Same `SolvingBanner` pattern from current CommentsTab

**Layout containers:**
- Outer: `flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]`
- Comment list: `flex-1 overflow-y-auto px-3 py-2`
- Bottom: `shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5`

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentsOverviewTab.tsx
git commit -m "feat: add CommentsOverviewTab with reply/resolve/solve"
```

---

## Task 2: Create AIFixesTab

**Files:**
- Create: `apps/desktop/src/renderer/components/AIFixesTab.tsx`

- [ ] **Step 1: Create AIFixesTab component**

Props: `{ workspaceId: string }`

Read the following for patterns:
- `apps/desktop/src/renderer/components/SolveActionBar.tsx` — push button logic
- The `SolvedState` and `SolvedGroupCard` functions in `apps/desktop/src/renderer/components/CommentsTab.tsx` — for group rendering, approve/revert logic
- The user's mockup design in the spec

**Component structure:**

```
AIFixesTab
├── EmptyState (when no ready/submitted session)
│   ├── "No AI fixes pending"
│   └── "Use the Comments tab to trigger AI solving"
│   └── SolvingBanner (if session in progress)
├── ActiveState (when session is ready)
│   ├── PR Header section
│   │   ├── "PULL REQUEST #N" label + branch name
│   │   ├── PR title (large, bold)
│   │   ├── Progress bar (green/dark/red segments)
│   │   └── Legend: "N resolved · N pending · N unclear"
│   ├── "N COMMIT GROUPS" section header
│   ├── Scrollable group list
│   │   └── CommitGroupCard × N (collapsible)
│   │       ├── Header: chevron + label + "N/M" badge + Approve/Review button
│   │       ├── Sub-header: commit hash + file names
│   │       └── Expanded: comments with author/line/body, draft replies inline
│   └── Bottom bar (pinned)
│       ├── Summary: "N draft replies ready · M needs input"
│       ├── "Push changes & post replies" button (accent/green)
│       └── "Revert all" button (outlined)
```

**Data:**
- Sessions: `trpc.commentSolver.getSolveSessions({ workspaceId })`
- Full session: `trpc.commentSolver.getSolveSession({ sessionId })` with `refetchInterval: 3000` when in progress
- Workspace metadata for PR info

**CommitGroupCard sub-component** (inline in AIFixesTab):
- Local state: `expanded: boolean` (default: first group expanded, rest collapsed)
- Header always visible, clickable to toggle expand
- Chevron: `▸` collapsed, `▾` expanded
- Count badge: `"N / M"` where N = resolved comments, M = total in group
  - Green background when all resolved
  - Accent/blue when partially done
  - Gray when pending
- Action button: "Approve" (calls `trpc.commentSolver.approveGroup`) or "Review" (visual only)
- Sub-header: short commit hash (monospace, 7 chars) + "·" + file names (comma-separated, from group comments' filePaths deduplicated)
- Expanded content: comments listed vertically, no colored left border
  - Each: author (bold) + `line N` + comment body
  - Draft replies: subtle inner card with "Draft reply:" label + reply text

**Progress bar:**
- Container: `h-[6px] rounded-[3px] bg-[#333] flex overflow-hidden gap-[1px]`
- Segments sized proportionally:
  - Resolved (fixed/approved): `bg-[#34c759]`
  - Pending: `bg-[#333]` (same as container, invisible)
  - Unclear: `bg-[#ff453a]`
- Count resolved/pending/unclear from `session.groups` → `group.comments` statuses

**Bottom bar:**
- Summary line: count draft replies from all comments with `reply` present, count how many are still "draft" vs "approved"
- Push button: `bg-[#34c759] text-black` — calls `trpc.commentSolver.pushAndPost({ sessionId })`
  - Disabled until all non-reverted groups are "approved" and no draft replies remain unapproved
- Revert all: `bg-transparent border-[var(--border)]` — calls `trpc.commentSolver.dismissSolve({ sessionId })`

**After push:** Session status becomes "submitted" → `getSolveSessions` no longer returns it as latest → AIFixesTab shows empty state.

**File click in group:** Each file name in the sub-header could be clickable, calling `useTabStore.getState().openCommentFixFile(...)` same as before. Use `useState` for active file tracking (NOT useTabStore selectors that cause infinite loops).

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/AIFixesTab.tsx
git commit -m "feat: add AIFixesTab with commit groups, progress bar, and push workflow"
```

---

## Task 3: Update DiffPanel — Add AI Fixes Tab

**Files:**
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx`

- [ ] **Step 1: Update DiffPanelTab type and imports**

Change the type from:
```typescript
type DiffPanelTab = "changes" | "files" | "comments";
```
to:
```typescript
type DiffPanelTab = "changes" | "files" | "comments" | "ai-fixes";
```

Replace import:
```typescript
import { CommentsTab } from "./CommentsTab";
```
with:
```typescript
import { CommentsOverviewTab } from "./CommentsOverviewTab";
import { AIFixesTab } from "./AIFixesTab";
```

- [ ] **Step 2: Add AI Fixes button to PanelHeader**

In the `PanelHeader` component's three-tab section (inside the `hasPR && onSetTab && activeTab` branch), add a fourth button after "Comments":

```tsx
<button
    type="button"
    onClick={() => onSetTab("ai-fixes")}
    className={[
        "rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
        activeTab === "ai-fixes"
            ? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
            : "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
    ].join(" ")}
>
    AI Fixes
</button>
```

- [ ] **Step 3: Update content routing**

Replace the current `activeTab === "comments"` routing:

```typescript
{activeTab === "comments" && activeWorkspaceId ? (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <CommentsTab workspaceId={activeWorkspaceId} />
    </div>
```

with routing for both tabs:

```typescript
{activeTab === "comments" && activeWorkspaceId ? (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <CommentsOverviewTab workspaceId={activeWorkspaceId} />
    </div>
) : activeTab === "ai-fixes" && activeWorkspaceId ? (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <AIFixesTab workspaceId={activeWorkspaceId} />
    </div>
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/DiffPanel.tsx
git commit -m "feat: add AI Fixes tab to right panel tab bar"
```

---

## Task 4: Delete CommentsTab

**Files:**
- Delete: `apps/desktop/src/renderer/components/CommentsTab.tsx`

- [ ] **Step 1: Delete the file**

```bash
rm apps/desktop/src/renderer/components/CommentsTab.tsx
```

- [ ] **Step 2: Search for remaining imports**

Search for `CommentsTab` across the codebase and remove any remaining references.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove old CommentsTab (replaced by CommentsOverviewTab + AIFixesTab)"
```

---

## Task 5: Type Check, Lint, Test

- [ ] **Step 1: Type check**

Run: `cd apps/desktop && bun run type-check`

Fix any errors.

- [ ] **Step 2: Lint**

Run: `cd /Users/thomas/.superset/worktrees/BranchFlux/ai-comments-solver && bun run check`

Fix any errors in our new/modified files.

- [ ] **Step 3: Tests**

Run: `cd apps/desktop && bun test tests/comment-solver.test.ts`

Verify tests pass.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve type and lint issues"
```
