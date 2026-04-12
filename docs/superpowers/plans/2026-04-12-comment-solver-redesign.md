# Comment Solver Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the comment solver review UI from the right sidebar into a dedicated workspace tab, add cancel/restart with partial recovery, improve file change visibility, and add agent-agnostic follow-up — while cherry-picking comment cache, recovery, and settings work from the `refine-comment-solver-flow` branch.

**Architecture:** New `SolveReviewTab` workspace tab component renders alongside terminal tabs. Backend gains `cancelSolve` mutation, `cancelled` session status, file change tracking per group, and follow-up prompt generation. Cherry-picked phases provide comment caching, PID-based recovery, settings split, and unclear comment sign-off.

**Tech Stack:** React 19, TypeScript, tRPC over IPC, Zustand (tab store), SQLite + Drizzle ORM, Biome

**Spec:** `docs/superpowers/specs/2026-04-12-comment-solver-redesign-design.md`

---

## File Structure

### New files
- `apps/desktop/src/renderer/components/SolveReviewTab.tsx` — workspace tab for reviewing solve sessions
- `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx` — redesigned commit group card with file list + comments
- `apps/desktop/src/main/db/migrations/0028_comment_solver_redesign.sql` — migration for new columns/statuses

### Modified files
- `apps/desktop/src/shared/solve-types.ts` — add `cancelled` status, `changes_requested` comment status, `ChangedFile` type, `followUpText` field
- `apps/desktop/src/main/db/schema-comment-solver.ts` — add `changedFiles`, `followUpText` columns
- `apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts` — add `cancelled` to state machine, implement `cancelSolve`
- `apps/desktop/src/main/trpc/routers/comment-solver.ts` — add `cancelSolve` mutation, update `assembleSolveSession`
- `apps/desktop/src/main/ai-review/solve-prompt.ts` — add `buildSolveFollowUpPrompt`
- `apps/desktop/src/main/ai-review/cli-presets.ts` — add `LaunchOptions.followUp` field
- `apps/desktop/src/renderer/stores/tab-store.ts` — add `solve-review` tab type, terminal metadata
- `apps/desktop/src/renderer/components/CommentsOverviewTab.tsx` — open SolveReviewTab on solve trigger
- `apps/desktop/src/renderer/components/DiffPanel.tsx` — add "Open Solve Review" link in ai-fixes tab
- `apps/desktop/src/renderer/components/AIFixesTab.tsx` — replace inline review with link to workspace tab

### Cherry-picked from `refine-comment-solver-flow` (adapted)
- Migration 0026 (comment cache tables) + 0027 (PID/heartbeat columns)
- `apps/desktop/src/main/ai-review/comment-poller.ts` — cache writes
- `apps/desktop/src/main/trpc/routers/comment-solver.ts` — cache reads, recovery endpoints
- GitHub + Bitbucket adapter changes (`getPRCommentsIfChanged`)
- `apps/desktop/src/renderer/components/CommentSolverSettings.tsx` — new settings tab
- Unclear sign-off endpoints (`approveReply`, `revokeGroup`) and UI logic

---

## Task 1: Cherry-pick comment cache, recovery, settings, and unclear sign-off

**Files:**
- Cherry-pick range: commits `0e9e5cc6` through `c0368346` from `refine-comment-solver-flow`
- Resolve conflicts in: `comment-solver.ts` router, `AIFixesTab.tsx`, `schema-comment-solver.ts`

- [ ] **Step 1: Cherry-pick comment cache commits**

```bash
git cherry-pick 0e9e5cc6..81251b0d --no-commit
```

This brings in:
- Migration 0026 (`pr_comment_cache` + `pr_comment_cache_meta` tables)
- `getPRCommentsIfChanged` on GitProvider interface (GitHub + Bitbucket adapters)
- Comment poller cache writes
- `getWorkspaceComments` reads from cache
- `refreshWorkspaceComments` mutation

- [ ] **Step 2: Cherry-pick solver recovery commits**

```bash
git cherry-pick fbed07d9..937c2c8b --no-commit
```

This brings in:
- Migration 0027 (`pid` + `last_activity_at` columns on `commentSolveSessions`)
- PID recording in `queueSolve`
- Heartbeat updates via MCP tools
- `recoverStuckSessions` startup sweep

- [ ] **Step 3: Cherry-pick failed session UI**

```bash
git cherry-pick c249f9fb..eaa712e3 --no-commit
```

- [ ] **Step 4: Cherry-pick settings split**

```bash
git cherry-pick 2ab591fe --no-commit
```

- [ ] **Step 5: Cherry-pick unclear sign-off commits**

```bash
git cherry-pick b13e8a52..c0368346 --no-commit
```

This brings in:
- `approveReply` + `revokeGroup` tRPC endpoints
- `addReply` defaults to approved; `updateReply` resets to draft on body edit
- Sign-off strip UI, gated approve, revoke button
- Bottom bar redesign with progress bar
- Soft publish gate (removed PublishGateDialog)

- [ ] **Step 6: Resolve conflicts and verify**

Conflicts are expected in files modified by multiple cherry-pick ranges. Resolve keeping the latest version from the cherry-picks.

```bash
git diff --stat  # Review all staged changes
bun run type-check
bun run lint
```

- [ ] **Step 7: Run tests**

```bash
cd apps/desktop && bun test
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: cherry-pick comment cache, recovery, settings, and unclear sign-off from refine-comment-solver-flow"
```

---

## Task 2: Schema changes — cancelled status, changedFiles, followUpText

**Files:**
- Modify: `apps/desktop/src/shared/solve-types.ts:1-13` (status types)
- Modify: `apps/desktop/src/main/db/schema-comment-solver.ts:23-35` (commentGroups), `37-64` (prComments)
- Create: `apps/desktop/src/main/db/migrations/0028_comment_solver_redesign.sql`

- [ ] **Step 1: Update shared type definitions**

In `apps/desktop/src/shared/solve-types.ts`, add `cancelled` to session status, `changes_requested` to comment status, and add `ChangedFile` type:

```typescript
// Add "cancelled" to the union
export type SolveSessionStatus =
  | "queued"
  | "in_progress"
  | "ready"
  | "submitted"
  | "failed"
  | "dismissed"
  | "cancelled";

// Add "changes_requested" to the union
export type SolveCommentStatus = "open" | "fixed" | "unclear" | "wont_fix" | "changes_requested";

// New type for per-group changed files
export interface ChangedFile {
  path: string;
  changeType: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
}

// Add to SolveGroupInfo interface
// changedFiles: ChangedFile[];

// Add to SolveCommentInfo interface
// followUpText: string | null;
```

- [ ] **Step 2: Update SolveGroupInfo to include changedFiles**

In the same file, add `changedFiles` field to `SolveGroupInfo`:

```typescript
export interface SolveGroupInfo {
  id: string;
  label: string;
  status: SolveGroupStatus;
  commitHash: string | null;
  order: number;
  comments: SolveCommentInfo[];
  changedFiles: ChangedFile[];
}
```

- [ ] **Step 3: Update SolveCommentInfo to include followUpText**

```typescript
export interface SolveCommentInfo {
  id: string;
  platformCommentId: string;
  author: string;
  body: string;
  filePath: string;
  lineNumber: number | null;
  side: string | null;
  threadId: string | null;
  status: SolveCommentStatus;
  groupId: string | null;
  replies: SolveReplyInfo[];
  followUpText: string | null;
}
```

- [ ] **Step 4: Update Drizzle schema**

In `apps/desktop/src/main/db/schema-comment-solver.ts`, add columns:

Add to `commentGroups` table definition:

```typescript
changedFiles: text("changed_files"), // JSON array of ChangedFile
```

Add to `prComments` table definition:

```typescript
followUpText: text("follow_up_text"),
```

- [ ] **Step 5: Generate migration**

```bash
cd apps/desktop && bun run db:generate
```

Verify the generated migration SQL includes:
- `ALTER TABLE comment_groups ADD COLUMN changed_files TEXT;`
- `ALTER TABLE pr_comments ADD COLUMN follow_up_text TEXT;`

- [ ] **Step 6: Run type-check**

```bash
bun run type-check
```

Fix any type errors from the new fields (mainly in `assembleSolveSession` which constructs `SolveGroupInfo` and `SolveCommentInfo`).

- [ ] **Step 7: Update assembleSolveSession in router**

In `apps/desktop/src/main/trpc/routers/comment-solver.ts`, update `assembleSolveSession()` to include the new fields:

For groups (around line 70):
```typescript
changedFiles: group.changedFiles ? JSON.parse(group.changedFiles) : [],
```

For comments (around line 90):
```typescript
followUpText: comment.followUpText ?? null,
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/solve-types.ts apps/desktop/src/main/db/schema-comment-solver.ts apps/desktop/src/main/db/migrations/ apps/desktop/src/main/trpc/routers/comment-solver.ts
git commit -m "feat: add cancelled status, changedFiles, and followUpText schema columns"
```

---

## Task 3: Backend — cancelSolve mutation and state machine update

**Files:**
- Modify: `apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts:18-35` (state machine)
- Modify: `apps/desktop/src/main/trpc/routers/comment-solver.ts` (add mutation)
- Test: `apps/desktop/tests/comment-solver.test.ts`

- [ ] **Step 1: Write failing test for cancelSolve**

In `apps/desktop/tests/comment-solver.test.ts`, add:

```typescript
describe("cancelSolve", () => {
  it("should transition in_progress session to cancelled and preserve fixed groups", async () => {
    // Setup: create a session with in_progress status, 2 groups (1 fixed, 1 pending)
    const sessionId = "test-cancel-session";
    db.insert(schema.commentSolveSessions).values({
      id: sessionId,
      prProvider: "github",
      prIdentifier: "owner/repo#1",
      prTitle: "Test PR",
      sourceBranch: "feat/test",
      targetBranch: "main",
      status: "in_progress",
      workspaceId: testWorkspaceId,
      pid: process.pid, // use current process PID for testing (won't actually kill)
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    db.insert(schema.commentGroups).values({
      id: "group-fixed",
      solveSessionId: sessionId,
      label: "Fixed group",
      status: "fixed",
      commitHash: "abc123",
      order: 1,
    }).run();

    db.insert(schema.commentGroups).values({
      id: "group-pending",
      solveSessionId: sessionId,
      label: "Pending group",
      status: "pending",
      commitHash: null,
      order: 2,
    }).run();

    // Act: call cancelSolve
    const result = await caller.commentSolver.cancelSolve({ sessionId });

    // Assert
    expect(result.success).toBe(true);

    const session = db.select().from(schema.commentSolveSessions)
      .where(eq(schema.commentSolveSessions.id, sessionId)).get();
    expect(session?.status).toBe("cancelled");

    const groups = db.select().from(schema.commentGroups)
      .where(eq(schema.commentGroups.solveSessionId, sessionId)).all();
    expect(groups).toHaveLength(1); // pending group deleted
    expect(groups[0]?.status).toBe("fixed"); // fixed group preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && bun test tests/comment-solver.test.ts
```

Expected: FAIL — `cancelSolve` not defined on router.

- [ ] **Step 3: Update state machine in orchestrator**

In `apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts`, update `VALID_SOLVE_TRANSITIONS` (around line 18):

```typescript
export const VALID_SOLVE_TRANSITIONS: Record<string, string[]> = {
  queued: ["in_progress", "failed", "dismissed", "cancelled"],
  in_progress: ["ready", "failed", "dismissed", "cancelled"],
  ready: ["submitted", "failed", "dismissed"],
  submitted: ["dismissed"],
  failed: ["dismissed"],
  cancelled: ["dismissed"],
};
```

- [ ] **Step 4: Implement cancelSolve in orchestrator**

Add to `apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts`:

```typescript
export function cancelSolve(sessionId: string): void {
  const session = db
    .select()
    .from(schema.commentSolveSessions)
    .where(eq(schema.commentSolveSessions.id, sessionId))
    .get();

  if (!session) throw new Error(`Session ${sessionId} not found`);

  validateSolveTransition(session.status, "cancelled");

  // Kill the agent process if PID is available
  if (session.pid) {
    try {
      process.kill(session.pid, "SIGTERM");
    } catch (err: unknown) {
      // ESRCH = process already dead, that's fine
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        throw err;
      }
    }
  }

  db.transaction((tx) => {
    // Delete pending groups and unlink their comments
    const pendingGroups = tx
      .select()
      .from(schema.commentGroups)
      .where(
        and(
          eq(schema.commentGroups.solveSessionId, sessionId),
          eq(schema.commentGroups.status, "pending"),
        ),
      )
      .all();

    for (const group of pendingGroups) {
      // Reset comments in pending groups back to open
      tx.update(schema.prComments)
        .set({ groupId: null, status: "open" })
        .where(eq(schema.prComments.groupId, group.id))
        .run();

      tx.delete(schema.commentGroups)
        .where(eq(schema.commentGroups.id, group.id))
        .run();
    }

    // Transition session to cancelled
    tx.update(schema.commentSolveSessions)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(eq(schema.commentSolveSessions.id, sessionId))
      .run();
  });
}
```

- [ ] **Step 5: Add cancelSolve tRPC mutation**

In `apps/desktop/src/main/trpc/routers/comment-solver.ts`, add after the `dismissSolve` mutation:

```typescript
cancelSolve: protectedProcedure
  .input(z.object({ sessionId: z.string() }))
  .mutation(({ input }) => {
    cancelSolve(input.sessionId);
    return { success: true as const };
  }),
```

Add the import at the top:
```typescript
import { queueSolve, revertGroup, validateSolveTransition, cancelSolve } from "../../ai-review/comment-solver-orchestrator";
```

- [ ] **Step 6: Run tests**

```bash
cd apps/desktop && bun test tests/comment-solver.test.ts
```

Expected: PASS

- [ ] **Step 7: Type-check and lint**

```bash
bun run type-check && bun run lint
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts apps/desktop/src/main/trpc/routers/comment-solver.ts apps/desktop/tests/comment-solver.test.ts
git commit -m "feat: add cancelSolve mutation with partial recovery"
```

---

## Task 4: Backend — file change tracking in MCP finish_fix_group

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs` (finish_fix_group handler)
- Reference: `apps/desktop/src/main/db/schema-comment-solver.ts`

- [ ] **Step 1: Find the finish_fix_group MCP handler**

Read `apps/desktop/mcp-standalone/server.mjs` to locate the `finish_fix_group` tool handler. This is where `git add -A && git commit` happens and `commentGroups.commitHash` is set.

- [ ] **Step 2: Add git diff-tree after commit**

After the commit is created and `commitHash` is stored, add file change extraction:

```javascript
// After: const commitHash = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();
// Add:
const diffTree = execSync(
  `git diff-tree --no-commit-id -r --numstat ${commitHash}`,
  { cwd: worktreePath },
).toString().trim();

const changedFiles = diffTree.split("\n").filter(Boolean).map((line) => {
  const [add, del, path] = line.split("\t");
  return {
    path,
    changeType: "M", // diff-tree --numstat doesn't show type; we'll enhance below
    additions: add === "-" ? 0 : parseInt(add, 10),
    deletions: del === "-" ? 0 : parseInt(del, 10),
  };
});

// Get change types (A/M/D/R) separately
const nameStatus = execSync(
  `git diff-tree --no-commit-id -r --name-status ${commitHash}`,
  { cwd: worktreePath },
).toString().trim();

const typeMap = {};
for (const line of nameStatus.split("\n").filter(Boolean)) {
  const [type, ...pathParts] = line.split("\t");
  const filePath = pathParts[pathParts.length - 1]; // handles renames (R\told\tnew)
  typeMap[filePath] = type.charAt(0); // R100 → R
}

for (const file of changedFiles) {
  file.changeType = typeMap[file.path] || "M";
}
```

- [ ] **Step 3: Store changedFiles in DB**

After building the `changedFiles` array, update the group:

```javascript
db.prepare(
  "UPDATE comment_groups SET changed_files = ? WHERE id = ?"
).run(JSON.stringify(changedFiles), groupId);
```

- [ ] **Step 4: Test manually**

Run a solve session and verify that after `finish_fix_group`, the `comment_groups.changed_files` column contains the expected JSON.

```bash
cd apps/desktop && bun run dev
# Trigger a solve, wait for a group to complete
# Check DB: sqlite3 path/to/superiorswarm.db "SELECT changed_files FROM comment_groups WHERE changed_files IS NOT NULL"
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs
git commit -m "feat: track changed files per commit group via git diff-tree"
```

---

## Task 5: Backend — follow-up prompt builder

**Files:**
- Modify: `apps/desktop/src/main/ai-review/solve-prompt.ts:12-44`
- Modify: `apps/desktop/src/main/trpc/routers/comment-solver.ts` (add `requestFollowUp` mutation)

- [ ] **Step 1: Add buildSolveFollowUpPrompt function**

In `apps/desktop/src/main/ai-review/solve-prompt.ts`, add:

```typescript
export interface SolveFollowUpOptions {
  prTitle: string;
  sourceBranch: string;
  targetBranch: string;
  sessionId: string;
  groupLabel: string;
  commitHash: string;
  commentAuthor: string;
  commentFilePath: string;
  commentLineNumber: number | null;
  commentBody: string;
  commentStatus: string;
  followUpText: string;
}

export function buildSolveFollowUpPrompt(opts: SolveFollowUpOptions): string {
  const location = opts.commentLineNumber
    ? `${opts.commentFilePath}:${opts.commentLineNumber}`
    : opts.commentFilePath;

  return `You are following up on a previous comment solve session.

PR: ${opts.prTitle}
Session ID: ${opts.sessionId}
Source: ${opts.sourceBranch} → Target: ${opts.targetBranch}

The user wants changes to group "${opts.groupLabel}" (commit ${opts.commitHash}).

Original comment by @${opts.commentAuthor} on ${location}:
"${opts.commentBody}"

The AI solver marked this as: ${opts.commentStatus}

User's follow-up instructions:
"${opts.followUpText}"

Use the SuperiorSwarm MCP tools. The session ID is already set in your environment.
Read the current code, make the requested changes, and call finish_fix_group when done.`;
}
```

- [ ] **Step 2: Add requestFollowUp tRPC mutation**

In `apps/desktop/src/main/trpc/routers/comment-solver.ts`, add:

```typescript
requestFollowUp: protectedProcedure
  .input(
    z.object({
      commentId: z.string(),
      followUpText: z.string().min(1),
    }),
  )
  .mutation(({ input }) => {
    // Store follow-up text on the comment
    db.update(schema.prComments)
      .set({
        followUpText: input.followUpText,
        status: "changes_requested",
      })
      .where(eq(schema.prComments.id, input.commentId))
      .run();

    // If the comment's group was approved, revoke it back to fixed
    const comment = db
      .select()
      .from(schema.prComments)
      .where(eq(schema.prComments.id, input.commentId))
      .get();

    if (comment?.groupId) {
      const group = db
        .select()
        .from(schema.commentGroups)
        .where(eq(schema.commentGroups.id, comment.groupId))
        .get();

      if (group?.status === "approved") {
        db.update(schema.commentGroups)
          .set({ status: "fixed" })
          .where(eq(schema.commentGroups.id, group.id))
          .run();
      }
    }

    // Build the follow-up prompt
    const session = db
      .select()
      .from(schema.commentSolveSessions)
      .where(
        eq(
          schema.commentSolveSessions.id,
          comment?.solveSessionId ?? "",
        ),
      )
      .get();

    const group = comment?.groupId
      ? db
          .select()
          .from(schema.commentGroups)
          .where(eq(schema.commentGroups.id, comment.groupId))
          .get()
      : null;

    if (!session || !comment || !group) {
      throw new Error("Session, comment, or group not found");
    }

    const prompt = buildSolveFollowUpPrompt({
      prTitle: session.prTitle,
      sourceBranch: session.sourceBranch,
      targetBranch: session.targetBranch,
      sessionId: session.id,
      groupLabel: group.label,
      commitHash: group.commitHash ?? "unknown",
      commentAuthor: comment.author,
      commentFilePath: comment.filePath,
      commentLineNumber: comment.lineNumber,
      commentBody: comment.body,
      commentStatus: comment.status,
      followUpText: input.followUpText,
    });

    // Write prompt to disk
    const { app } = require("electron");
    const solveDir = join(app.getPath("userData"), "solves", session.id);
    mkdirSync(solveDir, { recursive: true });
    const promptPath = join(
      solveDir,
      `follow-up-${Date.now()}.txt`,
    );
    writeFileSync(promptPath, prompt, "utf-8");

    // Resolve the worktree path for this session
    const { worktree } = resolveSessionWorktree(sessionId);

    // Build and write a launch script using the active CLI preset
    const settings = getSettings();
    const preset = CLI_PRESETS[settings.cliPreset ?? "claude"];
    const launchScript = join(solveDir, `follow-up-launch-${Date.now()}.sh`);
    const launchArgs = preset.buildArgs({ promptFilePath: promptPath } as LaunchOptions);
    writeFileSync(
      launchScript,
      `#!/bin/bash\ncd '${worktree.path}'\n${preset.command} ${launchArgs.join(" ")}\n`,
      { mode: 0o755 },
    );

    // Re-write MCP config for the follow-up session
    preset.setupMcp?.({
      mcpServerPath: getMcpServerPath(),
      worktreePath: worktree.path,
      reviewDir: solveDir,
      promptFilePath: promptPath,
      dbPath: getDbPath(),
      reviewDraftId: sessionId,
      prMetadata: JSON.stringify({
        title: session.prTitle,
        sourceBranch: session.sourceBranch,
        targetBranch: session.targetBranch,
        provider: session.prProvider,
      }),
      solveSessionId: sessionId,
    });

    return {
      success: true as const,
      promptPath,
      worktreePath: worktree.path,
      launchScript,
    };
  }),
```

Add imports at top:
```typescript
import { buildSolveFollowUpPrompt } from "../../ai-review/solve-prompt";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
```

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/solve-prompt.ts apps/desktop/src/main/trpc/routers/comment-solver.ts
git commit -m "feat: add follow-up prompt builder and requestFollowUp mutation"
```

---

## Task 6: Frontend — tab store changes

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts:10-66` (TabItem type), `93-200` (store interface)

- [ ] **Step 1: Add solve-review tab type**

In `apps/desktop/src/renderer/stores/tab-store.ts`, add the new tab variant to the `TabItem` union type (around line 10-66):

```typescript
| {
    kind: "solve-review";
    id: string;
    workspaceId: string;
    solveSessionId: string;
    title: "Solve Review";
  }
```

- [ ] **Step 2: Add terminal tab metadata for solve sessions**

Extend the terminal tab variant to include optional solve metadata:

```typescript
// In the terminal TabItem variant, add:
solveSessionId?: string;
presetName?: string;
```

- [ ] **Step 3: Add addSolveReviewTab method**

Add to the store interface and implementation:

```typescript
addSolveReviewTab: (workspaceId: string, solveSessionId: string) => string;
getSolveReviewTab: (workspaceId: string) => TabItem | undefined;
```

Implementation:
```typescript
addSolveReviewTab: (workspaceId, solveSessionId) => {
  const existing = get().getSolveReviewTab(workspaceId);
  if (existing) {
    // Already open — just focus it
    get().setActiveTab(existing.id);
    return existing.id;
  }
  const id = `solve-review-${solveSessionId}`;
  const tab: TabItem = {
    kind: "solve-review",
    id,
    workspaceId,
    solveSessionId,
    title: "Solve Review",
  };
  // Add to the workspace's pane (same logic as addTerminalTab)
  // ... insert into pane tabs array, set as active
  return id;
},

getSolveReviewTab: (workspaceId) => {
  const tabs = get().getTabsByWorkspace(workspaceId);
  return tabs.find((t) => t.kind === "solve-review");
},
```

- [ ] **Step 4: Update tab rendering switch**

Find where the store or parent component switches on `tab.kind` to render the correct component. Add the `"solve-review"` case. This is likely in a `WorkspacePane` or similar component — check where `"comment-fix-file"` is rendered and add the new case nearby.

- [ ] **Step 5: Type-check**

```bash
bun run type-check
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts
git commit -m "feat: add solve-review tab type and terminal metadata to tab store"
```

---

## Task 7: Frontend — SolveReviewTab component

**Files:**
- Create: `apps/desktop/src/renderer/components/SolveReviewTab.tsx`
- Create: `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`

- [ ] **Step 1: Create SolveReviewTab shell**

Create `apps/desktop/src/renderer/components/SolveReviewTab.tsx`:

```tsx
import { trpc } from "../utils/client";
import { useTabStore } from "../stores/tab-store";
import { SolveCommitGroupCard } from "./SolveCommitGroupCard";
import type { SolveSessionInfo } from "../../shared/solve-types";

interface Props {
  workspaceId: string;
  solveSessionId: string;
}

export function SolveReviewTab({ workspaceId, solveSessionId }: Props) {
  const utils = trpc.useUtils();

  const { data: session, isLoading } = trpc.commentSolver.getSolveSession.useQuery(
    { sessionId: solveSessionId },
    {
      refetchInterval: (data) => {
        const status = data?.state?.data?.status;
        return status === "queued" || status === "in_progress" ? 3000 : false;
      },
    },
  );

  const cancelMutation = trpc.commentSolver.cancelSolve.useMutation({
    onSuccess: () => utils.commentSolver.invalidate(),
  });

  const dismissMutation = trpc.commentSolver.dismissSolve.useMutation({
    onSuccess: () => utils.commentSolver.invalidate(),
  });

  const pushMutation = trpc.commentSolver.pushAndPost.useMutation({
    onSuccess: () => utils.commentSolver.invalidate(),
  });

  if (isLoading || !session) {
    return <div style={{ padding: 24, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  const isSolving = session.status === "queued" || session.status === "in_progress";
  const isCancelled = session.status === "cancelled";
  const isReady = session.status === "ready";

  const groups = session.groups ?? [];
  const allComments = groups.flatMap((g) => g.comments);
  const resolvedCount = allComments.filter(
    (c) => c.status === "fixed" || c.status === "wont_fix",
  ).length;
  const pendingCount = allComments.filter((c) => c.status === "open").length;
  const unclearCount = allComments.filter((c) => c.status === "unclear").length;

  const approvedGroups = groups.filter((g) => g.status === "approved").length;
  const totalGroups = groups.filter((g) => g.status !== "reverted").length;
  const allApproved = approvedGroups === totalGroups && totalGroups > 0;

  const hasDraftReplies = groups.some((g) =>
    g.comments.some((c) =>
      c.replies.some((r) => r.status === "draft"),
    ),
  );
  const canPush = allApproved && !hasDraftReplies && isReady;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px 18px" }}>
        {/* PR Header */}
        <PRHeader
          session={session}
          isSolving={isSolving}
          onCancel={() => cancelMutation.mutate({ sessionId: solveSessionId })}
        />

        {/* Progress strip */}
        <ProgressStrip
          resolvedCount={resolvedCount}
          pendingCount={pendingCount}
          unclearCount={unclearCount}
          approvedGroups={approvedGroups}
          totalGroups={totalGroups}
        />

        {/* Groups */}
        <div style={{
          fontFamily: "'Outfit', var(--font-family)",
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--text-tertiary)",
          marginBottom: 8,
        }}>
          {groups.length} Commit Groups
        </div>

        {groups.map((group, i) => (
          <SolveCommitGroupCard
            key={group.id}
            group={group}
            sessionId={solveSessionId}
            workspaceId={workspaceId}
            defaultExpanded={i === 0}
          />
        ))}

        {isCancelled && (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <button
              onClick={() => {/* trigger re-solve with excludeCommentIds */}}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                background: "var(--accent-subtle)",
                color: "var(--accent)",
                border: "none",
                cursor: "pointer",
              }}
            >
              Re-solve remaining comments
            </button>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <BottomBar
        session={session}
        canPush={canPush}
        hasDraftReplies={hasDraftReplies}
        approvedGroups={approvedGroups}
        totalGroups={totalGroups}
        unclearCount={unclearCount}
        onDismiss={() => dismissMutation.mutate({ sessionId: solveSessionId })}
        onPush={() => pushMutation.mutate({ sessionId: solveSessionId })}
      />
    </div>
  );
}
```

- [ ] **Step 2: Implement PRHeader sub-component**

In the same file:

```tsx
function PRHeader({
  session,
  isSolving,
  onCancel,
}: {
  session: SolveSessionInfo;
  isSolving: boolean;
  onCancel: () => void;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--text-tertiary)",
          }}>
            {session.prIdentifier}
          </span>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 8px",
            background: "var(--bg-elevated)",
            borderRadius: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-secondary)",
          }}>
            {session.sourceBranch} <span style={{ color: "var(--text-tertiary)", fontSize: 9 }}>→</span> {session.targetBranch}
          </span>
        </div>
        {isSolving && (
          <button
            onClick={onCancel}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--danger)",
              background: "var(--danger-subtle)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Cancel solve
          </button>
        )}
      </div>
      <div style={{
        fontSize: 17,
        fontWeight: 600,
        letterSpacing: "-0.03em",
        lineHeight: 1.35,
      }}>
        {session.prTitle}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement ProgressStrip sub-component**

```tsx
function ProgressStrip({
  resolvedCount,
  pendingCount,
  unclearCount,
  approvedGroups,
  totalGroups,
}: {
  resolvedCount: number;
  pendingCount: number;
  unclearCount: number;
  approvedGroups: number;
  totalGroups: number;
}) {
  const pct = totalGroups > 0 ? (approvedGroups / totalGroups) * 100 : 0;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 5 }}>
          {resolvedCount > 0 && (
            <StatusPill color="var(--success)" bg="var(--success-subtle)" count={resolvedCount} label="resolved" />
          )}
          {pendingCount > 0 && (
            <StatusPill color="var(--text-tertiary)" bg="var(--bg-elevated)" count={pendingCount} label="pending" />
          )}
          {unclearCount > 0 && (
            <StatusPill color="var(--warning)" bg="var(--warning-subtle)" count={unclearCount} label="unclear" />
          )}
        </div>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-tertiary)",
        }}>
          {approvedGroups} / {totalGroups} approved
        </span>
      </div>
      <div style={{
        height: 2,
        background: "var(--bg-elevated)",
        borderRadius: 1,
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "var(--success)",
          borderRadius: 1,
          transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

function StatusPill({ color, bg, count, label }: { color: string; bg: string; count: number; label: string }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 8px",
      borderRadius: 100,
      fontSize: 11,
      fontWeight: 500,
      background: bg,
      color,
    }}>
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }} />
      {count} {label}
    </span>
  );
}
```

- [ ] **Step 4: Implement BottomBar sub-component**

```tsx
function BottomBar({
  session,
  canPush,
  hasDraftReplies,
  approvedGroups,
  totalGroups,
  unclearCount,
  onDismiss,
  onPush,
}: {
  session: SolveSessionInfo;
  canPush: boolean;
  hasDraftReplies: boolean;
  approvedGroups: number;
  totalGroups: number;
  unclearCount: number;
  onDismiss: () => void;
  onPush: () => void;
}) {
  const messages: string[] = [];
  if (hasDraftReplies) messages.push("draft replies need sign-off");
  if (approvedGroups < totalGroups) {
    messages.push(`${totalGroups - approvedGroups} group${totalGroups - approvedGroups > 1 ? "s" : ""} not yet approved`);
  }

  return (
    <div style={{
      padding: "12px 28px",
      borderTop: "1px solid var(--border-subtle)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 5 }}>
        {messages.length > 0 && (
          <>
            <span style={{ color: "var(--warning)" }}>⚠</span>
            {messages.join(" · ")}
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={onDismiss}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-secondary)",
            background: "transparent",
            border: "1px solid var(--border-default)",
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
        <button
          onClick={canPush ? onPush : undefined}
          disabled={!canPush}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            border: "none",
            cursor: canPush ? "pointer" : "not-allowed",
            background: canPush ? "var(--success)" : "var(--bg-active)",
            color: canPush ? "#0a0c0a" : "var(--text-tertiary)",
            opacity: canPush ? 1 : 0.5,
          }}
        >
          Push & post replies
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
bun run type-check
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/SolveReviewTab.tsx
git commit -m "feat: create SolveReviewTab component with PR header, progress, and bottom bar"
```

---

## Task 8: Frontend — SolveCommitGroupCard component

**Files:**
- Create: `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`

- [ ] **Step 1: Create SolveCommitGroupCard**

Create `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`:

```tsx
import { useState } from "react";
import { trpc } from "../utils/client";
import { useTabStore } from "../stores/tab-store";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { SolveGroupInfo, SolveCommentInfo, ChangedFile } from "../../shared/solve-types";

interface Props {
  group: SolveGroupInfo;
  sessionId: string;
  workspaceId: string;
  defaultExpanded: boolean;
}

export function SolveCommitGroupCard({ group, sessionId, workspaceId, defaultExpanded }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const utils = trpc.useUtils();
  const tabStore = useTabStore();

  const approveMutation = trpc.commentSolver.approveGroup.useMutation({
    onSuccess: () => utils.commentSolver.invalidate(),
  });

  const isSolving = group.status === "pending";
  const isFixed = group.status === "fixed";
  const isApproved = group.status === "approved";
  const isReverted = group.status === "reverted";

  // Group comments by file
  const commentsByFile = new Map<string, SolveCommentInfo[]>();
  for (const comment of group.comments) {
    const existing = commentsByFile.get(comment.filePath) ?? [];
    existing.push(comment);
    commentsByFile.set(comment.filePath, existing);
  }

  const handleFileClick = (filePath: string) => {
    if (!group.commitHash) return;
    const repoPath = tabStore.activeWorkspaceCwd;
    if (!repoPath) return;
    tabStore.openCommentFixFile(
      workspaceId,
      group.id,
      filePath,
      group.commitHash,
      repoPath,
      filePath.split(".").pop() ?? "",
    );
  };

  return (
    <div style={{
      background: "var(--bg-surface)",
      border: `1px solid ${isSolving ? "rgba(76,154,255,0.12)" : "var(--border-subtle)"}`,
      borderRadius: 7,
      marginBottom: 5,
      overflow: "hidden",
      opacity: isReverted ? 0.5 : 1,
    }}>
      {/* Header */}
      <div
        onClick={() => !isSolving && setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          cursor: isSolving ? "default" : "pointer",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            width: 14,
            textAlign: "center",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}>
            ›
          </span>
          <span style={{
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "-0.015em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textDecoration: isReverted ? "line-through" : "none",
          }}>
            {group.label}
          </span>
          <RatioBadge group={group} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
          <GroupAction
            group={group}
            onApprove={() => approveMutation.mutate({ groupId: group.id })}
          />
        </div>
      </div>

      {/* Body */}
      {expanded && !isSolving && !isReverted && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px 12px 14px" }}>
          {/* Commit hash */}
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-tertiary)",
            marginBottom: 12,
          }}>
            {group.commitHash?.slice(0, 7)}
          </div>

          {/* Changed files */}
          <ChangedFilesSection
            files={group.changedFiles}
            onFileClick={handleFileClick}
          />

          {/* Comments addressed */}
          <CommentsAddressedSection
            commentsByFile={commentsByFile}
            sessionId={sessionId}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add RatioBadge and GroupAction sub-components**

In the same file:

```tsx
function RatioBadge({ group }: { group: SolveGroupInfo }) {
  const fixed = group.comments.filter(
    (c) => c.status === "fixed" || c.status === "wont_fix",
  ).length;
  const total = group.comments.length;
  const hasUnclear = group.comments.some((c) => c.status === "unclear");

  const bg = total === 0
    ? "var(--bg-active)"
    : fixed === total
      ? "var(--success-subtle)"
      : hasUnclear
        ? "var(--warning-subtle)"
        : "var(--bg-active)";
  const color = total === 0
    ? "var(--text-tertiary)"
    : fixed === total
      ? "var(--success)"
      : hasUnclear
        ? "var(--warning)"
        : "var(--text-tertiary)";

  return (
    <span style={{
      flexShrink: 0,
      padding: "1px 7px",
      borderRadius: 100,
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      fontWeight: 500,
      background: bg,
      color,
    }}>
      {fixed}/{total}
    </span>
  );
}

function GroupAction({
  group,
  onApprove,
}: {
  group: SolveGroupInfo;
  onApprove: () => void;
}) {
  if (group.status === "pending") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--accent)", fontWeight: 500 }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--accent)",
          animation: "blink 1.6s ease-in-out infinite",
        }} />
        Solving
      </span>
    );
  }
  if (group.status === "approved") {
    return (
      <span style={{
        padding: "3px 9px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 500,
        background: "var(--accent-subtle)",
        color: "var(--accent)",
      }}>
        ✓ Approved
      </span>
    );
  }
  if (group.status === "fixed") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onApprove(); }}
        style={{
          padding: "4px 12px",
          borderRadius: 6,
          fontSize: 11.5,
          fontWeight: 500,
          background: "var(--success-subtle)",
          color: "var(--success)",
          border: "none",
          cursor: "pointer",
        }}
      >
        Approve
      </button>
    );
  }
  return null;
}
```

- [ ] **Step 3: Add ChangedFilesSection**

```tsx
function ChangedFilesSection({
  files,
  onFileClick,
}: {
  files: ChangedFile[];
  onFileClick: (path: string) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--text-tertiary)",
        marginBottom: 5,
      }}>
        Changed files
      </div>
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        borderRadius: 5,
        overflow: "hidden",
      }}>
        {files.map((file) => (
          <div
            key={file.path}
            onClick={() => onFileClick(file.path)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 9px",
              background: "var(--bg-elevated)",
              cursor: "pointer",
            }}
          >
            <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>⬡</span>
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--accent)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {file.path}
            </span>
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-tertiary)",
              flexShrink: 0,
            }}>
              {file.additions > 0 && <span style={{ color: "var(--success)", opacity: 0.7 }}>+{file.additions}</span>}
              {file.additions > 0 && file.deletions > 0 && " "}
              {file.deletions > 0 && <span style={{ color: "var(--danger)", opacity: 0.7 }}>−{file.deletions}</span>}
            </span>
            <span style={{ color: "var(--text-tertiary)", fontSize: 10, opacity: 0 }}>→</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add CommentsAddressedSection with follow-up**

```tsx
function CommentsAddressedSection({
  commentsByFile,
  sessionId,
}: {
  commentsByFile: Map<string, SolveCommentInfo[]>;
  sessionId: string;
}) {
  if (commentsByFile.size === 0) return null;

  return (
    <div>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--text-tertiary)",
        marginBottom: 6,
      }}>
        Comments addressed
      </div>
      {Array.from(commentsByFile.entries()).map(([filePath, comments]) => (
        <div key={filePath} style={{ marginBottom: 10 }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-tertiary)",
            padding: "4px 0",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}>
            <span style={{ fontSize: 9 }}>⬡</span>
            {filePath.split("/").pop()}
          </div>
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} sessionId={sessionId} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CommentItem({ comment, sessionId }: { comment: SolveCommentInfo; sessionId: string }) {
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpText, setFollowUpText] = useState("");
  const utils = trpc.useUtils();

  const followUpMutation = trpc.commentSolver.requestFollowUp.useMutation({
    onSuccess: (result) => {
      setShowFollowUp(false);
      setFollowUpText("");
      utils.commentSolver.invalidate();

      // Launch the agent with the follow-up prompt
      if (result.promptPath && result.worktreePath) {
        const tabStore = useTabStore.getState();
        const tabs = tabStore.getTabsByWorkspace(workspaceId);
        const solverTab = tabs.find(
          (t) => t.kind === "terminal" && t.title === "AI Solver",
        );

        if (solverTab) {
          tabStore.setActiveTab(solverTab.id);
          // Send the follow-up launch command to the existing terminal
          window.electron.terminal.write(
            solverTab.id,
            `bash '${result.launchScript}'\r`,
          );
        } else {
          // Create new terminal and launch
          const tabId = tabStore.addTerminalTab(
            workspaceId,
            result.worktreePath,
            "AI Solver",
          );
          window.electron.terminal.create(tabId, result.worktreePath).then(() => {
            window.electron.terminal.write(
              tabId,
              `bash '${result.launchScript}'\r`,
            );
          });
        }
      }
    },
  });

  const statusColor = comment.status === "fixed" || comment.status === "wont_fix"
    ? "var(--success)"
    : comment.status === "unclear"
      ? "var(--warning)"
      : comment.status === "changes_requested"
        ? "var(--accent)"
        : "var(--text-tertiary)";

  const statusLabel = comment.status === "fixed" ? "✓ Fixed"
    : comment.status === "unclear" ? "? Unclear"
    : comment.status === "changes_requested" ? "↻ Changes requested"
    : comment.status === "wont_fix" ? "— Won't fix"
    : "Pending";

  return (
    <div style={{
      padding: "7px 0 7px 14px",
      borderLeft: "1px solid var(--border-default)",
      marginLeft: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <div style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg-active)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 8,
          fontWeight: 600,
          color: "var(--text-secondary)",
        }}>
          {comment.author.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{comment.author}</span>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--text-tertiary)",
        }}>
          {comment.lineNumber ? `line ${comment.lineNumber}` : ""}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
        <MarkdownRenderer content={comment.body} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
        <span style={{ fontSize: 10.5, fontWeight: 500, color: statusColor }}>{statusLabel}</span>
        {(comment.status === "fixed" || comment.status === "unclear") && (
          <button
            onClick={() => setShowFollowUp(!showFollowUp)}
            style={{
              fontSize: 10.5,
              color: "var(--text-tertiary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
          >
            Follow up
          </button>
        )}
      </div>

      {/* Follow-up text area */}
      {showFollowUp && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            placeholder="What should be changed?"
            style={{
              width: "100%",
              minHeight: 60,
              padding: 8,
              borderRadius: 6,
              border: "1px solid var(--border-default)",
              background: "var(--bg-base)",
              color: "var(--text-primary)",
              fontSize: 12,
              fontFamily: "var(--font-family)",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
            <button
              onClick={() => { setShowFollowUp(false); setFollowUpText(""); }}
              style={{
                padding: "3px 10px",
                borderRadius: 6,
                fontSize: 11,
                background: "transparent",
                color: "var(--text-tertiary)",
                border: "1px solid var(--border-default)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => followUpMutation.mutate({ commentId: comment.id, followUpText })}
              disabled={!followUpText.trim()}
              style={{
                padding: "3px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 500,
                background: "var(--accent-subtle)",
                color: "var(--accent)",
                border: "none",
                cursor: followUpText.trim() ? "pointer" : "not-allowed",
                opacity: followUpText.trim() ? 1 : 0.5,
              }}
            >
              Request changes
            </button>
          </div>
        </div>
      )}

      {/* Show existing follow-up text */}
      {comment.followUpText && (
        <div style={{
          marginTop: 6,
          padding: "6px 10px",
          background: "var(--accent-subtle)",
          borderRadius: 6,
          fontSize: 11.5,
          color: "var(--accent)",
        }}>
          Follow-up: {comment.followUpText}
        </div>
      )}

      {/* Draft reply sign-off (from unclear sign-off cherry-pick) */}
      {comment.replies.filter((r) => r.status === "draft").map((reply) => (
        <DraftReplySignoff key={reply.id} reply={reply} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Add DraftReplySignoff sub-component**

```tsx
function DraftReplySignoff({ reply }: { reply: SolveReplyInfo }) {
  const utils = trpc.useUtils();
  const approveMutation = trpc.commentSolver.approveReply.useMutation({
    onSuccess: () => utils.commentSolver.invalidate(),
  });
  const deleteMutation = trpc.commentSolver.deleteReply.useMutation({
    onSuccess: () => utils.commentSolver.invalidate(),
  });

  return (
    <div style={{
      marginTop: 8,
      padding: "9px 12px",
      background: "var(--bg-base)",
      border: "1px solid var(--border-default)",
      borderRadius: 6,
    }}>
      <div style={{
        fontSize: 9.5,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--warning)",
        marginBottom: 4,
        opacity: 0.75,
      }}>
        Draft reply
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {reply.body}
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px solid var(--border-subtle)",
      }}>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", flex: 1 }}>Post this reply?</span>
        <button
          onClick={() => deleteMutation.mutate({ replyId: reply.id })}
          style={{
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            background: "transparent",
            color: "var(--text-tertiary)",
            border: "1px solid var(--border-default)",
            cursor: "pointer",
          }}
        >
          Discard
        </button>
        <button
          onClick={() => approveMutation.mutate({ replyId: reply.id })}
          style={{
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            background: "var(--success-subtle)",
            color: "var(--success)",
            border: "none",
            cursor: "pointer",
          }}
        >
          Approve & post
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add CSS keyframes for blink animation**

Add a `<style>` tag or CSS-in-JS for the blink animation used by the solving indicator. If the project uses a global CSS file, add there. Otherwise inline:

```tsx
// At module level in SolveCommitGroupCard.tsx:
const style = document.createElement("style");
style.textContent = `@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`;
if (!document.querySelector("[data-solve-animations]")) {
  style.setAttribute("data-solve-animations", "");
  document.head.appendChild(style);
}
```

- [ ] **Step 7: Type-check**

```bash
bun run type-check
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx
git commit -m "feat: create SolveCommitGroupCard with file list, comments, and follow-up"
```

---

## Task 9: Frontend — tab lifecycle and integration

**Files:**
- Modify: `apps/desktop/src/renderer/components/CommentsOverviewTab.tsx:168-195` (handleSolve)
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx:16-23` (tab type), `87+` (content rendering)
- Modify: `apps/desktop/src/renderer/components/AIFixesTab.tsx` (replace with link)
- Modify: parent component that renders tabs based on `tab.kind` (find via tab-store usage)

- [ ] **Step 1: Open SolveReviewTab on solve trigger**

In `apps/desktop/src/renderer/components/CommentsOverviewTab.tsx`, update `handleSolve` (around line 168):

After the terminal tab is created and the launch script is sent, add:

```typescript
// After: window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\r`);
// Add:
const tabStore = useTabStore.getState();
tabStore.addSolveReviewTab(launchInfo.workspaceId, launchInfo.sessionId);
```

Note: `launchInfo` is of type `SolveLaunchInfo` which already has `sessionId` — verify this field exists. If not, the `triggerSolve` mutation response needs to include it (it should from the `createAndQueueSolve` return value).

- [ ] **Step 2: Render SolveReviewTab in workspace pane**

Find the component that switches on `tab.kind` to render tab content. Add the case:

```tsx
case "solve-review":
  return (
    <SolveReviewTab
      workspaceId={tab.workspaceId}
      solveSessionId={tab.solveSessionId}
    />
  );
```

Import `SolveReviewTab` from the new file.

- [ ] **Step 3: Replace AIFixesTab inline review with link**

In `apps/desktop/src/renderer/components/AIFixesTab.tsx`, replace the `ActiveState` rendering with a link to open the workspace tab:

```tsx
// Replace the ActiveState component usage with:
function AIFixesTab() {
  const workspaceId = useTabStore((s) => s.activeWorkspaceId);
  const { data: sessions } = trpc.commentSolver.getSolveSessions.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId },
  );

  const activeSession = sessions?.find(
    (s) => s.status !== "dismissed",
  );

  if (!activeSession || !workspaceId) {
    return (
      <div style={{ padding: 16, color: "var(--text-tertiary)", fontSize: 12 }}>
        No active solve session
      </div>
    );
  }

  return (
    <div style={{ padding: 16, textAlign: "center" }}>
      <button
        onClick={() => {
          useTabStore.getState().addSolveReviewTab(workspaceId, activeSession.id);
        }}
        style={{
          padding: "8px 16px",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          background: "var(--accent-subtle)",
          color: "var(--accent)",
          border: "none",
          cursor: "pointer",
        }}
      >
        Open Solve Review
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Auto-focus on ready**

In `SolveReviewTab.tsx`, add an effect to auto-focus when session transitions to ready:

```tsx
const prevStatusRef = useRef(session?.status);

useEffect(() => {
  if (prevStatusRef.current === "in_progress" && session?.status === "ready") {
    // Auto-focus this tab
    useTabStore.getState().setActiveTab(`solve-review-${solveSessionId}`);
  }
  prevStatusRef.current = session?.status;
}, [session?.status, solveSessionId]);
```

- [ ] **Step 5: Remove SolvingBanner usage**

In `CommentsOverviewTab.tsx`, remove the `SolvingBanner` import and usage. The solving state is now shown in the `SolveReviewTab` directly.

Keep the "solving in progress" check that disables the Solve button — just remove the banner component.

- [ ] **Step 6: Type-check and lint**

```bash
bun run type-check && bun run lint
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentsOverviewTab.tsx apps/desktop/src/renderer/components/DiffPanel.tsx apps/desktop/src/renderer/components/AIFixesTab.tsx apps/desktop/src/renderer/components/SolveReviewTab.tsx
git commit -m "feat: integrate SolveReviewTab lifecycle — auto-open, auto-focus, right panel link"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
bun run dev
```

- [ ] **Step 2: Verify solve trigger opens both tabs**

1. Open a workspace linked to a PR with comments
2. Go to Comments tab, click "Solve with AI"
3. Verify both "AI Solver" terminal tab and "Solve Review" tab open
4. Verify the Solve Review tab shows the session in "queued" state

- [ ] **Step 3: Verify live group updates**

1. Watch the Solve Review tab as the agent works
2. Verify groups appear with "Solving" indicator as they're created
3. Verify they transition to "fixed" when complete
4. Verify the file list populates with `+/-` stats

- [ ] **Step 4: Verify cancel flow**

1. While solving is in progress, click "Cancel solve"
2. Verify the agent process stops
3. Verify completed groups are preserved and pending groups are removed
4. Verify "Re-solve remaining" button appears

- [ ] **Step 5: Verify review and push flow**

1. Expand a fixed group — verify "Changed files" shows all files and "Comments addressed" shows comments grouped by file
2. Click a file — verify diff opens in a new workspace tab
3. Approve all groups
4. Verify "Push & post replies" button enables
5. Click it — verify push and reply posting works

- [ ] **Step 6: Verify follow-up flow**

1. Click "Follow up" on a comment
2. Type follow-up instructions, click "Request changes"
3. Verify comment status changes to "Changes requested"
4. Verify follow-up text is displayed
5. Verify the group's approval is revoked if it was approved

- [ ] **Step 7: Verify tab lifecycle**

1. Close the Solve Review tab via ✕
2. Go to "AI Fixes" in the right panel
3. Click "Open Solve Review" — verify the tab reopens
4. Verify the session data is intact

- [ ] **Step 8: Run all tests**

```bash
cd apps/desktop && bun test
bun run type-check
bun run lint
```

- [ ] **Step 9: Commit any fixes**

```bash
git add -A
git commit -m "fix: end-to-end verification fixes"
```
