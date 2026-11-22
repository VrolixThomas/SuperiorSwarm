# Combined queue publication QA and own-feedback correction

Base: merged `activity-queue` at `84edb72c`. QA and fix commit: `12ff7784` on `test/queue-combined-publication`. This lane did not modify the shared branch, user lockfile, live data or global settings.

## Confirmed finding

A successful COMMENT review from an **owned-PR feedback** item was treated as completion of reviewer attention. `pr-publication.ts` acknowledged the entire occurrence whenever `outcome.verdictSubmitted` was true. The next unchanged `observeScopedPRPoll` then treated all pending feedback as handled, discarding two independent unresolved reviewer threads. The original combined reproduction failed with `candidate:null`, empty pending feedback and `acknowledgedRevision:2` after one synthetic COMMENT POST. See [before](before.txt).

The fix records `resolvesOccurrence` separately from the actual publication outcome. A successful review still has `outcome.verdictSubmitted:true`; it acknowledges only `pr-review` attention, not unresolved `pr-feedback`. Shared reservations continue to block the same exact completed operation, while a different legitimate response can proceed on still-pending owned feedback. Receipts predating the new field retain the conservative prior verdict-based rule. Direct approval and reviewer completion semantics remain unchanged.

## Combined scenarios

Nine backend tests use production queue projection, source receipts, current-account checks, SQLite transactions, PR observation and publication services together:

- Workspace/chat attention, reviewer PR, owned-PR feedback, ticket and hook rows coexist in one list with correct counts.
- Concurrent direct approval and review publication reserve one occurrence once, with only one synthetic provider POST; other sources are untouched.
- Done during the Undo delay rejects that post. Undo Done permits a new explicit intent.
- Later/Done on unrelated ticket/hook rows does not cancel or acknowledge a PR operation.
- A new PR occurrence arriving during a successful post survives old cleanup and retry.
- Unknown outcomes block both approval paths only for the exact source/revision, leaving other PRs independent.
- Switching authenticated account during the delay prevents PR posting while local sources remain visible.
- An owned-PR COMMENT leaves two unresolved feedback events pending through refresh, preserves truthful provider outcome, blocks duplicate posting and permits a distinct thread response.
- Real temporary Git and SQLite solver/group snapshots share reservations with review replies; an unrelated reviewer item remains independent. Done before solver dispatch prevents the guarded publisher boundary from being invoked. A legacy receipt variant also verifies conservative recovery.

Seven React tests use the real tab, pane and review-mode stores with the production publication hook. They cover Undo, view/unmount cancellation and explicit close, plus pending operations while navigating through Tickets, a hook project, another chat and Queue before returning to the PR. Origin remains bound; navigation cancels the old intent rather than automatically resuming it. Late preparation cannot post after a chat switch.

## Results

- **9 backend tests / 114 assertions pass:** [backend](combined-backend.txt).
- **7 navigation tests / 23 assertions pass:** [navigation](combined-navigation.txt).
- **21 existing publication tests / 68 assertions pass:** [regression](publication-regression.txt).
- **10 direct approval/recovery tests / 27 assertions pass:** [approval](approval-regression.txt).
- **47 tests total**, all passing in isolated Bun processes. Biome has no errors; existing-style test non-null warnings remain. Type checking retains global repository diagnostics and none in the changed paths: [types](types.json).

## Boundaries

SQLite uses the repository's Bun compatibility shim. Daemon inventory and external provider responses are synthetic. Ticket/hook bystanders use synthetic projection adapters; PR projection/account scope, workspace projection, source observations and publication controllers are production code. Solver snapshot checks use a real temporary local Git repository, but the final solver publisher is replaced with a rejecting test boundary, so no push can occur. React tests use fake RPC; this is not native GUI or live external posting evidence. Parent agents own combined native UI and lifecycle checks. No actual approval, comment, Git push, user chat or project hook was executed.

Independent review is a separate parent-owned gate; this report records the author QA and fix only.
