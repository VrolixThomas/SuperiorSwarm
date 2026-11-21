# Independent queue POST-PATCH verification — 2026-11-21

**Verdict: PASS for the remediated queue acceptance criteria and the isolated actual-provider vertical path described below.** No reproduced actionable defect remains in that tested scope. **Unqualified shipped-app/TUI, real process hibernation, and whole-app restart readiness remain UNVERIFIED.** The provider permission-outcome limitation is explicit and conservatively handled, not counted as successful automatic approval resolution.

Final integrated staging HEAD: **`c310be8308450537da3e4c315d9b9f7402405923`**. Functional implementation: `7e244cbfbbb0824f754d0b795b508138100f6784`; subsequent staging commits added evidence, comments, test-output isolation and test-only capture/focus activation. The full native matrix ran at investigation checkout `764661c8357bd409fc5440bbc5dbad47647bc517`, integrated staging `f9921a2d74d68adb3528f37c1d34e3a49d0afb81`, with test-only capture instrumentation subsequently committed as `a24aea71`. Production source/MCP trees were checked identical to final staging. Final integrated checkout and hashes are recorded in [manifest.json](queue-e2e-postpatch-2026-11-21/manifest.json).

Codex investigated independently without subagents. Only root staging was integrated, using git merge; no implementation-lane branch was directly cherry-picked. Test-only merge conflicts preserved both upstream behavior and independent assertions. BEFORE report/evidence are unchanged. No production semantics were edited by this investigator; no push, release, merge back to parent, user-chat alteration, global trust/settings change, or shared installed/dev state-policy change occurred.

## What the live result proves

**16 of 16 cases passed in one 248.28-second run.** Each case launched an actual authenticated provider twice for the owning conversation and once for an unrelated sibling. There were no fabricated provider callbacks. Manual cases began with terminal ownership only: an assertion required no pre-registered `agent_sessions` row. Managed cases used production `dispatchAgent`, asserted the managed flag survived real SessionStart, and honored the provider session ID minted by production dispatch.

The continuous path was:

`production launch script / dispatchAgent → isolated real PTY → actual Claude or Codex CLI → real hooks and actual MCP set_status → production listener/manager and native Electron SQLite → production preload/tRPC and MainLayout/QueueView → exact conversation selection and attach-existing-only → real same-session follow-up → fresh completion → SQLite reopen → production terminal.dispose cleanup`

A small **print/exec readline adapter** changes CLI invocation mode and invokes the real provider for each turn; it never emits hooks or substitutes model output. Dispatch uses an isolated real-PTY `spawnFn`, not the shipped renderer's complete dispatch bootstrap. A fixture textarea sends input through production terminal IPC. This is stronger than joining separate provider-shaped and live probes, but **is not the interactive provider TUI or full shipped application**.

Each case additionally verifies:

- The first actual MCP status write belongs to the actual provider session; cold MCP initialization may initially return a lease, but the first usable action must be exact without restarting MCP.
- A real sibling prompt/completion does not clear or revise the owner's report. The sibling starts selected; queue navigation must select the owner. After the owner's reply/closure, the sibling's completion remains.
- The exact rendered queue row exists before capture; screenshots show real synthetic task/request content, not a fixture-only lifecycle label.
- Reading, setting visibility and typing before Enter preserve attention. Accepted submission clears old owner attention only, and later genuine completion returns.
- Follow-up stays in the same actual provider session. Close uses production preload/main dispose IPC and removes that reporting session despite a surviving sibling.

The fixture uses an isolated profile, native DB, Unix socket, PTYs, temporary folder and real temporary git repo/worktree. Both installed/development user apps stayed running and unchanged. The adapter uses explicit window activation and test-only `backgroundThrottling:false` to make captures deterministic under macOS occlusion. This does not establish production background-rendering or physical-keyboard behavior.

## Provider × entity × launch matrix

**P** = passed at the stated layer; **F** = reproduced failure; **U** = unverified. “Coordinator” here means an in-app `kind=workspace` cross-repo orchestrator. External/Hermes manager entities remain outside this queue projection and are not silently included as supported.

| Provider | Entity | Manual, real CLI | Dispatched, real CLI | Live context/navigation evidence |
|---|---|---:|---:|---|
| Claude | Repo/worktree | P | P | [manual](queue-e2e-postpatch-2026-11-21/claude-worktree-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/claude-worktree-dispatch-queue.png) |
| Claude | Folder | P | P | [manual](queue-e2e-postpatch-2026-11-21/claude-folder-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/claude-folder-dispatch-queue.png) |
| Claude | Repo orchestrator | P | P | [manual](queue-e2e-postpatch-2026-11-21/claude-orchestrator-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/claude-orchestrator-dispatch-queue.png) |
| Claude | Cross-repo coordinator | P | P | [manual](queue-e2e-postpatch-2026-11-21/claude-coordinator-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/claude-coordinator-dispatch-queue.png) |
| Codex | Repo/worktree | P | P | [manual](queue-e2e-postpatch-2026-11-21/codex-worktree-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/codex-worktree-dispatch-queue.png) |
| Codex | Folder | P | P | [manual](queue-e2e-postpatch-2026-11-21/codex-folder-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/codex-folder-dispatch-queue.png) |
| Codex | Repo orchestrator | P | P | [manual](queue-e2e-postpatch-2026-11-21/codex-orchestrator-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/codex-orchestrator-dispatch-queue.png) |
| Codex | Cross-repo coordinator | P | P | [manual](queue-e2e-postpatch-2026-11-21/codex-coordinator-manual-queue.png), [dispatch](queue-e2e-postpatch-2026-11-21/codex-coordinator-dispatch-queue.png) |

Native coordinators have both linked repo and folder projects. Dynamic `accessScope=all` context/authorization is separately tested at service/HTTP boundaries. Manual cases reply directly through ordinary conversation selection; dispatched cases reply after Queue Open. Full per-case targets, session IDs, revisions, scoped tool calls and callback timing: [native-live-results.json](queue-e2e-postpatch-2026-11-21/native-live-results.json), [native-mcp-startup.jsonl](queue-e2e-postpatch-2026-11-21/native-mcp-startup.jsonl), [run log](queue-e2e-postpatch-2026-11-21/native-full16.log).

## Required behavior matrix and limits

| Requirement | Result | Evidence / qualification |
|---|---|---|
| Exact Open with sibling selected or dead | P | Real selected sibling in live matrix; dead-sibling and missing-owner navigation in source/native regressions. No replacement shell |
| Conversation changes during inventory | P | Navigation rechecks session/pane after inventory; question mutations and managed resume reject identity changes |
| Open/read/type/wake-only does not clear | P | Live visibility/typing cases and native stand-ins; actual TUI process wake remains U |
| Direct and post-Queue accepted follow-up | P | All 16 live cases, same actual provider session; sibling attention survives |
| Later genuine completion returns | P | All 16 live cases; earlier report gone, fresh turn-end source present |
| Explicit working with identity, missing prompt hook | P | Actual current stdio MCP subprocess + native/server tests; old turn retired, old replay rejected |
| Missing/old MCP identity | P conservative boundary | Installed legacy/current missing-ID subprocesses cannot borrow another owner; exact-reply capability is unavailable |
| Cold manual bootstrap | P after additional fix | No pre-registration in live manual cases; immediate catalog plus first-generation admission, not current/latest-session guessing |
| Stale MCP after replacement | P | Controlled real-MCP tests reject old pinned process and first-generation lease after replacement; no silent rebind |
| Saved answer vs actual retrieval | P transport layer | Correlated UI saves without clearing; exact MCP fetch/receipt clears. Wrong sibling/recipient does not retrieve or clear. Model comprehension/action is U |
| Recipient inbox fairness | P after additional fix | More than 200 sibling-only messages cannot starve the owner's unread answer; bounded unread draining and `since` behavior covered |
| Close/replacement with surviving shell | P | Live dispose removes owner while real sibling remains; replaced-generation and question-owner cases covered |
| Grouped Done/Undo/Later/Bring back | P | Exact member revisions, stale standalone/group-member races, changed sources, expiry and concurrent receipts; native QueueView interactions |
| Fresh callback, stale/out-of-order/replayed Stop | P tested identities/windows | Listener/manager/source and native tests, including 55-turn/provider regressions; uncertainty-only changes do not resurrect Done/Later |
| Real task/request/reply context | P with capability limit | Real MCP needs for both; current Claude bridge captures actual reply. Current Codex evidence-bearing bridge remains U live because global reviewed bridge is older |
| Permission metadata/outcome | P conservative behavior | Actual scoped-approved Claude action executes, but missing correlated outcome remains unconfirmed; no repeated-approval claim, no inferred success |
| Failure classification | P controlled | StopFailure evidence/receipt persistence and rendered error context. Actual provider API-error task execution remains U |
| Daemon disconnect/reconnect | P native transport | Pending agent attention retained across real socket disconnect/reconnect, availability updated |
| App restart | P SQLite reopen/bootstrap; U process restart | Live matrix reopens native SQLite. Complete shipped app/provider restart was not performed |
| Hibernation / MCP resume_agent | P service/HTTP/command boundaries; U live hibernation | Both providers' exact coordinator resume/authority/race guards tested; no unrelated provider/shell fallback. No authenticated full API→TUI hibernation vertical claim |
| Current full layout | P | MainLayout/QueueView native fixtures, small/large geometry, scrolling, focus, saved reply, outcome-unconfirmed and conflict states |

A correlated MCP question is deliberately independent of ordinary chat input: typing in the chat does not invent an `inReplyTo` receipt. Use the correlated queue reply. The UI now explains saved versus retrieved and does not claim a saved answer wakes or controls the provider.

## New failures found, fixed, and independently retested

The first 89 existing tests passed at `194a61bb`. New positive acceptance tests nevertheless found the following. They remained failures until root staging supplied fixes; no `GAP` characterization was counted as product acceptance.

1. **Inbox starvation — F → P.** Save an owner answer; insert 201 newer sibling-only answers in that workspace; read owner inbox. SQL applied `LIMIT 200` before conversation filtering and returned no own answer. Visibility now precedes the limit and unread exact answers are prioritized/bounded. Original test passes unchanged. Source: `apps/desktop/src/main/services/workspace-service.ts:1211`. Evidence: [initial failure](queue-e2e-postpatch-2026-11-21/independent-final-head.log), [retest](queue-e2e-postpatch-2026-11-21/inbox-scope-retest.log).
2. **Dynamic coordinator context — F → P.** An all-projects coordinator without explicit links showed an empty linked-project context despite authorized repo/folder projects. A shared scope resolver now supplies authorization and context. Sources: `activity-queue/entities.ts`, `services/cross-repo-project-scope.ts`. Same independent reproduction and retest above.
3. **Actual coordinator dispatch — F → P.** Managed registration passed, but production `dispatchAgent(coordinatorId)` still threw NotFoundError at its workspace-only lookup. Real coordinator dispatch now uses its own workDir/provider and whole-scope authorization. Sources: `workspace-service.ts:559`, `:585`; final live coordinator-dispatch cells both pass.
4. **Coordinator resume counterpart — F → P.** Root requested a separate check of `resumeAgent`, not inference from direct chat replies. Both-provider independent tests initially failed. The service now chooses the exact managed session, rechecks scope/identity after waits, and never uses a legacy sibling/Claude fallback for coordinators. Source: `workspace-service.ts:1337`. Evidence: [red](queue-e2e-postpatch-2026-11-21/coordinator-resume-red.log), [42-test green run](queue-e2e-postpatch-2026-11-21/coordinator-resume-green.log).
5. **Real cold Codex MCP permanently unbound — F → P.** Actual optional-MCP initialization returned reporter=null at `1795281804141`; SessionStart arrived 1,630ms later. The same process's later real status call succeeded but stored no owner. A first-registration lease now captures the original validated generation and rejects replacement/expiry/close. Evidence: [initial trace](queue-e2e-postpatch-2026-11-21/cold-codex-mcp-failure/native-mcp-startup.jsonl), [actual first-action red](queue-e2e-postpatch-2026-11-21/cold-codex-first-action/native-cold-first-action-red.log).
6. **Admission fix delayed optional tool catalog — F → P.** The first patch waited for registration inside context initialization. Identity became correct, but default optional-MCP Codex repeatedly lacked the tool on its first turn; a stronger prompt returned `TOOL_UNAVAILABLE`. Setting only the isolated server `required=true` made the vertical pass, proving why that override must not be accepted as default behavior. The final candidate returns the lease immediately and admits asynchronously/post-connect or at first tool. Catalog was sent at `1795284051701`, before SessionStart at `1795284053190`; actual status completed with the exact session, without MCP restart. Evidence: [optional failure](queue-e2e-postpatch-2026-11-21/catalog-readiness-failure/), [required diagnostic only](queue-e2e-postpatch-2026-11-21/required-mcp-diagnostic/), [default optional green](queue-e2e-postpatch-2026-11-21/deferred-optional-mcp-green/). Sources: `control-plane/server.ts:87`, `activity-queue/reporter-admission.ts`, `mcp-standalone/reporter-admission.mjs`.

The delayed-context experiment also showed SessionStart occurring during a 3-second response hold; it did not prove tool-catalog readiness. Both timing concerns were investigated separately. Raw lease values were never written to evidence: traces record admission presence/state and selected reporter identity only.

## Original failure acceptance and migration review

Reports/questions now carry exact reporter targets; Open selects that conversation rather than a selected sibling. Proven same-conversation report/turn sources group without discarding separate revisions. Original ownerless managed-sibling cleanup is conservative; missing-owner reports do not gain guessed owners. Structured questions retain reporter/recipient identity and require exact correlated transport retrieval. Real task text appears with provenance, while missing context remains explicit.

Reviewed actual migrations **0067/0068** and reran the pre-migration populated-DB regression through the migrator: sessions/messages survive, foreign keys remain enabled and clean, unknown/colliding new owners are rejected, and deletion is kind-specific. Historic pre-0067 workspace FK proves workspace ownership; only unambiguous coordinator rows backfill as coordinators. Ambiguous historic workspace/coordinator ID collisions are withheld from queue projection rather than reassigned. Native fixtures also migrate fresh isolated SQLite. A populated user-database upgrade was not attempted.

## Verification and reproducibility

Environment: Bun 1.3.9; Electron 40.8.5; Claude Code 2.1.327; Codex CLI 0.170.0. Installed app remains 0.23.4 with older MCP source. See [environment.json](queue-e2e-postpatch-2026-11-21/environment.json). Existing installed/dev DB collision and its ownership guard were untouched; this report is not a deployment claim for those running processes.

- **50 final acceptance tests / 877 assertions passed**: independent matrix, exact resume, first admission, migration, inbox fairness and actual current/installed/missing-identity MCP. [final-acceptance.log](queue-e2e-postpatch-2026-11-21/final-acceptance.log).
- **Full live/native matrix: 16/16 passed**, 248.28 seconds. The Bun wrapper has two outer assertions; substantive per-case assertions execute inside Electron. [native-full16.log](queue-e2e-postpatch-2026-11-21/native-full16.log).
- **Current full-shell native fixture passed** on final behavior; legacy lifecycle fixture passed after reactivating app/webContents before its resize/key-focus check. [native-shell-final.log](queue-e2e-postpatch-2026-11-21/native-shell-final.log), [native-legacy-final.log](queue-e2e-postpatch-2026-11-21/native-legacy-final.log). The combined log retains the inactive-document legacy failure; the isolated rerun is the final result. No outline/identity assertion was removed.
- Separate authenticated evidence/approved-permission probe passed **34 assertions**. [live.log](queue-e2e-postpatch-2026-11-21/live.log), [live results](queue-e2e-postpatch-2026-11-21/live/live-results.json).
- **188 source/UI/evidence tests / 2,441 assertions passed**; type checking reports **204 diagnostics, exactly matching clean final staging, with zero added/removed**. Details are recorded in [final-source-ui.log](queue-e2e-postpatch-2026-11-21/final-source-ui.log) and [type-delta.json](queue-e2e-postpatch-2026-11-21/type-delta.json). The existing test-project type diagnostics match clean staging; no globally clean type claim is made.
- Desktop build passed. Normal commit hooks reported missing graphify; it was neither bypassed nor installed. Temporary dependency links used the compatible parent installation without lockfile writes and are removed at handoff.

From `apps/desktop`, with those compatible dependencies available:

```sh
bun run build
bun test tests/queue-postpatch-independent.test.ts tests/queue-postpatch-coordinator-resume.test.ts tests/queue-postpatch-bootstrap.test.ts
SS_QUEUE_INSTALLED_MCP=1 SS_QUEUE_EVIDENCE_DIR=<absolute-new-evidence-dir> bun test tests/queue-investigation-mcp.test.ts
SS_QUEUE_LIVE=1 SS_QUEUE_EVIDENCE_DIR=<absolute-new-evidence-dir> bun test tests/queue-investigation-live.test.ts
SS_QUEUE_NATIVE_LIVE=1 SS_QUEUE_NATIVE_CASES= SS_QUEUE_REQUIRE_MCP=0 SS_QUEUE_CONTEXT_DELAY_MS=0 bun test tests/queue-postpatch-native-live.test.ts
SS_KEEP_QUEUE_FIXTURE=1 bun test tests/activity-queue-electron.test.ts tests/workspace-queue-electron.test.ts
```

Native GUI fixtures must run exclusively; competing/occluded test windows can invalidate physical focus assertions. The real-provider fixture uses explicit activation and unthrottled test rendering, retains row/identity/input assertions, and bounds repaint waits. Earlier fixture failures are retained as diagnostics, not claimed product failures or hidden as passes.

Claude uses a reviewed temporary current bridge and isolated settings. Codex reuses only existing reviewed global hook trust via invocation overrides; no global bridge/trust edit occurs. Its live new evidence-bearing bridge remains U. Narrow Codex status approval is invocation-only `enabled_tools=['set_status']` plus per-tool `approval_mode='approve'`; the fixture transport additionally rejects every status body except the exact authorized synthetic blocked/color request. This uses the documented per-tool configuration, not broad approval or sandbox bypass. [Official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Readiness boundary

The tested implementation fixes the actionable findings, including those discovered during this post-patch pass. Cold startup, exact ownership, delivery correlation, grouped receipts and the actual-provider queue/follow-up vertical are green under the stated scope.

Still U: the shipped application's complete dispatch bootstrap/interactive provider TUI, actual provider process hibernation, whole-process app restart with surviving providers, authenticated MCP `resume_agent` through that complete runtime, provider API-error execution, and current Codex evidence transport under newly reviewed hook definitions. The noninteractive adapter cannot prove interactive process sleep; the shipped bootstrap would touch global hook/MCP/shared-app state excluded by the user. No existing user chat or running app was used to fill those cells. Saved/received answers do not establish model comprehension or successful task action.

Claude's missing stable permission request/outcome correlation is an observed capability limit: an actually approved action can remain **outcome unconfirmed** until explicit continuation/confirmation. That is expected conservative behavior, not a repeated demand for approval or inferred permission success. These limits and the excluded installed/dev collision prevent an unqualified whole-app/release-readiness claim.

All tests, selected sanitized evidence and this report are committed locally; hashes are reported separately to the parent/user. No push, merge back to parent, or release was performed.
