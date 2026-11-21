# Saved-answer continuation — answer lane

Implemented against activity-queue@652148fb with the shared safe-resume transport. Parent owns final integration and actual-provider verification.

## Behavior

- `workspaceAnswerAndContinue` saves or reuses the exact valid persisted answer, then delegates to the shared guarded continuation transport. Its result keeps answer persistence separate from submitted/uncertain/received continuation.
- Fresh saves remain trimmed and limited to 16,000 characters. Continuing an already-saved outside answer preserves its exact raw whitespace/content. A deterministic JSON text envelope escapes terminal control and bidi characters without changing the decoded answer. The encoded prompt is bounded to 56,000 bytes; the shared transport separately checks its complete socket frame before reserving delivery. Nothing is truncated.
- Save-only remains explicit. Send & continue is the primary control; already-saved answers expose Continue with saved answer. Queue view, peek and matching-chat bar use the same connected actions. Drafts retain full source/group receipts and target identity.
- A missing or uncertain response locks its original request. Check continuation status and polling are read-only, including when saving itself was not confirmed. Late status results cannot replace a newer request or downgrade received evidence. Definite failure retains the saved answer and permits an explicit new attempt.
- Matching accepted prompt digests retrieve only the selected answer after rechecking entity, terminal, conversation, sender, current persisted content and uniqueness. Mere save, wake or terminal admission does not retrieve it. Outside retrieval can make continuation not-needed; edited or conflicting answers preserve attention.
- Another pending question or permission blocks automatic continuation before the UI offers it. Multiple valid answers also require review. No implicit answer bundling, invented ownership or retrieval of another question is performed. Save-only/Open remains available for these cases and legacy daemons.

## Verification

- **63 pass / 474 assertions** across `queue-answer-router`, `queue-answer-continuation`, `queue-answer-envelope`, `queue-answer-continue-ui`, and existing `queue-question-reply` tests. [Log](focused-tests.txt).
- The public-router tests exercise real main services, durable delivery rows, `QueueDeliveryAdmission` and `AgentSessionManager` digest handling. Both providers × repo/worktree, folder, repository orchestrator and coordinator × live/sleeping modes pass. The daemon lease/write and physical lifecycle are controlled seams; this is not a live-provider Cartesian matrix.
- Race coverage includes duplicate/concurrent requests, saved answers from outside the queue, wrong recipient/older answer rows, read during admission, loss after daemon commit, unprojected new questions, competing valid answers, later answer edits, received-status ordering and unknown receipt lookup. The unprojected-question and competing-answer tests first failed with actual writes, then passed after backend guards. [First red](unprojected-question-red.txt), [second red](competing-answer-red.txt).
- **Native UI pass, 3.86 seconds:** actual production `QueueQuestionReply`, connected tRPC hook, public router, Electron preload/IPC, native SQLite and real SQL admission. Controlled daemon/provider callbacks explicitly stand in for PTY and models. It checks live/resume modes, exact digest retrieval, sibling isolation, retained saved answer through a busy rejection and explicit retry without duplicate answer. Two pending questions remain intentionally unhandled. [Result](native-result.json), [image](native-answer.png), [log](native-test.txt).
- Native UI evidence preceded the final additional compatibility/ambiguity guards; those are covered by the final focused suite. Parent independently tests actual providers and the final integrated tree. This lane does not claim real MCP question creation, whole installed-app restart or real provider inference from its native controlled fixture.
- Production desktop build passed before the final narrow ambiguity/compatibility guards; the parent rebuilds the final integrated tree. Main and renderer checks matched the prior 61/81 diagnostic counts with no owned-path errors. Tests matched the existing 216 diagnostic baseline after test-only corrections. Repository-wide type checks are not globally clean. [Build log](build.txt).
- Biome changed-owned paths has no errors; existing non-null assertion warnings in tests remain. Graphify hooks ran and reported the known absent module; no install or hook bypass was used.

## Reproduce

From `apps/desktop`:

```sh
bun test tests/queue-answer-router.test.ts tests/queue-answer-continuation.test.ts tests/queue-answer-envelope.test.ts tests/queue-answer-continue-ui.test.tsx tests/queue-question-reply.test.tsx
bun run build
SS_QUEUE_ANSWER_NATIVE=1 SS_KEEP_QUEUE_FIXTURE=1 bun test tests/queue-answer-native.test.ts
```

The native test requires the exclusive GUI slot; it uses isolated app data and prevents physical keyboard input because actions are DOM-driven. [Commit manifest](commits.json) separates owned changes from dependency cherry-picks. No user chat, lockfile, global provider policy, app lifecycle, push or release was changed by this lane.
