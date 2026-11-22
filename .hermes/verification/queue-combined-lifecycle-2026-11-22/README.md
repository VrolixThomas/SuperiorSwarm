# Combined queue lifecycle QA after merge

Base: merged `activity-queue` at `84edb72c`. Test-only lane; no production changes. **13 tests / 154 assertions pass** in `tests/queue-combined-lifecycle.test.ts`.

Each test starts with five external attention kinds together: ticket intake, own-ticket feedback, PR review, own-PR feedback and a project hook. It then adds workspace/chat attention and drives production main services and the public combined queue router against isolated persistent SQLite data.

## Scenarios verified

- Both Claude and Codex event semantics across repository workspaces, folder-only projects, repository orchestrators and cross-repository coordinators. A sibling prompt cannot consume the reporting chat's attention. An accepted outside-queue prompt clears only its exact chat/report, leaves all external source fingerprints/revisions/receipts unchanged, survives DB reopen, and permits a fresh completion without accepting replayed prompts.
- Ticket Start reserves and links the created workspace before returning, removes only intake, then coexists with the new chat and fresh ticket feedback. Following up in the chat does not clear the ticket feedback; an attributable later ticket reply clears only that feedback.
- Mixed Done/Undo, Later/BringBack, new ticket feedback while chat attention is deferred, database reopen and account switching preserve unrelated rows and counts. Old revisions cannot clear a newly returned occurrence.
- Hook Fix prepares a fresh unmanaged chat while an existing managed chat's attention and other external rows remain. A complete empty hook run removes only the hook row, preserving both chat rows and ticket/PR attention.
- Daemon loss retains chat attention as stale and refuses its mutation, while external actions remain available. Reconnection restores availability without losing receipts.
- Same-name workspaces/projects with separate identities reject forged cross-workspace/external receipt groups. Handling one project does not consume another project's work.

## Boundaries

The production projections, ownership checks, session manager, source adapters, ticket Start service, hook runner, dispatch preparation and queue router are used. Electron and its native SQLite driver are replaced by the existing test shim (Bun SQLite is real on-disk SQLite); daemon inventory/process control and provider callbacks are controlled stand-ins. Ticket/PR snapshots are synthetic, PR feedback fetch is fake, expensive Git workspace creation is replaced by a synthetic real DB row, and no real CLI is executed. The synthetic hook runs only `cat output.jsonl` in a newly-created temporary directory. No live provider mutation, user chat, global settings or GUI was touched.

This lane does **not** test external publication. In particular, the separate combined-publication lane is investigating the own-PR COMMENT acknowledgement behavior; this report is not an all-clear for that path or every combined feature.

The initial fixture runs caught setup mistakes (missing source-service argument, a synthetic event timestamp predating registration, incomplete typed create response and a duplicate repository path). Correcting those did not require production changes. Type checking has zero diagnostics in the new test; global existing diagnostics remain. Biome has no errors, with test non-null warnings. Optional Graphify rebuild remains unavailable.

Run this test in its own Bun process because its fake feedback module is intentionally scoped to the scenario file:

```sh
cd apps/desktop
bun test tests/queue-combined-lifecycle.test.ts
```

Recommendation within the stated lifecycle scope: healthy after merge. Keep the new suite as a mixed-source regression; publication findings require their own fix/retest gate.
