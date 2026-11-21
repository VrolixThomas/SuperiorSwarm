# Dispatched-task queue lifecycle verification — 2026-11-21

Scope: direct input outside the queue, opening/reading without action, typing before submission, wake-to-read, subsequent attention, and exact question answers. This is a targeted lifecycle fix, not completion of the entire queue redesign.

## Implemented behavior

- A validated new UserPromptSubmit from the exact registered managed session moves an old done/blocked workspace report back to working and clears its stale needs/status text. Sibling terminals and other workspaces cannot do this.
- Actual accepted provider activity resolves session attention. Optimistic running/resuming states caused by typing or wake do not.
- Same-session SessionStart/resume preserves attention until an actual prompt or tool event follows.
- Claude prompt_id is normalized into turn identity; replayed prompts from already observed turns cannot clear later attention.
- Precise report time is retained in the durable queue snapshot to reject delayed input that predates a newer report, including within one second and after reopening SQLite.
- A question resolves only through a correlated answer addressed to its asker (or a readable project broadcast), from the same project and no earlier than the question. Ordinary chat input does not invent a structured answer.
- Opening and typing never acknowledge. Existing exact-revision Handle behavior remains.

## Verification

- 88 focused tests pass across queue sources/current inventory/storage, panel/live rendering, and hook bridge/listener/setup suites.
- 15 agent-session-manager, 22 workspace-service, and 17 coordination tests pass.
- Native Electron integration passes: Chromium text insertion -> production preload terminal.write -> IPC before-input handling -> real PTY -> isolated provider stand-in -> generated production hook bridge -> authenticated listener -> session manager -> native SQLite -> production tRPC -> rendered queue. Both Codex turn_id and Claude prompt_id payloads are exercised.
- Native scenarios include done and blocked reports, open without action, text before Enter, direct submit without queue action, fresh later completion, database reopen, wake-to-read via production terminal.setVisible, stale Stop, exact-revision handling, and attach-only race.
- Desktop production build passes. Biome check passes for changed files. git diff --check passes.
- Type checks match clean HEAD baseline: 61 main, 0 preload, 81 renderer, 203 test diagnostics; no new diagnostics after normalizing resolved absolute paths.
- Graph rebuild attempted but unavailable: Python graphify module is not installed.

## Limits

The native provider stand-ins are deliberate fixtures, not authenticated Codex/Claude sessions. Live provider emission, missing callbacks, globally shared bridge replacement between builds, nested CLI session takeover, cross-repo coordinator entity support and new in-queue reply execution remain separate backend work. No real user chat input, global hook configuration or live app data was changed. The existing user bun.lock change was preserved.

Logs from this run: /tmp/queue-lifecycle-tests.log, /tmp/queue-session-regression.log, /tmp/queue-workspace-regression.log, /tmp/queue-coordination-regression.log, /tmp/queue-lifecycle-native.log, /tmp/queue-lifecycle-build.log, /tmp/queue-types-delta.json.
