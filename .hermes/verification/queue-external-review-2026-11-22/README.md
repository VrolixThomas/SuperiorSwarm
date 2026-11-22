# External queue — final independent review and integration

SUP-39–42 are implemented, independently reviewed and verified together on `integrate/queue-external-review`. The final code snapshot is `99b0edc3`; later commits record evidence only. The user's `activity-queue` branch remains at completed SUP-45 `014e5e79`. External queue features have not been merged into that branch or pushed.

## Delivered behavior

- Ticket intake and own-ticket comment feedback use authenticated account/site identities, a silent baseline, stable occurrence receipts and fresh comment context. Status-only edits do not resurrect dismissed feedback. Confirmed Start reserves its source/revision durably before creation and links the workspace in main, preventing concurrent or restarted duplicate creation.
- Reviewer PR attention is distinct from owned-PR feedback. Incomplete history retains attention; solver input includes exactly the fresh selected review/comment events, actor identity and inline anchors. Solver state and deduplication stay inside the exact workspace/provider/account/occurrence.
- Opt-in project hooks trust exact config bytes and canonical root. Failed/partial output retains previous attention; only complete successful output resolves missing keys. Open cannot restore another project's workspace. Fix rechecks dismissal and prepares a new unmanaged chat, preserving existing managed conversations.
- Queue-origin review and solver publication has a five-second Undo window, durable at-most-once receipts and fresh source/account/head/content checks. Cancellation, validation races, expired reservations, partial/uncertain outcomes, concurrent draft changes, foreign threads and unapproved outgoing commits are covered. Origin bindings survive navigation and saved restoration; old completions cannot clear or close newer drafts.
- Codex local solvers use a dedicated process to preserve terminal/task callback environment. Existing permission settings remain unchanged.

## Independent review closure

The original ten findings were fixed and independently retested. Further review found and corrected managed-chat reuse, missing review-only solver input, lost provider inline context, publication races/scope/content/commit-range issues and two UI lifetime defects. No blocking finding remains in the reviewed units.

| Independent review | Result |
| --- | --- |
| Ticket fixes `2a18176f` | 24 tests pass; separate two-process SQLite probe creates exactly one workspace/link |
| Hook fixes `24477d22` | 30 tests pass, including both providers × repo/folder/orchestrator through production manager seams |
| Original PR fixes `43960de7` | 25 tests pass, including original adverse reproductions |
| Exact solver feedback through `1ba8fb6c` | 11 tests / 33 assertions pass, including review-only input and both provider anchor cases |
| Publication backend `9b3097e3` | 34 tests pass, including every independent race/scope/content reproduction |
| Publication UI `e050050c` | 17 tests pass; actual restored React submit uses 0 immediate sends and 1 delayed preparation |
| Dedicated Codex solver `5add7a48` | 4 argv tests pass, exact one Codex flag with unchanged permissions and Claude args |

## Final integrated verification

- **348 tests across 40 isolated Bun suites pass** on the combined tree: [manifest](final-tests.json).
- **Desktop production build passes:** [build](final-desktop-build.txt).
- **Biome passes** for all 123 changed TypeScript files, with 52 non-blocking warnings: [output](final-biome.txt). `git diff --check` passes.
- Main/renderer diagnostics decrease from 57/78 to 56/69 with **zero new diagnostic signatures**. Repository-wide TypeScript remains failing; it is not presented as clean: [comparison](final-types.json).
- **Native external queue passes, 3.22s:** real QueueView/preload/IPC/SQLite, persisted-history Open targeting, no Open acknowledgment, Done/Undo, Later/BringBack, trusted synthetic hook reconciliation and failed-output retention: [log](final-external-native.txt), [image](final-external-queue.png).
- **Native full-shell queue passes, 35.28s:** jump/peek, existing workspace/folder/coordinator menu and layout/receipt behavior: [log](final-full-shell.txt), [wide](final-full-shell-peek-1440.png), [narrow](final-full-shell-peek-800.png).
- **Actual Claude and Codex:** four Hook Fix / PR Solve startup probes pass; the dedicated Codex production rerun passes; Claude exact-file Read and Codex generated-file/argv expansion both produce the expected accepted final reply marker. Full evidence and test seams: [native launch report](../queue-external-native-launch-2026-11-22/README.md).

## Boundaries

External review/reply/push validation uses fake providers and temporary Git repositories; no live external posts or pushes were made. Actual native tests prove launch identity, callback/cwd/conversation and prompt-context delivery under restrictive fixture configuration, not completed MCP-powered solving or every live provider × entity-kind combination. Entity scope variations are separately tested through production services and controlled lifecycle seams.

Bitbucket approval cannot atomically pin a head through its provider API. It retains the explicit manual fallback, never suggested automatic eligibility. Legacy solver scripts retain manual Open rather than guessed structured-resume provenance. Hooks remain opt-in, POSIX and project-root scoped, with the documented single-process scheduler boundary. Possibly side-effecting failed ticket creation retains a durable claim and requires manual recovery rather than automatic duplicate creation.

The root monorepo build also includes an unrelated website whose Next dependency is absent in the isolated worktree; the desktop build was run from `apps/desktop`. Optional Graphify rebuild is unavailable. Neither condition is a newly introduced source failure.

User `bun.lock` remains unchanged (`c3b29706e35ce3b2abe14db228dcc11f8917d97a6ae4eaca5a0d8eb29dca10ad`). Existing user app instances, chats and global provider trust/settings were preserved. No release was created.
