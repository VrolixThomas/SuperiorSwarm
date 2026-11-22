# PR queue review fixes and guarded publication

Local branch `fix/queue-pr-review`, based on `32e9ceaf`. No merge, push, release or real provider publication was performed by this lane.

## Reviewable commits

- `43960de7`: fixes four independently reproduced defects. Successful approval receipts remain submitted after local acknowledgement failure, and repeated dispatch retries local cleanup without posting again. Direct and review-mode reservations now share the occurrence boundary. Solvers never implicitly delete active sessions; completed-comment dedupe includes workspace/provider/account identity. Queue solving rejects failed refreshes; unknown viewer history retains attention.
- `99f67e18`: complete fresh queue feedback, including review-only changes requests, is filtered by the displayed pending event IDs and forwarded with actor/source identity. Self/unrelated/resolved events are excluded. Solver scope includes occurrence identity. Review-level feedback without a thread retains prepared replies with manual PR-conversation guidance; it is not passed to an incompatible thread endpoint.
- `1ba8fb6c`: Bitbucket inline path/to/from and GitHub diff side remain attached to solver input. The independent reviewer reported the corrected context/input unit passing 11 tests / 33 assertions.
- `d8cba5bd`: Queue-origin review Open carries its source receipt into Review Mode. Review, draft, thread reply and resolution use five-second main-owned reservations. Queue-origin solver Push & post, group buttons and keyboard actions use the same guarded publication flow; ordinary solver publication routes reject bypass for queue-bound sessions. Normal non-queue review flows keep their existing APIs.

## Publication behavior

Preparation binds the displayed head, exact queue occurrence/account and reviewed payload. Draft text/comment records and selected solver groups/replies/local HEAD/remote are fingerprinted; changes before dispatch reject. Undo, closing, unmounting or navigating away cancels before dispatch. Pending text stays local on cancellation or failure. Dispatch claims a durable receipt before mutations. Unknown/partial outcomes remain reserved across request IDs and restart, preventing blind retries. Successful external posts cannot be downgraded by local queue cleanup failure.

Solver publication checks the exact queue origin, workspace PR link, branch and push remote. Before push it revalidates the snapshot and provider head; after push, reply guards expect the prepared local HEAD at the provider. Approved reply IDs/text are bound. Failed or partial guarded publication retains unsubmitted group status. Bitbucket cannot atomically pin its provider approval API; its existing explicit fallback and this documented limitation remain.

## Evidence

- Four initial independent adverse tests were reproduced failing before patching; red logs are retained here. First fix unit: 125 focused tests across 11 isolated Bun processes passed. Module-mocking suites run independently to avoid cross-file mock leakage. A pre-existing `github-activity-source` assertion expects `{}` where the previous implementation already emits `{accountId: "me"}`; it is not counted as a passing check.
- Publication unit: **14 backend tests**, **5 React hook/cancellation tests**, and **1 real temporary Git/SQLite snapshot test** pass. External provider calls and push boundaries in publication tests are fake; the real Git fixture only initializes/reads an isolated repo and checks remote/snapshot changes. It never pushes.
- Existing direct approval **9**, review publisher **3**, review-mode store **12** tests pass. Feedback-anchor tests **2** pass.
- Desktop production build passes. Changed-file Biome has no errors. Global TypeScript checks remain failing on existing diagnostics; the new publication modules/UI/tests have no diagnostics. A pre-existing solver router type-import path was corrected so its renderer types remain meaningful.
- Native dual-provider solver startup is owned by the separate native-verification agent; this lane does not claim real authenticated posting or full native publication UI proof.

## Independent review still required

The publication unit is intentionally handed off before merging. Parent was notified to exercise concurrent draft edits after the final digest, GitHub global-thread membership for batch draft replies/resolutions, and legacy group publishing of HEAD when other commits/groups are not approved. Current snapshot checks do not establish that every commit at HEAD belongs only to the selected approved group. These are explicit review items, not a claim that all publication acceptance has passed.

Run from `apps/desktop`, each mock-heavy file in its own process:

```sh
bun test tests/queue-pr-publication.test.ts
bun test tests/queue-pr-publication-ui.test.tsx
bun test tests/queue-solve-publication-snapshot.test.ts
bun test tests/queue-pr-actions.test.ts
bun test tests/review-publisher.test.ts
bun test tests/review-mode-store.test.ts
```

Graphify rebuild was attempted by the required hook and is unavailable because the optional module is absent. No dependency install or hook bypass was used.

## Independent backend publication findings corrected

`9b3097e3` corrects the independently reproduced concurrent-dispatch and expiry races: a delayed loser cannot overwrite a winner's submitted/attempted/cancelled receipt, and the final claim rechecks expiration. Read-only failure before any irreversible call is retryable; after a push/POST actually begins, receipt uncertainty remains durable.

The same correction binds the full pushed commit range to selected approved or previously submitted groups. Draft text/approvals are rechecked after asynchronous provider reads and again transactionally before local cleanup. Only the publisher's own successful row receipts advance its expected snapshot. Newer text is retained if it changed while a POST was in flight. Prior resolution comments must belong to the same provider/PR, and every GitHub global-thread mutation checks fresh membership, including draft and solver batches. Solver sends carry exact local comment/reply receipt IDs; live reply/group changes cannot be overwritten by cleanup.

Final targeted follow-up: **21 backend publication tests**, **1 real Git range/snapshot test (8 assertions)**, **2 real SQLite cleanup tests with fake push/provider**, and **3 existing publisher tests** pass. Changed-file Biome has no errors; newly owned main/test paths have no TypeScript diagnostics. The global baseline remains failing. No actual push or provider post was executed. Independent retest of this exact correction is requested from the parent; separate UI origin-lifetime and stale-draft completion fixes are owned by another agent.
