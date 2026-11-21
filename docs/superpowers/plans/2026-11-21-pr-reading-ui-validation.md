# V2 — native reading-workspace validation

**Recommendation: hold integration for the three findings below.** Validated merged baseline `0e79fa3dde6a48700846a4768e45389067fe9c20`, not an individual implementation lane. Tests/fixture commit: `29423b2a4127b4aa4ea9279b9765259ffb34a269`. No production changes.

The new native acceptance test completes **57 behavior probes: 51 pass, six fail**, representing three defects. It intentionally remains red against this baseline. Repeated completed runs reproduce the same failures. Nine existing renderer wrapper tests pass (33 isolated child cases); both existing native terminal lifecycle cases pass, 100 navigation cycles each.

## Confirmed findings

### P1 — left selections silently target the right side

In split mode, select original/LEFT lines 2–3, then press `/`. Actual Ask anchor is `{path:"src/alpha.ts",side:"RIGHT",startLine:1,endLine:1}`. There is no left selection action row. With that selection focused, `c` creates a composer in the modified editor: **LEFT composers 0, RIGHT composers 1**. A reviewer asking about removed code instead sends current-code context and can create a draft on the wrong side.

Sources: `apps/desktop/src/renderer/components/review-mode/hooks/useSelectionActions.ts:25` subscribes only to `getModifiedEditor()` and line 46 hardcodes RIGHT. `step/useStepComments.ts:204` and line 213 select the modified editor and RIGHT for keyboard comments. This is a gap in the new selection interaction; the existing right-only comment assumption also carries into it. Real Monaco disproves the selection-double tests' coverage of both sides.

Failing probes: `left selection exposes Ask and Comment actions`, `left selected-line Ask retains side and range`, `left c places composer in original editor`.

### P1 — ordinary context return exhausts snapshot concurrency

Open a changed file, navigate through an unchanged test/context, then return to the changed file. Cached `resolveSnapshot` and both `getSnapshotFile` sides refetch together. The production service rejects a request with **“Review snapshot reader is busy. Retry shortly”**. The diff stays unavailable and tells the reviewer to acquire exact commits which already exist locally. Refetching all queries also reproduces this contention.

Sources: `apps/desktop/src/main/review-explanation/snapshot.ts:117` rejects a third active request. `renderer/components/review-mode/step/useReviewSnapshot.ts:34` and `useStepContent.ts:21` use `staleTime:0` and `retry:false`; cached snapshot data permits all three requests on remount. `useStepContent.ts:30` turns any query error into unavailability. This is an integration failure involving a preexisting snapshot concurrency limit now relied upon by the new navigation/content hooks, not a missing local revision.

Failing probe: `returning from context retains available diff`. The saved query errors identify the failed HEAD content request. The fixture uses the actual snapshot service/router, local Git objects, native preload IPC, and full renderer; content is not doubled.

### P2 — rejected Ask loses the question and its error

Make `reviewPath.ask` reject before a question is persisted, then send “Do not lose this question on launch failure”. After the next successful poll (observed after 1.7 seconds), there is no matching message, composer text, retry action, or launch error. This is distinct from a persisted failed question, whose Retry works.

Sources: `apps/desktop/src/renderer/components/review-mode/panel/AskTab.tsx:40` clears text before acknowledgement; `panel/useAskAgent.ts:95` returns no send result; `renderer/lib/review-path-source.ts:303` clears the mutation error on successful polling. Offline or provider-validation failures can silently discard a user's question.

Failing probes: `transport error remains exposed after poll`, `transport error retains question or retry`.

No P0 finding. All three findings were sent immediately to the parent through SuperiorSwarm MCP.

## Coverage matrix

| Surface | Result | Independently exercised / limit |
|---|---|---|
| Full workspace, live adapter, React stores | PASS | No `fixture` prop; real `useReviewConnections`, live controller, tRPC client, `contextBridge`, `setupTRPCIPC`. Provider/path replies are controlled local handlers. |
| Overview / mapping / reading | PASS, bounded | Open overview; Map RPC; streamed mapping-to-ready polling preserves selected file. No actual agent map run or Stop-to-runtime round trip. |
| Files, Path, >100 files | PASS | 106 changed files, windowed rail (26 visible rows), last file's exact head text, nested unchanged test/context; model count remains two across changed-file swaps. |
| Native keyboard | MIXED | Real Electron key events for diff `j/k/v/n/p/f/t/` and Cmd-period; context `t`; shell Cmd-arrows, Cmd-period, resize arrows, Escape. Left `/` and `c` fail. Not every key/focus/surface permutation was exercised. |
| Snapshot / model lifecycle | FAIL | Exact Git contents, binary/empty handling and unknown-head refusal pass. Context-to-diff remount fails with BUSY. Existing renderer tests independently cover missing context and stale responses. |
| Ask and draft comment | MIXED | Right selection 2–3, pending/duplicate-send guard, cancel, persisted failure/retry, typed text through refetch, answer reference to beta:3, Add-as-comment body/RIGHT/end-line 3 pass. Left selection and pre-persistence failure fail. Existing comment API is single-line; no multi-line provider payload is claimed. |
| Findings / explicit Submit | PASS with inert backend | Actual inline Edit, Dismiss, Accept; Submit popover sends `{draftId:"draft",verdict:"APPROVE",body:"Native test summary"}`. Handler records only; no provider publication. |
| Threads / identity | PASS | Left inline thread, outdated prior line, unknown resolution, Mine stable ID despite matching display names; current account changes from ID 42 to 99. |
| Context viewed state | PASS | Saved context and unchanged test never call mark-viewed. Navigation/Ask/accept do not implicitly mark files. One explicit `v` call is recorded. |
| Layout / themes | PASS with content defect visible | All nine categories captured and visually inspected in dark/light at 1512×945 CSS pixels (Retina PNGs 3024×1890). No body horizontal overflow; overlay preserves diff width. Rail keyboard resize 288→308, native pointer clamp 360, collapse work. Busy-state screenshots visibly show unavailable content. |
| PR/head async boundaries | PARTIAL | Native head refresh clears anchor; Cmd-arrows use real queue/workspace opening flow with disposable response. Existing independent launch-delivery tests cover changed-head/unmount late attachment. Full pending native PR-switch/agent attachment combination not exercised. |
| Terminal return / running attach | PASS at separate seams | Existing full-workspace controlled attachment test checks existing terminal IDs and zero writes. Separate actual Terminal/preload/IPC/socket/PTY fixture passes current and legacy daemon modes, 100 cycles each. New native workspace fixture does not mount a running TerminalDrawer. |
| Authenticated providers / Codex / Claude | UNVERIFIED | No live-provider execution or authenticated metadata testing; no prompts sent. |
| LSP Cmd-click / full restart / restored workspace | UNVERIFIED in native fixture | No language server or process restart; native testing must follow after blockers. |

## Reproduce and evidence

Run from `apps/desktop` with existing dependencies:

```sh
SS_KEEP_UI_ARTIFACTS=1 bun test tests/review-workspace-native.test.ts
bun test tests/review-live-workspace.test.tsx tests/review-selection-actions.test.tsx tests/review-workspace-panel.test.tsx tests/review-workspace.test.tsx
bun test tests/review-workspace-step.test.tsx tests/review-workspace-rail.test.tsx tests/review-inline-zones.test.tsx tests/review-snapshot-renderer.test.tsx tests/review-path-launch-delivery.test.tsx
bun test tests/terminal-lifecycle-electron.test.ts
```

[Committed evidence](assets/pr-reading-ui-validation/evidence.json) includes named checks, exact failed observations, mutation payloads, layout metrics, and query errors. Final raw native evidence: `/tmp/ss-review-ui-NLjKPw/result.json`, `electron.log`, and `screenshots/`. Prior confirming run: `/tmp/ss-review-ui-TrKz0L/`. Command logs: `/tmp/pr-reading-ui-validation/{native-final-confirmed,baseline-ui,baseline-components,baseline-terminal-native}.log`.

Native fixture uses a disposable Git repository/profile, real Monaco with bundled workers, production CSS, and native key/pointer events. It keeps actual editor models/view zones and actual snapshot IPC. The custom preload exposes only isolated handlers. Main registers no real provider mutation, account, database, or agent launcher; external network requests are blocked. Explicit test submission is recorded in memory. Final forbidden operation log is empty. This is not authenticated/live success.

Production baseline is unchanged; existing tested entry points remain green. The new test adds six failed acceptance assertions rather than modifying expected behavior to pass. Global test TypeScript remains red: baseline excluding only the new test/fixture has 211 distinct diagnostics, current has 211, with 0 added and 0 removed. Changed fixture/test paths have zero diagnostics. Scoped Biome exits successfully with explicit-any/non-null warnings in fixture assertions; diff whitespace passes. Graphify rebuild and normal commit hook report `No module named graphify`. No package/lockfile changes, native rebuilds, global configuration edits, pushes, or merges. Only the two dependency symlinks created for this validation are removed on completion.

Self-evaluation: accuracy 4/5 (repeated native evidence, provider doubles explicit); completeness 3/5 (live CLI, combined drawer/PTY, LSP/restart and exhaustive shortcut permutations unverified); clarity 4/5 (bounded matrix); actionability 4/5 (runnable red acceptance test plus exact sources); conciseness 3/5 (large fixture needed to retain boundaries). Overall 3.6/5. Highest-impact next work: fix/retest the three failures, then combine real terminal attachment with full workspace and exercise LSP/restart. This assessment should not be read as full release certification.
