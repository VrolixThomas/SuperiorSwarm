# F1 state ordering and scoped authority fixes

Baseline `f298e114`; implementation commits `72eb8c7a` (F01 and reusable disposable fixture) and `444d462b` (F02/F03, depending on that fixture). All changes are local to `fix/pr-reading-state-authority`. Independent validator tests/reports are unchanged.

## Findings and behavior

- **F01 fixed:** Any supplied invalid, empty, expired, or consumed task token returns HTTP 403 before manager, workspace-header, or cwd fallback. All six task modes retain their valid first-use behavior. Tokenless workspace/manager/unknown-cwd behavior is unchanged. Expiry includes the exact TTL deadline. Reconnect with consumed credentials deliberately fails closed; no new reconnect credential mechanism is introduced. Parent approved strengthening the preexisting control-plane replay test from `mode:none` to 403; independent security assertions were retained.
- **F02 fixed:** Provider resolution reserves a durable generation in the existing full-scope document (workspace/provider/owner/repository/PR). Application instances and independent storage connections share this fence. Compare-and-apply occurs within one SQLite transaction before get/start/Ask can apply a resolved head, including mismatched-head paths. Direct head transitions and new mapping/question runs also advance the fence. Rejected reads return the latest snapshot; rejected mutations throw without starting/stopping work or revoking current callbacks. Failed newer resolutions still fence older metadata. Later legitimate force pushes are accepted. Old documents default to generation zero without a migration; capability and path callbacks do not themselves advance metadata generations.
- **F03 fixed:** Agent replacement protects user context by both stable ID and path, including unchanged test references. Conflicts reject atomically. Omitted context retains its full note/detail/focus/usedBy/alsoIn record and original entry identity/title; referenced entry shells survive replacement and remapping. Stream updates and user additions continue rejecting duplicate IDs/paths. If user context becomes a changed file, remapping rejects instead of erasing it; the user can remove that context from the stale path using the current identity, then remap.

## Reproduction and verification

Run Bun commands from `apps/desktop` to use bunfig/preload. Logs are under `/tmp/f1-reading-validation/`; initial native log is `/tmp/f1-native-red.log`.

Before fixes, the supplied SQLite/tRPC lifecycle races both failed, all three assigned V3 assertions failed, and V4 context ownership failed. Native registered-router evidence had 31/33 passing checks, with both head rollback and unrelated descriptor delivery failing. New metadata tests independently showed 9 failures/8 passes; context tests showed 3 failures/8 passes before the fix. An initial new token fixture attempt hit a duplicate workspace fixture constraint (corrected); the substantive F01 RED evidence is the supplied actual HTTP replay probe.

| Command / boundary | Final result |
| --- | --- |
| `bun test tests/review-path-metadata-authority.test.ts tests/review-path-context-authority.test.ts tests/pr-reading-lifecycle-races.test.ts` | 31 pass, 0 fail; fresh application/storage instances, separate DB connections, get/start/Ask match/mismatch/error ordering, scope dimensions, force push, current capability callbacks, complete user records, removal/recovery |
| `FILE_BROWSER_TEST_CHILD="$PWD/tests/review-path-task-authority.test.ts" bun test tests/review-path-task-authority.test.ts` | 1 pass, 245 assertions; disposable HTTP server/SQLite, all task modes, replay/expiry/unknown/empty, cwd/header/manager combinations and tokenless behavior |
| `bun test tests/review-path-task-authority.test.ts tests/task-registry.test.ts` | 5 top-level pass, 0 fail (wrapper count; do not add child again) |
| `bun test tests/control-plane.test.ts -t /context.resolve` | 5 pass, 0 fail, 22 filtered; initial whole-file batch encountered resource timeouts in unrelated cases |
| `FILE_BROWSER_TEST_CHILD="$PWD/tests/review-path-security-validation.test.ts" bun test tests/review-path-security-validation.test.ts -t 'delayed provider\|streamed replacement\|replayed reading'` | Assigned cases: 3 pass, 0 fail, 1 filtered |
| `FILE_BROWSER_TEST_CHILD="$PWD/tests/review-v4-independent-storage.test.ts" bun test tests/review-v4-independent-storage.test.ts -t 'streamed replacement'` | Assigned case: 1 pass, 0 fail, 2 filtered |
| `bun test tests/pr-reading-lifecycle-electron.test.ts` | Mixed wrapper remains RED: 32/33 native checks pass. Assigned head-race check now passes (`newerStillActive:true`); only F4 simultaneous Map/Ask descriptor delivery fails. Real registered appRouter, SQLite, IPC/preload, disposable Git/PTY/profile, controlled provider |
| `bun test tests/review-path-application.test.ts tests/review-path-control.test.ts tests/review-path-boundaries.test.ts tests/review-path-runtime-integration.test.ts` | 8 top-level pass, 0 fail |
| `bun test tests/review-path-storage.test.ts tests/review-path-execution.test.ts tests/review-path-ask-conversation.test.ts tests/review-path-auto-map.test.ts tests/review-path-reconcile.test.ts` | 27 pass, 0 fail |
| Full independent security file | Mixed: 3 pass, 1 fail (F2 local Git promisor helper) |
| Full independent V4 storage file | Mixed: 1 pass, 2 fail (F2 pinned publication, F3 current-draft selection) |
| Scoped Biome + `git diff --check` | Pass, no warnings on changed files |
| Test-project TypeScript | Baseline 211 diagnostics; final 211; zero added/removed after normalizing line offsets. No new-file diagnostics. Command from repo root: `./node_modules/.bin/tsc --noEmit --incremental false -p apps/desktop/tests/tsconfig.json`; `types-delta.json` records the comparison. |
| Production `bun run build` | Pass (main, preload, renderer); existing Browserslist/chunk warnings only. |

The native evidence is copied to `/tmp/f1-reading-validation/native-red.json` and `native-final.json`. No whole mixed suite is claimed green. No runtime, publisher, auth-core, renderer controller or UI files were changed.

## Limits and containment

Provider data is controlled; no authenticated provider/real CLI/full UI acceptance is claimed. No external comments/reviews/merges/posts, user terminal prompts, live database writes, global MCP changes, pushes or shared native rebuilds occurred. The native harness retained its disposable profile/Git/DB/service/PTY boundaries. Only existing dependencies were temporarily linked; no package/lockfile changes. Normal commit hooks ran. Graphify rebuild and hooks report `ModuleNotFoundError: graphify`; that baseline tooling limit remains.

Self-evaluation (`ecc:agent-self-evaluation`): accuracy 4/5 (independent SQLite/HTTP/native evidence, live-provider limits explicit); completeness 4/5 (all assigned findings covered, cross-process load/power-loss not exercised); clarity 4/5 (mixed suites separated, detailed commands remain necessary); actionability 4/5 (exact scoped commits, parent integration/validator reruns remain); conciseness 4/5 (report retains reproducible evidence). Overall 4.0/5. Highest-impact next step: integrate these scoped commits with the other lanes and rerun the original validators. This assessment describes the assigned fixes, not full feature acceptance.
