# Review snapshot foundation: implementation evidence

Date: 2026-11-10. Source baseline: `a6603c1b9e04f32c3cb8b4bf6aa911e453a6820e`.
Plan: [implementation sequence](../plans/2026-11-10_19-35-explainable-pr-review-implementation.md).

## Completed slice

Added immutable local revision/file contracts, a bounded Git-object reader, a workspace-bound snapshot service and two read-only tRPC procedures. GitHub details now include exact provider head/base OIDs. The renderer, semantic ordering, conversation tools, viewed-state persistence and submission behavior are unchanged. Local snapshot manifests are independent of the provider's 100-file list; the old renderer's cap is not fixed by this increment.

## TDD checkpoints

| Stage | Evidence |
|---|---|
| RED `b9fa9ac4` | Snapshot tests reference the intentionally missing implementation. `bun test tests/github-pr-details.test.ts`, from `apps/desktop`, yielded 2 pass / 1 fail: expected explicit PR head `aaaa…`, received stale commit-list `cccc…`. An initial root-directory invocation lacked the desktop Electron preload; that setup failure is not counted as behavioral RED. |
| GREEN `4e75159d` | Snapshot service/router and revision mapping: 19 pass / 0 fail / 63 assertions. The gitlink fixture was corrected to stage the gitlink after `git add --all`, which otherwise removed its deliberately absent working-tree directory. |
| RED `b5c6e54b` | Added cache/cancellation/path tests: 15 pass / 3 fail. Delayed read resurrected an evicted entry; cancellation waited for a root lookup; `.trimEnd()` broke roots ending with whitespace. |
| GREEN `ab2ac36e` | Added cancellation racing/deadline cleanup, post-await cache ownership validation and exact newline removal: 23 pass / 0 fail / 68 assertions. |
| RED `2b2cf540` | Focused BOM fixture failed: TextDecoder removed the UTF-8 BOM. This checkpoint also adds subprocess cancellation and Git environment/replacement-ref isolation tests plus focused TypeScript configuration. |
| GREEN `7ba1c163` | Preserve BOM using TextDecoder `ignoreBOM: true`; 68 tests passed. |
| RED `a434afe8` | A synthetic repository with `protocol.file.allow=always` bypassed the general `protocol.allow=never` setting. The isolated reader allowed a local transport operation; no external server was contacted. |
| Final GREEN | Set an empty `GIT_ALLOW_PROTOCOL` allowlist so protocol-specific repository overrides cannot enable transports. Focused types pass. Final combined run: **69 pass / 0 fail / 125 assertions** across five files. |

## Guarantees exercised

| Journey / boundary | Test evidence |
|---|---|
| Read the PR's changes rather than unrelated target-branch changes | `review-snapshot.test.ts`: divergent target/head yields the expected merge base and four-file manifest. |
| Return to exactly the same code after refs or working-tree content move | Pinned rename base/head reads remain identical after changing the branch ref and local file. |
| See every changed file and correct old/new sides | 110-file fixture includes tabs/newlines/Unicode; rename paths preserved; added/deleted absence differs from empty text. |
| Avoid automatic traversal/download/conversion | Symlink/gitlink/binary/non-UTF8/large/LFS entries return explicit metadata-only reasons; synthetic diff/textconv helpers never run. |
| Reject unavailable or ambiguous revisions | Full commit IDs only; missing objects, blob-as-commit, shallow history, disconnected roots and multiple merge bases rejected. Missing cached blob returns unavailable, never empty text. |
| Stay inside the registered workspace and snapshot | Router rejects arbitrary roots, invalid ref/side inputs, unknown workspace and foreign snapshot/file IDs. Service revalidates root and returns cloned cache data. |
| Bound lifetime and resource ownership | Cache eviction, delayed-read eviction race, two-request limit/recovery, early cancellation, cancellation during root resolution and live Git subprocess cancellation. |
| Preserve byte-relevant source text | BOM and CRLF retained; binary and invalid UTF-8 are not silently decoded. |
| Ignore ambient Git overrides | Git directory override and replacement references do not change the pinned result; repository-specific transport overrides cannot enable a connection. |

## Commands and results

Run from `apps/desktop` so its test preload applies:

```sh
../../node_modules/.bin/tsc --noEmit -p tests/tsconfig.review-snapshot.json
bun test --coverage --coverage-reporter=text tests/review-snapshot.test.ts tests/review-snapshot-router.test.ts tests/github-pr-details.test.ts tests/github-api.test.ts tests/github-adapter.test.ts
```

Focused type-check exited 0. Test result: 69 pass, 0 fail, 125 assertions. Bun reported 100% line coverage for the new Git reader, snapshot service and router; function coverage was 100%, 90.91% and 87.50% respectively. The combined imported-source report was 57.81% lines / 35.92% functions, since these focused tests import unrelated database/auth/Git infrastructure. Coverage is not proof of every branch; no claim of complete application coverage.

`tsc --noEmit -p tsconfig.main.json` was run against both the working tree and a disposable archive of baseline `a6603c1b`, with identical installed dependencies. Both exited 2 with **66 diagnostics**. Their diagnostic multisets were identical after normalizing source-root paths and line shifts; no introduced diagnostics. Existing issues include AI-review types, provider narrowing and SQLite driver type mismatches. The first comparison needed absolute-path normalization for schema import diagnostics; it was rerun with that correction.

Biome check across the 12 changed source/test/config files passed after formatting, with two existing `noNonNullAssertion` warnings in `main/github/github.ts`. `git diff --check` passed. No full-suite test run, running-app UI check, packaged Electron build, or live-provider call was performed: this increment exposes backend groundwork and does not change UI. Native Git behavior was exercised in disposable repositories.

## Trust and local side effects

Git reads use argument arrays, an allowlisted environment, disabled global/system config, disabled fsmonitor/hooks/credential helper, no external diff/textconv, no replacement refs, no lazy fetching, and an empty transport allowlist that overrides repository protocol settings. Content is addressed by manifest blob IDs, not caller-provided paths; symlinks/submodules are never followed. No provider mutation dependency exists in the new router. Errors omit subprocess stderr and internal root paths. Limits and cancellation are enforced in the service as well as input validation at tRPC.

Tests used synthetic repositories and fake workspace resolvers with the project's Electron/SQLite test shims. No app database, Keychain, credentials, external publication, push, deployment or running daemon was accessed. Existing dependency directories were temporarily linked for validation and removed afterward; no installation scripts ran.

Local RED/GREEN checkpoints retain all hooks except the known shared-Graphify `post-commit` hook, disabled per invocation; signing was disabled per invocation. Persistent Git config and installed hooks were not changed. The repository-required Graphify rebuild ran with its installed Python 3.13 interpreter, no LLM and no symlink traversal. Its output was isolated to a worktree-local ignored `graphify-out/` directory, replacing only this worktree's shared-output symlink; the shared main-worktree output was not modified.

## Remaining work and assessment

Proceed to changed-symbol extraction and evidence-labeled deterministic flows, then the guided UI/persistence. Snapshot metadata is process-local and root/workspace-scoped; cross-workspace deduplication, retained historical blobs, paginated manifests beyond the current explicit cap and persistent progress belong to subsequent increments. Provider base/head authenticity at a PR-level session boundary must be enforced when wiring the renderer; this API intentionally accepts exact local revisions for a registered workspace and does not claim to authorize publication.

Self-review using `ecc:agent-self-evaluation`: accuracy 4 (real Git/route tests and baseline comparison; no packaged-runtime validation), completeness 4 (current backend slice delivered; full product phases explicitly remain), clarity 4 (typed states and documented API; no visible UI yet), actionability 4 (test commands/checkpoints and next increment specified; inference choice remains later), conciseness 4 (evidence repeats some fixture guarantees to preserve the TDD trail). Overall 4.0/5. Next improvement: use these contracts in flow extraction before introducing UI state or model inference. The user can distinguish the implemented foundation from the planned experience.
