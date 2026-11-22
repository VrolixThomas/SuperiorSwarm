# Legacy lifecycle and bot author follow-up

Both reported P2 regressions were reproduced against merged `activity-queue` at `c721349a`.

## Legacy callbacks

OpenCode Start→Stop and Start→PermissionRequest callbacks lack turn IDs. Gemini BeforeAgent→AfterAgent has the same legacy shape. The queue snapshot intentionally retains earlier attention when callback ordering cannot be established, but session management was incorrectly using that retained alert as the current provider lifecycle alert.

After ownership/replay validation, the manager now preserves mapped lifecycle alerts for OpenCode/Gemini callbacks with neither an incoming nor remembered turn ID. Session state, status notifications and the returned renderer alert reflect Start/Stop/PermissionRequest. Identified histories and all Claude/Codex events continue to use ordered normalization. Queue snapshots, revisions, dismissal receipts and prompt-continuation checks are unchanged; no fabricated ordering metadata is added.

Four new lifecycle checks failed before the patch. Afterward the tests cover idle→running transitions, permission notification, pending/dismissed attention retention and missing-turn downgrade refusal for all four providers. These are production-manager/SQLite tests with controlled process callbacks, not live OpenCode/Gemini CLI smoke tests.

## Bot authors

The compact GraphQL query now selects `databaseId` for both User and Bot actors. GitHub documents the [Bot databaseId field](https://docs.github.com/en/graphql/reference/apps#bot). Existing normalization and account-scoped admission can therefore establish bot authorship without weakening unknown-author handling.

The adapter-to-queue test simulates GraphQL's type-conditioned response: the Bot field is present only when its fragment is requested. It reproduced zero queued requests before the patch, and now admits the bot-authored requested review while keeping a second PR with unavailable author identity unconfirmed. No authenticated remote request is used.

An older compact-fetch failure assertion was updated to retain the already-supported accountId field; it still asserts unknown head metadata.

## Verification

121 focused tests pass across 10 files: lifecycle/evidence/order47; GitHub adapter/bot/normalization8; scoped PR8; existing queue source/reply/resume58. Desktop build passes. Biome has no errors; existing-style warnings remain. Test type checking still reports pre-existing repository diagnostics, with none in edited production/test paths. `git diff --check` passes. Optional Graphify module remains unavailable.

No global provider config, user conversation, remote PR, dependency or user lockfile was changed.
