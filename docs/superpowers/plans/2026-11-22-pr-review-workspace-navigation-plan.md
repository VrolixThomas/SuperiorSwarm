# PR review: one workspace, persistent review and agent tabs

Status: design and implementation plan for review. This pass changes planning artifacts only.

## Recommendation

Make PR review a normal workspace with a persistent **Review** tab and an **agent job tab** beside it. Create the agent tab immediately when a start request is accepted, including during preparation. Keep the sidebar, tab bar, and Back/Forward controls in the same places throughout.

The recent fixes improved labels and removed several blocking operations, but retained separate navigation systems for the PR inbox, overview, file reader, and agent workspace. The recording shows that this structure remains confusing. Another banner or renamed button will not resolve that structure.

The agent tab must represent the job, not only an existing terminal. It needs to work before the PTY exists, while it runs, when it needs input, after failure, and after the terminal has ended.

## Recording and evidence

Reviewed `~/Desktop/Screen Recording 2026-11-22 at 14.28.33.mov`: 2:09.49, 2798×1788, no audio track. I reviewed the sequence across the entire recording, then inspected one-second frames around the launch and failure transitions. Times below are video positions, approximate to one second; they are observations, not instrumented performance benchmarks.

| Time | Visible behavior | Design or performance problem |
| --- | --- | --- |
| 00:00–00:03 | The sidebar-based PR screen becomes a full-window review. | The familiar workspace navigation disappears on entering a PR. |
| 00:06–00:09 | Switching PR shows a mostly blank `Loading review…` screen before the overview. | Fast route switching still feels slow because useful content disappears while provider details load. |
| 00:12 | Following a reading path opens the real diff and contextual explanation. | This is useful and should remain. There is no explicit, persistent Overview/Changes/Findings navigation beside it. |
| 00:15–00:24 | The full-page All PRs selector is reopened between review/file views. | The inbox is a separate mode rather than a stable navigation surface. The PR title also doubles as an undisclosed overview link. |
| 00:27–00:29 | PR #12291 remains on `Loading review…`; details are visible at 00:30. | Another multi-second blank-content interval. This is provider/content waiting, not evidence of a worktree checkout on open. |
| 00:31–00:32 | Start agent review changes to Preparing Codex workspace. | The intent is acknowledged, but there is no job tab, activity detail, elapsed time, or preparation cancellation control. |
| 00:32–01:38 | The same preparation presentation remains for roughly 66–68 seconds before failure becomes visible at 01:39. | The largest wait in the recording has almost no observable progress. The user cannot distinguish fetching, checkout, launch, or a stall. |
| 01:39–01:40 | Agent did not start; Retry is available; the reason is under What happened. | After a long wait, the cause and useful recovery action should be visible without opening a disclosure. |
| ~01:41–01:50 | Retry prepares, then reaches Agent session started in about 9–10 seconds. | The faster retry suggests reusable work may exist, but the video does not establish why. Do not attribute this to authentication or caching without timing evidence. |
| 01:50–01:56 | The left side switches from the usable file list to a reading path with zero entry points and placeholders. | Starting the agent changes navigation before useful ordering exists. Keep the known file list available and preserve the selected file. |
| 01:57–02:09 | Open agent workspace replaces the review with a terminal-only surface. A tab appears only in this surface, and Back to PR review is a separate button. | The review is not a sibling tab. The user must leave one mode to discover another, and the agent becomes discoverable too late. |
| 02:08 | The terminal shows `git diff <destination-tip> <head> --stat` reporting 900 changed files, although the PR UI lists 11. | The first comparison is broader than the PR manifest. Pass an explicitly verified merge base and file scope. The recording does not establish whether the agent corrects this later. |

Read-only corroboration from the local run record: #12291 attempt 1 is failed with `Review revision acquisition timed out. Retry Refresh.` Attempt 2 is now recorded completed. The recording ends while the second agent is working; completion is from the later stored record, not from the video. Neither source identifies the exact slow acquisition substage.

Evidence crops: [ready to start](../specs/assets/2026-11-22-pr-review-navigation/00-30-review-controls.jpg), [preparing](../specs/assets/2026-11-22-pr-review-navigation/00-32-preparing.jpg), [failed](../specs/assets/2026-11-22-pr-review-navigation/01-39-start-failed.jpg), [session started](../specs/assets/2026-11-22-pr-review-navigation/01-50-session-started.jpg), [separate agent view](../specs/assets/2026-11-22-pr-review-navigation/01-57-agent-view.jpg).

Additional evidence: [the initial 900-file comparison](../specs/assets/2026-11-22-pr-review-navigation/02-08-diff-scope.jpg). The runtime prompt calls the provider destination tip `baseSha`, whereas the snapshot service separately establishes a merge base. That naming/contract mismatch can invite an unnecessarily broad two-tip comparison. Extra investigation/context cost is a plausible consequence, not a measured latency attribution or proof that the final review is wrong.

## What should change

### 1. One navigation shell

- Retain the normal app sidebar and workspace header when a PR opens. Use the PR list in that sidebar as the primary inbox, preserving its filter and scroll position.
- Use the existing workspace tab bar and pane layout. A pinned **Review #12291** tab remains visible beside **Codex · Preparing**, **Codex · Running**, or **Codex · Needs input**.
- Give the Review tab explicit **Overview / Changes / Findings** subviews. Selecting a file opens Changes; selecting a finding opens its pinned file and anchor. Reading path versus file order is an ordering choice within Changes, not another navigation destination.
- Remove the special full-window agent route. Opening an agent selects its existing tab; returning selects Review. Keep global Back/Forward visible for normal navigation history.
- The PR title is a title, not the only way back to the overview. If it remains clickable, it must not be required for navigation.

### 2. A job tab appears immediately

On Start, create a visible pending tab beside Review immediately. After the server accepts the request, bind it to a durable job ID. Keep Review selected so the user can keep reading; badge the agent tab as its state changes. Explicitly selecting the agent tab shows its activity.

The tab exists during preparation and never needs to manufacture a PTY. Its contents show the current phase, elapsed time, last update, and a real Cancel action. The existing terminal appears inside that same tab only after the session is registered and ownership is verified.

Use one agent-job tab per requested review. Retrying a failed job keeps the tab and adds a new attempt, with a new run version/session where required. Duplicate clicks focus the existing job instead of dispatching duplicates. A deliberate new review after completion is a new job.

When the agent finishes, retain its summary and links to Reading path and Findings in the tab even if the terminal is gone. When the PR head changes, label old results as belonging to the previous revision.

### 3. Back, closing, and focus have predictable meanings

- Selecting Review restores its subview, file, diff mode, scroll position, selected thread, and unsent comment/Ask text.
- Back/Forward traverses workspace/tab/subview navigation. Scrolling and j/k file stepping update the current location rather than filling history with every line or file.
- A link from a finding or answer records one return location, so Back returns to the finding/answer.
- Starting, retrying, or completing an agent never steals focus from another PR or workspace. Background updates still register the tab in their owning workspace.
- Closing an agent tab hides its view; **Stop agent** cancels its job. A running-job badge in the sidebar/Agents area can reopen the tab. Do not let the ordinary terminal-tab close cleanup accidentally terminate an agent job.
- Keep the Review tab pinned while that PR workspace is open. Closing the workspace and stopping a job are separate actions.

### 4. Replace the large workflow banner with contextual actions

The banner occupies substantial vertical space and repeats configuration even when results exist. Move ongoing status into the agent tab. Keep a compact action in Review:

| Review state | Main action | Supporting information |
| --- | --- | --- |
| No agent job | Start agent review | Agent choice and mapping/review options in a compact setup control. Browsing works independently. |
| Job preparing/running | Select the visible agent tab | A compact status badge; file navigation remains unchanged. |
| Results ready | Read changes / Review findings | Counts and completion summary; rerun is secondary. |
| Failure | Retry preparation or review the failure | Show the failed phase and useful short reason directly in the job tab. |
| PR changed | Review new commits / Update agent review | Explicit old/new revision distinction. |

Keep Submit review explicit and separate from agent completion. Agent completion never submits provider comments automatically. Do not automatically switch Files to an empty reading-path skeleton when the agent starts; offer the agent's ordering when it becomes useful, preserving selection.

### 5. Show honest preparation and agent states

Separate the durable job phase from the terminal lifecycle:

`Queued`, `Checking PR revision`, `Fetching missing commits`, `Preparing checkout`, `Starting agent`, `Session open`, `Needs input`, `Completed`, `Failed`, `Cancelled`.

Show phase elapsed time and a last-update timestamp. Display counts only where measured, such as files organized. A terminal existing is not proof that the agent is actively reading. Needs input must come from a supported provider/session signal; silence alone is not evidence. If the integration cannot identify that state reliably, say Session open and make the terminal accessible.

The timeout in this recording should read, for example, **Fetching PR commits timed out**, with elapsed time and Retry, rather than a generic disabled Preparing button followed by a collapsed explanation.

## Why the current code produces this experience

These are source observations, not inferred user intent:

- `App.tsx` replaces the normal shell when `shouldShowReviewMode` is true. `MainContentArea.tsx` separately branches between `ReviewModeShell` and `ReviewAgentWorkspace`.
- `review-mode-store.ts` combines flat `view` with independent `overviewOpen`, `queueOpen`, and panel state. Navigation is distributed across booleans instead of one workspace/tab location.
- `attachReadingPathTerminal` registers a terminal descriptor, but `openReviewTerminalTab` creates the pane tab only after the user presses Open agent workspace. During preparation there is no durable visible tab to select.
- `ReviewPathApplication.start` awaits metadata and `runtime.startMapping` before returning its launch result. The renderer's controller suppresses refresh while a mutation is pending, leaving preparation represented mainly by a local boolean.
- The start path performs metadata work in application resolution, runtime preparation, and revision-source resolution. Some checks are intentional revision-safety fences; instrument their durations and consolidate redundant payload reads without removing those fences.
- Revision acquisition currently fetches missing head/base objects separately, even when they share a remote. This is an optimization candidate, not a proven explanation of this recording's timeout.
- Some file selection and scroll state already exists in `pr-review-session-store.ts`. Preserve and extend it; do not replace working immutable-revision or ownership protections.

## Performance work and targets

Separate immediate UI response from external network work. The following are acceptance targets for controlled tests, not promises about arbitrary provider/network speed:

| Interaction | Target |
| --- | --- |
| Select workspace, tab, or cached PR | Visible selection/content within 100 ms; no full blank screen. |
| Open a cold PR | Identity and loading sections within 100 ms; load details progressively. |
| Start agent | Pending tab immediately; server acceptance/job identity within 200 ms of local processing, without waiting for provider or Git calls. |
| Browse a cached diff | Reuse model/content within 150 ms at p95 in the controlled workload. |
| Long preparation | Current phase, elapsed time, and working Cancel always available; updates within 1 s of backend state changes. |
| Revisit a PR | Restore location and cached content immediately; revalidate in the background. |

Instrument click → selection → first useful paint → metadata → first diff, and start → accepted → metadata → fetch → checkout → PTY → first output. Include cold and warm runs, missing head/base combinations, forks, and interrupted retries. Keep telemetry local and content-free: IDs, phases, durations, counts, and safe error categories, not code, credentials, URLs or terminal contents.

Prioritize these changes:

1. Render cached/list metadata immediately; load description, files, checks, and discussion independently. Unknown counts stay unknown, not zero. Never show another PR's content under the newly selected title.
2. Keep review location and bounded editor/model caches across tab changes. Key content by workspace/provider/PR/full revision/path/side, not filename alone.
3. Return an accepted job immediately and publish versioned phase updates. Do not freeze job-state observation behind a pending start mutation.
4. Reuse captured, certified revision/manifest data across preparation where safe; retain authoritative head/base validation before launch and all generation checks.
5. Fetch missing OIDs in one operation per verified remote where possible; keep fork remotes separate. Reuse objects already acquired on retry. Preserve isolated authentication and local files/refs.
6. Measure each cold-path phase before changing deadlines. The faster second attempt could reflect partial acquisition reuse, but that is not established. Do not simply raise the existing timeouts or hide the delay behind animation.
7. Resolve the review comparison once and pass distinct `targetTipOid`, `mergeBaseOid`, `headOid`, and the complete changed-file manifest to the agent. Diff the verified merge base against the head. Test a diverged target branch so an 11-file PR cannot accidentally begin as a 900-file target-tip comparison. Preserve controlled context-file reads beyond the changed files when needed.

## Proposed backend/UI contract

The start command should first validate the registered local scope and persist a request intent with an idempotency key. It returns a job ID immediately. This is acceptance of preparation, not certification of the requested revision.

Background preparation then validates provider metadata, accepts the current revision generation, and creates/binds the existing scoped run. A changed head ends preparation with Refresh required; it never launches against silently substituted code. Phase events carry job/attempt identity and a monotonic revision. The tab observes those events and can recover through a read-only job query after navigation/reload.

Cancellation addresses the durable job from the beginning, including metadata and fetch phases. A cancelled/superseded attempt cannot register a late worktree, attach a terminal, publish results, or steal focus. Shared acquisition must not cancel another consumer's work. Restore shows existing jobs and output; mounting a tab must never relaunch an agent.

Keep the existing full-OID contracts, snapshot root behavior, ownership checks, permission prompts, and explicit provider publication boundary. The new tab is a view of a job, not authority to launch or attach a process.

## Implementation sequence

Paths below are relative to `apps/desktop/`. Tests listed first are the tests to add/update before each implementation task.

| Task | Tests first | Files / concrete result |
| --- | --- | --- |
| 1. Establish timing and navigation baseline | New `tests/review-flow-timing.test.ts`; replay the recorded cold/warm and fail-then-retry cases. | `renderer/lib/open-pr-review.ts`, `main/review-path/application.ts`, `main/review-path/runtime.ts`, `main/review-explanation/revision-acquisition.ts`: local phase timings and useful-paint markers. No layout change yet. |
| 2. Define workspace locations and tab types | `tests/tab-store.test.ts`, `tests/pr-review-session-store.test.ts`; new route-history cases. | `renderer/stores/tab-store.ts`, `pane-store.ts`, `pr-review-session-store.ts`, `review-mode-store.ts`, `shared/pane-types.ts`: explicit PR review and agent-job tabs, per-PR view state. |
| 3. Put Review in the normal workspace shell | Update `tests/review-terminal-navigation.test.tsx`; new full-shell test asserting persistent sidebar/tab bar. | `renderer/App.tsx`, `MainContentArea.tsx`, `panes/PaneContent.tsx`, `PaneTabBar.tsx`, `ReviewModeShell.tsx`, `ReviewWorkspace.tsx`: remove special full-window route replacement. |
| 4. Accept and expose durable preparation jobs | New `tests/review-job-acceptance.test.ts`; delayed metadata/fetch, duplicate start, cancel-before-launch, restart tests. | `main/review-path/application.ts`, `runtime.ts`, `storage.ts`, `main/trpc/routers/review-path.ts`, `shared/review-path-runtime.ts`; explicit migration if persisted shape requires it. Preserve generation/credential fences. |
| 5. Register the agent tab on acceptance | New `tests/review-agent-job-tab.test.tsx`: Start A → switch B → delayed receipt, retry, close/reopen, no focus theft. | `renderer/lib/review-connected-terminal.ts`, `review-terminal-tab.ts`, `review-path-source.ts`, tab persistence, typed preload/IPC event wiring. Tab exists during preparation, not only after PTY creation. |
| 6. Render activity, input, failures, and results in that tab | Extend `tests/review-agent-terminal.test.tsx`, `review-terminal-state.test.ts`; no PTY for preparing/ended/foreign states. | `ReviewAgentWorkspace.tsx`, `ReviewAgentTerminal.tsx`, `main/review-path/terminal-state.ts`, existing agent-session services. Results survive terminal exit; explicit cancel/stop/retry controls. |
| 7. Make Overview / Changes / Findings and Back predictable | `tests/review-workspace.test.tsx`, `review-terminal-navigation.test.tsx`, session-store tests: return preserves scroll, anchors, drafts and queue filters. | `ReviewReadingPane.tsx`, `hooks/useReadingNavigation.ts`, `views/OverviewView.tsx`, queue components, navigation/session stores. Keep known files visible during mapping. |
| 8. Make provider loading progressive | New `tests/review-progressive-loading.test.tsx`: slow checks/discussion do not blank description/files; revision changes cannot reuse wrong content. | `useReviewData.ts`, `useReviewWorkspaceData.ts`, project/provider routers, `providers/bitbucket-adapter.ts`, `providers/github-adapter.ts`. Scoped cache and background revalidation. |
| 9. Reduce preparation work and pin the comparison | Extend `review-revision-acquisition.test.ts`, `review-workspace-opening.test.ts`, `review-runtime-lazy-worktree.test.ts`, snapshot/prompt tests: one fetch per same remote, separate fork fetches, partial-retry reuse, cancel/no late writes, diverged-target PR scope. | `revision-acquisition.ts`, `acquisition-service.ts`, `ai-review/review-workspace-preparation.ts`, `review-path/runtime.ts`, `review-path/prompt.ts`, `review-explanation/snapshot.ts`. Optimize measured duplicate work and distinguish target tip from merge base. |
| 10. Reduce chrome and complete native verification | Update `review-workflow-bar.test.tsx`, native fixtures, `review-workspace-native.test.ts`; new close-view-versus-stop-job tests. | Simplify `ReviewWorkflowBar.tsx` and top bars, retire redundant mode-switch UI, integrate `pane-lifecycle.ts` with agent-job semantics. Verify 1512×945 and the recorded wide layout. |

Dependency order: 1–3 establish measurement and navigation. Task 4 precedes 5–6. Task 7 builds on the tab contract. Tasks 8–9 can run independently once identity and phase contracts are fixed. Task 10 checks the assembled flow.

The merge-base/file-scope check in task 9 is a correctness gate before benchmarking a real agent or shipping the redesign; it should run in parallel with the navigation work, not wait for visual polish.

## Acceptance replay

Repeat the recording's journey with these checks:

1. Open a PR: the sidebar and tab strip stay visible; no blank fullscreen transition.
2. Open Changes, select a file, then Overview/Findings: each destination is explicit and preserves the expected return location.
3. Switch PRs and return: the selected file, scroll and list filter survive; cached content paints before background refresh.
4. Start a cold agent review: an agent tab appears immediately beside Review, without taking focus.
5. Hold acquisition for 70 seconds in a controlled fixture: the tab names the phase, shows elapsed time/last update, and can cancel. The Review tab remains usable.
6. Fail preparation: the reason is visible in the job tab; Retry starts a new fenced attempt in the same tab and does not duplicate workspaces or PTYs.
7. Start successfully: the same tab receives the verified terminal. Review remains one tab-click away; no extra Open agent workspace route is required.
8. Need input: show a badge only from a supported signal, and reveal the actual prompt when selected.
9. Complete the run and remove the PTY: summary/path/findings remain accessible. No ownership-error terminal or automatic relaunch.
10. Close an agent view while it runs: job continues and can be reopened; explicit Stop cancels it. Test keyboard focus so review shortcuts never leak into terminal input.
11. Refresh the PR head during work: old output stays correctly scoped and cannot appear as current findings or publish under the new revision.
12. Use a target branch containing unrelated later changes: the agent's initial comparison must match the verified PR manifest and merge-base semantics, not the unrelated target-tip delta.

## Decisions and limits

- Recommended focus policy: create the agent tab in the background; select it only on explicit user navigation. Needs input gets a visible badge rather than silently moving keyboard focus.
- Recommended inbox: preserve the existing PR sidebar as the primary list. A larger inbox can remain a normal tab when needed, with saved filters/scroll, not a modal replacement for the whole navigation shell.
- The recording cannot tell us the exact acquisition substage that consumed the first minute, or whether the faster retry reused downloaded objects. Timing instrumentation is required before claiming a performance root cause.
- A cancellation/backend redesign and a tab model change are required. This should be implemented as the staged workspace redesign above, not another isolated positioning patch.

Companion: [interactive layout concept](../specs/assets/2026-11-22-pr-review-navigation/workspace-tabs-proposal.html). It illustrates the recommended navigation and job states; it does not launch agents or modify the app.
