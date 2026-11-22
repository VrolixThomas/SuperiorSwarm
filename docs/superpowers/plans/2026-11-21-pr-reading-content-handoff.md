# Lane D — immutable review content handoff

Base dependency: `163c7059` (shared frontend checkpoint). This lane does not require A/B/C implementation commits to compile or test. The parent owns final integration; no sibling commits were cherry-picked and no external provider writes or active terminal prompts were issued.

## Implemented contract

- `useStepContent(workspaceId, prCtx, details, currentFilePath)` resolves `details.baseCommitOid` (provider target tip) and `details.headCommitOid` as full 40/64-character commit OIDs. Changed-file identities and rename sides come from the immutable snapshot manifest, not a branch diff. Commentable line sets are calculated from those exact contents with a bounded comparison; an unavailable comparison grants no line anchors.
- `ContextFileView` accepts `workspaceId`, `baseRef`, and `headRef`. Missing/short refs remain unavailable and request an explicit PR refresh after exact commits are acquired locally. No branch fallback or fetching is performed.
- Parent's remaining glue in `ReviewReadingPane.tsx`: pass `workspaceId={active.workspaceId}`, `baseRef={data.details.baseCommitOid}`, and `headRef={data.details.headCommitOid}`. Remove the existing source-branch fallback. `StepDiff` already supplies its existing workspace/details props to the changed-content hook.
- Existing `reviewExplanation.resolveSnapshot` takes optional `review: { provider, owner, repo, number }`. Renderer always supplies it. This is a cache identity discriminator, not provider authorization. Snapshot IDs include it alongside registered workspace/root and both commit OIDs; provider/repository/PR switches cannot reuse another review's cache entry.
- New `reviewExplanation.getSnapshotContext({ workspaceId, snapshotId, path, side: "base" | "head" })` returns the existing `ReviewSnapshotContent` union. Base means merge base, not target tip. The UI reads head context. Existing AppRouter registration requires no change.
- Context lookup uses literal `ls-tree` at the pinned commit, never filesystem content. It rejects traversal, absolute/backslash/NUL paths and over-limit names, does not follow symlinks, and shares changed-file root/cache checks, cancellation, object-size/encoding/LFS/mode limits and local-only Git reader transport protections. Empty text, absent, omitted, and unavailable stay distinct.
- The approved layout is unchanged; only availability text and content loading changed. Context has no viewed-state mutation path. Late requests cannot replace content after file/revision changes.

## Verification

Logs: `/tmp/pr-reading-integration-validation/`.

- RED first: four service context tests failed because `readContext` did not exist; five renderer integration cases failed against branch-based content loading.
- Final targeted suite: **49 passed, 0 failed across 14 test files**, including isolated renderer wrappers. See `final-tests.log`.
- `review-snapshot-renderer.test.tsx` uses real React/tRPC client IPC link, real router factory, real snapshot service and disposable Git repositories; only the native context editor is substituted. It covers mutable branch/worktree isolation, stale/revision switches, missing metadata, provider/owner/repo/PR/workspace separation, late responses, distinct context states, and zero viewed/writing RPCs.
- `review-snapshot-electron.test.ts` passes using a hidden, isolated Electron window, real contextBridge and production `setupTRPCIPC`, renderer hooks/client link, router and Git service. Temporary profile/repo, blocked external network requests, query-only preload guard, no database/provider/terminal/agent access. It verifies changed content remains immutable after branch/worktree mutation, empty/missing context, and unknown-revision refusal. This is a content integration test, not an authenticated live-agent run or full Monaco visual audit.
- Service/router tests cover renamed/added/deleted/empty content, BOM/CRLF, unusual literal paths, symlinks, binary/oversized/invalid-encoding/LFS/submodule omissions, missing tree/blob objects, root/ownership checks, cancellation, eviction, reader restart/reopen, and Git transport overrides.
- Production desktop `bun run build`: passes (`build.log`).
- Scoped Biome and `git diff --check`: pass. Focused snapshot TypeScript config passes. Main and renderer diagnostics match parent baselines after normalizing absolute worktree paths and line numbers. Test diagnostics have no additions; the baseline's five fixture-module diagnostics are absent at checkpoint. Global TypeScript still fails on pre-existing diagnostics; no clean global check is claimed.
- Graphify rebuild attempted: unavailable (`ModuleNotFoundError: graphify`), no graph data changed.

## Remaining integration work

A's early shared contract is `963c0b56`, but implementation commits from A/B are still required for actual renderer → path router → durable store/controlled runtime → MCP callback → renderer scenarios. Parent should authorize their integration before those assertions are implemented here. Required scenarios remain mapping partial progress, cancellation fencing, stale-head run callbacks, multiple independently correlated questions, durable path/question restart, auto-map/settings, and provider identity/outdated-thread metadata through the assembled workspace. C owns provider metadata; D's content flow uses the already-published exact base/head fields.

The parent must complete the three ContextFileView props above before live context reads are enabled in the assembled workspace. Until then the view intentionally shows unavailable rather than mutable content. Authenticated provider smoke and live agent execution were not attempted. Existing LSP definition/reference locations still come from its running server; this change pins opened file content and does not synchronize the LSP to a snapshot. Existing IPC does not propagate renderer query cancellation into the service; service AbortSignal guards and late-response isolation are tested separately.

## Source routing for parent CLAUDE.md integration

- Revision-bound renderer loading and availability labels → `review-mode/step/useReviewSnapshot.ts`, `useStepContent.ts`, `useContextContent.ts`; context props are supplied by `ReviewReadingPane.tsx`.
- Unchanged snapshot paths → `ReviewSnapshotService.readContext`, `getSnapshotContext`; literal tree lookup shares object policies with manifest reads.
- Native content regression → `tests/review-snapshot-electron.test.ts` and `tests/fixtures/review-snapshot-electron/`. Its separate Bun builder avoids test-runner bundler cache aliasing; Electron startup runs asynchronously instead of top-level awaiting app readiness.

## Self-evaluation

Accuracy 4/5: isolated service/renderer/native evidence is concrete; authenticated providers and live execution remain unverified. Completeness 4/5 for independent lane scope: content is wired and tested, with parent glue and A/B-dependent E2E explicitly outstanding. Clarity 4/5: exact APIs and remaining props are recorded; full integration spans other lanes. Actionability 4/5: local commit plus checkpoint dependency is directly integrable; parent must supply the three context props. Conciseness 4/5: dedicated helpers keep production loading small; native harness adds fixture code to verify actual IPC. Overall 4.0/5. Highest-impact next steps are parent UI glue, A/B integrated callback tests, then an explicitly safe live read-only smoke. The user should agree with this bounded assessment; it does not claim completion of dependent E2E.
