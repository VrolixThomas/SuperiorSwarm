# External queue integration — 22 November 2026

Branch: `feat/queue-pr-review-feedback`, based on `cd9d5f28`. Includes the ticket and hook agents' commits. The reviewed integration was merged into `activity-queue` at `84edb72c`.

Implemented:

- Additive `QueueViewItem` union and `viewList/viewDone/viewLater/viewBringBack/viewUndoDone`. Workspace-only APIs, exact chat/group receipts, permission and reply guards remain unchanged.
- One query drives queue, badge, category counts, jump sessions and peek. External rows do not invent workspace owners or inherit conversation controls. Source errors and missing links remain visible.
- Account/host/repository-scoped PR observations use the existing poller. Fresh provider author identity, not cached role, separates reviewer requests from authored-PR feedback. First authored-feedback sync is silent; self events are suppressed; failures retain prior observations; new/reopened feedback returns after Done/Later. Existing comment edits refresh display without creating occurrences.
- GitHub re-review evidence checks the viewer's latest CHANGES_REQUESTED review, its resolved threads, an ancestor comparison and changed-file subset, and complete passing CI. The UI explicitly says these checks do not prove that only requested edits were made. Incomplete pages, divergence, renamed/new files, and unknown/pending/failing CI cannot qualify.
- Direct queue approval is explicit, delayed five seconds, cancellable on Undo/unmount, and revalidated in main. Durable per-request and per-occurrence receipts prevent duplicate concurrent submissions and blind retries after uncertain outcomes or restart. GitHub posts pin `commit_id`; a fresh current-head check precedes the post.
- Authored feedback uses the existing local solver only for one explicitly linked worktree, through a confirmation and prepared terminal launch. Launching does not dismiss feedback or post replies.
- Ticket intake/feedback, safe in-app ticket detail, confirmed ticket starts/default-agent launch, and opt-in trusted project hooks are integrated from the other lanes; see their source-contract and verification documents.

Verification:

- `queue-pr-evidence.test.ts`: strict eligibility cases and feedback baseline/self/duplicate/Done/resolution/reopening.
- `queue-pr-actions.test.ts`: five-second admission, cancellation, changed head/evidence/account, concurrent request IDs, uncertain response and recovered-attempted receipt. Fake providers only; no real reviews posted.
- `queue-pr-scoped-source.test.ts`: actual SQLite source observations, author/reviewer split, failures, outside-queue review cleanup, independent repository/account occurrences and switched-account cached-author rejection.
- `queue-external-view.test.ts`: actual SQLite exact-revision mutations, no daemon requirement for external items, stale/account/group rejection and independent occurrences.
- `external-queue-electron.test.ts`: PASS. Production renderer components, preload, tRPC and native SQLite in an isolated Electron profile. Ticket, PR and hook rows appear together; actual Open/Done/Undo/Later/BringBack actions run through IPC; a trusted synthetic `cat output.jsonl` hook resolves absent keys and retains failures. This fixture blocks network, uses synthetic account identities and disables provider-capability reads. It does not prove authenticated review submission, live ticket creation, local solver execution, physical keyboard delivery, or full-shell sidebar layout.
- Existing workspace/review normalization/classification and queue UI/navigation regression suites are rerun. Production build passes. Repository-wide TypeScript diagnostics predate this branch; comparisons exclude line-number shifts and record new diagnostics separately.

Final follow-up: all implementation and independent-review gates are now complete in `integrate/queue-external-review`; the reviewed features are merged into `activity-queue` at `84edb72c`. Queue-origin review and solver publication now use five-second guarded Undo, and actual Claude/Codex startup/context checks pass. The detailed final report, independent findings and integrated test results are in [final verification](../../../.hermes/verification/queue-external-review-2026-11-22/README.md).

Bitbucket still cannot atomically pin approval to a head, and keeps its explicit manual fallback. Live provider posting was not used in verification. Actual native startup/context tests retain the documented restrictive fixture seams; legacy solver structured resume is not claimed.

The native screenshot is fixture evidence, not a polished full-app screenshot. Its synthetic PR is intentionally stale.

Final local runs:

- Workspace/generic queue, PR normalization/classification, queue view/model/navigation and external lifecycle: **69 passed**.
- PR evidence/feedback plus scoped source observation: **23 passed**.
- Delayed approval controller: **9 passed** (separate process with fake provider modules).
- Ticket and hook source/runtime suites: **30 passed**.
- Native unified queue: **1 passed**, 3.02 seconds, isolated profile `ss-external-queue-JAcuSj`.
- Desktop build: passed. Main and renderer diagnostic comparison against `cd9d5f28`: **zero new diagnostic signatures**; global baseline remains failing. Biome changed-file check and `git diff --check`: passed.
