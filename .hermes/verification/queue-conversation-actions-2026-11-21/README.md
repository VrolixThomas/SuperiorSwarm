# Lane C — exact conversation navigation, replies and context

Codex, 2026-11-21. No subagents. Local isolated worktree only. Original investigation artifacts are unchanged.

## Delivered behavior

- Validated workspace reports and questions select their exact reporting terminal/provider/conversation, including when an unrelated sibling is selected. Coordinator targets resolve the coordinator's own directory, never a linked workspace. Navigation remains attach-existing-only; it never launches through `openXroWorkspace`, acknowledges attention, sends input or wakes a provider. The intended PTY is checked independently of dead siblings. Session identity and the pane are checked again after asynchronous inventory, so replacement/closure cannot silently select a sibling.
- Structured questions show the actual question, recipient/chat and delivery state. **Send answer** calls the safe backend with the displayed source ID, revision and question ID. Drafts survive errors and conflicts; a changed revision requires explicit review. Saving does not resume a task or imply the agent read the answer. Saved answer text survives leaving/reopening Queue. Other queue actions are blocked while saving. There is no terminal-write reply path.
- Canonical backend grouping is consumed without renderer row hiding. Done, Undo, Later and Bring back carry every member revision unchanged. Distinct questions, permissions and unrelated chats remain independent; stale canonical items disable actions.
- Context shows project kind/path, workspace/orchestrator/coordinator role, chat title, actual report/reply/request/error text and next action. Linked coordinator projects retain their own kinds/paths. Provider evidence is rendered once with provider/kind/truncation/redaction; technical hook provenance is behind closed **Source details**. Unknown permission outcomes remain explicit and do not ask for approval again or claim execution.
- Narrow Details / reply uses a scrollable view with focus containment and Escape/back return. Handling an item closes that view and focuses the visible next row. Wide and short layouts retain reachable actions.

## Commits to integrate

Lane-C-owned commits, in order (peer dependencies must already be integrated):

1. `03a46223` exact reporter/coordinator navigation.
2. `9bace43b` intended-PTY checks and post-inventory session revalidation.
3. `d44d9501` reply UX, context, member receipts and native acceptance.
4. `f4fa1d9e` focus return after handling from narrow details.
5. `b26c6157` plain-language delivery/provenance and persisted answer display.
6. `f355af71` CLAUDE index pointers (A also cherry-picked an equivalent).
7. `f2eedab8` unknown permission outcome and in-flight action serialization.

Tested with A through `30e8d91a` (including `5315d2a5` transport retrieval confirmation) and B through `62d60436`, native fixture correction `2984ae83` and live report `c7e2efc3`. This branch contains cherry-picked peer commits solely for isolated validation; do not duplicate their equivalents when integrating C.

## Coverage, kept separate

**Unit/model/SQLite acceptance:** 69 passing tests, 324 assertions across navigation, question UI, queue UI/model, ownership and context description. See [focused-tests.txt](focused-tests.txt). The original navigation GAP was replaced with an exact-target acceptance assertion, and the native fixture independently verifies the actual backend reporter projection. Added race/focus regressions failed before their fixes; [focus-regression-red.txt](focus-regression-red.txt) is an expected failure, not a product pass.

**Native stand-ins:** production build followed by both Electron fixtures, run from `apps/desktop`, passed (2 fixtures, 0 failures). [native.txt](native.txt), [native-result.json](native-result.json), [build.txt](build.txt). Native SQLite, isolated Unix socket/PTYs, real preload/tRPC and production shell components are exercised. The full-shell fixture uses a stand-in chat surface; the lifecycle fixture drives benign provider stand-ins through real PTY input. These are not authenticated launch-to-GUI results.

The expanded full-shell fixture checks exact reporter selection over siblings; unchanged pending count/no extra PTY/attach-only intent; canonical grouped Done/Undo/Later/Bring back; stale answer rejection and preserved text; saved answer persistence across navigation; sibling and unidentified inbox exclusion; exact reporter retrieval; coordinator navigation without a surrogate workspace; folder/repo scope; permission pending→unknown without receipt change; failure/error states; keyboard focus and 800×600, 1440×900, 2304×1296 and 1200×500 geometry.

**Live providers:** not rerun by Lane C. Lane B's [separate report](../queue-provider-evidence-2026-11-21/README.md) records actual Claude/Codex probes and distinguishes current-bridge evidence, older trusted Codex bridge behavior, blocked MCP execution and the narrowly approved synthetic Claude action. Its positive-permission result remains **unconfirmed** because provider metadata lacks a correlatable outcome. No live pass is inferred from these native fixtures.

**Unverified:** final parent-branch integrated recheck (explicit follow-up task), authenticated production dispatch through the shipped GUI, and automatic positive permission resolution where provider metadata is absent. No universal E2E readiness claim.

**Static checks:** owned-file Biome and `git diff --check` pass. Renderer/test TypeScript checks have existing repository diagnostics; [type-check.json](type-check.json) records totals and zero diagnostics in C-owned paths. This is not a globally clean type-check claim or a baseline-delta claim.

## Screenshot evidence

- [Narrow queue](queue-800x600.png), [wide queue](queue-1440x900.png), [short scrolled actions](queue-short-scrolled.png), [narrow question details](queue-narrow-details.png).
- [Report and actual reply](queue-report-context.png), [permission request](queue-permission-context.png), [unknown permission outcome](queue-permission-unconfirmed.png), [provider failure](queue-provider-failure.png).
- [Stale question and preserved draft](queue-question-conflict.png), [saved/not-yet-read answer](queue-question-saved.png), [coordinator directory and linked scope](queue-coordinator-context.png), [recoverable query error](queue-error.png).

Screenshots contain synthetic fixture data only. Long requests and context remain scrollable; they are not silently clipped to four evidence lines.

## Constraints and reproduction

Temporary dependency links point to the parent's compatible installation and are removed after verification. `bun.lock`, installed/dev DB policy and both running apps are untouched. No merge, push or release; no global trust changes or unsafe provider approval. Graphify's normal hook and explicit rebuild attempt report its known missing module; it was not installed and hooks were not bypassed.

From `apps/desktop`, with compatible dependencies available:

```sh
bun test tests/queue-model.test.ts tests/activity-queue-navigation.test.ts tests/queue-view.test.tsx tests/queue-question-reply.test.tsx tests/activity-queue-ownership.test.ts tests/describe-workspace-item.test.ts
bun run build
SS_KEEP_QUEUE_FIXTURE=1 bun test tests/activity-queue-electron.test.ts tests/workspace-queue-electron.test.ts
```

## Self-evaluation

Applied `ecc:agent-self-evaluation` to this lane's delivered scope. Overall **4.0/5**.

| Axis | Score | Evidence and remaining improvement |
|---|---:|---|
| Accuracy | 4 | Real backend/native assertions and honest delivery labels; authenticated production GUI remains unverified. |
| Completeness | 4 | All lane-C acceptance areas covered; final parent integration is a separate requested recheck. |
| Clarity | 4 | Plain-language answer state and optional technical provenance; long linked paths still require scrolling in narrow windows. |
| Actionability | 4 | Tested commit order and reproduction commands supplied; depends on the listed A/B changes. |
| Conciseness | 4 | Small production changes with extensive acceptance fixtures; the fixture could later be split for easier maintenance. |

Highest-impact follow-ups: run the requested final integrated recheck; separately verify authenticated production-launch/GUI coverage without broad provider permissions. The user should agree this is a verified lane result, not a claim that the explicit live-provider limitations disappeared.
