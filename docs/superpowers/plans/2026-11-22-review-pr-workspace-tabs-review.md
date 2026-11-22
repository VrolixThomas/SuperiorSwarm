# Review of the PR workspace tab plan and 13 boards

Reviewed: `2026-11-22-review-pr-workspace-tabs.md` and all 13 PNG/HTML pairs in `../specs/assets/2026-11-22-review-pr-workspace/`.

Verdict: **accept the visual direction; resolve the implementation contracts below before treating the plan as ready to implement.** The provided plan and boards were not modified during this review.

All 13 PNGs are 3024×1890, consistent with 1512×945 at 2×. The NavRail, shared PR header, actual pane tab bars and split Review/Codex layout address the central navigation problem in the recording. Board 5 is the strongest reference for the intended experience. This review respects the new plan's choice of Path/Files with inline findings rather than restoring the previous Overview/Changes/Findings subview proposal.

## Implementation blockers

### R1 — Durable job acceptance must precede the agent-tab task

**Plan:** §4.1, §4.3 and Task 5; lines 228, 256 and 378. The plan proposes deriving the job from existing runs until the durable job contract lands, while requiring a preparing tab, Cancel, and retries in the same tab.

**Current source:** `main/review-path/application.ts:43` awaits provider metadata before creating a run; lines 66–76 await agent preparation/launch before returning it. `renderer/lib/review-path-source.ts` suppresses refresh while mutations are pending. There is no existing early acceptance result from which this fallback can reliably build the required tab. Run IDs are also attempt identities, not a stable retry-group/job identity.

**Required change to the plan:** make navigation-plan task 4 an explicit dependency of this plan's Task 5. Define the accepted job ID, attempt/run ID, phase updates, cancellation and idempotency before wiring the tab. Remove the ambiguous “until the durable job exists, the run id” ID substitution, or fully specify its persistence migration. A UI-only placeholder can be a prototype, but must not pass the durable-preparation acceptance criterion.

**Add tests:** a provider call held for 70 seconds still has an accepted job/tab and working cancellation; duplicate Start is one job; Retry retains tab identity while replacing fenced attempt identity; delayed responses cannot attach an old attempt.

### R2 — “Always mounted” is insufficient for state preservation

**Plan:** §3.4, Task 2 and Task 8 promise preservation on tab changes, PR switches and pane moves.

**Current source:** `renderer/stores/review-mode-store.ts:80` contains global rail/panel/overview state and resets it when a different workspace opens. `hooks/useReadingNavigation.ts:45` keeps transient context, selection, question/composer state and comment requests in component-local state. The session store already preserves some file/scroll state, but not all of those fields. Moving a component between different pane parents can remount it even when its tab ID is unchanged.

**Required change:** explicitly key review UI and unsent drafts by workspace/PR/revision, and define a stable editor host or state restoration across pane moves. Keeping inactive tabs mounted may preserve same-pane switching, but is not the complete solution. Pause hidden-view layout/shortcut work without pausing the durable job observer.

**Add tests:** type an unsent comment and Ask draft in PR A; switch to B and back; move Review to another pane; close that pane so Review is re-homed. Preserve text, anchor, selection, scroll and panel state in all cases. Hidden review views must not steal focus or handle shortcuts.

### R3 — Enforce isolated shell creation at every entry point

**Plan:** §3.3 and Task 4 disable “+” before a review worktree exists and promise never to open a shell in the fallback project root.

**Current source:** `renderer/actions/core-actions.ts:366` has an independent `terminal.new` route that calls `addTerminalTab` with the active cwd. `main/terminal/ipc.ts:83` resolves a logical workspace to its cwd, which can legitimately be the project root for snapshot browsing. Disabling one button does not enforce the stated shell rule for shortcuts, menus, restored tabs or IPC.

**Required change:** centralize the review-shell eligibility check and enforce it at the main-process creation boundary, while retaining the existing owned-agent attach rules. Apply the same rule to every shell command and restoration path. Consider an explicit “Prepare review workspace” action for someone who wants a shell without starting an AI agent; that is an optional product decision, not permission to use the parent checkout.

**Add tests:** “+”, terminal.new, menu/shortcut and restored ordinary terminal all refuse a logical-only review workspace; after isolation they use the canonical review worktree. No shell is silently created in the project root.

### R4 — Define how mapping completion and later Ask activity share the agent tab

**Plan:** board 5 shows `finish_review_path` followed by a question/answer in Codex. §3.5 includes idle/answering; §4.3's interim hook selects only `kind: "mapping"`.

**Current source:** `main/review-path/runtime.ts:302` disposes owned terminals whose runs are no longer running. `application.ts:93` creates separate scoped question runs for Ask. A completed mapping terminal is not currently a reusable, indefinitely interactive session with permission to write more findings.

**Required change:** specify the job/conversation/run relationship for follow-up questions. Either bind a new validated question attempt to the appropriate stable agent tab, or explicitly design continued-session capabilities. Preserve the rule that a completed/superseded mapping run cannot write new results. The status chip must represent the relevant active question as well as mapping.

**Add tests:** mapping finishes and its PTY disappears; Ask from the Review pane creates the correct owned question activity without relaunching the old mapping; chip/tab status updates; the answer and any proposed finding stay attached to the right revision and anchor.

## Design changes and missing acceptance details

### R5 — Keep return destinations and manual browsing explicit

The no-subview decision is coherent, but the provenance line in boards 7–9 and 11–13 looks like muted metadata. Making it the primary route to the summary risks repeating the “how do I go back?” problem. Keep Path/Files, and add a visibly named **Path summary** action rather than depending on a hidden click in that text. The summary's findings count should also be an explicit action to the first relevant finding.

Board 10 again uses “Map this PR” as the launch label and offers only a `j` hint for manual reading. Consider **Start agent review** with a short “build a reading path” explanation, plus an explicit **Browse files** action. This does not require bringing back the large workflow band.

Board 3 depicts a useful partially mapped state but does not define zero-step behavior. Do not automatically replace the known file list with skeletons at launch. Preserve selection and keep all changed/unplaced filenames reachable while the path is built. Add a zero-progress case to the visual and native tests.

Boards 11 and 13 also need a documented mouse/keyboard entry to Ask/Threads from ordinary reading. Retaining their content is not sufficient if the landing/toolbar routes that used to open them are removed.

### R6 — Narrow panes need rendering rules, not only hidden controls

In board 5, the Review pane is 868px and its rail is 236px, leaving about 632px for the reader. The plan hides the Unified/Split toggle below 960px but never says to switch an existing side-by-side Monaco editor to unified. A user with Split selected could be left with two narrow code columns and no visible way to change it.

Specify an effective unified mode below the threshold, preserving the user's wide-pane preference for restoration. Add combined-state coverage: PR list open + 60/40 split, and split + Ask/Threads. The existing side panel is 400px and can cover most of the remaining code area; define when it overlays, collapses the rail, or fills the Review pane.

Test actual editor options and usable content width, not merely absence of the toggle. Include long real PR titles/branches and small windows as well as the fixed 1512×945 boards.

### R7 — Reconcile board states and add the lifecycle boards that caused the original problem

- Board 2 says the agent finished and the path is ready, but its chip says **Codex idle**. The state table calls idle “no job” and separately defines done.
- Board 10 says Codex has not started but already shows a Codex tab. §3.5 says the job tab appears on acceptance. Remove that tab in the no-job state or explicitly define a setup placeholder distinct from a job tab.
- Board 5 labels waiting for you; the tab/chip should use the specified needs-input badge consistently.
- There are no dedicated preparing, failed or ended-result boards, although preparation/failure dominated the recording. Add those states before visual sign-off, including Cancel and Retry. The happy-path boards alone do not establish this flow.

Derive chip, tab, activity list and summary from one job projection. Distinguish no job, active/awaiting input, and completed results; do not infer a waiting user from silence.

### R8 — Complete the data and migration contracts

- The activity feed in board 3 requires verified event types and timestamps. The current path has progress/currentFile and updatedAt, not a durable history of “read”, “placed” and “added” events. Define those sources or omit unsupported events.
- `ReviewPath.otherFiles` is `string[]`; it does not store reasons. The summary cannot derive “these files don't change behaviour” from that field. Add explicit reason data or show a neutral count with unknown reason. Keep every changed file accounted for.
- Run records are serialized inside `review_path_documents.payload` (`main/db/schema.ts:1036`), not one SQLite row per run. Task 9's generic “add the columns” instruction does not match the current schema. Choose a versioned document/job projection or an explicit new table design; use backward-compatible unknown timestamps for old records.
- Add migration tests for existing bare `terminal` tabs with `review-path:*` IDs and persisted `view: "terminal"` state. Testing hydration of only the two new kinds does not cover installed users. Preserve session identity, prevent duplicate agent tabs, and never launch on restore.
- `useReviewQueue` intentionally excludes authored PRs; Task 8's Your PRs section needs a separate input/projection. Keep Next PR scoped to requests needing the user's review. Viewed counters and provider-specific actions must retain their capability guards; the GitHub-based boards should not invent Bitbucket viewed state.

### R9 — Clarify pinned movement and performance gates

§3.3 says Review may be dragged between panes, but also that a pinned tab never moves; Task 1 says `splitPane` never moves a pinned tab. Distinguish **manual drag**, **automatic split**, and **re-home on pane close**. Define the last-pane case, and preserve exactly one Review tab per workspace. Pinned should mean nonclosable/workspace-bound, not accidentally make the accepted drag interaction impossible.

The UI plan inherits performance work from the navigation plan, which is reasonable, but needs an explicit combined release gate. Skeletons prevent a blank screen; they do not make provider calls or agent preparation faster. Keep the previous plan's cold/warm timings, immediate job acceptance, phase updates, cancellation, acquisition optimization and verified merge-base comparison in the integrated acceptance replay. Do not declare this done solely because screenshots match.

Task 0's NavRail/MainLayout files already exist in the local activity-queue worktree. Pin the integration revision and make the baseline type-error policy explicit; the current review branch has recorded unrelated type diagnostics. Do not turn a UI prerequisite into an unbounded unrelated cleanup silently.

## Board-by-board disposition

| Board | Disposition |
| --- | --- |
| 1 Queue | Keep as context. Assign ownership of the Queue context strip shown in board 2; distinguish Next queue item from Next PR. |
| 2 Landing | Strong provenance layout. Correct idle/done; make summary return and findings actions discoverable. |
| 3 Mapping | Good activity direction; specify real event sources and a zero-step state that preserves file access. |
| 4 Codex | Clear sibling tabs. Show actual checkout identity, including detached state when relevant, rather than assuming a named branch. |
| 5 Split | Use as the main layout reference. Resolve the narrow editor/panel rules and follow-up session contract. |
| 6 PR list | Good persistent navigation. Specify authored-PR input, provider capabilities, and saved filter/scroll. |
| 7 Reading | Keep focus notes and step controls. Add a clearly named path-summary destination. |
| 8 Files | Keep the alternative order. Use provider-neutral wording instead of “same as GitHub” for Bitbucket; retain viewed capability guards. |
| 9 Context | Keep the distinct context treatment and exclusion from viewed counts. Test state preservation during pane moves. |
| 10 No path | Resolve the no-job Codex tab; improve visible launch/manual-browse actions. |
| 11 Ask | Keep anchored context. Define the active question's job/tab relationship and narrow split behavior. |
| 12 Findings | Keep inline triage. Ensure explicit navigation to the next finding and back to its originating summary/answer. |
| 13 Threads | Keep thread filters and outdated anchors. Specify the panel's visible entry action and narrow-pane behavior. |

## Minor corrections

- The introductory path convention says relative to `apps/desktop/`, but most implementation paths are `src/`-relative. Clarify the convention.
- The board-5 statement about empty body reaching null remains consistent with current code, but its backend line reference is stale: the relevant logic is currently `main/trpc/routers/ai-review.ts:334–337`, not line 387. Keep any behavioral change to submission separate from the layout task.

Recommended next step: revise the contract/dependency sections and the missing lifecycle/narrow-state boards, then implement the shell/tab foundation against the agreed job interface. No application changes are needed to complete this design review.
