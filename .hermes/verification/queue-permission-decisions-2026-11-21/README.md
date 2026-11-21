# Queue permission decisions — lane C

Owned commits before this evidence: `03d5f7cc` contract/design, `51b3fa02` implementation, `8f9b2ffa` review/process/digest hardening, `9912b620` visibility handoff and cold-dispatch admission. No cherry-picked dependencies, push, release, global hook trust changes, or existing user chat use. Parent/lane A own public router and QueueView/QueuePanel wiring and independent integration retesting.

## What is implemented

Only an authenticated, currently waiting Claude/Codex PermissionRequest bridge invocation can expose decisions. The bridge mints a UUID; the service checks exact entity, terminal, provider conversation, generation, queue source/group revisions, provider process fingerprint, and bounded lifetime. A decision is one-shot. Replay, ambiguous concurrency, stale revisions, closed/replaced processes and expired waits cannot send another decision. Memory retention is bounded without lifetime exhaustion (4,500-request test).

Allow once additionally requires the complete bounded action preview: known scalar argument fields, nonempty complete tool name, no hidden/unknown arguments, truncation, or redaction. Otherwise Deny/Open remain available. No permission rules, updated input, approval mode changes, or PTY permission keystrokes are used. Common credentials/control sequences are stripped; natural-language privacy cannot be exhaustively classified.

The new endpoint advertises response support. Old endpoints/hooks/listeners remain telemetry-only. Unsupported platform/process ancestry, unknown visibility, absent exact source identity or unreadable action detail cannot fabricate Allow support. Process inspection supports macOS/Linux; live evidence below is macOS only. Windows uses native Open fallback.

Already-visible chats take the native flow immediately. Explicit terminal visibility=true releases an existing wait without deciding or changing queue receipts. Hidden state is conversation-generation-bound. Freshly allocated background dispatch establishes hidden state; an initially null provider conversation uses the existing first-registration admission lease and cannot borrow a replacement. Unknown legacy visibility stays unavailable. A 30-second deadline remains the final native fallback.

Transport states distinguish sent, bridge stdout receipt, and uncertain response loss. Even stdout receipt does not establish provider acceptance, command execution, or task completion. No generic tool activity is used as permission outcome. Queue attention remains unchanged by sends, reads, handoffs or receipt arrival.

## Verification layers

- **125 focused source/UI/transport tests, 11,177 assertions passed** (`final-source.log`). Includes both providers × worktree/folder/repository orchestrator/cross-repository coordinator, exact current-source admission, sibling refusal, owner-close isolation, replacement during inventory, eager cancellation, cold background dispatch, summary gating, replay and retention. Native Node HTTP subprocess transport is used because Bun HTTP does not immediately report peer cancellation the same way Electron's Node runtime does.
- **Actual authenticated Claude Code 2.1.327 and Codex CLI 0.170.0: 7 cases each.** `live-claude.json` / `live-codex.json`: allow, deny, Open, timeout, cancellation, stale generation and response loss. Only allow executed the exact temporary synthetic MCP marker operation. This is actual CLI print/exec + production bridge + native Node HTTP + lifecycle service with a fixture identity resolver. It is not the interactive TUI or production DB/UI integration. Codex uses invocation-local exact hook key/hash trust from installed read-only `hooks/list`; no trust/approval bypass. Claude uses isolated settings and no session persistence.
- **Native Chromium component/service seam passed** (`native-component-result.json`): built preload, real Electron SQLite/migrations, real daemon socket and PTYs, actual bridge, actual QueuePermissionDecision buttons through a fixture tRPC wrapper. Provider processes are explicitly stand-ins. Exact allow/deny stdout, sibling independence, attention preservation, already-visible/unknown fallback and real `terminal.setVisible(true)` handoff were asserted. Source revision stayed unchanged on visibility. The latest scoped-visibility/first-generation refinements have source coverage; parent owns the final upgraded public-router/connected-QueueItemActions native rerun. Do not conflate this fixture wrapper with A's production router.
- Desktop production build passed. Biome changed-path checks have warnings (primarily test non-null assertions), no errors. Main/renderer owned source paths have no type diagnostics; repository-wide checks retain baseline errors. Final test-only optional-identity diagnostic was fixed by an explicit assertion.
- `terminal-workspace.test.ts`: 47 pass, 1 existing failure (duplicate entity fixture conflicts with current migration trigger). The same exact failure reproduces read-only on original `activity-queue` at base `89894806` (`terminal-baseline.log`). Coordinator dispatch regression passes 5/5 separately. Combining terminal mock-heavy files caused additional schema cross-contamination, so verification uses separate processes as repository guidance recommends.

## Findings retained honestly

Real Codex cancellation initially left an orphan hook socket open. The fix binds and rechecks the ancestor provider PID/start/parent/executable, with cheap non-signalling periodic process checks in main; the bridge independently monitors its provider. Both actual cancel cases now end cancelled with no operation. Full process checks remain immediately before decisions.

An initial real Codex fixture call added a period to an exact-enum synthetic argument. The fixture incorrectly swallowed the validation error and waited; the prompt now supplies exact JSON and the server returns a proper error. The successful final seven Codex cases retain exact input checking. No policy was weakened.

Early native fixture attempts did not start the stand-in (per-create SHELL is not the daemon shell selector), then referenced the wrong renderer filename. Those fixture defects were corrected; only the final native pass is claimed. Final terminal visibility generation/cold-admission refinements await parent's public integration rerun.

Graphify rebuild was attempted and reports its known missing module. It was not installed and commit hooks were not bypassed. Temporary local dependency links are removed at handoff.

## Reproduce

From `apps/desktop` with compatible existing dependencies:

```sh
bun test tests/queue-permissions.test.ts tests/queue-permission-summary.test.ts tests/queue-permission-runtime.test.ts tests/queue-permission-transport.test.ts tests/queue-permission-decision.test.tsx tests/agent-hooks tests/activity-queue-agent-source.test.ts tests/agent-evidence-persistence.test.ts
SS_PERMISSION_LIVE=1 bun test tests/queue-permission-live.test.ts
bun run build
# Reserve the exclusive GUI slot first.
SS_KEEP_QUEUE_FIXTURE=1 bun test tests/queue-permission-native.test.ts
```

Primary protocol sources: [Claude hooks](https://code.claude.com/docs/en/hooks#permissionrequest), [Codex hooks](https://developers.openai.com/codex/hooks). Installed Codex app-server JSON schema independently exposed `hooks/list`, current hashes and exact hook keys.

## Self-review

Agent-self-evaluation skill: accuracy 4/5 (explicit transport vs execution boundaries); completeness 4/5 (owned lane complete, public-router native integration delegated to parent by agreement); clarity 4/5 (evidence layers separated); actionability 4/5 (commits and reproducible scripts supplied); conciseness 3/5 (long investigation and several fixture corrections). Average 3.8. Highest-impact remaining check is parent's public-router/connected-action vertical; improve handoff by reporting only owned hashes and exact limitations. The user should agree with the evidence boundary, rather than an unqualified whole-app completion claim.
