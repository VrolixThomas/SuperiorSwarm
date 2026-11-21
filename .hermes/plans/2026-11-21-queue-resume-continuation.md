# Safe queue resume and saved-answer continuation

Continuation of SUP-45 from activity-queue@652148fb. The user authorized continuing the two explicit remaining capabilities. Preserve their existing bun.lock; external queue intake stays deferred.

## Ownership

- Codex safe_resume: structured daemon process replacement, exact lifecycle/admission guards, launch policy, shared transport/ledger and conversation reply integration.
- Codex answer_continue: saved-answer continuation service, question ownership/retrieval, router and UI.
- Codex resume_review: read-only lifecycle and integration review.
- Parent: shared contract review, real provider sleep/resume fixture, independent integration and final merge.

SuperiorSwarm MCP is unavailable this turn; collaborators use isolated local worktrees. No user conversation, global approval policy, or running installed/dev app is changed for tests.

## Required behavior

1. Resume the exact sleeping provider conversation using a structured executable/argv launch, never a string typed into a retained shell. Retain the logical terminal and its siblings, cwd, callbacks and approved launch policy. Unknown policy/capability must remain explicit and safe.
2. Same-terminal process replacement preserves subscriptions and history, rejects typing/busy/replaced ownership races, and does not let the old process exit remove the replacement. Verify repeated sleep/resume, not only the first restart.
3. Durable admission is claimed before side effects. Retry, concurrent calls, daemon loss and spawn failure preserve at-most-once behavior and truthful unavailable/rejected/uncertain/received results.
4. Saving an answer and continuing are separate outcomes. Use the exact persisted answer/question/recipient; acceptance of a matching provider prompt or explicit inbox retrieval can mark the answer retrieved. Saving, waking and terminal admission alone cannot.
5. New questions/reports and sibling work survive. Viewing and mere wake-up never acknowledge. Changed receipts are not silently rebased.
6. Verify both Claude and Codex across repo/worktree, folder, repo orchestrator and coordinator using controlled production-state tests, plus real provider/native resume checks with isolated synthetic conversations where available.
7. Keep Save-only/Open recovery clear. Any partial success must explain exactly what succeeded and preserve the answer/draft without duplicating sends.
