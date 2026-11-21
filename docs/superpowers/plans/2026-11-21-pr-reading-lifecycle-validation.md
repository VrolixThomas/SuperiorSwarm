# V1 integrated reading-path lifecycle validation

Baseline: `0e79fa3dde6a48700846a4768e45389067fe9c20`, merged implementation and parent integration. Worktree: `test/pr-reading-lifecycle`. Production files are unchanged. Tests intentionally remain RED on two confirmed defects; do not treat their addition as a newly introduced production regression.

**Recommendation: hold feature acceptance until P1 is fixed and these regressions pass.** Resolve P2 or explicitly limit concurrent operations without dropping successful attachment results. No P0 finding.

## Confirmed findings

### P1 — late provider responses rewind the authoritative head and invalidate newer work

Sources: `src/main/review-path/application.ts:28–29`, `39–45`, analogous `ask` resolution; `src/main/review-path/storage.ts:128–145`.

Trigger: two requests for different observed heads overlap. The older request has captured provider metadata but returns after the newer head has been accepted and a new mapping started. `get` applies its old resolved identity without checking for intervening state changes. `start` similarly calls `storage.get`/`begin` after its awaited resolution. Storage then marks the newer run superseded, cancels its draft, and clears capabilities.

Independent assertions fail: expected durable head B, received A; expected newer mapping `running`, received `superseded`. The native fixture also reports `newerStillActive: false` after this ordering through the **registered production appRouter** and real provider adapter port. This is not just a factory-only reproduction.

Impact: a delayed refresh or old tab can destroy a current mapping/question and revoke its agent capability. A second provider check inside runtime preparation does not undo the damage already done to newer work.

Regression: `tests/pr-reading-lifecycle-races.test.ts` (two tests), plus native check “late provider read preserves newer native mapping”. Provider response ordering is deliberately controlled; no authenticated provider behavior is claimed. This is a feature defect at the supplied baseline, not an unrelated test-suite issue.

Remediation boundary: fence resolution acceptance across application instances for the full scope, including get/start/ask and mismatch paths. `getReviewPathApplication()` constructs a new instance for each call; an instance-local counter alone is insufficient.

### P2 — overlapping mutations lose a successful terminal attachment descriptor

Sources: `src/renderer/lib/review-path-source.ts:286–304`, particularly `generation !== sequence` returning `undefined`; hook attachment delivery later depends on `result.launch`.

Trigger: hold Map at native daemon inventory, issue Ask on the same renderer controller, then release both. The controller's single sequence protects the newer snapshot by dropping the entire earlier result. Both runtime launches and durable runs succeed, but Map returns no descriptor: `{mapDelivered:false, askDelivered:true}`.

Impact: the earlier successful agent cannot reach its hook's `onLaunch` attachment callback. Snapshot freshness and successful mutation result delivery need separate treatment. The normal Ask composer disables sending while pending, mitigating ordinary sequential clicks; the shared controller still violates the requested simultaneous-operation contract. This is not a terminal IPC ownership failure: native attachment and subsequent exit detection independently pass.

Regression: native check “simultaneous Map and Ask both deliver terminal attachment descriptors”. The new native test fails on both P1 and P2 after collecting the entire check matrix.

## Evidence matrix

| Behavior | Result | Boundary actually exercised |
|---|---|---|
| Generated migrations, registered router, persisted path | PASS | Native Electron `initializeDatabase`, better-sqlite3, production `appRouter`/IPC/contextBridge/client/controller |
| Map without / with Also review | PASS | Real runtime/owned PTY, zero draft without review; local ready draft/findings/summary with review |
| Complete coverage and streamed partial steps | PASS | Capability-authenticated MCP wrappers → local HTTP → storage → IPC → React rendering; missing coverage rejected |
| Stop/Retry; cancel during provider read, inventory, terminal creation | PASS | Deferred actual boundaries; no late prompt, no active draft, no created session row/session left after cancellation |
| Simultaneous mapping/questions | **FAIL P2** | Both run durably; earlier descriptor disappears at renderer controller |
| Multiple questions, out-of-order answers, current conversation/anchors | PASS | Real scoped MCP answer callbacks, native snapshots, production conversation selector; remap hides historical messages |
| Head change observed during launch / callback | PASS | New observed head fences launch before prompt and rejects authenticated old capability writes |
| Out-of-order provider read/start | **FAIL P1** | Native late read plus two independent SQLite/tRPC regressions |
| Restart with surviving / missing session | PASS, bounded | Disk close/reopen; surviving real PTY + missing question PTY; new control plane, runtime startup fencing, revoked capability, cleanup, manual retry |
| Durable auto claim/settings import | PASS | Claim survives disk reopen; duplicate auto start has no launch; explicit settings survive import |
| Duplicate polls; authored/closed/unlinked auto eligibility | PASS, unit boundary | Existing auto-map behavior tests; no real provider poll cycle is claimed |
| Closed PR manual Map/Ask; unlinked workspace refusal | PASS | Native provider double declares closed; local operations succeed; registered workspace validation rejects unknown ID |
| Provider/workspace isolation | PASS | Native separate workspace/provider scopes return no shared path/messages; baseline storage rejects cross-scope writes |
| Transient provider error / recovery | PASS | Truthful error, no run created; later refresh recovers |
| Daemon disconnect/reconnect | PASS | Real socket client disconnect/connect; no invented failure or duplicate launch; reattach existing PTY |
| Terminal attachment and exit callbacks | PASS | Real terminal:create IPC reuses session; after renderer attachment, agent exit reaches durable failure through callback/reconciliation |
| Full production startup process / packaged build | UNVERIFIED | Source ordering inspected; native fixture invokes real parts with isolated assembly, not main/index.ts or packaged launcher |
| Full ReviewWorkspace/Monaco visual flow | PARTIAL | Existing isolated default workspace/panel/rail/step tests pass; native fixture renders controller state, not the full review UI |
| Authenticated remote providers / real Codex or Claude / MCP CLI subprocess | UNVERIFIED | Provider double + disposable fake executable. MCP handlers register in-process and call real local authenticated HTTP. No live-provider claim |

## Startup inspection

`main/index.ts` initializes DB at 187, registers tRPC at 266 and shows the window at 333, then starts the control plane/task registry at 349/355. Providers register at 446–449 and reading-path runtime initializes at 454. Polling starts at 462–464. In normal startup, daemon connection occurs later at 495–497; only pending cleanup recovery connects it earlier at 226–228.

Thus “after daemon initializes” is not guaranteed by current bootstrap order, and UI requests can precede runtime registration. Runtime startup interruption does occur before pollers. Offline/pre-runtime requests are truthful errors, but an auto claim made while the daemon is unavailable is durable; automatic retry is intentionally suppressed. The actual startup timing window and global MCP/hook installation were not executed because main/index.ts would mutate shared configuration. This is an integration risk for parent follow-up, not a third confirmed failure claimed by this report.

## Commands and counts

All valid verification runs below used `apps/desktop` as cwd, Bun 1.3.9. Existing dependencies were temporarily symlinked from the supplied main checkout; no packages/lockfiles/native modules changed.

- `bun test tests/review-path-runtime-integration.test.ts tests/review-path-boundaries.test.ts tests/review-path-live-source.test.ts tests/review-path-launch-delivery.test.tsx`: **8 pass, 0 fail** (`baseline-core.log`).
- `bun test tests/review-path-application.test.ts tests/review-path-storage.test.ts tests/review-path-control.test.ts tests/review-path-execution.test.ts tests/review-path-auto-map.test.ts tests/review-path-settings-sync.test.ts tests/review-path-settings-store.test.ts tests/review-path-ask-conversation.test.ts tests/review-path-reconcile.test.ts tests/review-path-launch.test.ts`: **38 pass, 0 fail** (`baseline-lifecycle.log`).
- `bun test tests/review-connected-terminal.test.ts tests/review-workspace.test.tsx tests/review-workspace-panel.test.tsx tests/review-workspace-rail.test.tsx tests/review-workspace-step.test.tsx tests/review-queue.test.ts tests/review-snapshot-renderer.test.tsx`: **14 pass, 0 fail** (`baseline-renderer.log`).
- `bun test tests/pr-reading-lifecycle-electron.test.ts tests/pr-reading-lifecycle-races.test.ts`: **0 pass, 3 fail**, expected regressions (`final-regressions.log`). The native test independently collects **33 checks: 31 pass, 2 fail**. These are checks, not 33 Bun test cases. Existing wrappers report top-level counts; child counts are not added again.
- `bunx --no-install biome check --write tests/pr-reading-lifecycle-races.test.ts tests/pr-reading-lifecycle-electron.test.ts tests/fixtures/pr-reading-lifecycle`: **0 errors, 36 warnings** (explicit-any/non-null assertions in fixture code).
- Test-project TypeScript: global baseline remains red; changed fixture diagnostics were corrected. Excluding only the new tests/fixtures yields 211 diagnostics; including them yields 211 diagnostics, with 0 additions and 0 removals (`types-delta.json`).
- Graphify rebuild attempted as instructed; unavailable: `ModuleNotFoundError: No module named 'graphify'`.

Logs: `/tmp/pr-reading-lifecycle-validation/`. Committed sanitized check evidence: `2026-11-21-pr-reading-lifecycle-evidence.json`. Initial harness attempts hit fixture-only missing Supabase dummy env, duplicate seed constraints, URL/query trust mismatch and native teardown timing; these were corrected before collecting final evidence and are not product findings. Two accidental repo-root Bun invocations were discarded; the valid counts above come from desktop cwd with its Electron preload.

## Scope and residual limits

The native fixture uses a private profile/DB/repository, real node-pty and sockets, a shell that cannot load user login configuration, and a fake Codex executable. No global MCP installation or settings changes, authenticated provider writes, real CLI prompts, or user terminals. Only locally generated task capabilities are used; retained evidence omits them. Restart testing closes/reopens disk DB and rotates the control plane while the in-process daemon PTY survives; it does not claim a separate installed-app restart. Cancellation before a durable run exists (initial application metadata lookup) has no scope to cancel and is not claimed as tested cancellation. No performance/load or multi-window soak claim. Production files and sibling/parent worktrees are unchanged.

Self-evaluation (ecc:agent-self-evaluation): accuracy 4/5 (real native boundaries, explicitly doubled providers); completeness 4/5 (full UI, installed-process restart and live CLI remain unverified); clarity 4/5 (matrix distinguishes checks/wrappers/native); actionability 4/5 (RED repros and shared-instance fix boundary, parent owns fixes); conciseness 4/5 (native harness is substantial). Overall 4.0/5. Highest-impact follow-up: fix P1, rerun this exact native matrix, then verify production bootstrap in a separately isolated app profile without global installer side effects. The stated limitations should match the user's assessment.
