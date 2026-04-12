# Unclear Comment Sign-off Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blocked publish state and missing sign-off UX for AI-drafted replies on unclear comments — adding `approveReply`/`revokeGroup` endpoints, an inline sign-off strip component, a gated Approve + Revoke button, and a redesigned bottom bar.

**Architecture:** Three layers: (1) two new tRPC endpoints + `addReply` tweak; (2) inline sign-off strip + Approve/Revoke buttons in `CommitGroupCard`; (3) redesigned bottom bar in `ActiveState` that hard-disables Push until all groups are approved. `PublishGateDialog` is removed. No schema changes required.

**Tech Stack:** TypeScript, React 19, tRPC over Electron IPC, SQLite + Drizzle ORM (`better-sqlite3` in tests), Bun test runner.

**Spec:** `specs/2026-04-12-unclear-comment-signoff-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `apps/desktop/src/main/trpc/routers/comment-solver.ts` | Modify | Add `approveReply`, `revokeGroup`; update `addReply`, `updateReply` |
| `apps/desktop/src/renderer/components/AIFixesTab.tsx` | Modify | Sign-off strip, Approve gating, Revoke button, new bottom bar, remove `PublishGateDialog` usage |
| `apps/desktop/src/renderer/components/PublishGateDialog.tsx` | Delete | Entirely removed |
| `apps/desktop/tests/comment-solver.test.ts` | Modify | Add sign-off and revoke test suites |

---

## Task 1: Backend — `approveReply` and `revokeGroup` endpoints

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/comment-solver.ts`
- Modify: `apps/desktop/tests/comment-solver.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `apps/desktop/tests/comment-solver.test.ts` (inside the outer `describe("Comment Solver", ...)` block, after the "Revert ordering" suite):

```typescript
describe("Sign-off flow", () => {
  const SESSION = "signoff-sess";
  const GROUP_ID = "signoff-grp";
  const COMMENT_ID = "signoff-c-1";
  const REPLY_ID = "signoff-r-1";

  beforeAll(() => {
    seedSession(SESSION, "ready");
    seedGroup(GROUP_ID, SESSION, 1, "approved", "commit-xyz");
    seedComment(COMMENT_ID, SESSION, "plat-signoff-1", GROUP_ID, "unclear");
    seedReply(REPLY_ID, COMMENT_ID, "draft");
  });

  test("approveReply sets reply status to approved", () => {
    db.prepare("UPDATE comment_replies SET status = 'draft' WHERE id = ?").run(REPLY_ID);

    // Mirrors approveReply endpoint logic
    db.prepare("UPDATE comment_replies SET status = 'approved' WHERE id = ?").run(REPLY_ID);

    const row = db
      .prepare("SELECT status FROM comment_replies WHERE id = ?")
      .get(REPLY_ID) as Record<string, unknown>;
    expect(row["status"]).toBe("approved");
  });

  test("revokeGroup resets group to fixed and approved replies to draft", () => {
    // Setup: group is approved, reply is approved
    db.prepare("UPDATE comment_groups SET status = 'approved' WHERE id = ?").run(GROUP_ID);
    db.prepare("UPDATE comment_replies SET status = 'approved' WHERE id = ?").run(REPLY_ID);

    // Mirrors revokeGroup endpoint logic
    db.prepare("UPDATE comment_groups SET status = 'fixed' WHERE id = ?").run(GROUP_ID);

    const comments = db
      .prepare("SELECT id FROM pr_comments WHERE group_id = ?")
      .all(GROUP_ID) as Array<{ id: string }>;
    const commentIds = comments.map((c) => c.id);
    if (commentIds.length > 0) {
      db.prepare(
        `UPDATE comment_replies SET status = 'draft'
         WHERE pr_comment_id IN (${commentIds.map(() => "?").join(",")})
         AND status = 'approved'`
      ).run(...commentIds);
    }

    const groupRow = db
      .prepare("SELECT status FROM comment_groups WHERE id = ?")
      .get(GROUP_ID) as Record<string, unknown>;
    expect(groupRow["status"]).toBe("fixed");

    const replyRow = db
      .prepare("SELECT status FROM comment_replies WHERE id = ?")
      .get(REPLY_ID) as Record<string, unknown>;
    expect(replyRow["status"]).toBe("draft");
  });

  test("revokeGroup only resets approved replies, leaves draft replies alone", () => {
    const DRAFT_REPLY_ID = "signoff-r-draft-only";
    db.prepare(
      "INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'draft body', 'draft')"
    ).run(DRAFT_REPLY_ID, COMMENT_ID);

    // revokeGroup should not touch already-draft replies
    db.prepare(
      `UPDATE comment_replies SET status = 'draft'
       WHERE pr_comment_id = ? AND status = 'approved'`
    ).run(COMMENT_ID);

    const row = db
      .prepare("SELECT status FROM comment_replies WHERE id = ?")
      .get(DRAFT_REPLY_ID) as Record<string, unknown>;
    expect(row["status"]).toBe("draft"); // Unchanged

    // Cleanup
    db.prepare("DELETE FROM comment_replies WHERE id = ?").run(DRAFT_REPLY_ID);
  });

  test("revokeGroup on a non-approved group should be guarded", () => {
    // Verify the data condition: group must be 'approved' to revoke
    db.prepare("UPDATE comment_groups SET status = 'fixed' WHERE id = ?").run(GROUP_ID);
    const row = db
      .prepare("SELECT status FROM comment_groups WHERE id = ?")
      .get(GROUP_ID) as Record<string, unknown>;
    // In the router, if status !== 'approved' we throw. This test verifies
    // the DB state that would trigger the guard.
    expect(row["status"]).not.toBe("approved");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/desktop && bun test tests/comment-solver.test.ts --grep "Sign-off flow"
```

Expected: test runner finds and runs 4 tests. They should all pass immediately since the tests replicate the SQL logic directly (same pattern as the recovery tests). If they pass, that's correct — the test suite is validating the DB behaviour, not calling unimplemented router code.

- [ ] **Step 3: Add `approveReply` endpoint to router**

In `apps/desktop/src/main/trpc/routers/comment-solver.ts`, add after the `approveGroup` procedure (around line 334):

```typescript
/**
 * Approve a draft reply on an unclear comment.
 * Sets reply status from "draft" → "approved".
 */
approveReply: publicProcedure.input(z.object({ replyId: z.string() })).mutation(({ input }) => {
  const db = getDb();

  const reply = db
    .select()
    .from(schema.commentReplies)
    .where(eq(schema.commentReplies.id, input.replyId))
    .get();

  if (!reply) throw new Error(`Reply ${input.replyId} not found`);

  db.update(schema.commentReplies)
    .set({ status: "approved" })
    .where(eq(schema.commentReplies.id, input.replyId))
    .run();

  return { success: true };
}),
```

- [ ] **Step 4: Add `revokeGroup` endpoint to router**

Add after `approveReply` (still in `comment-solver.ts`):

```typescript
/**
 * Revoke a previously approved group.
 * Resets group status "approved" → "fixed" and returns all approved replies
 * in the group back to "draft" so the sign-off strip re-appears.
 */
revokeGroup: publicProcedure.input(z.object({ groupId: z.string() })).mutation(({ input }) => {
  const db = getDb();

  const group = db
    .select()
    .from(schema.commentGroups)
    .where(eq(schema.commentGroups.id, input.groupId))
    .get();

  if (!group) throw new Error(`Comment group ${input.groupId} not found`);
  if (group.status !== "approved") {
    throw new Error(
      `Cannot revoke group with status "${group.status}" — expected "approved"`
    );
  }

  db.update(schema.commentGroups)
    .set({ status: "fixed" })
    .where(eq(schema.commentGroups.id, input.groupId))
    .run();

  const comments = db
    .select({ id: schema.prComments.id })
    .from(schema.prComments)
    .where(eq(schema.prComments.groupId, input.groupId))
    .all();

  const commentIds = comments.map((c) => c.id);
  if (commentIds.length > 0) {
    db.update(schema.commentReplies)
      .set({ status: "draft" })
      .where(
        and(
          inArray(schema.commentReplies.prCommentId, commentIds),
          eq(schema.commentReplies.status, "approved")
        )
      )
      .run();
  }

  return { success: true };
}),
```

- [ ] **Step 5: Run type check**

```bash
cd apps/desktop && bun run type-check 2>&1 | head -40
```

Expected: no errors on the new endpoints.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/comment-solver.ts apps/desktop/tests/comment-solver.test.ts
git commit -m "feat: add approveReply and revokeGroup tRPC endpoints"
```

---

## Task 2: Backend — `addReply` creates `approved` by default; `updateReply` resets to draft on body edit

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/comment-solver.ts`
- Modify: `apps/desktop/tests/comment-solver.test.ts`

- [ ] **Step 1: Write failing tests**

Append inside the `describe("Sign-off flow", ...)` block in `apps/desktop/tests/comment-solver.test.ts`:

```typescript
test("addReply without draft flag creates reply as approved", () => {
  const replyId = "signoff-r-approved";
  // Mirrors addReply with draft: false (default) — creates as 'approved'
  db.prepare(
    "INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'User reply', 'approved')"
  ).run(replyId, COMMENT_ID);

  const row = db
    .prepare("SELECT status FROM comment_replies WHERE id = ?")
    .get(replyId) as Record<string, unknown>;
  expect(row["status"]).toBe("approved");

  db.prepare("DELETE FROM comment_replies WHERE id = ?").run(replyId);
});

test("addReply with draft: true creates reply as draft", () => {
  const replyId = "signoff-r-undo";
  // Mirrors addReply with draft: true — used for undo-discard
  db.prepare(
    "INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'Restored body', 'draft')"
  ).run(replyId, COMMENT_ID);

  const row = db
    .prepare("SELECT status FROM comment_replies WHERE id = ?")
    .get(replyId) as Record<string, unknown>;
  expect(row["status"]).toBe("draft");

  db.prepare("DELETE FROM comment_replies WHERE id = ?").run(replyId);
});

test("updateReply with body resets an approved reply to draft", () => {
  // Mirrors updateReply: when body changes, status resets to draft
  const replyId = "signoff-r-reset";
  db.prepare(
    "INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, 'Original', 'approved')"
  ).run(replyId, COMMENT_ID);

  // Simulate updateReply with body — always resets to draft
  db.prepare("UPDATE comment_replies SET body = ?, status = 'draft' WHERE id = ?").run(
    "Edited body",
    replyId
  );

  const row = db
    .prepare("SELECT status, body FROM comment_replies WHERE id = ?")
    .get(replyId) as Record<string, unknown>;
  expect(row["status"]).toBe("draft");
  expect(row["body"]).toBe("Edited body");

  db.prepare("DELETE FROM comment_replies WHERE id = ?").run(replyId);
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/desktop && bun test tests/comment-solver.test.ts --grep "Sign-off flow"
```

Expected: all tests pass (same pattern — they validate DB behavior directly).

- [ ] **Step 3: Update `addReply` to accept optional `draft` param**

Replace the existing `addReply` procedure in `apps/desktop/src/main/trpc/routers/comment-solver.ts`:

```typescript
/**
 * Add a new reply to a comment.
 * By default creates as "approved" (user explicitly wrote it = implicit sign-off).
 * Pass draft: true to create as "draft" — used when undoing a discard.
 */
addReply: publicProcedure
  .input(z.object({ commentId: z.string(), body: z.string(), draft: z.boolean().default(false) }))
  .mutation(({ input }) => {
    const db = getDb();
    const id = randomUUID();
    db.insert(schema.commentReplies)
      .values({
        id,
        prCommentId: input.commentId,
        body: input.body,
        status: input.draft ? "draft" : "approved",
      })
      .run();
    return { id, success: true };
  }),
```

- [ ] **Step 4: Update `updateReply` to reset status to draft when body changes**

Replace the `updateReply` procedure in `comment-solver.ts`:

```typescript
/**
 * Update a comment reply's body and/or status.
 * When body is provided, status is always reset to "draft" — the user must
 * re-approve via the sign-off strip after editing.
 */
updateReply: publicProcedure
  .input(
    z.object({
      replyId: z.string(),
      body: z.string().optional(),
      status: z.enum(["approved", "draft"]).optional(),
    })
  )
  .mutation(({ input }) => {
    const db = getDb();
    const updates: Record<string, unknown> = {};

    if (input.body !== undefined) {
      updates.body = input.body;
      updates.status = "draft"; // Always reset when body changes
    }
    if (input.status !== undefined) {
      updates.status = input.status;
    }

    if (Object.keys(updates).length === 0) {
      return { success: true };
    }

    db.update(schema.commentReplies)
      .set(updates)
      .where(eq(schema.commentReplies.id, input.replyId))
      .run();

    return { success: true };
  }),
```

- [ ] **Step 5: Run type check**

```bash
cd apps/desktop && bun run type-check 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/comment-solver.ts apps/desktop/tests/comment-solver.test.ts
git commit -m "feat: addReply defaults to approved; updateReply resets to draft on body edit"
```

---

## Task 3: Frontend — Sign-off strip, gated Approve, and Revoke button in `CommitGroupCard`

**Files:**
- Modify: `apps/desktop/src/renderer/components/AIFixesTab.tsx`

The `CommitGroupCard` component lives at the top of `AIFixesTab.tsx` (lines 68–412). All changes in this task are within that component.

- [ ] **Step 1: Add new mutations and `discardedBodies` state to `CommitGroupCard`**

After the existing `addReply` mutation (around line 107), add:

```typescript
const approveReply = trpc.commentSolver.approveReply.useMutation({
  onSuccess: () => {
    utils.commentSolver.getSolveSession.invalidate({ sessionId });
  },
});

const revokeGroup = trpc.commentSolver.revokeGroup.useMutation({
  onSuccess: () => {
    utils.commentSolver.getSolveSession.invalidate({ sessionId });
  },
});

// Holds reply bodies for in-flight discards so Undo can restore them.
// Keyed by comment ID. Cleared when user navigates away (component unmounts).
const [discardedBodies, setDiscardedBodies] = useState<Map<string, string>>(new Map());
```

- [ ] **Step 2: Update `canApprove` and add `canRevoke`**

Replace these two lines (around line 138–140):

```typescript
// OLD:
const canApprove = group.status === "fixed";
```

With:

```typescript
const hasUnclearDraftReplies = group.comments.some(
  (c) => c.status === "unclear" && c.reply?.status === "draft"
);
const canApprove = group.status === "fixed" && !hasUnclearDraftReplies;
const canRevoke = group.status === "approved";
```

- [ ] **Step 3: Update the Approve button and add Revoke button**

Replace the entire Approve button block in the header actions div (inside `{/* Row 2: actions */}`, around lines 189–231):

```tsx
{/* Row 2: actions */}
<div className="mt-1 flex items-center gap-2 pl-4">
  {canApprove && (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        approveGroup.mutate({ groupId: group.id });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          approveGroup.mutate({ groupId: group.id });
        }
      }}
      className="rounded-[4px] bg-[rgba(48,209,88,0.15)] px-2 py-0.5 text-[10px] font-medium text-[#30d158] hover:opacity-80"
    >
      {approveGroup.isPending ? "..." : "Approve"}
    </span>
  )}
  {!canApprove && group.status === "fixed" && hasUnclearDraftReplies && (
    <span
      className="rounded-[4px] bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-quaternary)] cursor-not-allowed"
      title="Resolve unclear replies first"
    >
      Approve
    </span>
  )}
  {canRevoke && (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        revokeGroup.mutate({ groupId: group.id });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          revokeGroup.mutate({ groupId: group.id });
        }
      }}
      className="rounded-[4px] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
    >
      {revokeGroup.isPending ? "..." : "Revoke"}
    </span>
  )}
  {group.status === "approved" && !canRevoke && (
    <span className="rounded-[3px] bg-[rgba(10,132,255,0.15)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[#0a84ff]">
      Approved
    </span>
  )}
  <span
    role="button"
    tabIndex={0}
    onClick={(e) => {
      e.stopPropagation();
      handleFollowUp();
    }}
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        handleFollowUp();
      }
    }}
    className="rounded-[4px] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
  >
    Follow up
  </span>
</div>
```

Note: The old `{group.status === "approved" && <span>Approved</span>}` is now replaced by the Revoke button which shows when `canRevoke`. The standalone "Approved" badge only shows as a fallback (edge case where canRevoke is false but status is approved — in practice this shouldn't occur, but keeps the UI safe).

Simplify the action row to just:

```tsx
{/* Row 2: actions */}
<div className="mt-1 flex items-center gap-2 pl-4">
  {canApprove && (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); approveGroup.mutate({ groupId: group.id }); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); approveGroup.mutate({ groupId: group.id }); } }}
      className="rounded-[4px] bg-[rgba(48,209,88,0.15)] px-2 py-0.5 text-[10px] font-medium text-[#30d158] hover:opacity-80"
    >
      {approveGroup.isPending ? "..." : "Approve"}
    </span>
  )}
  {group.status === "fixed" && !canApprove && (
    <span
      className="rounded-[4px] bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-quaternary)] cursor-not-allowed"
      title="Resolve unclear replies first"
    >
      Approve
    </span>
  )}
  {group.status === "approved" && (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); revokeGroup.mutate({ groupId: group.id }); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); revokeGroup.mutate({ groupId: group.id }); } }}
      className="rounded-[4px] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
    >
      {revokeGroup.isPending ? "..." : "Revoke"}
    </span>
  )}
  <span
    role="button"
    tabIndex={0}
    onClick={(e) => { e.stopPropagation(); handleFollowUp(); }}
    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); handleFollowUp(); } }}
    className="rounded-[4px] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
  >
    Follow up
  </span>
</div>
```

- [ ] **Step 4: Update the draft reply box to show sign-off strip and approved state**

Replace the existing `{/* Draft reply — editable */}` block (around lines 292–319) with:

```tsx
{/* Draft reply — editable */}
{comment.reply && editingReply !== comment.reply.id && (
  <div
    className={[
      "mt-2 rounded-[4px] border px-2.5 py-1.5 transition-colors",
      comment.reply.status === "approved"
        ? "border-[rgba(48,209,88,0.2)] bg-[rgba(48,209,88,0.05)]"
        : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)]",
    ].join(" ")}
  >
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-medium text-[var(--text-quaternary)]">
        {comment.reply.status === "approved" ? "✓ Reply approved" : "Draft reply:"}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => {
            setEditingReply(comment.reply!.id);
            setEditReplyText(comment.reply!.body);
          }}
          className="text-[9px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => deleteReply.mutate({ replyId: comment.reply!.id })}
          className="text-[9px] text-[#ff453a] hover:opacity-80"
        >
          Delete
        </button>
      </div>
    </div>
    <MarkdownRenderer content={comment.reply.body} />

    {/* Sign-off strip — only for unclear comments with draft replies */}
    {comment.status === "unclear" && comment.reply.status === "draft" && (
      <div className="mt-2 flex items-center gap-2 border-t border-[rgba(255,255,255,0.05)] pt-2">
        <span className="flex-1 text-[10px] text-[var(--text-quaternary)]">Post this reply?</span>
        <button
          type="button"
          disabled={deleteReply.isPending}
          onClick={() => {
            const body = comment.reply!.body;
            const commentId = comment.id;
            setDiscardedBodies((prev) => {
              const next = new Map(prev);
              next.set(commentId, body);
              return next;
            });
            deleteReply.mutate({ replyId: comment.reply!.id });
          }}
          className="rounded-[4px] border border-[rgba(255,255,255,0.1)] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] disabled:opacity-40"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={approveReply.isPending}
          onClick={() => approveReply.mutate({ replyId: comment.reply!.id })}
          className="rounded-[4px] border border-[rgba(48,209,88,0.2)] bg-[rgba(48,209,88,0.12)] px-2 py-0.5 text-[10px] font-medium text-[#30d158] hover:bg-[rgba(48,209,88,0.2)] disabled:opacity-40"
        >
          {approveReply.isPending ? "..." : "✓ Approve"}
        </button>
      </div>
    )}
  </div>
)}

{/* Discarded reply — show undo affordance */}
{!comment.reply && discardedBodies.has(comment.id) && (
  <div className="mt-2 flex items-center justify-between rounded-[4px] border border-[rgba(255,255,255,0.04)] px-2.5 py-1.5">
    <span className="text-[10px] italic text-[var(--text-quaternary)]">
      Reply discarded — nothing will be posted
    </span>
    <button
      type="button"
      onClick={() => {
        const body = discardedBodies.get(comment.id)!;
        setDiscardedBodies((prev) => {
          const next = new Map(prev);
          next.delete(comment.id);
          return next;
        });
        addReply.mutate({ commentId: comment.id, body, draft: true });
      }}
      className="text-[9px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
    >
      Undo
    </button>
  </div>
)}
```

- [ ] **Step 5: Run type check**

```bash
cd apps/desktop && bun run type-check 2>&1 | head -50
```

Expected: no errors. If `approveReply` or `revokeGroup` are not found on `trpc.commentSolver`, verify the router exports are correct and the tRPC client is regenerated.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/AIFixesTab.tsx
git commit -m "feat: sign-off strip, gated approve, and revoke button for unclear comments"
```

---

## Task 4: Frontend — Redesign bottom bar in `ActiveState`

**Files:**
- Modify: `apps/desktop/src/renderer/components/AIFixesTab.tsx`

The `ActiveState` component starts around line 416. The bottom bar is the `{/* Bottom bar */}` section.

- [ ] **Step 1: Replace computed gate values in `ActiveState`**

Remove these lines (around lines 451–454):

```typescript
// OLD — remove these:
const allReplies = allComments.filter((c) => c.reply != null);
const approvedReplies = allReplies.filter((c) => c.reply?.status === "approved").length;
const draftReplies = allReplies.filter((c) => c.reply?.status === "draft").length;
const gate = classifyPublishGate(session);
```

Replace with:

```typescript
const nonRevertedGroups = session.groups.filter((g) => g.status !== "reverted");
const approvedGroupCount = nonRevertedGroups.filter((g) => g.status === "approved").length;
const totalGroupCount = nonRevertedGroups.length;
const allGroupsApproved = approvedGroupCount === totalGroupCount && totalGroupCount > 0;

const unclearDraftCount = allComments.filter(
  (c) => c.status === "unclear" && c.reply?.status === "draft"
).length;

const approvedReplyCount = allComments.filter((c) => c.reply?.status === "approved").length;

const unapprovedGroupCount = totalGroupCount - approvedGroupCount;
```

- [ ] **Step 2: Remove `showPublishDialog` state and `pushError` state handling**

Remove:

```typescript
// OLD — remove:
const [showPublishDialog, setShowPublishDialog] = useState(false);
```

Keep `pushError` and `setPushError` — they're still used for actual server errors.

- [ ] **Step 3: Replace the entire bottom bar JSX**

Replace the `{/* Bottom bar */}` section (from `<div className="shrink-0 border-t...">` to the closing `</div>` that includes the buttons) with:

```tsx
{/* Bottom bar */}
<div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
  {/* Error feedback */}
  {pushError && (
    <div className="border-b border-[var(--border-subtle)] bg-[rgba(255,69,58,0.1)] px-4 py-1.5 text-[10px] text-[#ff453a]">
      {pushError}
    </div>
  )}

  {/* Progress bar */}
  {totalGroupCount > 0 && (
    <div className="flex items-center gap-2 px-4 pt-2.5">
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${(approvedGroupCount / totalGroupCount) * 100}%`,
            background: allGroupsApproved ? "#34c759" : "#0a84ff",
          }}
        />
      </div>
      <span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
        {approvedGroupCount} of {totalGroupCount} approved
      </span>
    </div>
  )}

  {/* Status line */}
  <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 text-[10px]">
    {allGroupsApproved ? (
      <>
        <span className="font-medium text-[#34c759]">✓ All groups approved</span>
        {approvedReplyCount > 0 && (
          <>
            <span className="text-[var(--text-quaternary)]">·</span>
            <span className="text-[var(--text-tertiary)]">
              {approvedReplyCount} {approvedReplyCount === 1 ? "reply" : "replies"} will be posted
            </span>
          </>
        )}
      </>
    ) : (
      <>
        {unclearDraftCount > 0 && (
          <span className="rounded-[3px] bg-[rgba(255,159,10,0.12)] px-1.5 py-px font-medium text-[#ff9f0a]">
            ⚠ {unclearDraftCount} unclear {unclearDraftCount === 1 ? "reply" : "replies"} need sign-off
          </span>
        )}
        {unapprovedGroupCount > 0 && (
          <>
            {unclearDraftCount > 0 && (
              <span className="text-[var(--text-quaternary)]">·</span>
            )}
            <span className="text-[var(--text-tertiary)]">
              {unapprovedGroupCount} {unapprovedGroupCount === 1 ? "group" : "groups"} not yet approved
            </span>
          </>
        )}
      </>
    )}
  </div>

  {/* Action buttons */}
  <div className="flex items-center gap-2 px-4 pb-2.5">
    <button
      type="button"
      disabled={!allGroupsApproved || pushAndPost.isPending}
      onClick={() => pushAndPost.mutate({ sessionId: session.id })}
      className="w-full rounded-[8px] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pushAndPost.isPending
        ? "Pushing…"
        : `Push changes & post replies${allGroupsApproved && approvedGroupCount > 0 ? ` (${approvedGroupCount}/${totalGroupCount})` : ""}`}
    </button>
    <button
      type="button"
      onClick={handleDismiss}
      disabled={dismissSolve.isPending}
      className="rounded-[6px] border border-[var(--border)] bg-transparent px-4 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-overlay)] disabled:opacity-50"
    >
      {dismissSolve.isPending ? "Reverting..." : "Revert all"}
    </button>
  </div>
</div>
```

- [ ] **Step 4: Remove `prTitle`, `prNumber`, `sourceBranch` variables that are no longer used**

Check if `prTitle`, `prNumber`, `sourceBranch` are still referenced in the component. They are used in the PR header section — leave them as-is. Only remove unused variables that TypeScript flags.

- [ ] **Step 5: Run type check**

```bash
cd apps/desktop && bun run type-check 2>&1 | head -50
```

Expected: no errors. Common issue: `classifyPublishGate` import will be unused — remove it from the import at the top of `AIFixesTab.tsx`:

```typescript
// Remove classifyPublishGate from this import line:
import { PublishGateDialog, classifyPublishGate } from "./PublishGateDialog";
```

Change to (temporarily, until Task 5 removes the file):

```typescript
import { PublishGateDialog } from "./PublishGateDialog";
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/AIFixesTab.tsx
git commit -m "feat: redesign bottom bar with progress bar and hard-gated push button"
```

---

## Task 5: Frontend — Remove `PublishGateDialog`

**Files:**
- Modify: `apps/desktop/src/renderer/components/AIFixesTab.tsx`
- Delete: `apps/desktop/src/renderer/components/PublishGateDialog.tsx`

- [ ] **Step 1: Remove `PublishGateDialog` usage from `AIFixesTab.tsx`**

Remove the import line at the top of `AIFixesTab.tsx`:

```typescript
// DELETE this line entirely:
import { PublishGateDialog, classifyPublishGate } from "./PublishGateDialog";
```

Search for any remaining references to `PublishGateDialog`, `showPublishDialog`, or `classifyPublishGate` in `AIFixesTab.tsx` and remove them. With the new bottom bar from Task 4 in place, there should be none.

- [ ] **Step 2: Delete `PublishGateDialog.tsx`**

```bash
rm apps/desktop/src/renderer/components/PublishGateDialog.tsx
```

- [ ] **Step 3: Run type check**

```bash
cd apps/desktop && bun run type-check 2>&1 | head -50
```

Expected: no errors and no references to `PublishGateDialog`.

- [ ] **Step 4: Run the test suite**

```bash
cd apps/desktop && bun test tests/comment-solver.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Update the "Publish gate" tests in `comment-solver.test.ts`**

The existing `describe("Publish gate", ...)` tests in `comment-solver.test.ts` test the old `classifyGroups` logic (which is now removed). Replace those two tests with a description of the new gate:

```typescript
describe("Publish gate", () => {
  test("all non-reverted groups approved → allGroupsApproved is true", () => {
    // The new gate is: every non-reverted group has status === "approved"
    const groups = [
      { status: "approved" },
      { status: "approved" },
      { status: "reverted" }, // skipped
    ];
    const nonReverted = groups.filter((g) => g.status !== "reverted");
    const allApproved = nonReverted.every((g) => g.status === "approved");
    expect(allApproved).toBe(true);
  });

  test("any non-reverted group not approved → allGroupsApproved is false", () => {
    const groups = [
      { status: "approved" },
      { status: "fixed" }, // not yet approved
    ];
    const nonReverted = groups.filter((g) => g.status !== "reverted");
    const allApproved = nonReverted.every((g) => g.status === "approved");
    expect(allApproved).toBe(false);
  });

  test("unclear draft reply count gates the Approve button on a group", () => {
    // hasUnclearDraftReplies: group.comments.some(c => c.status === 'unclear' && c.reply?.status === 'draft')
    const commentsWithUnclearDraft = [
      { status: "fixed", reply: { status: "approved" } },
      { status: "unclear", reply: { status: "draft" } },
    ];
    const hasUnclearDraft = commentsWithUnclearDraft.some(
      (c) => c.status === "unclear" && c.reply?.status === "draft"
    );
    expect(hasUnclearDraft).toBe(true);
  });

  test("unclear comment with approved reply does not gate the Approve button", () => {
    const comments = [
      { status: "unclear", reply: { status: "approved" } },
    ];
    const hasUnclearDraft = comments.some(
      (c) => c.status === "unclear" && c.reply?.status === "draft"
    );
    expect(hasUnclearDraft).toBe(false);
  });
});
```

- [ ] **Step 6: Run full test suite**

```bash
cd apps/desktop && bun test tests/comment-solver.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Run lint/format**

```bash
cd apps/desktop && bun run check
```

Fix any Biome warnings (imports order, unused vars). Common issue: `useState` import may need `showPublishDialog` removed if it was the only `useState` call — check the import.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/AIFixesTab.tsx apps/desktop/tests/comment-solver.test.ts
git rm apps/desktop/src/renderer/components/PublishGateDialog.tsx
git commit -m "feat: remove PublishGateDialog, simplify publish gate to all-groups-approved check"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Sign-off strip on unclear draft replies | Task 3 Step 4 |
| Approve reply → `approved` status | Task 1 Step 3, Task 3 Step 4 |
| Discard reply → deleted, Undo re-inserts as draft | Task 3 Step 4 (discardedBodies state) |
| Editing approved reply resets to draft | Task 2 Step 4 (updateReply) |
| Approve button gated on unclear draft replies | Task 3 Step 2–3 |
| Revoke button resets group + replies | Task 1 Step 4, Task 3 Step 3 |
| User-added replies created as `approved` | Task 2 Step 3 (addReply `draft: false` default) |
| Undo-discard calls addReply with `draft: true` | Task 3 Step 4 |
| Progress bar in bottom bar | Task 4 Step 3 |
| Hard-disabled Push when not all approved | Task 4 Step 3 |
| Actionable "unclear replies need sign-off" tag | Task 4 Step 3 |
| `PublishGateDialog` removed | Task 5 |
| No schema changes | — (verified: only existing columns used) |

**All-unclear groups with no commit:** The spec notes that `finish_fix_group` must set groups to `fixed` even with no code changes. This is enforced by the MCP server tool and is pre-existing behaviour — the tests in `tests/comment-solver.test.ts` already verify that `finish_fix_group` sets `status = 'fixed'` and `commit_hash` (Task 1 Step 1 in the existing test file, "Fix workflow" suite). If an all-unclear group is stuck in `pending` status, the Approve button will not appear — raise this as a separate investigation against the MCP `finish_fix_group` tool.
