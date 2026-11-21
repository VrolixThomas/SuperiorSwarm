# PR reading path — remediation verification

Production fix checkpoint: **`bb328ca3`**, integrated on `investigate/explainable-pr-review-flow`. No push, release, or main-branch merge performed.

## Integration record

- F1 committed fixes merged in `bcea5cd8` (task-token fail-closed behavior, durable cross-instance metadata generation/CAS, user-context ownership preservation).
- F2 committed fixes merged in `edd571ff` (bounded local-only Git, account-generation refresh CAS, revision-safe publication).
- F3 committed fixes merged in `ac9dea43` (authoritative draft selection, historical projection, terminal/status discovery and navigation).
- SuperiorSwarm's control endpoint was offline during continuation. No child Codex processes remained. F4's uncommitted implementation/tests were copied into this branch without altering its original worktree; patch retained at `/tmp/pr-reading-f4-recovered.patch`.
- Local Codex subagents completed the remaining attach-only terminal and Bitbucket publishing boundaries, then independently reviewed the combined fixes. This fallback was disclosed; no claim is made that these continuation agents ran through the unavailable app.
- Independent continuation review found two additional F07 cases: manual comment selection could revive an older same-head draft, and a delayed successful acknowledgement could switch the renderer back after remapping. Both were reproduced, fixed and re-reviewed.

## Finding disposition

| Finding | Result | Main verification |
|---|---|---|
| F01 Invalid/replayed task-token authority fallback | Fixed | Supplied invalid/empty/replayed/expired tokens fail closed; original HTTP security probe and task-mode matrix pass |
| F02 Late metadata rewinds current head/run | Fixed | Durable generation reservation/CAS across actual application instances; original SQLite/router and native late-head probes pass |
| F03 Agent overwrite of user context by path/new ID | Fixed | Original security/storage probes plus complete-record/entry/path/test collision tests pass |
| F04 Runtime Git helper execution / unbounded synchronous check | Fixed | Hardened asynchronous local-only reader; original promisor-helper probe and cancellation/timeout tests pass |
| F05 Old account refresh overwrites replacement credentials | Fixed | Originating credential generation compare/update; actual disposable DB auth regressions pass |
| F06 Stale findings display/publication | Fixed with explicit provider limit | Historical projection and backend all-or-nothing preflight preserve provenance. Bitbucket pinned inline publication is rejected before any provider mutation because its documented API has no revision pin; ordinary unpinned comments, body-only and verdict operations remain supported |
| F07 Prior draft wins after repeated mapping | Fixed | Current bound draft/chain and revision determine selection. Scoped manual writes use a transaction and reject stale/ambiguous bindings; mapping initialization intent is persisted. Delayed acknowledgements are fenced by observed mapping generation before subscriber notification |
| F08 Missing terminal opener/recovery | Fixed | Persistent opener and scoped descriptor recovery. Owned review-path terminals are attach-only at IPC and daemon fallback, including disappearance after inventory; missing PTYs are never recreated |
| F09 Changes link leaves overview visible | Fixed | Original renderer deep-link regression passes |
| F10 Non-current queue has no live scoped status | Fixed | Registered read-only status projection; original queue regression and scoped no-mutation tests pass |
| F11 LEFT selection acts on RIGHT | Fixed | Original real Monaco / and c probes and focused side/model-switch tests pass |
| F12 Context return leaves BUSY unavailable diff | Fixed | Two active readers plus finite cancellable deadline-bound queue; transient-only retry; repeated native navigation/refetch passes |
| F13 Rejected Ask loses input/error | Fixed | Acknowledgement-aware composer and scoped mutation errors retained across successful polling; original native assertions pass |
| F14 Concurrent successful launch result discarded | Fixed | Snapshot ordering is separated from successful scoped mutation-result delivery; native concurrent Map/Ask assertion passes |

## Verification evidence

Run from `apps/desktop` with existing dependencies, using disposable Git repositories/databases/Electron profiles, synthetic credentials/providers and dedicated test PTYs. No live provider writes or user-terminal prompts were performed.

- Original independent regressions plus focused F4/manual additions: **14 top-level tests passed across 10 files**. Isolated wrappers run additional child cases; their counts are not added again.
- Core state/runtime/settings regressions: **61 tests passed across 13 files**.
- Existing UI/navigation/wiring regressions: **53 top-level tests passed across 14 files**.
- Native final run: **3 Bun tests passed**, containing **57/57 full-workspace**, **33/33 lifecycle**, and **13/13 focused editor/Ask** behavior checks. Actual React/Monaco, preload/IPC, snapshot Git service and lifecycle runtime/PTY boundaries are exercised; provider/CLI executables are controlled test doubles.
- Terminal continuation subagent: **95 tests passed** in isolated compatible groups, covering ordinary terminals, owned inventory/ownership, real socket disappearance race and structured IPC error round-trip.
- Provider continuation subagent: new publishing/provenance tests and **51 related provider top-level tests** passed. Bitbucket LEFT maps to `inline.from`, RIGHT to `inline.to`; pinned comments fail before requests.
- Additional independent review: **52 top-level checks across 20 files** passed. It authored the previously missing manual-binding regressions: **12 router cases** and **4 delivery-order cases**, all green, then approved the production fixes with the limits below.
- `bun run build`: passes.
- Main, renderer and test TypeScript checks: no additional normalized diagnostics compared with baseline (52 / 63 / 119 existing unique diagnostics respectively). Global type checks remain baseline-red.
- Scoped Biome: passes with fixture/non-null warnings; `git diff --check`: passes. Graphify remains unavailable (`ModuleNotFoundError`); normal commit hooks were not bypassed.

These batches overlap; counts must not be summed into a unique total.

Sanitized native check lists: [native-checks.json](assets/pr-reading-fixed-verification/native-checks.json).
Logs: `/tmp/pr-reading-continue-validation/` (`acceptance-final.log`, `core-regression.log`, `ui-regression.log`, `native-complete.log`, `complete-build.log`, `complete-*-types.log`, `final-biome.log`). Lifecycle report: `/tmp/pr-reading-lifecycle-validation/native-result.json`.

Native fixture factual updates: the synthetic current draft now declares its actual head SHA and the new read-only status projection. Happy-path publisher fixtures use matching stored/current SHA. Explicit snapshot overload testing sets `maxQueued: 0` while separate tests verify bounded default queuing. Original independent expected-behavior assertions were retained; no failing case was skipped or relaxed.

## Residual limits

- Authenticated live GitHub/Bitbucket reads/writes, real Codex/Claude execution and packaged/full installed-app startup were not certified. SuperiorSwarm's app endpoint was offline during this continuation.
- Bitbucket Cloud revision-pinned inline comments are explicitly unsupported rather than silently posted on a mutable head. Official contract: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/#api-repositories-workspace-repo-slug-pullrequests-pull-request-id-comments-post
- The legacy daemon attach protocol has no success ACK. Inventory-detected absence yields a structured error; disappearance after sending attach produces a visible redacted unavailable diagnostic and exit(-1), without recreation.
- Long-running memory/load testing, exhaustive shortcut permutations and every external LSP/provider configuration remain outside this verification.

The fourteen reported findings are remediated at the tested boundaries. This is local source/build/test acceptance, not a claim that a release has been deployed or live-provider behavior has been certified.
