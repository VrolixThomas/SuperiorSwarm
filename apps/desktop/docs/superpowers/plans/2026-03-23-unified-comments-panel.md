# Unified Comments Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the right panel by adding a "Comments" tab alongside "Changes" and "Files", replacing the separate CommentSolvePanel mode.

**Architecture:** The DiffPanel component gains a local tab state (Changes/Files/Comments) when a PR is linked. The Comments tab content is extracted from CommentSolvePanel into a new CommentsTab component. Clicking a file in a solved group opens a `comment-fix-file` tab in the main pane using the existing DiffEditor with inline/split toggle.

**Tech Stack:** React 19, TypeScript, tRPC, Zustand, Monaco DiffEditor, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-23-unified-comments-panel-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/renderer/components/CommentsTab.tsx` | Comments tab content: three states (unsolved, in-progress, solved) |

### Modified Files

| File | Changes |
|---|---|
| `src/main/trpc/routers/comment-solver.ts` | Add `getWorkspaceComments` query + `excludeCommentIds` to `triggerSolve` |
| `src/renderer/components/DiffPanel.tsx` | Add local tab state (Changes/Files/Comments), remove comment-solve mode, render CommentsTab |
| `src/renderer/stores/tab-store.ts` | Remove `"comment-solve"` from PanelMode, add `"comment-fix-file"` TabItem, add `openCommentFixFile()` |
| `src/renderer/components/panes/PaneContent.tsx` | Add `"comment-fix-file"` rendering case |
| `src/renderer/components/WorkspaceItem.tsx` | Simplify: remove triggerSolve terminal logic, keep context menu as simple tab-switch |

### Deleted Files

| File | Reason |
|---|---|
| `src/renderer/components/CommentSolvePanel.tsx` | Content moved into CommentsTab.tsx |

### Deleted (along with CommentSolvePanel)

| File | Reason |
|---|---|
| `src/renderer/components/CommentGroupItem.tsx` | Layout replaced by inline group rendering in CommentsTab |
| `src/renderer/components/CommentGroupDetail.tsx` | Layout replaced by inline group rendering in CommentsTab |

### Kept As-Is

| File | Reason |
|---|---|
| `src/renderer/components/SolveActionBar.tsx` | Reused at bottom of CommentsTab State 3 |

---

## Task 1: Backend — Add `getWorkspaceComments` Query

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/comment-solver.ts`

- [ ] **Step 1: Add `getWorkspaceComments` query**

Add a new tRPC query that fetches live PR comments for a workspace's linked PR. This is needed for the Comments tab State 1 (showing comments before any solve session exists).

```typescript
getWorkspaceComments: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ input }) => {
        const db = getDb();
        const workspace = db.select().from(schema.workspaces)
            .where(eq(schema.workspaces.id, input.workspaceId)).get();
        if (!workspace?.prProvider || !workspace.prIdentifier) return [];

        const { owner, repo, number: prNumber } = parsePrIdentifier(workspace.prIdentifier);

        if (workspace.prProvider === "github") {
            // GitHubComment has: id, body, author (string), createdAt, kind, path?, line?
            const comments = await getPRComments(owner, repo, prNumber);
            return comments.map(c => ({
                platformId: String(c.id),
                author: c.author, // plain string (login name)
                body: c.body,
                filePath: c.path ?? null,
                lineNumber: c.line ?? null,
                createdAt: c.createdAt,
            }));
        }
        if (workspace.prProvider === "bitbucket") {
            const comments = await getBitbucketPRComments(owner, repo, prNumber);
            return comments.map(c => ({
                platformId: String(c.id),
                author: c.author,
                body: c.body,
                filePath: c.filePath,
                lineNumber: c.lineNumber,
                createdAt: "",
            }));
        }
        return [];
    }),
```

- [ ] **Step 2: Add `excludeCommentIds` to `triggerSolve`**

Extend the `triggerSolve` input schema:

```typescript
.input(z.object({
    workspaceId: z.string(),
    excludeCommentIds: z.array(z.string()).optional(),
}))
```

In the comment insertion loop, filter out excluded IDs:

```typescript
const commentsToInsert = newComments.filter(
    c => !input.excludeCommentIds?.includes(String(c.id))
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/comment-solver.ts
git commit -m "feat: add getWorkspaceComments query and excludeCommentIds support"
```

---

## Task 2: Tab Store — Remove comment-solve, Add comment-fix-file

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`

- [ ] **Step 1: Remove `"comment-solve"` from PanelMode**

Change line 47 from:
```typescript
export type PanelMode = "diff" | "explorer" | "pr-review" | "comment-solve";
```
to:
```typescript
export type PanelMode = "diff" | "explorer" | "pr-review";
```

- [ ] **Step 2: Remove `openCommentSolvePanel` method**

Delete the `openCommentSolvePanel` method from the store interface and implementation (search for `openCommentSolvePanel`).

- [ ] **Step 3: Remove comment-solve detection from `panelForWorkspace`**

Remove the block around line 217-218 that returns `"comment-solve"` mode:
```typescript
if (meta?.type !== "review" && meta?.prProvider && meta.prIdentifier) {
    return { open: true, mode: "comment-solve", diffCtx: null };
}
```

- [ ] **Step 4: Add `"comment-fix-file"` to TabItem union**

After the existing `"pr-overview"` variant (around line 40-46), add:

```typescript
| {
    kind: "comment-fix-file";
    id: string;
    workspaceId: string;
    groupId: string;
    filePath: string;
    commitHash: string;
    title: string;
    language: string;
    repoPath: string;
  }
```

- [ ] **Step 5: Add `openCommentFixFile` method**

Add to the store interface:
```typescript
openCommentFixFile: (
    workspaceId: string,
    groupId: string,
    filePath: string,
    commitHash: string,
    repoPath: string,
    language: string
) => string;
```

Implementation follows the `openDiffFile` / `openPRReviewFile` pattern:
- Generate ID with `nextFileTabId()`
- Create dedup key: `${groupId}:${filePath}`
- Check for existing tab with same key in workspace
- If found, switch to it; if not, create new tab
- Return tab ID

- [ ] **Step 6: Verify type check passes**

Run: `cd apps/desktop && bun run type-check`

Note: `DiffPanel.tsx` may have errors from the removed `"comment-solve"` import/routing and `WorkspaceItem.tsx` from `openCommentSolvePanel`. Fix these inline now:
- In `DiffPanel.tsx`: delete the `comment-solve` routing block (lines 311-318) and remove the `CommentSolvePanel` import
- In `WorkspaceItem.tsx`: remove references to `openCommentSolvePanel`

These are quick deletions that belong with this task to keep the build green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts
git commit -m "feat: remove comment-solve panel mode, add comment-fix-file tab kind"
```

---

## Task 3: CommentFixFileTab Component + PaneContent Routing

**Files:**
- Create: `apps/desktop/src/renderer/components/CommentFixFileTab.tsx`
- Modify: `apps/desktop/src/renderer/components/panes/PaneContent.tsx`

**Note on file content:** The existing `trpc.diff.getFileContent({ repoPath, ref, filePath })` already supports commit hashes as the `ref` parameter (it runs `git.show([${ref}:${filePath}])`). Using `commitHash~1` as ref also works. No new backend endpoint is needed.

- [ ] **Step 1: Create CommentFixFileTab component**

Create `apps/desktop/src/renderer/components/CommentFixFileTab.tsx`. This is a new component that shows a diff for a specific commit's changes to a single file.

Props:
```typescript
interface CommentFixFileTabProps {
    repoPath: string;
    filePath: string;
    commitHash: string;
    language: string;
    groupId: string;
}
```

Implementation:
- Fetch base content: `trpc.diff.getFileContent({ repoPath, ref: \`${commitHash}~1\`, filePath })`
- Fetch modified content: `trpc.diff.getFileContent({ repoPath, ref: commitHash, filePath })`
- Render the existing `DiffEditor` component (read how the `diff-file` tab kind in PaneContent renders its diff — it likely uses a `DiffEditor` or `MonacoDiffEditor` component with `original` and `modified` content props, plus the inline/split toggle)
- Read `apps/desktop/src/renderer/components/DiffEditor.tsx` (or whatever the diff editor component is called) to understand its props and rendering pattern
- Include the inline/split toggle (reuse the existing `diffMode` from tab store: `useTabStore((s) => s.diffMode)`)
- Add a simple header bar showing filename + commit hash + Prev/Next buttons (props: `onPrev`, `onPrev`, `hasPrev`, `hasNext` — optional, for later wiring)

- [ ] **Step 2: Add comment-fix-file rendering case to PaneContent**

In `apps/desktop/src/renderer/components/panes/PaneContent.tsx`, after the `pr-overview` case (around line 73-80), add:

```typescript
{activeTab?.kind === "comment-fix-file" && (
    <div className="absolute inset-0">
        <CommentFixFileTab
            key={`${activeTab.groupId}:${activeTab.filePath}`}
            repoPath={activeTab.repoPath}
            filePath={activeTab.filePath}
            commitHash={activeTab.commitHash}
            language={activeTab.language}
            groupId={activeTab.groupId}
        />
    </div>
)}
```

Import `CommentFixFileTab`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentFixFileTab.tsx \
       apps/desktop/src/renderer/components/panes/PaneContent.tsx
git commit -m "feat: add CommentFixFileTab and PaneContent routing"
```

---

## Task 4: CommentsTab Component

**Files:**
- Create: `apps/desktop/src/renderer/components/CommentsTab.tsx`

This is the core new component. Read the existing `CommentSolvePanel.tsx` to understand the data flow, then build the new CommentsTab with three states.

- [ ] **Step 1: Create CommentsTab.tsx**

Props:
```typescript
interface CommentsTabProps {
    workspaceId: string;
}
```

The component has three states based on session data:

**State 1 — Unsolved (no active session):**
- Query: `trpc.commentSolver.getWorkspaceComments({ workspaceId })` for live comments
- Render comment cards using PRControlRail styling patterns (read PRControlRail.tsx lines 700-870 for card structure):
  - `rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]`
  - Author name, file:line monospace, comment body
- Skip-to-exclude: local state `Set<string>` of skipped platformIds. Clicking a card toggles skip. Skipped cards: `opacity-40` + "Skipped" badge
- "Solve Comments with AI (N of M)" button at bottom
  - Calls `trpc.commentSolver.triggerSolve({ workspaceId, excludeCommentIds: [...skippedIds] })`
  - On success: creates terminal tab, launches solve script (same pattern as existing CommentSolvePanel)

**State 2 — In progress (session queued/in_progress):**
- Query: `trpc.commentSolver.getSolveSession({ sessionId })` with `refetchInterval: 3000`
- Spinner + "AI is analyzing and fixing comments..."
- "Watch progress in the AI Solver terminal tab" note

**State 3 — Solved (session ready):**
- Query: `trpc.commentSolver.getSolveSession({ sessionId })`
- **Do NOT reuse the two-column layout from CommentSolvePanel** (which had a 200px sidebar + detail area). Instead, render a single scrollable list of groups:
  - **Group card** — for each group, render inline (no separate detail panel):
    - Group header row: label, status badge (Fixed/Approved/Reverted/Pending), commit hash. If group contains "unclear" comments, show a warning icon.
    - **File list** within the group: determine changed files by looking at the group's comments' `filePath` values (deduplicated). For each file:
      - Clickable row with file icon, file path (monospace), comment count for that file
      - Click calls `useTabStore.getState().openCommentFixFile(workspaceId, group.id, filePath, group.commitHash, repoPath, detectLanguage(filePath))` to open diff in main pane
      - `repoPath` from `useTabStore((s) => s.activeWorkspaceCwd)`, `language` detected from file extension using a helper (e.g., `filePath.endsWith('.ts') ? 'typescript' : 'javascript'`)
      - Active file (matching currently open tab's filePath + groupId) gets blue left border
    - **Comments** within the group (nested under file context): show each comment with author, body, "Addressed by AI" or "Needs clarification" indicator
    - For unclear comments: draft reply with Approve Reply / Edit / Delete actions (reuse reply editing logic from `CommentGroupDetail`)
    - Approve / Revert buttons per group
  - **Do NOT use CommentGroupItem or CommentGroupDetail** directly — their current shape (flat comment list, sidebar+detail layout) doesn't match. Build the group rendering inline in CommentsTab, but reference them for styling patterns.
- Push bar at bottom (reuse `SolveActionBar`)
- **Error states**: If `getWorkspaceComments` fails in State 1, show error with "Retry" button. If session status is `"failed"`, show error message with "Retry" that deletes the failed session and returns to State 1.
- **PR header**: Show PR title, number, and branch info at top of all states.

Use `trpc.commentSolver.getSolveSessions({ workspaceId })` to determine which state to show (find latest non-dismissed session).

- [ ] **Step 2: Style comment cards to match PRControlRail patterns**

Use these Tailwind classes from PRControlRail's CommentThreadCard:
- Card: `mx-2 mb-1.5 overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]`
- Header: `flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1`
- Body: `px-3 py-2 text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentsTab.tsx
git commit -m "feat: add CommentsTab component with three states"
```

---

## Task 5: DiffPanel — Add Comments Tab to Header

**Files:**
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx`

- [ ] **Step 1: Remove comment-solve mode routing**

Delete lines 311-318 (the `if (rightPanel.mode === "comment-solve")` block) and remove the `CommentSolvePanel` import.

- [ ] **Step 2: Add local tab state to DiffPanelContent**

Add a local state to `DiffPanelContent` (line 88):

```typescript
type DiffPanelTab = "changes" | "files" | "comments";

function DiffPanelContent({ diffCtx, onClose }: { ... }) {
    const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

    // Check if workspace has a linked PR
    const workspacesQuery = trpc.workspaces.listByProject.useQuery(
        { projectId: /* need project ID */ },
        { enabled: false } // We need a different approach
    );
```

Actually, a simpler approach: pass workspace metadata down from `DiffPanel` to `DiffPanelContent`. The `DiffPanel` component already has `activeWorkspaceId`. Query the workspace's `prProvider` using a lightweight query or the workspace metadata from the tab store.

Read how `panelForWorkspace` accesses workspace metadata from `tab-store.ts` (around line 62-70 for `WorkspaceMetadata`). The metadata includes `prProvider`. Use `useTabStore((s) => s.workspaceMetadata[activeWorkspaceId])` to check if `prProvider` is set.

```typescript
const [activeTab, setActiveTab] = useState<DiffPanelTab>("changes");
const meta = useTabStore((s) =>
    activeWorkspaceId ? s.workspaceMetadata[activeWorkspaceId] : undefined
);
const hasPR = !!meta?.prProvider;
```

- [ ] **Step 3: Extend PanelHeader to show three tabs when PR linked**

Modify `PanelHeader` to accept `hasPR`, `activeTab`, `onSetTab`, and `commentCount` props. When `hasPR` is true, render three tab buttons: Changes, Files, Comments (with badge).

```typescript
function PanelHeader({
    mode,
    stats,
    onSetMode,
    onClose,
    hasPR,
    activeTab,
    onSetTab,
    commentCount,
}: {
    mode: PanelMode;
    stats?: { added: number; removed: number; changed: number };
    onSetMode: (mode: PanelMode) => void;
    onClose?: () => void;
    hasPR?: boolean;
    activeTab?: DiffPanelTab;
    onSetTab?: (tab: DiffPanelTab) => void;
    commentCount?: number;
}) {
```

When `hasPR && activeTab && onSetTab`:
- Render three buttons: Changes, Files, Comments
- Changes button: `onClick={() => { onSetTab("changes"); onSetMode("diff"); }}`
- Files button: `onClick={() => { onSetTab("files"); onSetMode("explorer"); }}`
- Comments button: `onClick={() => onSetTab("comments"))`
- Comments badge: `{commentCount > 0 && <span>...</span>}`
- Active state based on `activeTab` instead of `mode`

When `!hasPR`: render existing two-button layout (Changes/Files) unchanged.

- [ ] **Step 4: Route active tab to content**

In `DiffPanelContent`, when `activeTab === "comments"`, render `<CommentsTab workspaceId={activeWorkspaceId} />` instead of the diff/explorer content.

When `activeTab === "changes"` or `activeTab === "files"`, render existing content (the diff or explorer view) unchanged.

- [ ] **Step 5: Fetch comment count for badge**

Add a query for comment count in DiffPanelContent:
```typescript
const commentsQuery = trpc.commentSolver.getWorkspaceComments.useQuery(
    { workspaceId: activeWorkspaceId ?? "" },
    { enabled: hasPR && !!activeWorkspaceId, staleTime: 30_000 }
);
const commentCount = commentsQuery.data?.length ?? 0;
```

Pass `commentCount` to `PanelHeader`.

- [ ] **Step 6: Import CommentsTab, remove CommentSolvePanel import**

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/DiffPanel.tsx
git commit -m "feat: add Comments tab to unified right panel"
```

---

## Task 6: Simplify WorkspaceItem

**Files:**
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx`

- [ ] **Step 1: Remove triggerSolve terminal-launching logic**

Remove the `triggerSolve` mutation and its `onSuccess` handler that creates terminal tabs and launches the solve script. The CommentsTab now handles this.

- [ ] **Step 2: Simplify context menu "Solve Comments" action**

The context menu "Solve Comments" should now simply:
1. Set the workspace as active
2. Switch the right panel's local tab to "comments"

Since the local tab state lives in DiffPanel, the simplest approach is: clicking "Solve Comments" in the context menu navigates to the workspace (calls `handleClick`) and the DiffPanel auto-switches to the Comments tab if the workspace has a PR linked. Alternatively, just remove the "Solve Comments" context menu entry entirely since the Comments tab is now always accessible.

**Recommendation:** Remove the "Solve Comments" context menu entry. The Comments tab in the right panel is the primary interaction point now.

- [ ] **Step 3: Remove unused imports**

Remove `triggerSolve` related imports.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat: simplify WorkspaceItem, remove triggerSolve logic"
```

---

## Task 7: Delete Replaced Components

**Files:**
- Delete: `apps/desktop/src/renderer/components/CommentSolvePanel.tsx`
- Delete: `apps/desktop/src/renderer/components/CommentGroupItem.tsx`
- Delete: `apps/desktop/src/renderer/components/CommentGroupDetail.tsx`

- [ ] **Step 1: Delete the files**

```bash
rm apps/desktop/src/renderer/components/CommentSolvePanel.tsx \
   apps/desktop/src/renderer/components/CommentGroupItem.tsx \
   apps/desktop/src/renderer/components/CommentGroupDetail.tsx
```

- [ ] **Step 2: Remove any remaining imports**

Search for `CommentSolvePanel`, `CommentGroupItem`, `CommentGroupDetail` across the codebase and remove any remaining imports.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove CommentSolvePanel (replaced by CommentsTab)"
```

---

## Task 8: Type Check, Lint, and Verify

- [ ] **Step 1: Run type check**

Run: `cd apps/desktop && bun run type-check`

Fix any TypeScript errors.

- [ ] **Step 2: Run lint**

Run: `cd /Users/thomas//worktrees/BranchFlux/ai-comments-solver && bun run check`

Fix any Biome errors in files we modified.

- [ ] **Step 3: Run tests**

Run: `cd apps/desktop && bun test tests/comment-solver.test.ts`

Verify existing tests still pass.

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve type and lint issues from panel unification"
```
