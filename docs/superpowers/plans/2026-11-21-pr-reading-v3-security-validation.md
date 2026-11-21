V3 independent backend/security validation — 2026-11-21

Recommendation: hold integration approval until the four P1 findings below are fixed and the five supplied regression assertions pass. No P0 was established. Production implementation is unchanged in this validation worktree.

Reviewed delta: `990ed5efeedf64cf7647b2a41297b5cccc552ecf` → merged `0e79fa3dde6a48700846a4768e45389067fe9c20`. Test commit: `b044c9576a7011b37428e9ec45f2ad6814518f83`. Read CLAUDE.md, approved design, and latest A/B/C/D handoffs; historical frontend-only caveats were not used to discount the integrated runtime.

| Area | Result | Independently exercised evidence / limit |
| --- | --- | --- |
| Scoped reading-path control, storage, router | PASS, with exceptions below | 17 existing tests: wrong capability/run/selectors, validation, transaction rejection, durable restart, independent question completion, local draft ownership, actual authenticated HTTP/MCP handler transport. |
| Runtime cancellation, duplicate launch, startup/reconcile, shell quoting | PASS, with Git exception below | 15 existing tests including assembled runtime/router/storage/control-plane; real Git and fake daemon/provider, fake CLI executables. No existing user terminals. |
| Provider manifest/identity/thread metadata | PASS, with auth exception below | 12 reported top-level tests, including isolated wrappers running additional provider cases. Complete/partial/cyclic/drifting manifests, next-link host/repo restrictions, IDs, unknown/outdated threads, late GitHub 401, switched identity. Synthetic fetch only. |
| Immutable context and changed content | PASS | 32 tests, including real hidden Electron window, production contextBridge/tRPC IPC, and temporary Git repositories. Literal paths, symlinks, object omission/limits, missing objects, ownership, stale roots, immutable branch/worktree isolation, cancellation and transport overrides. |
| Neighboring control plane and automatic mapping | PASS | 51 tests: ordinary control-plane routing, auto-map claims and review coordination. |
| New independent adversarial regressions | FAIL | Five substantive failures across two isolated files; wrapper run reports two failures because each wrapper launches a child. All failures are expected-behavior assertions, not source-text assertions. |
| Types / formatting | PARTIAL / PASS | Test-project tsc remains red on existing repository diagnostics; final output contains zero diagnostics naming either added file. No full original-versus-merged type delta claimed. Scoped Biome and diff whitespace checks pass. |
| Native live CLI / authenticated providers / complete review UI | UNVERIFIED in V3 | No real agent prompt, provider read/write, full Monaco audit, or authenticated end-to-end run. Native Electron coverage is the snapshot fixture only. |

There are **127 reported passing top-level tests** across five bounded batches. Provider wrappers execute additional cases that are not added to that count. The five new red cases expose gaps in the otherwise passing baseline; no preexisting test failed in these batches.

1. **P1 — Consumed task bootstrap silently upgrades a reading agent to workspace-agent.** Inherited control-plane behavior newly used by reading-path launches.

   Source: `apps/desktop/src/main/control-plane/server.ts:578` (missing fail-closed branch after `consume`), `:711` (cwd workspace fallback); `apps/desktop/mcp-standalone/context.mjs:4` and `server.mjs:929` (mode determines tool registration).

   Trigger: register a reading-path launch token for a registered review worktree, successfully call `/context.resolve?taskToken=...&cwd=...`, then reconnect/restart MCP with the same inherited token. The second real HTTP request returns **200 / workspace-agent**, not an authorization error. The actual test uses only an in-memory migrated database, a disposable directory and synthetic token; it does not invoke the newly available side-effecting tools.

   Impact: an ordinary MCP reconnect loses reading-path tools and gains general workspace coordination tools. Those include mutations, so the read-only prompt is not a scope enforcement boundary. This is not a demonstrated unauthenticated remote exploit: the caller has the normal local discovery bearer, just as the launched MCP does.

   Fix direction: reject any supplied but invalid/expired/consumed task token before cwd/header/manager fallback. If reconnect is supported, give it explicit scope-preserving credentials; do not silently change roles. Test: `review-path-security-validation.test.ts`, “replayed reading task token”.

2. **P1 — Delayed provider metadata can roll back a newer persisted head and revoke its active run.** New application-layer race.

   Source: `apps/desktop/src/main/review-path/application.ts:26`–`:29`; storage head transition/invalidation at `storage.ts:128`–`:151`. The same unconditional resolved-head application pattern also exists in start/Ask, but the supplied repro directly exercises `get`.

   Trigger: stored head A; start a provider read for head B and delay its return; establish a new mapping at head C and grant its capability; release the old B response. Actual production application/storage yield `{head:B, state:"superseded", authenticated:false}` for the C run. Expected: C remains current/running/authenticated.

   Impact: a stale tab/poll can invalidate the current user's mapping/Ask work and make its callbacks unusable despite full-head identity checks. Provider verification at request start does not fence out-of-order completion.

   Fix direction: compare an authoritative document generation/head before committing an asynchronous metadata result; discard or re-resolve a result if another request advanced it. Do not infer chronology from SHA ordering (force pushes are valid). Test: “delayed provider read”.

3. **P1 — Runtime's purported local commit check executes Git promisor transports synchronously.** New runtime path, distinct from the hardened snapshot reader.

   Source: `apps/desktop/src/main/review-path/runtime.ts:57`–`:60` uses raw `execFileSync("git", ["cat-file", "-e", ...])`, with inherited environment, no transport prohibition and no timeout. Compare `review-explanation/git-reader.ts:10` for the existing bounded local-only policy.

   Trigger: disposable Git repository with a missing requested commit, `remote.origin.promisor=true`, a synthetic `ext::` helper and `protocol.ext.allow=always`. Calling **production** `getReviewPathRuntime(...).startMapping(...)` runs that helper before failing the commit check. The helper only touches a local marker and exits; no network or real terminal is involved. The negative assertion `existsSync(marker) === false` fails.

   Impact: partial-clone checks may fetch/write objects, launch repository-configured helpers, or hang Electron's main thread on an unbounded synchronous network/helper operation. The marker proves helper execution, not arbitrary code execution from ordinary PR text: the precondition includes local Git configuration. A real network hang was not induced.

   Fix direction: use the hardened asynchronous Git reader, clear Git environment overrides, forbid all lazy-fetch transports, and retain cancellation/time/output bounds. Test: “runtime local-object check”.

4. **P1 — Successful Bitbucket token refresh overwrites a replacement account's credentials.** Preexisting auth dependency, unchanged between original and merged baseline.

   Source: `apps/desktop/src/main/atlassian/auth-core.ts:56`–`:63` commits the old asynchronous refresh unconditionally; `atlassian/auth.ts:178`–`:190` combines its tokens with the newly read account metadata.

   Trigger: save expired synthetic account A; start its refresh and pause the synthetic token response; connect B; release A's successful refresh. Through **actual auth modules and migrated SQLite**, the account ID stays B but access/refresh tokens become A's. Assertions compare booleans to avoid logging credentials. The new identity reader's late-response checks cannot repair this persisted mismatch.

   Impact: future PR reads can use account A while the connection UI identifies B; B's saved credentials are lost. The same helper supports Jira, but the reproduction is specifically Bitbucket. No live account was touched.

   Fix direction: bind successful refresh persistence to the exact originating credential/account generation using atomic compare-and-update; do not return stale credentials for a replacement connection. Test: `review-path-security-auth-validation.test.ts`, “successful refresh from old account”.

5. **P2 — Agent path replacement can erase user-owned context by changing its ID.** New storage authority-boundary defect.

   Source: `apps/desktop/src/main/review-path/storage.ts:243` matches old context only by step ID; `:118` skips preservation when the replacement has the same path.

   Trigger: add user context `id=user-context,path=context.ts`; use an authenticated mapping capability to replace it with `id=agent-context,path=context.ts,addedBy=agent,note=Replaced`. `executeReviewPathTool` succeeds and only the replacement survives. The test permits either rejection or faithful preservation, and fails because neither happens.

   Impact: streamed agent output removes a user's chosen context identity/note despite the explicit preservation contract. Match protected context by path as well as ID, and retain the complete user record. Test: “streamed replacement”.

Commands and artifacts (run from `apps/desktop`, logs in `/tmp/pr-reading-v3-validation/`):

```sh
bun test tests/review-path-storage.test.ts tests/review-path-control.test.ts tests/review-path-application.test.ts tests/review-path-boundaries.test.ts
# core.log: 17 pass / 0 fail
bun test tests/review-path-execution.test.ts tests/review-path-launch.test.ts tests/review-path-reconcile.test.ts tests/review-path-runtime-integration.test.ts
# runtime.log: 15 pass / 0 fail
bun test tests/provider-file-completeness.test.ts tests/provider-metadata-rpc.test.ts tests/provider-reviewer-identity.test.ts tests/bitbucket-thread-metadata.test.ts
# provider.log: 12 reported pass / 0 fail, nested cases in isolated subprocesses
bun test tests/review-snapshot.test.ts tests/review-snapshot-context.test.ts tests/review-snapshot-router.test.ts tests/review-snapshot-electron.test.ts
# snapshot.log: 32 pass / 0 fail
bun test tests/review-path-auto-map.test.ts tests/review-path-metadata.test.ts tests/ai-review-auto-trigger.test.ts tests/control-plane.test.ts
# control-auto.log: 51 pass / 0 fail
bun test tests/review-path-security-validation.test.ts tests/review-path-security-auth-validation.test.ts
# regression-wrappers.log: 2 wrapper failures representing 5 substantive red cases
FILE_BROWSER_TEST_CHILD="$PWD/tests/review-path-security-validation.test.ts" bun test tests/review-path-security-validation.test.ts
# adversarial-final.log: 0 pass / 4 fail
FILE_BROWSER_TEST_CHILD="$PWD/tests/review-path-security-auth-validation.test.ts" bun test tests/review-path-security-auth-validation.test.ts
# adversarial-auth-final.log: 0 pass / 1 fail
```

From repository root: `./node_modules/.bin/tsc --noEmit --incremental false -p apps/desktop/tests/tsconfig.json` (`types-tests-final.log`); `./node_modules/.bin/biome check` on the two added tests; `git diff --check`. Initial harness attempts encountered missing Electron preload when invoked from root and missing test worktree fixture columns; these setup errors were corrected before the reported behavioral failures. They are not product findings. Graphify rebuild and normal commit hook report `No module named 'graphify'`; no hook was bypassed.

Limits and non-findings: no evidence of cross-run writes through the new capability endpoint itself, provider publishing from new reading-path tools, shell injection in the fixed launch builder, or snapshot symlink/pathspec escape in exercised cases. Correct first bootstrap registers only reading-path MCP tools; fallback is the concrete exception. A shared local control bearer and an unrestricted CLI are not a process sandbox. CLI permission settings and read-only prompts do not prove prevention of arbitrary external writes. GitHub's existing thread/comment page caps remain; provider tests verify file completeness, not exhaustive discussion history. Persistent JSON histories and runtime launch maps lack cumulative retention bounds; this is a scale/hardening concern without a destructive exhaustion test. Prompt files are written under random run directories with private modes; hostile same-user filesystem replacement was not tested. Crash-at-every-write/power-loss recovery and long-running memory saturation were not exercised; normal SQLite transaction/disk-reopen/migration and runtime restart cases passed.

Only this worktree's tests/report were changed. Temporary dependency symlinks pointed to the existing shared dependency trees and were removed before final handoff. No package/lockfile changes, shared native rebuilds, production fixes, other worktree modifications, global MCP changes, real provider actions, existing-agent cancellation, pushes or merges occurred. New tests are intentionally red and should be integrated with corresponding fixes, not mistaken for a passing release gate.

Self-evaluation (agent-self-evaluation skill): accuracy 4/5 (five direct behavior repros; no live CLI assertion); completeness 4/5 (all assigned backend areas reviewed, saturation/power-loss/live-provider limits explicit); clarity 4/5 (new versus inherited defects separated, native versus doubles distinguished); actionability 4/5 (repro commands and source anchors, production fixes delegated to parent as requested); conciseness 4/5 (report retains exact evidence needed for five independent fixes). Overall 4.0/5. Next improvement: rerun the five red regressions against parent-owned fixes, then use a separately isolated live CLI setup to test reconnect behavior. The user should agree with this bounded assessment; it does not claim production readiness.
