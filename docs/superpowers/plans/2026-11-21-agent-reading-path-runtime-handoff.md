# Lane B runtime handoff

Base frontend `163c7059`. Initial B implementation: `15af833e`, `2b78db36`; earlier handoff commits `247216eb`, `e63ee394`.

A dependencies integrated for assembled validation: `963c0b56` → `3e71b80e` → `3064b315` → `213fba2f`. Local equivalents are `120bf0ec`, `e549160e`, `44e01b18`, `99d9c7af`. Integrate each dependency once. The new B follow-up changes only B runtime/adapters/tests and this handoff; no A schema, router, capability, or storage code changed.

Provider deployment also needs C's verified file-manifest commit `00174a1e7bf1791802f818a7021d79e8fb26b1e2` on `be9631d7`. C was not cherry-picked here; the assembled test supplies explicit complete/incomplete provider doubles to A's real validator.

## Integration contract

- Call `initializeReviewPathRuntime()` after DB, task registry, daemon and providers initialize, before accepting mapping/Ask requests. It installs the port using A's service.
- Startup fails all persisted running mapping/question scopes as interrupted, even if their PTY survived. Old capabilities are revoked. No prompt is sent. Manual Retry creates a new scope; durable auto-claims prevent silently relaunching a failed/cancelled head. Transient terminal inventory failure defers cleanup without repeating startup fencing against new runs.
- Runtime validates the registered review workspace and current exact provider head, writes private prompt files, registers task mode `review-path`, creates an owned terminal, and returns its attachment descriptor.
- Parent UI: pass full `identity` (or workspaceId plus exact details head) into `useReviewPath`; pass full `identity` into `useAskAgent`. Both accept `onLaunch`. Attach the returned **existing terminalId**, reviewWorkspaceId and worktreePath. Do not call `launchReviewTerminal` or write launchScript again: main already launched the owned PTY. Both hooks now suppress delayed attachment after identity change or unmount.
- Ask returns `status`, `error`, `questions`, and `cancel(questionId)` alongside messages/send/available. Parent owns final presentation. Only the current conversation and full run/head identity are displayed; answers inherit their correlated question anchor. An older failure cannot mask a newer pending question.
- `alsoReview` creates an existing-schema local review draft and binds it with A's `attachReviewDraft` before task registration. A owns draft completion/failure/cancellation with the mapping. Findings and summaries stay local.
- Existing `auto-trigger.ts` invokes mapping before legacy automatic review. `pr-poller.ts` reconciles eligible existing requests after successful poll transactions while preserving first-provider bootstrap silence. C confirmed no poller collision.

## Follow-up defects reproduced and fixed

1. Surviving startup PTYs left durable scopes running with unusable task bootstrap. Startup now interrupts both mapping and Ask scopes independently of terminal inventory.
2. Cancellation during the awaited provider metadata read created an orphan `in_progress` review draft. The runtime rechecks the durable scope before side effects; storage owns workspace binding, and failed binding removes the new draft.
3. Cancellation during terminal inventory could still send a late launch prompt. Runtime checks its active scope after inventory and after terminal creation.
4. Cancellation during terminal creation left a persisted empty terminal. Failed pre-prompt launch disposes only its own terminal and removes only the session row it inserted.
5. Late Map/Ask callbacks could attach an old-head terminal after switching identity or unmounting. Hook delivery is now guarded by current controller and mount lifetime.
6. Ask exposed historical conversations and errors. It now selects current-conversation questions by full run identity, preserves correlated anchors, and evaluates the latest question's failure separately from pending history.
7. Follow-up prompts lacked conversation instructions. Ask now calls `get_review_path` first and restricts history to the exact run conversation and head; ambiguous or unavailable context remains explicit.

## Source routing for parent CLAUDE.md

- `main/review-path/execution.ts`: duplicate launch ownership, active-scope checks, cancellation and ordinary inventory reconciliation.
- `main/review-path/runtime.ts`: startup interruption, production provider/DB/task-token/terminal connection. Terminal IDs are `review-path:<run id>:<run version>`; Stop cannot select unrelated terminals. `exec` ends the owned PTY when its agent exits; polling compensates for renderer attachment replacing terminal callbacks.
- `main/review-path/prompt.ts` and `launch.ts`: exact MCP contract, scoped conversation history, immutable `git show` instructions, fixed executable/flags, shell-quoted prompt-file paths. Unknown base revisions remain unknown.
- `renderer/lib/review-path-source.ts`: durable polling, late-read sequence fencing, exact-identity controller cache and guarded launch delivery. Fixture registry remains explicit opt-in.
- `panel/useAskAgent.ts`: current conversation/head selection, question/answer correlation and error/pending behavior.
- `review-path-settings-store.ts`: legacy import-once through the backend and authoritative backend updates; failed reads/saves expose errors without claiming success.
- `auto-map.ts` / `auto-map-runtime.ts`: injected trigger policy, durable claim and existing review ledger coordination; only an actual matching local draft counts as an automatic code review. Existing review worktrees are reused without resetting a live session.

## Verification matrix

Logs: `/tmp/agent-reading-runtime-validation/assembled-*`.

| Check | Result | Evidence/limits |
|---|---|---|
| Targeted A+B regressions | Pass | 95 reported tests across 24 entry files; isolated wrappers additionally execute their component/native checks. |
| Actual storage/router/capability/runtime integration | Pass | Real migrations, SQLite storage, production runtime, tRPC, authenticated HTTP task bootstrap and registered MCP tools; temporary Git repo, provider doubles and fake daemon only. Covers partial mapping, local findings, scoped answer, cancellation races, retry, head supersession, offline Ask and incomplete metadata. |
| Codex/Claude prompt-file launch | Pass | Temporary fake executables verify exact prompt bytes, task token, descriptor and safe quoting; no real provider prompt. |
| React stale launch delivery | Pass | Actual hooks with isolated RPC: changed head and unmount cannot attach late Map/Ask terminals. |
| Production build | Pass | Electron main/preload/renderer build succeeds with A dependencies. |
| TypeScript delta | Pass relative to baseline | Normalized main 52→52, renderer 63→63, test 119→119 unique diagnostic sets; zero added diagnostics. Global type checks remain red on existing errors. |
| Scoped Biome / diff check | Pass | Nine changed TS/TSX files; no fixes outstanding. |
| Parent UI assembly / C live providers | Unverified here | Parent owns final identity/attachment/error-control glue and C integration; target these in the requested independent verification phase. |
| Live CLI/provider smoke | Not run | No real agent prompts, comments, review submissions, merges, or external writes during testing. |
| Graphify | Unavailable | Normal hooks report `No module named graphify`; no hooks bypassed. |

No new B blocker remains. Dependencies were integrated only in this isolated worktree. No global MCP configuration, package/lockfile, parent/sibling worktree, push, or merge changed.

Self-review: accuracy 4/5 (real local integration evidence, no live CLI test); completeness 4/5 (B scope complete; parent UI/C assembly independent); clarity 4/5 (source/API routing explicit); actionability 4/5 (isolated reproduction and exact dependencies); conciseness 4/5 (integration test is intentionally broad). Overall 4.0/5. Next verification priority: parent assembled UI and complete provider manifests, using isolated runners before any separately authorized live prompt.
