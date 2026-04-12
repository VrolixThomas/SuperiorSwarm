# Unclear Comment Sign-off Flow

**Date:** 2026-04-12
**Branch:** refine-comment-solver-flow

---

## Problem

When the AI solver marks a comment `unclear`, it writes a draft reply explaining its interpretation and asks the reviewer for clarification. The current UI has no way to approve or discard that reply — only Edit and Delete. This causes four compounding failures:

1. **Hard publish block** — `pushAndPost` requires all groups `approved` and zero `draft` replies. All-unclear groups have neither an Approve button nor a path to clear their draft replies, so publishing is permanently blocked.
2. **No revoke** — once a group is approved there is no way to undo it, trapping users who want to change a reply before pushing.
3. **Frontend/backend mismatch** — `classifyPublishGate` treats all-unclear groups as exempt from reply validation, but the backend does not. The Push button appears enabled then throws a server error on click.
4. **Unactionable messaging** — "1 needs your input" in the bottom bar gives no indication of what to do or where to go.

---

## Design: Inline Sign-off Strip

### Core principle

A small approve/discard strip appears directly below every AI draft reply on an `unclear` comment. Handling the reply (approve or discard) is the prerequisite for approving the group. Group approval is the prerequisite for publishing. The state machine is linear and the UI enforces it without modals or hidden server errors.

---

## Reply-level behaviour

Each draft reply on an `unclear` comment shows a sign-off strip beneath the reply body:

```
Post this reply?   [Discard]  [✓ Approve]
```

| Action | What happens |
|--------|-------------|
| **Approve reply** | Reply `status` → `approved`. Strip replaced with a green "✓ Reply approved" label and an Undo link. |
| **Discard reply** | Reply deleted from DB. Replaced with a muted "Reply discarded — nothing will be posted" label and an Undo link. Undo re-inserts the original body (held in component state — not refetched) as a new `draft` reply. Body is lost if the user navigates away before undoing. |
| **Edit reply** | Opens inline textarea (existing behaviour). Saving resets an already-approved reply back to `draft`, re-showing the strip. |

The sign-off strip and Approve gating apply **only to draft replies on `unclear` comments**. Draft replies on `fixed` comments (user-added via the Reply textarea) are created with `status: "approved"` immediately — the act of writing and saving a reply is treated as implicit approval. These use the existing Edit/Delete controls and do not gate the group.

---

## Group-level behaviour

### Approve button gating

The `Approve` button on a group is disabled (greyed, tooltip: "Resolve unclear replies first") when any **`unclear` comment** in the group still has a `draft` reply. Once all such replies are `approved` or deleted, the button activates.

This applies to both all-unclear groups and mixed groups (some fixed, some unclear). Draft replies on fixed comments in the same group do not gate the button (they are created `approved` already — see above).

### Revoke

After a group is approved, the `Approve` button is replaced by a `Revoke` button. Revoking:
- Sets group `status` back to `fixed`
- Sets all `approved` replies in that group back to `draft`
- Re-shows the sign-off strip on each affected comment

This gives users a clean escape hatch if they want to re-read or change a reply before publishing.

### Group status for all-unclear groups

Groups where all comments are `unclear` must still reach `fixed` status after the solver completes (implementation must verify that `finish_fix_group` always sets `fixed`, even with no code changes / empty commit). Without `fixed` status the Approve button cannot appear.

---

## Bottom bar

Replaces the vague "X draft replies ready · Y needs your input" with structured, actionable status:

**Blocked state:**
```
[progress bar — 7 of 12 approved]
⚠ 1 unclear reply needs sign-off  ·  4 groups not yet approved
[Push changes & post replies]  (disabled)     [Revert all]
```

**Ready state:**
```
[progress bar — 12 of 12 approved ████████████]
✓ All groups approved  ·  7 replies will be posted
[Push changes & post replies (12/12)]          [Revert all]
```

The Push button is hard-disabled whenever any group is not yet approved. No soft-block dialog, no silent server errors.

---

## Backend changes

### New endpoints

| Endpoint | Input | Effect |
|----------|-------|--------|
| `commentSolver.approveReply` | `{ replyId }` | Sets `commentReplies.status` → `approved` |
| `commentSolver.revokeGroup` | `{ groupId }` | Group → `fixed`; all `approved` replies in group → `draft` |

`discardReply` is the existing `deleteReply` endpoint — no change needed.

### `pushAndPost` validation — unchanged

The server-side validation (no `draft` replies, all groups `approved`) stays exactly the same. The UI flow now guarantees this state before the button is enabled, so the validation becomes a safety net rather than a user-facing error.

### Remove `PublishGateDialog` soft-block

`classifyPublishGate` / `PublishGateDialog` can be removed or simplified to a single check: "are all groups approved?" The nuanced soft-block logic that was inconsistent with the backend is no longer needed.

---

## Schema — no changes

`commentReplies.status` already supports `draft` and `approved`. Discard uses delete. No migrations needed.

---

## Files affected

| File | Change |
|------|--------|
| `src/renderer/components/AIFixesTab.tsx` | Sign-off strip component; gated Approve; Revoke button; new bottom bar |
| `src/renderer/components/PublishGateDialog.tsx` | Remove soft-block logic (or delete file) |
| `src/main/trpc/routers/comment-solver.ts` | Add `approveReply`, `revokeGroup`; change `addReply` to create replies as `approved` |
| `src/main/ai-review/comment-solver-orchestrator.ts` | `revokeGroup` implementation |
| `src/shared/solve-types.ts` | Verify `SolveReplyStatus` includes `approved`; no new types expected |

---

## Out of scope

- Changing how the AI solver decides what is "unclear" (prompt changes)
- Bulk approve all groups
- Any changes to the `fixed` → `submitted` flow for groups that are not unclear
