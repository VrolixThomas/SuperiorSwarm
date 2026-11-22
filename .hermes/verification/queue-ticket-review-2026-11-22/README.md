# Ticket independent review remediation

Base: `32e9ceaf`. Addresses the four reproduced SUP-39 / ticket-side SUP-42 findings from the independent ticket reviewer. No changes to the integrated feature branch or parent activity-queue worktree.

## Changes

- Ordinary status transitions are metadata for continuing comment feedback. Removing status from its source fingerprint preserves Done and Later when the same pending comments remain actionable.
- Every successful comments snapshot refreshes pending comment bodies/authors by ID. Existing IDs do not manufacture a new occurrence; new attributable external comments still do.
- Start preparation rejects an acknowledged revision. The confirmed public create route rechecks the source after provider refresh, and the creation completion rechecks again before linking/returning for chat launch.
- `ticket-start.ts` acquires a durable account/site/ticket/revision reservation under an IMMEDIATE SQLite transaction before calling workspace creation. The existing `session_state` key is unique, so separate processes cannot both reserve it. Main completes the verified ticket link and reservation together before returning, removing the renderer link gap. Generic workspace creation remains unchanged.
- A failed/ambiguous creation retains its reservation across restart; a repeated receipt cannot create a second workspace. Invalid repository selection is rejected before reserving. Done, account changes and changed occurrences during creation prevent link/continuation. Existing created work is not deleted on those races.

## Verification

All four original adverse cases first failed on the base: 16 pass / 4 fail ([before](before.txt)). After patching, **40 focused tests / 246 assertions pass** ([tests](tests.txt)). These include six isolated actual-router/SQLite Start scenarios: simultaneous requests choosing different repositories; Done before confirmation submission; Done during creation; failure after workspace insertion plus database reopen/retry; account switch during creation; and invalid repository preflight followed by a valid attempt. Expensive Git creation/provider refresh are mocked; workspace rows and ticket links are real synthetic SQLite data. Router mocks run in a subprocess to avoid contaminating other suites.

Source checks cover edited context, preserved Later and a new comment breaking the deferral. React checks cover confirmed Start with main-owned linking and chat launch failure without workspace retry. Existing account/site, baseline, incomplete fetch, outside-queue reply and owned-chat launch checks remain enabled.

Production desktop build passes. Biome has no errors (existing test non-null warnings remain). Main/renderer/test type checks retain existing diagnostics; no diagnostics in changed production or test paths. Counts are in [types](types.json); this is not a globally clean TypeScript claim. Optional Graphify rebuild is unavailable (`ModuleNotFoundError`).

## Boundaries

No real external provider writes, project hooks, provider sessions or GUI activity were used. Actual Claude/Codex Start launch E2E remains with the parent integration work. A possibly side-effecting creation failure is deliberately not automatically retried: inspect the existing workspace and recover manually through ordinary workspace actions. A source reservation is retained for that exact occurrence rather than expiring into duplicate work. No schema migration, user lockfile change, push or merge.
