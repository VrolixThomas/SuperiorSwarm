# V4 independent integrated correctness review

**Recommendation: request changes before integration approval.** Six confirmed findings: two P1 and four P2; no P0 found. Eight new behavior assertions fail on the merged baseline. The existing focused suites remain green. Production implementation was not changed.

- Reviewed baseline: `0e79fa3dde6a48700846a4768e45389067fe9c20`.
- Comparison merge base with local main: `17a316bf5fd73c0c6883128637398aa14bb81c05`.
- Initial independent probes: `a174350dac3c3255eae2e3125ab8570a28f1ab35`.
- This report's commit adds the final queue regression. Parent receives its exact SHA separately.
- Read CLAUDE.md, the approved November 21 design, and current persistence/runtime/provider/content handoffs; treated frontend-only statements as historical. Reviewed the integrated production changes and traced renderer, storage, runtime, MCP, provider, content, queue, and legacy submission callers. Did not review generated migration snapshot JSON line by line or claim a pixel-complete visual audit.

## Confirmed findings, ordered by severity

### 1. P1 — pinned findings are displayed and submitted at a different head

**Trigger:** map/review head A, retain a pending/accepted finding at `a.ts:12`, then refresh or submit after the provider moves to head B while the file still exists.

`apps/desktop/src/renderer/components/review-mode/useReviewData.ts:125` maps the selected draft's comments without comparing `aiDraft.commitSha` to the current head. `step/step-diff-model.ts:21` treats every AI draft as current. The independent hook/layout probe receives details B and draft A and places that finding in the new-head inline output.

More seriously, `apps/desktop/src/main/ai-review/review-publisher.ts:119` replaces the pinned draft commit with the provider's latest head; lines 156–158 preserve the old line and side. A real migrated DB → ReviewPathStorage finding → accepted draft → production publisher probe recorded a test-provider call with **commit B, original line 12**. Expected: no retargeted call. No external comment was posted.

**Impact:** a reviewer can accept an old finding against unrelated current code and publish it at the wrong location. The same legacy comment route does not carry an exact head for newly authored comments either (`trpc/routers/ai-review.ts:301`).

**Classification:** preexisting renderer/publisher weakness relied upon by the new pinned feature; publisher has no diff versus the comparison base. **Fix direction:** retain revision provenance through draft projection and submission; mark stale findings as historical and reject or explicitly reconcile changed-head submission. Do not fix only the visual label.

### 2. P1 — repeated Map + Also review selects the previous draft forever

**Trigger:** complete two mappings with Also review enabled, or map after an older ready legacy review.

`apps/desktop/src/main/review-path/runtime.ts:103` creates a new chain with `roundNumber: 1` every time. `getReviewDrafts` returns rows without newest-first ordering (`main/ai-review/orchestrator.ts:224`). `renderer/lib/pr-review-threads.ts:271` breaks equal-priority ties only on strictly greater round number; `useReviewData.ts:91` uses that selection rather than the current workspace/run draft binding. Two ready round-one rows therefore select the first row. An older higher-round legacy draft also wins.

**Probe:** two actual persisted runs and findings finish; workspace `reviewDraftId` is `new-reading-path`, but the production draft list and renderer helper return `old-reading-path`. Expected new, received old. While the new run is in progress, ready-priority selection additionally prevents its finding query from polling.

**Impact:** the path reports new findings while the diff, overview and Submit use the previous review. **Classification:** new integration defect combining new independent chains with an existing helper. **Fix direction:** use the authoritative bound run/workspace draft and exact revision; do not compare round numbers across unrelated chains.

### 3. P2 — agent replacement can erase user-added context

**Trigger:** user adds context `context.ts` with ID U; an agent `set_review_path` replacement contains that path with a fresh ID V, `addedBy: agent`, and a different note.

`apps/desktop/src/main/review-path/storage.ts:244` checks protected user context by ID only. `preserveUserContext` at line 118 then skips preserving U because the replacement already has the same path. The transaction succeeds and user ownership/note disappear. The migrated DB probe expects the original user step to survive or the update to reject; neither occurs.

**Classification:** new defect. **Fix direction:** protect both path and stable identity when merging user context, including unchanged test references that reuse its path. Retain the user's step or reject the conflicting update atomically.

### 4. P2 — owned terminals are unreachable for Ask and automatic mapping

Two separately reproduced cases:

1. An attached Ask terminal exists while neither mapping nor legacy review is active. `ReviewWorkspaceTopBar.tsx:49` exposes `openTerminal` only through an active `AgentStatusChip`; it renders nothing when inactive. The new top bar has no persistent Agent/terminal control (the old `ReviewHeader` did). The independent button-reachability probe supplies `openTerminal`, clicks every rendered top-bar control with all other callbacks inert, and records zero calls.
2. Open an automatically mapping PR or reopen the renderer while its run survives. The live snapshot contains a running run's deterministic `terminalId`, but `hooks/useReviewConnections.ts` attaches only launch-mutation results. `ReviewWorkspace.tsx:161` depends solely on the in-memory terminal store. The independent full workspace probe renders the live Mapping pill **disabled** despite the persisted owned terminal.

**Impact:** the user cannot inspect output or respond to CLI trust/permission prompts from the review shell, and completed output also becomes inaccessible. Actual CLI permission behavior was not exercised. **Classification:** new integration regression. **Fix direction:** provide a persistent terminal control and recover validated owned terminal descriptors from durable runs/session inventory without relaunching or writing another prompt.

### 5. P2 — Changes deep links can leave the overview covering the selected file

**Trigger:** click the PR title to open overview, then invoke an existing Changes deep link for the same workspace/file/thread.

`renderer/lib/review-mode-nav.ts:27` changes `view` only. The new `ReviewReadingPane.tsx:95` prioritizes the separate `overviewOpen` flag. File/thread selection changes but overview remains visible. The independent full workspace probe asserts the requested diff pane and gets null. Existing `review-mode-nav.test.ts` passes because it checks store selection/view, not the new pane rendering.

**Classification:** new shell integration regression. **Fix direction:** clear the overview layer in the shared navigation transition; preserve existing file/thread intent.

### 6. P2 — non-current queue rows never connect to persisted path status

**Trigger:** load a mapped PR, move to another PR, and open All PRs.

`queue/AllPRsDrawer.tsx:39` calls `useReviewPath` without `workspaceId` or exact identity. `review-path-source.ts` therefore supplies no live controller. Parent `factsByKey` only covers the current PR. Other rows cannot show Mapping/Path ready regardless of persisted state.

**Probe:** a real React workspace first loads a ready path through the production tRPC client/IPC-link transport double; then the same PR is rendered as a non-current queue row. Expected `Path ready`; actual `Status unavailable`. This is honest unknown text, but the promised queue status integration is missing.

**Classification:** frontend placeholder left disconnected after backend integration. **Fix direction:** resolve registered review workspace identities or expose a scoped batch status read for queue rows; keep unknown for genuinely unavailable metadata.

## Verification matrix

| Area | Result | Evidence and boundary |
| --- | --- | --- |
| Independent correctness probes | **FAIL** | 10 cases: 2 pass, 8 fail; failures reproduce the six findings above. Regular failing tests intentionally retained as regression specifications. |
| Existing focused baseline tests | **PASS** | 148 reported top-level cases across 35 entry files; zero failures. Some are subprocess wrappers; their internal case totals are excluded rather than double-counted. |
| Real native content transport | **PASS** | Existing isolated Electron fixture independently run: 1 case, 3 outer assertions, 2.39s. Real contextBridge/preload + production setupTRPCIPC + snapshot service + disposable Git; immutable content, empty/missing context, missing-revision refusal. |
| Storage/runtime/task/MCP | **PASS with doubles** | Actual migrations, SQLite, router/control-plane/capability handlers; runtime boundary tests use provider and daemon doubles. Partial progress, own-run cancellation/races, retry, startup interruption, superseded writes and local-only findings exercised. |
| Provider/identity/thread metadata | **PASS with doubles** | Complete manifests, malformed/pagination/revision failures, GitHub IDs, Bitbucket UUID/root/reply/outdated/unknown-resolution mapping exercised. No authenticated provider success claimed. |
| Ask selection and late delivery | **PASS with doubles** | Current conversation/full identity, correlated anchors, pending/failure selection, changed-head/unmount launch fencing exercised by bounded existing suites. Terminal reachability fails separately. |
| Closed/merged PRs | **PASS, UI contract** | Independent rendered shell checks banner, disabled Submit/Start Review, read-only prop to diff; diff implementation substituted, no provider write attempted. |
| Queue scope/settings/auto ledger | **PASS bounded / FAIL status** | Provider-key separation, author exclusion, navigation helpers, settings sync and auto-claim helpers pass. Non-current row status integration fails. No long-running production poller soak. |
| Legacy submit/reply/resolve | **PASS bounded / FAIL revision** | Existing publisher tests pass, including retry/dedup/follow-up resolution with test providers. Stale publishing fails independently. No external submissions. |
| CLI installation/configuration | **READ-ONLY CHECK ONLY** | Codex and Claude executables found. Both existing global configs contain enabled SuperiorSwarm entries with existing launcher commands; no tool allowlists; Codex forwards task-token env name. Inspected only safe booleans, no credentials emitted or files changed. Actual invocation/tool discovery unverified. |
| Production build/global TS | **NOT RE-RUN** | No production changes. Baseline build success and unrelated TS failures are parent evidence, not independent green claims. New tests execute under Bun; scoped Biome and diff check pass. |
| Physical rendering / real agents | **UNVERIFIED** | No full ReviewWorkspace + real Monaco + live CLI + authenticated provider E2E, no trust/permission interaction, no visual sign-off at 1512×945. Existing native test covers content transport only. |

## Reproduction and artifacts

Run from `apps/desktop` so `bunfig.toml` loads Electron mocks. No package install or native rebuild is needed. The two test files isolate global provider/DB or module doubles in child processes; direct-child commands show substantive counts:

```sh
FILE_BROWSER_TEST_CHILD="$PWD/tests/review-v4-independent-storage.test.ts" bun test tests/review-v4-independent-storage.test.ts
FILE_BROWSER_TEST_CHILD="$PWD/tests/review-v4-independent-renderer.test.tsx" bun test tests/review-v4-independent-renderer.test.tsx
```

Logs are local under `/tmp/agent-reading-v4-validation/`. Each existing batch command was `bun test` followed by these exact files, from `apps/desktop`:

| Log | Files under `tests/` | Reported result |
| --- | --- | --- |
| `runtime.log` | `review-path-runtime-integration.test.ts review-path-control.test.ts review-path-application.test.ts` | 5 pass |
| `core.log` | `review-path-storage.test.ts review-path-boundaries.test.ts review-path-ask-conversation.test.ts review-path-execution.test.ts review-path-live-source.test.ts review-path-reconcile.test.ts` | 28 pass |
| `provider-queue.log` | `provider-file-completeness.test.ts bitbucket-thread-metadata.test.ts provider-reviewer-identity.test.ts review-queue.test.ts review-path-auto-map.test.ts review-path-settings-sync.test.ts` | 24 pass |
| `ui.log` | `review-live-workspace.test.tsx review-workspace-panel.test.tsx review-workspace.test.tsx review-path-launch-delivery.test.tsx` | 4 pass |
| `rendering.log` | `review-workspace-step.test.tsx review-inline-zones.test.tsx review-selection-actions.test.tsx review-workspace-rail.test.tsx review-snapshot-renderer.test.tsx` | 5 pass |
| `legacy.log` | `ai-review-auto-trigger.test.ts review-publisher.test.ts review-mode-nav.test.ts review-mode-store.test.ts review-keymap.test.ts` | 43 pass |
| `content-launch.log` | `review-snapshot.test.ts review-snapshot-context.test.ts review-snapshot-router.test.ts review-connected-terminal.test.ts review-path-launch.test.ts` | 38 pass |
| `native-content.log` | `review-snapshot-electron.test.ts` | 1 pass |
| `independent-storage-red.log` | direct-child command above | 0 pass / 3 fail |
| `independent-renderer-red.log` | direct-child command above | 2 pass / 5 fail |

**Baseline delta:** existing selected suites have zero failures at the requested merged baseline. The new probes reveal eight previously uncovered assertions; they do not represent eight independent defects. No production fixes were applied, so the regression cases remain red. The initial implementation handoff claims are not substitutes for these results.

**Residual risks:** snapshot reads have bounded two-request concurrency and no renderer-to-main cancellation propagation; no stress or sustained memory profile was run. Live controller caches, runtime launch promises, run documents and prompt files have no demonstrated pruning bound. LSP definition locations still come from mutable worktree/server state even though opened content is pinned. Left-side selection-to-Ask/comment parity was not native-tested. GitHub's thread/comment pagination caps remain. These are limitations or review follow-ups, not additional reproduced failures.

**Containment:** only the two new test files and this report were committed. Temporary dependency links were created only in this worktree and removed at completion. Disposable DB/Git fixtures used; no live app DB writes, global config changes, installs, shared native rebuilds, external comments/messages, merges or pushes. Graphify rebuild and normal commit hook ran but reported `ModuleNotFoundError: graphify`; no bypass or graph edits.

**Self-evaluation (ecc:agent-self-evaluation):** accuracy 4/5 (each finding has observed behavior; native/live scope bounded); completeness 3/5 (no authenticated combined CLI/provider/Monaco E2E or resource soak); clarity 4/5 (severity, provenance and matrix separate); actionability 4/5 (isolated red probes and exact source anchors; production fixes intentionally parent-owned); conciseness 4/5 (long report needed for audit commands). Overall 3.8/5. Highest-impact improvement is a dedicated isolated combined native/live run after these fixes, followed by sustained polling/resource validation. The user should regard this as a completed bounded code review with explicit release limits, not full live acceptance.
