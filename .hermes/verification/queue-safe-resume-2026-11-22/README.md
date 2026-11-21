# Guarded Queue resume and continuation transport

Base: `652148fb`. This lane supplies daemon/main transport and lifecycle; answer UI/service and real provider GUI probes are coordinated by the parent.

## Supported path

Trusted app launch descriptors retain provider policy arguments, exact conversation, native process identity and binary identity. Per-command launch identity admits a pending descriptor only from its intended launch. Ordinary own chats remain unmanaged, so they never steal an orchestrator's managed dispatch target. The non-secret `queueLaunchKnown` marker survives app restarts; actual arguments and environment remain memory-only. Missing metadata never downgrades a known launch to an unverified shell command.

Sleep preparation pins the clean prompt/input boundary and native process. The daemon validates current ownership/state under an IMMEDIATE SQLite lock before signalling the exact foreground group. Changed input, process, callbacks or provenance block sleeping. A directly resumed root process returns to a retained shell without closing its logical terminal; parked-shell readiness is bounded and rechecked.

Queue resume validates original source/group receipts and a durable one-shot intent under the database lock. It creates only the exact replacement process with direct executable/argv, preserving terminal ID, cwd, dimensions, replay and subscribers. It kills only the proven retired empty shell. Post-spawn publication failures remain uncertain. A matching initial argv prompt digest establishes later live-reply readiness; view-only wake does not invent prompt consumption.

Answer-bound intents also validate authoritative question/answer rows under the lock, including retrieval and ambiguity races, not only lazily projected queue rows. A separate `queue-answer-v1` capability prevents old daemons from advertising unsupported continuation. The answer lane owns saved-answer semantics and accepted-prompt retrieval reconciliation.

## Environment privacy

`terminal-process-info <pid>` remains identity-only. Its separate `--environment` mode snapshots a same-user, start-time/executable-verified process exec environment. The daemon uses this snapshot for resumed providers and keeps the original shell environment for parked shells. No environment goes to SQLite, file-result/list IPC, provider-event callbacks, UI or logs. Empty, protected or unreadable snapshots fail closed. A synthetic native test checks auth/config markers, argv exclusion and the default identity-only response without inspecting or printing real credentials.

## Evidence

- 67 focused tests / 368 assertions passed before the environment-only refinement: manager gates, prior delivery matrix, pure resume guards, mocked PTY replacement/park/replay/failure paths and actual native SQLite writer exclusion.
- 19 environment/replay/guard tests / 139 assertions passed after refinement, including an actual native helper + PTY with synthetic environment.
- Main TypeScript remains at 61 existing diagnostics, with no diagnostics in changed owned paths.
- Parent reported real Claude and Codex repeated sleep→Queue-resume/new-reply cycles passing. Codex promptless resume defers SessionStart until actual input; transcript/native-provider verification and a subsequent manual prompt prove view-only resume without inventing a callback.
- Mock PTY tests are explicitly not real provider evidence. Parent owns final build, native UI and integration acceptance.

## Deliberate fallbacks

Arbitrary shell commands/Quick Actions and legacy sessions without trusted policy metadata are not inferred as app-owned. Unknown foregrounds, drafts, old daemon capabilities, changed executable identity and unsupported environment inspection refuse guarded automatic resume. Complete daemon loss cannot recover secret launch metadata from the database; it refuses policy-dropping fallback. Platform support follows native identity/environment inspection (macOS for this delivery).

Owned source commits: `afe66a5c`, `0ea5b907`, `438a0d45`, `e654f58b`, `89182579`. Reviewer test commit: `a84d70ff`. Dependency cherry-picks: answer `a65d133d`→`92fa11b9`, `624c4982`→`d89d0f27`; parent launch bridge `d424ad12`→`ea70eb63`, `423738fa`→`49368244`; answer capability source `d1421583`→`c3794824` (router test stays with its owner).

No push/release, user app termination or user lockfile modification. Graphify commit hook attempted its rebuild; the optional module is unavailable.
