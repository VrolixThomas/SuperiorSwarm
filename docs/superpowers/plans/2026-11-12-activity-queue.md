# Activity queue: investigation and implementation plan

Status: all three Codex implementation lanes integrated locally on `activity-queue`, including the terminal attachment guard and native Electron regression. Build and focused acceptance checks pass. Live authenticated Codex session acceptance remains limited by the account/workspace-routing startup timeout reported below. Nothing has been pushed or released.

Parent: `activity-queue`, workspace `ixF_z5zm1lQJvV0ltE9_p`, project `r5z5VhZC2XuA29LGyuTfy`.
Source baseline: `17a316bf5fd73c0c6883128637398aa14bb81c05`.

## Outcome

Give the operator one list answering “what needs my attention next?” across projects: agents waiting for input, agents ready for another instruction, PRs requesting review, and PRs with meaningful updates since they were handled.

Use a persistent **Queue N** button above the existing sidebar segments, with the same entry point in the collapsed rail. Open a compact, viewport-bounded panel without changing the active workspace. Keep the four existing segments. Adding a fifth segment would couple the queue to workspace restoration and crowd the current 232–360px sidebar.

This first version derives tasks from existing agent and PR activity. Manual todos, scheduling, snoozing, automated replies, automatic review submission, and automatic agent dispatch are follow-up features.

## Product behavior

| Group | Inclusion | Resolution / return |
| --- | --- | --- |
| Needs input | Explicit workspace `blocked`/needs, a validated session `needs-input`, or a currently unanswered agent question | Resolve when the relevant source resumes, the exact question is answered, or the operator handles that occurrence; a new occurrence returns |
| Ready agents | Explicit workspace `done`, or a validated turn-ended event | Distinguish “Task complete” from “Ready for next input”; a newly created/idle shell is not completed work |
| PR review needed | Open, known non-draft PR with a current request for this user's review; also a ready AI review draft with a precise label | Remove when request/draft is handled or no longer applicable; never imply CI success or merge readiness |
| PR updated | Meaningful head, review, comment/thread, or relevant readiness change after a known baseline | Show the reason; unchanged polling never counts; first discovery is not an update |

Default to all projects. Provide category and project filters and a way to inspect handled items. Order by needs-input, PR-review-needed, PR-updated, ready-agent; newest meaningful activity first within each group, with deterministic ID tie-breaking. Keep all reasons on a PR row, but count that PR once and place it in its highest-priority group. Preserve distinct terminal/session identities within one workspace.

Rows show action, title, project/workspace or repository/PR number, reason, and relative age. **Open** navigates; **Handled** acknowledges the displayed revision. Merely viewing the panel, changing filters, opening a workspace, or opening a PR does not acknowledge anything. Acknowledging an older revision must not hide activity arriving concurrently. “Handled” is local attention state, never agent task completion, GitHub approval, or review submission.

## Evidence from the current implementation

Paths below are relative to `apps/desktop/`.

- `src/main/services/workspace-service.ts:setStatus` persists `currentPhase`, `statusText`, `needs`, and `statusUpdatedAt`; these describe task intent. `agent_messages` has durable question/answer correlation through `inReplyTo`.
- `src/main/services/agent-session-manager.ts:handleAgentEvent` persists independent terminal state. Hook `task-complete` becomes `idle`: it is a turn ending, not proof of task completion. Codex's hook mapping currently has SessionStart/Stop but no needs-input mapping.
- `src/renderer/stores/agent-alert-store.ts` is transient, keyed only by workspace, and loses terminal identity/time. `useAgentAlertListener.ts` falls back to the currently focused workspace for unscoped alerts. Neither is safe as queue truth. Existing workspace clicks also clear these alerts.
- `src/main/ai-review/pr-poller.ts` already runs centrally every 60 seconds and persists `tracked_prs`; reuse it. Its `updatedAt` changes on every poll, its initial normalization uses placeholder review/comment fields, and its current dedupe uses only PR number within a provider. All three are unsuitable for meaningful activity detection.
- PR listings are open-only; absence alone does not confirm closure. Provider failures and partial results must not remove pending work. Existing poller callbacks are single-handler slots already owned by `src/main/index.ts`; do not overwrite them for the queue.
- GitHub's listing includes requested, team-requested, and previously-reviewed PRs. `role=reviewer` is therefore insufficient evidence of an outstanding request. Extend its existing compact multi-alias query with real request/draft/head/state metadata. Current enrichment helpers can manufacture empty heads, non-draft flags, and fetch-time update dates; do not treat their fallbacks as confirmed facts.
- Local `review_drafts.status=ready` can also mean a manually created draft. Label these “Review draft ready”; claim AI completion only with corresponding completed AI-session/round evidence. Preserve known heads when enrichment fails, and coalesce overlapping manual/timer polls.
- The existing comment poller covers linked worktree PRs, not all queue PRs; GitHub comment reads do not include submitted reviews and have pagination limits. Complete comment/review update coverage requires an explicit provider observation contract; it cannot be inferred from comment count alone.
- `src/main/trpc/routers/ai-review.ts:markCommitSeen` changes review-draft commit data and looks up by identifier without provider. Queue acknowledgment needs its own receipt and must not reuse this operation.
- `src/renderer/components/PullRequestsTab.tsx:openPRWorkspace` plus `tab-store.ts:activateReviewWorkspace` provide the existing PR navigation flow. It may create a review worktree and can fail; keep per-item pending/errors and guard duplicate clicks.
- `tab-store.ts:setActiveTab` can select a terminal in a split pane. Selecting a workspace alone does not identify the emitting terminal or switch away from every sidebar segment. Review terminals also have a separate drawer/view path.

## Architecture and invariants

The main process owns a durable current-attention projection. Existing agent and PR sources feed it; renderer components query it through preload/tRPC. Do not create a renderer-only alert feed or replay an unbounded event journal on startup.

1. Define shared typed items, source observations and navigation targets in `src/shared/activity-queue.ts`. Use stable source identity, semantic fingerprint, monotonically increasing occurrence/revision, reason codes, meaningful observed time, and source availability. Keep polling freshness separate from semantic activity.
2. Persist current source observations/baselines and versioned attention receipts in SQLite. The schema owner chooses the smallest tables that preserve these invariants. Updating a source and its queue projection must not leave contradictory state. Retain enough inactive source state to distinguish first discovery, duplicate delivery, and a new occurrence after resolution.
3. Keys include provider plus repository plus PR number for PRs; terminal/provider-session identity for session alerts; workspace ID for explicit task status; message ID for unanswered questions. Do not assign unidentified hooks to the focused workspace. Coalesce task/session signals only when identity is proven; one session becoming active cannot clear another session's need for input.
4. Bootstrap from authoritative persisted state. Active/working, answered, deleted, closed/merged and invalidated sources reconcile the appropriate rows. A transient provider failure marks stale/unavailable without clearing or inventing changes. Confirm disappearance and review-request removal through existing provider state/detail APIs with bounded concurrency.
5. Integrate PR observations after successful poll persistence or through an additive observer; retain all existing auto-review handlers. Reuse provider listings and existing enrichment capabilities. Avoid details-per-PR-on-every-render. Correct cross-repository identity before using the poller as queue input.
6. Distinguish unknown values from empty/false. An unknown head, draft flag, review decision, or comment set cannot prove a transition. Semantic fingerprints exclude local fetch time, avatar URLs, and display-only enrichment.
7. Expose `activityQueue.list` (items, total pending count, freshness/error information) and `activityQueue.acknowledge({id, revision})`. A stale acknowledgment returns a conflict/current item rather than hiding it. Initial delivery may poll this local endpoint at a bounded interval and invalidate on existing agent notifications; no new remote polling loop is needed.
8. Navigation targets must retain enough identity to resolve the exact terminal, workspace, Hermes session when supported, or provider/repository/PR. Unavailable targets report an error and remain pending. Opening an agent row must not dispatch a new agent or create an unrelated shell.

### Contract handoff

Lane A publishes the first contract commit before B/C connect to persistence. The required renderer-facing shape is an item with `id`, `revision`, `kind` (`agent-input`, `agent-ready`, `pr-review`, `pr-update`), `title`, `summary`, `projectId`/`projectName` when known, meaningful `occurredAt`, `reasons`, `target`, `acknowledged`, and `stale`. `list` accepts optional `projectId`, `kinds`, and `includeAcknowledged`, and returns `{ items, totalPending, updatedAt, sourceErrors }`. `totalPending` is global; filtered counts derive from returned items. `acknowledge({id, revision})` reports success or a stale-version conflict without modifying a newer revision.

The target is a discriminated union for workspace, exact terminal, PR, and Hermes conversation. PR targets include provider, owner, repo and number, plus available branches/title/local project linkage; terminal targets include workspaceId and terminalId, with provider/session identity for validation. A queue row may be unavailable rather than fabricating a target.

The PR adapter needs a durable previous source observation and an atomic operation to replace that observation plus its current candidate (or resolve it). A publishes explicit typed read/observe/resolve signatures together with the contract; B validates stored snapshot payloads. Core must preserve a monotonic revision across A→B→A semantic changes. A same-state duplicate observation is not a new occurrence. A/C agree on milliseconds versus ISO strings in the shared type, rather than leaving conversions implicit.

Prioritize a working end-to-end slice with durable workspace blocked/done/questions and confirmed PR review/head changes. Add identity-validated session-turn and remote review/comment observations within the same ownership boundaries. Any provider coverage or Hermes recovery limitation must be explicit in the handoff and UI wording; the final integration must not claim a category whose source cannot establish it.

Hermes integration should use explicit runtime approval/input states and stable profile/session identity, not unread counts or generic idle status. If those signals cannot be integrated safely in the first slice, document the precise limitation and preserve the target contract for the follow-up.

## Work allocation and dependency order

All dispatched agents use **Codex**. Branches were created from `activity-queue` at the source baseline above. Do not merge or publish during these handoffs.

| Lane | Workspace / branch | Ownership | Deliverable |
| --- | --- | --- | --- |
| A: queue core + agent sources | `F7IWNKqwtfIYR62SgQrNo` / `activity-queue-agent-state` | Shared activity contract; queue schema/migrations; main queue persistence/service/router; agent status, question and validated hook adapters; focused tests | Durable revision-safe queue with real agent sources; first commit stabilizes contract/API for B/C |
| B: PR sources | `dWRxYctUakAtIogiXxKoi` / `activity-queue-pr-state` | Provider normalization; existing PR poller integration; `main/activity-queue/pr-source.ts`; PR/AI-draft classification and tests | Correct reviewer/draft/update semantics, stable provider/repo identity, bootstrap and failure handling |
| C: UI + navigation | `F7_U25s0aO-DtBV-fQe9b` / `activity-queue-ui` | Renderer Queue button/panel, shared navigation helper, sidebar/rail mounts, command registration, necessary narrow tab-store changes, UI tests | Keyboard-accessible queue and correct destination navigation |
| Integration | Parent `activity-queue` | Plan, contract arbitration, cherry-pick order, cross-lane review and integrated acceptance | Reviewable integrated change after lane handoffs |

A owns all DB schema/migration edits and the shared contract. B requests any schema additions from A rather than editing the same files. C does not invent a duplicate contract. A sends a contract commit and API signatures first; B/C can build pure classification/presentational pieces independently, then consume that commit. Each lane works only in its worktree, reports blockers and exact test results, and returns commit SHAs and known limitations. No peer worktree edits. No additional agent fan-out without parent coordination.

## Acceptance and verification

- Persistence: pending and handled rows survive restart; repeated identical source observations remain handled; new semantic activity reappears; acknowledgment of revision N cannot hide N+1.
- Agents: two terminals in one workspace remain independent; explicit question answer resolves only that message; working supersedes the relevant ready item; stale/missing identity never lands on the focused workspace; Stop is not labelled task completion.
- PRs: the same number in two repositories/providers remains distinct; draft PRs do not appear as review-ready; first baseline creates review requests but no fake updates; unchanged polls create no updates; a new head/comment/review does; missing enrichment retains known facts; errors/partial pages cannot falsely close work; explicit closure removes pending items.
- Navigation: from each sidebar segment and collapsed rail, open the exact terminal/split pane/review drawer or correct PR review workspace. Duplicate clicks do not launch duplicate work. Errors preserve attention. Workspace Back history has no accidental intermediate destination.
- UI: global and filtered counts match unique pending rows; loading/error/stale/empty states differ; Open/Handled use separate buttons; visible focus, keyboard access, labelled dialog, Escape, focus return, and destination focus all work.
- Run focused Bun tests for changed behavior, relevant TypeScript checks and targeted Biome checks. Compare any existing failures against baseline; repository guidance warns that full-suite runs suffer timeout/fd-exhaustion failures. Integration additionally builds the desktop and runs a native/manual queue scenario. Do not claim native acceptance from unit tests.

## Dispatch record

Three Codex investigation sessions were started and verified in the correct project. The two initial default-Claude launches were superseded after the user's Codex-only correction. The parent uses a fresh local SuperiorSwarm MCP client with the exact workspace identity because the conversation's preconnected connector inherited a different project's identity.

Research results: lane A ran 80 existing tests successfully (hook listener, Codex hook mapping, Hermes view model); five additional suites could not load missing dependencies. Lane B's seven selected suites could not load `drizzle-orm`. Lane C completed a read-only navigation/accessibility audit. These are investigation checks, not evidence that the new queue works. Implementation lanes may install dependencies with Bun using the existing lockfile; report setup or baseline failures separately from changed behavior.

The implementation prompts authorize local implementation, focused validation and scoped commits; no merges, pushes, releases, review submissions or unrelated repairs. The parent owns final integration. Because legacy workspace `cliPreset` can remain `claude` after a Codex dispatch, each implementation launch must explicitly set `cli_preset=codex`; do not use a legacy resume fallback that could select Claude.

Implementation dispatch receipts (2026-11-12, SuperiorSwarm returned `status: started`):

| Lane | Codex terminal/session ID | Contract dependency |
| --- | --- | --- |
| A: core + agents | `CFFIXWdw8Vlq8QIb1xlDq` | Publish contract/API commit first, then continue core implementation |
| B: PR sources | `CKayMnkFL5BJEXfS78g55` | Pure classification/provider work now; consume A's contract for persistence integration |
| C: UI/navigation | `WoCm5oOrxo4xswAXDU1SW` | Presentation/navigation work now; consume A's contract for typed tRPC integration |

Integration consumed A's three commits, B's two commits and C's three commits, then added C's atomic terminal guard (`ab721e01`, integrated as `a36512de`). The parent added readable source labels and real Electron coverage. Dependency-only cherry-picks in child worktrees were not duplicated.

## Added acceptance gate: Codex/Claude status reliability

User report: in longer Codex threads, agent status does not always update. This is a required part of the feature, not an optional queue polish task.

Parent reproduced an adapter defect on the source baseline: `SessionStart -> Stop -> UserPromptSubmit -> PostToolUse -> PermissionRequest` leaves Codex at `task-complete`, because every event after Stop maps to null. Both repository code and the installed SuperiorSwarm entries in `~/.codex/hooks.json` register only SessionStart/Stop. Claude's current mapping correctly returns to active on subsequent prompts/tools and needs-input on permission requests. This confirms missing event coverage; it does not establish that every reported long-thread failure has the same cause.

Official sources checked on 2026-11-12: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [Claude hooks](https://code.claude.com/docs/en/hooks). Installed CLI reports `codex-cli 0.167.2`; older long-lived processes may still use 0.166.0. Use provider-supported events and preserve turn/session identity through the generated hook script, listener, manager, queue and renderer. Codex per-turn events expose `turn_id`; compaction is not completion. New/changed nonmanaged Codex hooks require review/trust, so installation alone does not prove delivery. Do not bypass trust or silently change global user configuration while testing this branch.

Lane A owns producer mappings/setup and main-process processing. Lane C owns renderer convergence. Required tests and evidence:

- Run at least 50 sequential turns using the same provider session through the real manager/queue ingestion path. Include prompt, tool success/failure where supported, approval waiting, completion, compaction, resume and interruption. Do not test only the event-map dictionary.
- Assert each subsequent turn becomes active, only its own completion becomes ready, and permission waiting is visible. Acknowledge an earlier completion and ensure the next genuine completion returns.
- Inject duplicate and delayed prior-turn events, a replaced provider session, two terminals in one workspace, and subagent events. Reject invalid identity/obsolete generations before broadcasting to the renderer, not only in queue persistence.
- Test the generated hook parser and HTTP delivery with real JSON fixtures, including nested similarly named fields. Preserve top-level provider/turn identity; do not infer it from matching text in transcript/tool payloads.
- Verify renderer remount/reconnect and main restart converge to authoritative state. Unattributed events must never fall back to the currently selected workspace. Keep explicit task phase distinct from terminal activity; no completion inference from silence or transport failure.
- Inspect hook delivery failures, persisted auth-token reuse and listener-port changes for surviving terminals. Document transport/version limitations and distinguish controlled replay evidence from an actual long-lived native session check.

The controlled status acceptance gate now passes: 55 sequential turns per provider exercise HTTP listener, manager and SQLite state, while the generated hook bridge is tested as a real process. Live authenticated CLI verification remains a separate limitation; these controlled fixtures do not claim a real 55-turn Codex/Claude conversation.

## Integrated acceptance results

- All eight original implementation commits integrated without conflicts. The remaining native navigation race is closed by an explicit `attach-existing-only` intent carried through every restored terminal pane, production preload/main IPC and the daemon client. Existing daemon attach is atomic and never creates a PTY; legacy empty-buffer success uses an ordered attach/list response barrier. Ordinary terminal creation retains its existing behavior.
- Production desktop build passes after integration, including the final guard and UI polish.
- Parent reran 95 core/agent/hook tests, including 55 turns for each provider. PR checks passed in isolated processes: 130 provider/classification/source tests, one actual poll integration test and one actual GitHub adapter test. Renderer queue/live/identity and existing tab-store checks passed. These groups overlap other lane coverage; their counts should not be summed as one unique total.
- Parent reran all 321 focused guard tests: 54 daemon; 161 navigation/store; 62 IPC/legacy/native-PTY; 13 preload; 31 Terminal component. The native PTY case initially exposed missing executable mode on the dependency's spawn-helper after script-free installation; restoring the package's expected local executable mode made that test pass. No user configuration was modified.
- New `tests/activity-queue-electron.test.ts` uses the production preload, real Electron/Chromium, real SQLite migrations and the production tRPC/router/service stack in an isolated home/profile. It verifies hook→UI updates, durable acknowledgment after DB reopen, duplicate/late Stop rejection, next-turn input after compaction, agent+PR rows together, Open preserving attention, and Escape/focus return. It additionally runs the real PTY/server/client through production terminal IPC, disposes a terminal inside atomic attach, and verifies the clone-safe failure plus zero replacement shells. This native regression passes.
- Biome checks all 78 changed TypeScript/JSON source/test files with zero errors; three existing non-null assertion warnings remain. Diff whitespace checks pass.
- Final TypeScript checks retain inherited failures: main 61 versus baseline 66; renderer 81 versus 86; tests 203 versus 208; preload 0. Comparing diagnostic file/code multisets gives no new diagnostics. The five removed errors were in PR source typing; unrelated baseline errors were not broadened into this feature.
- Dependency installation initially stalled at resolution; parent reused an isolated filesystem clone of the same-lockfile lane dependencies. Native testing used the existing Electron 40.8.5 runtime and an ABI-compatible local SQLite addon. No lockfile or global profile changes were needed.

Reproduce from `apps/desktop`: `bun run build`, then `bun test tests/activity-queue-electron.test.ts` with the repository's native dependencies installed. `ELECTRON_OVERRIDE_DIST_PATH` can select an existing compatible Electron distribution; `SS_KEEP_QUEUE_FIXTURE=1` retains the disposable profile/result/screenshot for inspection. Focused tests use the existing `tests/preload-electron-mock.ts`; native Electron itself does not use that shim.

Remaining limits:

- A newly dispatched reviewer failed twice before starting: Codex `account/read` reported `workspace routing discovery timed out (code -32603)`. Parent verified the failure, retried once in the same terminal, then performed the source review locally. The other Codex worker completed the guard. A successful SuperiorSwarm dispatch receipt was not counted as a running or completed review.
- Live Codex hook trust/reload and real authenticated CLI sessions were not changed or claimed verified. Supported hooks and processing are covered by generated-script, transport, manager and native UI fixtures. Changed nonmanaged Codex hooks may require review in `/hooks` after installation. Existing terminal processes may still run an older CLI version.
- Hooks emitted while the whole app/listener is unavailable are not replayed. Legacy payloads without turn/producer metadata retain arrival-order limitations. Hermes ingestion/recovery is deferred.
- GitHub PR updates cover head/state/draft/current requests, latest submitted review and latest conversation comment/count. Older edits and inline-thread resolution are not comprehensively observed. Bitbucket covers head/state/draft/participants/comment count; edits and unchanged-participant repeated reviews are not comprehensive. UI labels describe observed activity rather than claiming complete provider history.
- The repository's optional graphify post-commit hook cannot rebuild because its Python package is unavailable; source commits and verification succeed.
