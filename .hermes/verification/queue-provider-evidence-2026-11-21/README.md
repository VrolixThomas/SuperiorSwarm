# Lane B — provider evidence and transitions

Codex implementation and isolated verification, 2026-11-21. No subagents. Original investigation artifacts remain unchanged. This directory contains only synthetic provider output and selected lifecycle metadata; no auth material or existing conversation text.

## Result and explicit limitation

The bridge admits bounded plain-text assistant replies, permission-request fields, and provider error details with field/provider/event provenance. It strips terminal/bidi controls and common credential patterns, marks truncation/redaction, never reads transcripts, and does not import prompts or arbitrary tool arguments/results. Admission is capped at 4096 characters per callback; durable combined evidence at four 1024-character entries. Credential redaction is best effort, not a guarantee that arbitrary natural language contains no private information.

Permission requests survive Stop and uncorrelated tools. A request starts `pending`; after activity/end without a provable outcome it becomes `unconfirmed`, described as an unknown outcome rather than another demand to approve. Only an explicitly matching request ID can carry an allowed/denied/cancelled outcome. An accepted new prompt or bound working report is an explicit continuation, not proof that the permission was granted. StopFailure is durable turn state and survives generic Stop/tool/compaction callbacks until continuation.

**Automatic positive-permission resolution remains limited.** The live approved Claude probe performed PermissionRequest → narrowly scoped allow → actual isolated HTTP/SQLite set_status → PostToolUse → Stop. The request payload had neither `permission_request_id` nor `tool_use_id`; PostToolUse had a tool ID but no correlated permission outcome. The queue therefore records outcome **unconfirmed**. This is an observed provider-metadata limitation, not passing automatic permission cleanup. No tool-name/arrival-order inference was added. See `live-claude-approved-request-diagnostic.json` and `claude-hook-fields.jsonl`. The [official Claude hooks reference](https://code.claude.com/docs/en/hooks#permissionrequest-input) documents the missing request tool ID; its [StopFailure schema](https://code.claude.com/docs/en/hooks#stopfailure-input) documents admitted error_details and rendered error text.

## Ordering and receipts

Bridge invocation/receipt times are not stable event identity or provider ordering. Real provider event IDs deduplicate; provider timestamps reject older observations. Neither an unseen event ID nor missing turn identity may establish a new turn against existing state. Untagged replay after explicit continuation leaves zero pending items; uncertainty is retained in the source snapshot. Existing pending attention can remain marked uncertain. A later genuinely identified prompt/completion appears normally.

`transitionAgentEvent` returns normalized attention, snapshot, semantic fingerprint and `preserveRevision`. Callers preserve the existing fingerprint/closed candidate on semantic duplicates, including older v2 snapshots. Uncertainty-only pending→unconfirmed/ordering changes do not invalidate Done/Later. Evidence and real failure changes do create new revisions. SQLite/manager tests acknowledge a failure, deliver Stop/compaction/missing-turn replay, and prove zero pending with the exact receipt retained; a new turn then reappears.

## Coverage

- **Unit/SQLite acceptance:** hook/listener/evidence/transition tests plus actual isolated SQLite/manager receipt tests. Integration matrix and ownership tests run with lane A dependencies. Final focused integration run: **107 passed, 0 failed, 503 assertions**. See `acceptance.log` and `unit.log`.
- **Live Claude:** current isolated bridge, actual initial question and same-session reply text (`Which color: amber or blue?`, `COLOR_BLUE_DONE`), actual isolated MCP write. A second probe approves only the exact synthetic blocked-status action, once, through a fixture-only permission hook; it demonstrates the positive-outcome metadata limitation above.
- **Live Codex:** authenticated actual session/turn hooks, permission-blocked MCP attempt with **no status HTTP write**, preserved unconfirmed attention, and same-conversation follow-up. Uses only existing reviewed global hook trust; the global bridge is older. New Codex evidence transport is therefore stand-in-tested, not authenticated-live-proven.
- **Native stand-ins:** after desktop build, native Electron fixtures from apps/desktop exercise isolated native SQLite/socket/PTY/preload/tRPC/Chromium. The lifecycle fixture now binds managed reports to their reporter and asserts PermissionRequest→Stop retains input attention. Both fixtures passed after the final desktop build. These are provider stand-ins, not an authenticated launch-to-GUI proof.
- **Unverified:** full authenticated production dispatch/UI, automatic permission-resolution correlation without provider metadata, actual provider API-error execution, and new Codex bridge transport under provider trust. Matched explicit outcome handling is unit-tested only.

The opt-in harness records provider behavior; a passing capture run does not convert its expressly limited positive-permission cell into product acceptance. `preintegration-*` retains the expected failure before lane A wired the production transition helper.

## Reproduction and constraints

From apps/desktop with compatible dependencies available:

```sh
bun test tests/agent-evidence-persistence.test.ts tests/agent-event-transition.test.ts tests/agent-hooks tests/queue-investigation-matrix.test.ts tests/activity-queue-ownership.test.ts
SS_QUEUE_LIVE=1 bun test tests/queue-investigation-live.test.ts
bun run build
bun test tests/activity-queue-electron.test.ts tests/workspace-queue-electron.test.ts
```

Dependencies were temporarily linked to the parent installation without lockfile writes. No installed/development DB policy, running app, global hook/trust setting, real repository, push/merge/release or unrelated bun.lock was changed. Graphify was attempted by the normal commit hook and explicitly; its known missing module was not installed. Changed-file Biome and git diff --check pass. Full TypeScript is not globally clean; final test-project check reported 206 diagnostics and zero lane-B-owned-path diagnostics (`type-check.json`); no final baseline delta claim is made.
