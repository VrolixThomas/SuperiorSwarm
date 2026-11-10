# Explainable PR review implementation

Baseline: `a6603c1b9e04f32c3cb8b4bf6aa911e453a6820e`. Implements the [investigation](2026-11-10_18-55-explainable-pr-review-investigation.md) in bounded increments. Product code is now authorized; no push, external publication, deployment, credential access or app/daemon restart is part of this work.

## Delivery sequence

1. **Immutable local snapshot foundation — current increment.** Add shared snapshot contracts, bounded Git object reads, complete local changed-file manifests and a registered-workspace tRPC API. Preserve rename/base-side identity and distinguish absent, omitted and unavailable code. Expose the provider base OID alongside head OID for later renderer acquisition. No branch checkout, fetch, repository execution or empty-content fallback. This increment is backend groundwork; it does not claim to ship Flows or conversational Q&A.
2. **Deterministic flow analysis.** Parse changed TS/JS symbols on both sides using a bundled parser. Classify support files, resolve imports/local calls, discover roots, condense cycles and create several evidence-labeled routes. Add bounded jobs/cache and fixture expectations from PR #129/#161. Other languages retain explicit file-level fallback and complete coverage.
3. **Guided UI and durable progress.** Add optional Flows to the existing Review Mode, with one ordered projection for rail/keys, pinned diff models, current-step rationale, raw access, jump/backtracking and saved view/composer state. Add additive SQLite persistence and head-change reconciliation. Do not silently reuse legacy viewed marks for a new revision.
4. **Architectural Q&A.** Select an inference transport with an enforced read-only broker. Retrieve exact snapshot evidence, validate citations and distinguish changed code from surrounding architecture. Preserve and restore the review anchor. Ordinary CLI review permissions are not acceptable for this mode.
5. **Findings/revision integration.** Attach findings to steps with mapping confidence/freshness. Surface urgent concerns without stealing focus. Add expected-head checks before explanation-originated drafts can be published.
6. **Scale and customization.** Measure worker/cache budgets, add package reverse indexes and private reorder/title overrides. Evaluate optional snapshot-validated LSP enrichment and content-free metrics.

## Current increment: testable guarantees

| Task | Likely files | Acceptance and test target |
|---|---|---|
| Snapshot contract | `apps/desktop/src/shared/review-snapshot-types.ts` | Versioned IDs, target/head/merge base, file IDs, old/new paths/blob modes, explicit content states. |
| Safe Git transport | `apps/desktop/src/main/review-explanation/git-reader.ts` | Argument arrays only; full commit OIDs; no inherited Git overrides/helpers; bounded output/time; no network fetch, textconv or filters; cancellation. Real disposable-repo tests. |
| Manifest and reader | `apps/desktop/src/main/review-explanation/snapshot.ts` | Merge-base comparison, >100 changed files, repeatable identities, branch/working-tree changes cannot alter pinned reads, rename old-side content, deletion versus empty file, binary/large/LFS/symlink/submodule metadata, explicit missing/ambiguous/shallow failures. `tests/review-snapshot.test.ts`. |
| API boundary/cache | `apps/desktop/src/main/trpc/routers/review-explanation.ts`, `routers/index.ts` | Resolve root from workspace registration; no caller-supplied filesystem root; cache scoped to workspace/root/revision; reject foreign/evicted snapshot and unknown file IDs; revalidate root on reads; bounded memory/concurrency. `tests/review-snapshot-router.test.ts`. |
| Provider revision metadata | `apps/desktop/src/shared/github-types.ts`, `main/github/github.ts` | Preserve exact `headRefOid` and `baseRefOid`; missing base remains unavailable, never guessed from branch. Extend `tests/github-pr-details.test.ts`. Existing providers/raw UI remain compatible. |

Use Bun native tests already established by the project. RED: add tests and verify missing implementation / new metadata behavior fails. GREEN: implement and rerun the same targets. Then run coverage, focused type-check and Biome checks; compare broader type-check failures against the pre-change baseline when needed. Record commands/results in `.hermes/verification/` and create local RED/GREEN checkpoints. Test repositories are temporary and isolated from user Git hooks/config; no real credentials/provider requests.

## Scope and rollout

The first increment adds an API without changing the current renderer or submission behavior. It can be reviewed and tested independently; the guided UI consumes it in increment 3. Missing local objects are explicit errors; acquiring them remains a separate user action through existing integration. The initial cache is bounded and process-local; restart-safe progress and retained history arrive with the additive schema in increment 3. Semantic ordering must not depend on Git/provider path order; the foundation's stable path ordering is metadata order only.

Use existing installed dependencies without running installation scripts. Preserve pre-commit hooks; suppress only the post-commit Graphify hook that writes shared output through this worktree's symlink. Do not modify persistent Git configuration or sign through Keychain. If rebuilding graph metadata, isolate the output to this worktree rather than replacing the shared main-worktree graph.

## Execution ledger

- [x] Inspect current checkout and record implementation sequence.
- [x] Snapshot/metadata tests demonstrate RED: snapshot module absent (intended compile-time RED); metadata test returns the stale commit-node OID. Run from `apps/desktop` to apply its Electron test preload.
- [x] Local RED checkpoint: tests and this plan only, before implementation.
- [x] Snapshot service and API pass GREEN; initial checkpoint `4e75159d`, cancellation/cache corrections `ab2ac36e`, and subsequent BOM preservation regression fixed.
- [x] Coverage, focused type checks, lint and boundary review. 69 tests pass; full main type-check has the same 66 diagnostics as baseline, with no additions.
- [x] Update durable source index and [verification evidence](../verification/2026-11-10-review-snapshot-foundation.md).
- [x] Local GREEN checkpoints preserved; report snapshot foundation as completed and increments 2–6 as remaining.

## Current handoff

The `reviewExplanation.resolveSnapshot` and `getSnapshotFile` tRPC procedures are implemented. Cache: eight snapshots, at most 10,000 changed files each, two simultaneous requests, 15-second request deadline / 10-second Git subprocess deadline, 8 MiB subprocess output cap, 1 MiB text-blob limit. Oversized manifests fail explicitly rather than truncating. Cache eviction/restart requires re-resolving the revision.

The next increment starts at `ReviewSnapshot.files`: add changed-hunk/symbol extraction and deterministic flow planning. Keep the current renderer unchanged until it can switch manifest, content, progress and navigation together. The existing provider file-list cap, branch-based Changes view and legacy viewed-state semantics are not fixed by this backend increment. No UI, model transport, persistent schema, submission change or hosted analysis has shipped.
