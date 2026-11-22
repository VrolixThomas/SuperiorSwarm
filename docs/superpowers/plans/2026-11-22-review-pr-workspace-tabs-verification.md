# PR workspace tabs — implementation verification

The PR review now stays inside the app shell with a pinned Review tab, background agent-job tabs, ordinary isolated shells, persistent pane splits and a filterable PR sidebar. The old fullscreen review/terminal navigation is no longer the production route.

## Implemented behavior

- Start accepts a durable job before provider metadata, fetch, checkout or PTY creation. Its tab appears without stealing focus. Preparation phases, cancellation, retry attempts and ended results are visible.
- Stable job IDs survive retries; attempts receive fresh scoped run/question authority. Opening/restoring a tab never launches an agent. Closing hides the view; explicit Stop cancels.
- Review remains pinned. Automatic side-by-side opens at 60/40; manual drag remains 50/50. Pane closure rehomes Review. Hidden jobs and terminal ownership records survive session save/restore.
- Shell creation is guarded in renderer commands and main IPC until a verified isolated review worktree exists.
- PR opening remains a logical record operation. Agent preparation uses grouped same-remote fetches and a verified merge-base/head pair, with the target tip separately identified.
- Per-PR drafts, selection, scroll and panels survive tab/PR switching and pane moves. Stored observed revisions clear stale line anchors even after unmount/remount while preserving question text.
- Path summary, Browse files, Ask, Threads, findings, remap and session entry points are visible. Narrow panes render unified diffs without changing the saved preference.
- Needs review, Waiting on author and Your PRs use appropriate provider data. Search/repository/section preferences persist. Unsupported provider viewed counts are omitted.
- Original boards corrected; preparing, failed and ended boards added (16 HTML + PNG pairs).

## Validation

- Production Electron/Vite build passed.
- Native integrated shell: **25/25 checks**, real Monaco and production snapshot IPC. Covers early preparation, navigation without focus theft, split ratio, narrow unified diff, Ask drafts across pane moves, failure/retry/cancel/end, real 288px PR sidebar with split + Ask, authored filtering, and no horizontal overflow.
- Existing native review suite: **57/57 checks**, dark/light captures, changed/context files, Ask/comments, inline findings and exact snapshots.
- Tab/pane/sidebar/resize focused suites: **126 passing tests** at the lane integration gate.
- Backend jobs, metadata fencing, auto-map, revision scope and runtime/terminal ownership suites passed. Renderer job/Ask/transport/session-persistence regression suites passed.
- Independent review found and verified fixes for stale-head job revocation, Ask retry correlation, remounted stale anchors, and provider-observation generation races (including delayed old-head results after an accepted newer head).
- Full repository TypeScript still reports pre-existing unrelated diagnostics. The final changed-file audit found no diagnostics in implementation or newly added test files; the existing pane resize diagnostic was fixed as part of this work.
- Biome checked changed source/tests; test-fixture non-null/any warnings remain. No formatting/lint errors; `git diff --check` passed.

Native runs use disposable Git repositories/profiles and isolated provider responses. They do not contact real providers, launch paid agents, or submit reviews. Provider/Git/CLI latency on a real PR is not represented as an observed timing improvement; browsing and job acceptance are now independent of that preparation.

## Visual evidence from the implementation

- [Preparation beside the review](../specs/assets/2026-11-22-review-pr-workspace/implementation/preparing-split.png)
- [PR sidebar + split + Ask](../specs/assets/2026-11-22-review-pr-workspace/implementation/sidebar-split-ask.png)
- [Reading-path summary](../specs/assets/2026-11-22-review-pr-workspace/implementation/path-summary.png)

## Separate integration boundary

The available app routes use the 72px navigation shell. The independently owned Queue screen on `activity-queue` (board 1, explicitly out of scope) has not been merged wholesale into this branch. No placeholder Queue destination was introduced. Existing development sessions need the changed main process loaded to expose the new durable-job endpoints.
