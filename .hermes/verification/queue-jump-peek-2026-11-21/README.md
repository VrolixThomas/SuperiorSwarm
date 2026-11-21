# Lane B — exact queue jump, peek and workspace header

Implemented on `feat/queue-jump-peek`, base `89894806`. Owned implementation commits: `abf07628`, `9e131bde`, `fd9a30ed`, `30b17155`. Owned fixture/log/docs commits: `11d0f428`, `ef2e157c`, `30214f72`, `35aa6fd3`; the final evidence refresh follows these. No push/release. Parent integrates locally and independently verifies the combined lanes.

## Behavior and contracts

- `queue.next` is Cmd/Ctrl+J; `queue.peek` is Cmd/Ctrl+Shift+J. Core action and Electron menu source inspection found no existing chord registration. Existing Cmd/Ctrl+1…4 and sidebar shortcuts remain intact; shifted uppercase key events match correctly. Repeated queue keydown events do not cause repeated navigation.
- One canonical `useWorkspaceQueue` query cache supplies pending rows/counts. Later and acknowledged items are excluded. A navigation session pins a cloned exact item, target and all group member revisions. A refresh never advances or silently adopts a new occurrence. Next stops at the end; a removed current item remains an ordering anchor so its shifted successor is not skipped.
- `useQueueNavigationStore.select(item, pendingItems)` is the QueueView Open seam owned/wired by A. Later/absent occurrences do not establish a pending navigation session.
- Navigation calls A's `openQueueItem` wrapper: an explicitly opened live permission wait must first return confirmed `opened`, then existing `openQueueTarget` validates exact entity/terminal/provider/conversation with attach-existing-only intent. It does not approve/deny, acknowledge or write input. Passive viewing/selection never calls this wrapper. Query failure/stale status preserves the current destination and explains retry.
- The collapsed QueueBar is a compact toolbar plus one secondary explanation line; native validation requires at most 80 CSS pixels at the wide size. Detail/reply expansion gets a separate block. Compact buttons have no unsafe letter-key hints; duplicate workspace/chat breadcrumbs are suppressed.
- QueueBar is visible only for the matching entity and visible chat, with the current provider conversation independently checked. A sibling or replacement conversation cannot inherit the old bar. Missing-owner workspace targets cannot present a bar over an arbitrary chat. Done/Later/Undo carry exact grouped receipts; direct reply and permission capability/transport belong to A/C through shared `QueueItemActions`.
- Peek owns plain keys and focus; input/composition suppresses letter actions. Escape restores origin focus; successful navigation/Queue opening suppresses restoration so the destination owns focus. Details and replies scroll at narrow sizes without collapsing rows. Header count scopes Peek to the exact entity and does not change receipts.
- `QueueWorkspaceHeader` uses the parent's `workspaceLinkedContext` query/component. Explicit linked tickets/PRs are read-time display enrichment. Coordinators do not inherit child project links. Structured answer input IDs can be made unique through the optional `QueueQuestionReply.inputId` prop; its default preserves existing callers/tests.

## Verification

- `renderer-regressions.log`: **93 tests / 318 assertions passed** across navigation model, core shortcuts, Peek focus/typing, existing QueueView/question reply, exact navigation, shared conversation reply UI and linked context.
- `backend-regressions.log`: **67 tests / 860 assertions passed**, covering workspace receipts, current inventory, entity ownership, exact inbox scope and conversation replies.
- `build.log`: desktop production build passed.
- Changed renderer files and native fixture/test files have no TypeScript diagnostics in the renderer/test project checks. The overall repository typecheck remains nonzero with unrelated/pre-existing and peer-owned diagnostics; no globally clean typecheck claim is made.
- Biome reports no errors for owned changes. Some pre-existing/new test non-null assertion warnings remain in `queue-jump.test.tsx`; production code has no new warning reported. `git diff --check` passed. Graphify invocation and normal commit hooks report the known missing module; nothing was installed or bypassed.

### Native full-shell semantics — provider stand-ins, not authenticated CLI evidence

From `apps/desktop`, after `bun run build`, run:

```sh
SS_KEEP_QUEUE_FIXTURE=1 bun test tests/queue-jump-electron.test.ts
```

Obtain the exclusive GUI slot before running. The fixture mounts real MainContentArea, MainLayout, Sidebar, QueueView and xterm, using production preload/tRPC, native SQLite and real isolated PTYs. Temporary profile, sockets, folders and terminal inventory are isolated. The database path is asserted beneath the temporary fixture root **before migration**, and the full router is dynamically loaded afterward. No running app is terminated. Only fixture-owned processes are disposed.

`native-green.log`: passed in **36.62 seconds** (two outer assertions; substantive assertions execute inside Electron). Verified:

1. Jump from Queue selects the reporting chat, not its active sibling; terminal-origin Cmd/Ctrl chords navigate/peek without PTY input.
2. Open/peek/typing/context refresh preserve source receipts. Background polling discovers changed revisions without moving the user. Old actions disable until explicit selection.
3. Escape restores exact origin focus; opening the coordinator from Peek focuses its own xterm rather than the previous chat.
4. Peek row geometry stays at least 40px and visible at 800px and 1440px; dialog fits the viewport. The wide collapsed toolbar is at most 80 CSS pixels tall. Header linked-work popup is actually open, in bounds and hit-testable.
5. Full QueuePanel, header and Peek display explicit Linear UUID-backed SUP-46 and a provider/repository-qualified PR; metadata refresh preserves source revisions.
6. A structured answer is saved exactly once, is invisible to the sibling inbox and is retrieved by the exact reporting conversation. This proves transport retrieval, not model comprehension.
7. Clearing the current question does not skip the shifted successor. Grouped Done clears every member; Undo restores; Later is excluded; timed expiry returns through background polling without navigation; Next stops at the end.
8. Coordinator navigation retains its own entity/chat. Replacing its provider conversation removes the old bar.
9. **Zero post-seed replacement terminal creates and zero PTY writes** during these actions; original terminal inventory survives. The explicit additional coordinator PTY is fixture setup, excluded from the replacement counter.

`result.json` stores the semantic outcome. The final run includes the permission-aware Open adapter and compact toolbar; its permission source remains a stand-in without a held hook. A focused red/green hook regression separately proves exact release before navigation, no release on passive mount/peek, and no navigation on uncertain or unavailable release. `queue-jump-permission-open.test.tsx` runs its three transport-mocked cases in a subprocess, so its mocks cannot affect other tests. The initial red trace called only `navigate, focus`; green calls `capability, release, navigate, focus` with every group member receipt preserved. A fixed stale capability binding and unavailable-release bug found during B's read-only integration review. These synthetic provider registrations are intentionally labeled stand-ins. Actual Claude/Codex direct-input and permission decisions belong to A/C's separately labeled live evidence; this lane does not claim those capabilities or permission outcomes from its navigation test.

### Red evidence and corrections

- `native-setup-red.log`: initial static full-router import led to missing queue table during setup. The final fixture establishes/asserts its profile DB and migrates before dynamically importing the full router. This failure is not counted as product acceptance.
- `peek-800-before-shrink-fix.png`: screenshot review caught a zero-height narrow row list despite the initial semantic test passing. `QueuePeek` now prevents list flex shrink; final native assertions explicitly check row geometry. Header popup assertions were also strengthened from textContent to open/bounds/hit testing.
- `peek-800.png`, `peek-1440.png`, `header-links.png`, `coordinator-bar.png`, and `bar-cleared.png` are the reviewed final rendered evidence.

## Integration dependencies (not owned changes)

| Origin | Local cherry-pick |
| --- | --- |
| Parent `7135c80b` | `bb46820b` |
| Parent `11ec66f4` | `9ddbc7ba` |
| Parent `fb18ea89` | `7b57fe43` |
| A `984f77ba` | `d07144eb` |
| A `1854ec3a` | `efa9e6d2` |
| A `4d62bba4` | `9753c455` |
| C `03d5f7cc` | `241ac179` |
| C `51b3fa02` | `5d7e3f4f` |
| C `8f9b2ffa` | `5494d37d` |
| A `7cc5868f` | `f167dd2c` |
| A `2fbb67c4` | `11f950d9` |
| A `b277d8f2` | `b4c01410` |
| A `48586058` | `e00a3300` |

Later A/C capability or transport changes should be integrated by the parent through the shared `QueueItemActions` API; B does not invent permission transport. No arbitrary input is sent to shell stand-ins. Native fixtures are evidence for the tested source, not installed-app deployment or shared-database policy changes.

## Self-evaluation

Applied `ecc:agent-self-evaluation` to the delivered lane and evidence.

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4 | Semantic assertions and image review agree; authenticated provider behavior remains explicitly outside this lane's proof. |
| Completeness | 4 | Requested navigation/header/focus/receipt paths are covered; parent still independently verifies the final A/B/C integration. |
| Clarity | 4 | Separate source/native/actual-provider boundaries are recorded; the evidence report is longer than a reviewer needs for a quick scan. |
| Actionability | 4 | Owned hashes, dependency mapping and exact reproduction command are provided; exclusive GUI scheduling remains required. |
| Conciseness | 4 | Shared query and transport are reused; fixture setup intentionally repeats the existing isolated-shell harness for independent execution. |

Overall **4.0/5**. Highest-impact follow-up: parent's independent integrated checks, especially final A/C capability behavior through both compact surfaces. Would the user agree? The evidence supports the lane's navigation/receipt claims while keeping provider uncertainty explicit.
