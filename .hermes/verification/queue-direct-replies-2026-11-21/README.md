# Exact Queue conversation replies — Lane A

Status: direct free-form replies and permission/action wiring implemented; safe hibernated resume and optional automatic continuation after a saved structured answer remain unsupported. No push or release.

## Delivery boundary

`workspaceReplyCapability` is read-only. `workspaceReply` carries the displayed source/group receipts, content, and a stable request ID. Main revalidates the exact entity, terminal, provider and provider conversation. The daemon requires a native provider foreground and an identified prompt/idle pair with no unaccounted terminal input. Input submission boundaries are paired FIFO; typing, queued drafts, multiple CRs in a batch, process changes, shell/runtime foreground, busy state, fresh questions/permissions, replaced owners and stale/group-expanded receipts fail closed. Provider slash commands and `!` shell shortcuts require Open.

The daemon persists uncertainty before handoff, then takes an IMMEDIATE SQLite transaction for source/session validation and the one-shot bracketed-paste handoff. A native Electron/better-sqlite3 two-connection WAL test proves another writer cannot commit between validation and that handoff. A durable occurrence key prevents concurrent/different-ID duplicates. Definite rejection permits an explicit new attempt; an uncertain request never becomes an automatic resend. `workspaceReplyReceipt` is a separate read-only recovery query, including when the original request never reached main.

An admitted PTY write does **not** acknowledge sources, confirm model consumption, or claim work completion. A received receipt requires an actual exact-conversation UserPromptSubmit digest matching the persisted content hash. Prompt plaintext is not persisted by this ledger. Unknown/mismatched prompts never become received. A distinct cleanup-only guard protects one missing-digest turn, separately from delivery evidence; later manual turns can clean normally. A matching delayed prompt cannot clear a report newer than the original intent.

QueuePanel, QueueItemActions (jump/peek), and the public activityQueue router share these actions. Drafts keep their original group/target, uncertain input stays locked, and read-only receipt polling upgrades displayed evidence. Permission capability polling updates cancellation/expiry without a source revision. Explicit Open releases an exact active permission wait before attach-only navigation; selecting/viewing does not decide or dismiss anything. Parent owns the pure permission expiry timer; lane C owns the provider decision channel and visibility handoff.

## Verification

- New source/admission/UI checks cover duplicate/concurrent/reconnected requests, native WAL locking, lost response, explicit rejected retry, queued input/draft races, later source/group changes, digest mismatch and sibling rejection, bounded unknown cleanup, and stable-item permission capability updates.
- Controlled delivery matrix: Claude and Codex × repo/worktree, folder, repository orchestrator and cross-repository coordinator. Every cell checks exact owner delivery, untouched sibling receipt, retained identity and a fresh later occurrence. This is composed DB/daemon proof, not eight live-provider TUI cases.
- Existing regression groups: 128 source tests / 2,857 assertions; 44 UI tests / 177 assertions; 149 daemon/legacy-file tests / 455 assertions. These are separate focused invocations, not a claim that the known-flaky whole suite is clean.
- Main TypeScript: 61 diagnostics; renderer: 81, matching the clean integration baseline supplied by parent, with no new changed-path diagnostics. Build passes. Biome changed paths has no errors; existing/non-null test warnings remain.
- Graphify rebuild attempted and failed with the known missing module. It was not installed; normal commit hooks were not bypassed.

### Actual providers, separate from stand-ins

The native fixture builds against production main/preload/QueueView code, creates isolated Electron profile/SQLite/socket/PTY state, runs the **interactive provider TUI**, submits through the actual Queue reply control/public router, and inspects native process identity. It does not use the old readline print/exec adapter. DOM-driven controls and a minimal terminal protocol responder are fixture seams; this is not a physical keyboard or whole shipped bootstrap claim. Physical input to the fixture window is prevented to avoid accidental queue shortcuts while it is activated.

Claude 2.1.327: passed an actual initial turn, Queue reply, matching provider prompt digest and actual `QUEUE_TUI_FOLLOWUP` assistant evidence in the same provider session. The fresh synthetic session had built-in tools disabled and used an existing trusted checkout after a temporary-folder trust gate was encountered. No existing conversation or global trust setting changed. See [result](claude-result.json) and [follow-up Queue](claude-after.png).

Codex 0.170.0: passed the strengthened actual TUI test (42.19 seconds under machine load): matching prompt receipt, actual new assistant reply, same conversation and exactly two distinct accepted prompt turns. See [result](codex-result.json), [initial Queue](codex-before.png), and [follow-up Queue](codex-after.png). Synthetic hooks use a read-only hooks/list catalog and exact invocation-only hashes; other hooks/MCP servers are disabled for that invocation. The provider runs read-only, approval on-request, and without the shared daemon. No fragile approval keystrokes or trust bypass is used.

Earlier diagnostic attempts are not counted as passes: Claude temporary-folder trust gate; oversized synthetic Codex shell launch (fixed via a short script invocation); unsupported exec-only CLI flags on TUI; catalog/TUI project-trust scope mismatch; unexpected native Done before send; and a fixture completion predicate that counted duplicate initial Stop hooks. The final fixture requires matching new assistant reply evidence, a received digest receipt, same provider session and exactly two distinct accepted prompt turns.

## Capability gaps

- Hibernated reply/resume is **not implemented** by this lane. Existing `AgentSessionManager.wake` only sends a queued shell command; `defaultRespawnAgent` destroys all workspace terminals; `PtyManager.create` only creates a new shell. None provides safe same-terminal structured process launch/admission. Open remains available. A separate guarded launch/lifecycle protocol is needed; no provider or sibling fallback was introduced.
- Saved structured inbox answers retain the existing explicit saved/retrieved semantics. Automatic Send-and-continue is not offered without a safe continuation transport. Existing tests remain green.
- Legacy daemons, unobserved prompt/idle generations, non-native runtimes, unsupported platforms/foregrounds and ambiguous input use Open. Current native identity inspection is macOS-specific. Real provider API-error UI, full process restart/hibernation and external concurrent provider submissions are not established by the live success cases.
- Exact matching prompt evidence confirms accepted text, not comprehension, successful requested work or permission execution.

## Reproduction

From `apps/desktop`, after `bun run build` and with an explicitly reserved exclusive GUI slot:

```sh
bun test tests/queue-conversation-admission.test.ts tests/queue-conversation-replies.test.ts tests/queue-conversation-reply-ui.test.tsx tests/queue-delivery-native.test.ts
bun test tests/queue-permission-open.test.ts tests/queue-permission-actions.test.tsx
SS_QUEUE_REPLY_TUI=1 SS_QUEUE_NATIVE_CASES=claude SS_QUEUE_TRUSTED_CWD=<existing-trusted-checkout> bun test tests/queue-reply-tui.test.ts
SS_QUEUE_REPLY_TUI=1 SS_QUEUE_NATIVE_CASES=codex bun test tests/queue-reply-tui.test.ts
```

The fixture retains its temporary profile and result/trace/screenshots for audit. Never point it at an existing user conversation. Temporary dependency symlinks to the parent installation are removed at handoff; no lockfile change is required.

## Local commits and self-review

[Commit manifest](commits.json) separates owned changes from cherry-picked parent/B/C dependencies. The later fixture/evidence and CLAUDE.md index commits are reported in the handoff. Parent performs independent integration checks; this is not a release-readiness declaration.

Self-evaluation: accuracy **4/5** (real provider and native SQLite evidence; full restart/failure UI remains unverified), completeness **2/5** (safe hibernated resume and automatic saved-answer continuation remain absent), clarity **4/5** (delivery stages and fixture limits are explicit), actionability **4/5** (local commits, commands, tests and screenshots are available; new resume protocol still needed), conciseness **4/5** (evidence is separated from the short handoff). Overall **3.6/5**. Highest-impact improvement: implement and independently verify a structured same-terminal resume protocol before calling the whole requested scope complete. The user would reasonably regard this as a tested supported-path deliverable with those material gaps, not all four functions finished without qualification.
