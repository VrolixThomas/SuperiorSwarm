# Lane B runtime handoff

Base frontend: `163c7059`. Shared contract dependency: A's `963c0b56`, cherry-picked here as equivalent `120bf0ec`; integrate only one copy. A owns storage/service/schema/router/MCP. This lane adds no migrations or router registration.

## Integration

- Call `initializeReviewPathRuntime()` from `main/review-path/runtime.ts` after DB, task registry, daemon and providers initialize, before accepting mapping requests. It installs the port through A's `configureReviewPathRuntime` and reconciles durable runs against terminal inventory. Missing processes become explicit failures; no restart prompt is injected into any terminal.
- Runtime expects A's service exports `getReviewPathStorage`, `configureReviewPathRuntime`, `getReviewPathApplication`. Store methods: `getRun`, `getActiveRuns`, `fail`, `attachReviewDraft`. TaskMode must include `review-path`.
- `alsoReview` creates an existing-schema local review draft, links it to the workspace, and binds it through `attachReviewDraft` before token registration. A must finish/fail/cancel/supersede that draft with the mapping. MCP tools `add_review_finding`/`set_review_summary` are strictly local; no provider posting is invoked.
- Parent UI: pass full `identity` (or workspaceId plus exact details head) into `useReviewPath`, and full `identity` into `useAskAgent`. Both accept `onLaunch`. Attach the returned **existing terminalId**, reviewWorkspaceId and worktreePath. Do not call `launchReviewTerminal` or write launchScript again: main already launched the owned PTY. A's shared launch result needs these optional descriptor fields plus cliPreset.
- Ask returns `status`, `error`, `questions`, and `cancel(questionId)` in addition to messages/send/available. Parent owns final UI error/pending/cancel presentation.
- Existing `auto-trigger.ts` invokes mapping before legacy automatic review. `pr-poller.ts` reconciles eligible existing requests on successful polls after the DB transaction, keeping first-provider bootstrap silent. C confirmed no poller collision.

## Source routing for parent CLAUDE.md

- Mapping/Ask launches: `main/review-path/execution.ts` fences duplicate/pending launches and cancellation; `runtime.ts` validates the registered review workspace and exact provider head, writes private prompt files, registers scoped MCP task context, creates an owned daemon terminal, and returns its attachment descriptor.
- Launch terminal IDs are deterministic `review-path:<run id>:<run version>`. Stop never accepts unrelated persisted terminal IDs. The launch shell uses `exec` so agent exit also ends the owned PTY; reconciliation compensates for renderer attachment replacing terminal callbacks.
- Prompt/tool contract: `main/review-path/prompt.ts`; only fixed executable/flags become shell syntax in `launch.ts`. PR metadata is data; immutable `git show` reads are required and unknown base revisions remain unknown.
- Backend path/Ask polling and stale-response fencing: `renderer/lib/review-path-source.ts`. Fixture registry remains explicit opt-in only. Conversations are keyed by full workspace/provider/repo/PR/head identity; no synthetic offline agent answer is created.
- Settings: `review-path-settings-store.ts` imports legacy browser settings through server's import-once method and thereafter treats backend values as authoritative. Failed saves expose errors and do not persist pretend success.
- Auto-map: `auto-map.ts` is the injected policy; `auto-map-runtime.ts` uses A's durable automatic claim and existing automatic-review ledger. Existing workspaces are reused without resetting a live review worktree. Unsupported/unlinked/authored/closed/unknown-head PRs do not auto-map.

## Verification

Logs: `/tmp/agent-reading-runtime-validation/`.

- 72 tests pass across 16 targeted files, including existing path/model/settings/rail/panel/workspace/poller/auto-review regressions. The shell test executes fake Codex and Claude binaries in a temporary directory; it verifies exact prompt bytes and scoped task token without invoking a real provider.
- New tests cover duplicate starts, cancellation during preparation, wrong question identity, offline failures, unrelated terminal rejection, late poll fencing, full identity mismatches, restart reconciliation, completed-run exit, duplicate auto triggers and server-authoritative legacy settings migration.
- Scoped Biome: 21 files pass. `git diff --check` passes.
- Production build attempted and blocked by the intentionally absent A `main/review-path/service.ts` dependency. Main TypeScript additions are the absent service and `review-path` TaskMode. Renderer/test checks additionally require A's AppRouter registration. Existing global diagnostics remain; no clean global type-check is claimed. Integrated build/types must run after A lands.
- Graphify is unavailable (`No module named graphify`, also reported by normal commit hook). No graph, global MCP config, dependency package, lockfile or parent/sibling worktree changed.
- No real provider prompts, provider writes, comments, review submissions, merges or external messages were used for testing.

## Remaining integration checks

A must confirm durable MCP capability behavior across app/control-plane restart; ephemeral consumed task tokens cannot authorize a fresh connection by themselves. Auto claims should preserve user cancellation and prevent automatic relaunch loops. Parent/integration must exercise the real assembled application with isolated DB/provider/runner doubles after A and B are combined. Main runtime and renderer tests here are independently injected, not an end-to-end claim for the unassembled lanes.

Self-review: accuracy 4/5 (isolated evidence, no live-provider test); completeness 3/5 (A integration and restart capability verification still pending); clarity 4/5 (explicit APIs/dependencies, parent owns UI glue); actionability 4/5 (committable code and tests, build awaits A); conciseness 4/5 (focused modules, handoff necessarily detailed). Overall 3.8/5. Highest-value next check is integrated A+B execution with durable MCP capabilities and renderer terminal attachment.
