# PR reading workspace: development integration repair

The live development app exposed gaps that fixture verification had missed: an older
branch migration was skipped by an existing database, Bitbucket returned abbreviated
commit IDs, and an existing review worktree lacked the exact PR commit objects.

## Database startup

Drizzle's SQLite migrator compares the latest ledger timestamp. A newer migration
from another branch can hide the additive reading-path migration. Startup now checks
the two reading-path tables after ordinary migrations and transactionally creates
only missing tables from the shipped canonical SQL. Existing rows, extra columns,
and the migration ledger remain untouched.

The live database was backed up with SQLite's backup API before restart. Both tables
were then present, with the same 73 ledger rows and maximum timestamp. Tests cover
newer mixed histories, partial schemas, preservation, foreign keys, and rollback.

## Provider identity

Bitbucket details and provider state now resolve abbreviated hashes using the commit
endpoint for each side's repository. Returned IDs must be full length and match the
captured prefix. Fork source identity is preserved; missing, inaccessible, or mismatched
objects remain unavailable. List polling does not expand every PR's hashes.

## Polling and interface

Reading-path consumers now share one reference-counted poller and one in-flight read.
Unchanged snapshots retain references and do not notify subscribers. Same-head local
reads no longer write the document. Regression measurements: three consumers produce
one request instead of three; 21 identical snapshots produce one notification instead
of 21; 20 unchanged reads produce no writes instead of 20.

All PRs opens a dedicated searchable overview with repository filtering, author and
activity context, current/next markers, and separate review/waiting sections. Unknown
cached file counts are omitted. The selected PR overview has clear change, discussion,
reviewer, and check sections. File names and folders occupy separate rail lines.
Overview actions navigate to the actual changed file or requested discussion filter.
Keyboard focus stays inside the overview even when automatic mapping settings are closed.

## Verification

- Focused startup/provider/performance/overview/workspace/panel regressions: passing.
- Native Electron workspace with real Monaco and production snapshot IPC: passing.
- Renderer type diagnostics: same 63 normalized signatures as the recorded baseline.
- Desktop production build: passing.
- Live `bun run dev`: missing-table error gone; Map enabled for the previously blocked
  Bitbucket PR; overview search, selection, and file navigation exercised.
- Only one dev instance is left running; an older duplicate instance was showing stale UI.
- A final retry of the user's failed mapping attempt launched Codex successfully;
  no provider review/comment was submitted.

## Exact-object acquisition

Snapshot reading remains local-only. A separate acquisition mutation validates the
registered review workspace, provider, PR, captured head/base pair, and each side's
configured repository remote before fetching missing full commit IDs. It never
checks out, resets, or updates a branch. Missing fork connections and authentication
failures produce actionable errors instead of silently using a different revision.

Map uses the same acquisition service, independently cancellable from shared UI
requests. Browsing deduplicates requests across mounts and only retries a failed
acquisition after explicit Refresh for that workspace. Tests exercise cancellation,
StrictMode, failed snapshot retries, forks, identity changes, deadlines, and unchanged
HEAD, refs, and uncommitted files in disposable real repositories.

The live repository's HTTPS Git connection had no password available despite a
working app OAuth connection. Bitbucket Git authentication therefore uses the app's
existing refreshed token. The documented OAuth Git username is `x-token-auth`:
[Atlassian OAuth documentation](https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud).

Live verification on PR #9503 succeeded after restarting root `bun run dev`: the
acquisition mutation, snapshot creation, and both file reads completed, and the
actual C# changes rendered side by side in Monaco. The first fetch took tens of
seconds; subsequent snapshot and file responses completed within approximately
150 ms after acquisition. This is not an end-to-end performance benchmark.

Before/after digests of the real review worktree's HEAD, refs, status, tracked diff,
and staged diff all matched. Both database tables exist and the migration ledger
remains 73 rows with its original maximum timestamp. Retrying the user's failed Map
attempt subsequently launched Codex, attached its owned agent terminal, and displayed
Mapping with the 112-file manifest. The agent is waiting at Codex's "Hooks need review"
prompt for two new or changed hooks. Hook trust was not granted automatically. A
completed reading-path output is therefore not claimed; no provider review was submitted.

Independent final acquisition/authentication/cancellation review approved the code;
its latest batch passed 14 top-level tests across three files. The implementation
agent's broader acquisition/router/provider/renderer batch passed 20 top-level tests
across six files. Parent validation passed 21 focused top-level tests across nine
files and the native Electron workspace test with actual Monaco. Changed-file Biome
checks pass. Renderer diagnostics have the same 63 normalized signatures as baseline;
main typechecking also retains existing unrelated errors.

The requested knowledge-graph rebuild could not run because the local Python
environment has no `graphify` module; source tests and builds do not depend on it.
