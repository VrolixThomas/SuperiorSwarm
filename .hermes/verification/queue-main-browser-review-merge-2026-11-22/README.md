# Main browser / PR workspace merge into activity-queue

Merge parents: Queue `0adb8d00`, latest fetched `origin/main` `4f2d7bc2` (PR review workspace merge #163, including browser #162). Three Codex lanes integrated shell, review flow and runtime; parent resolved schema/provider/dependency compatibility. All 23 conflict paths are resolved by retaining both behaviors.

## Integration

- Queue rail/layout, mixed sources, jump/peek, exact attach-only Open, own-chat controls and persisted origins coexist with persistent browser tabs, the browser registry and PR job coordination.
- Queue PR Open uses main's bounded lazy review helper. New reading workspace/header/thread controls use the exact scoped Queue origin and guarded five-second publication; pinned revision/path/draft checks remain enforced. Split callers register owned tabs before moving them, preserving main's strict pane guard.
- Terminal/control-plane/MCP handling retains both queue/reporting admission and review-owned task/terminal authority. New browser tools and review-path tools remain registered. Opening Queue destinations never creates an ordinary shell in a logical PR root.
- Ordinary own-chat startup rejects unprepared review records before preparing a terminal/script. Prepared review chats use their joined isolated worktree. Both providers have regressions for these paths.
- Bitbucket open state reads use full verified OIDs and keep Queue activity/account facts. Confirmed terminal PR states remain usable for cleanup when an old fork/source commit is unavailable; no open action accepts a missing OID.

## Migration compatibility

Both historical 0065 SQL files and their timestamps are retained. Journal entries preserve each branch's original relative order; indices are renumbered to combine histories. Generated `0076_merge_queue_review_schema` adds idempotent reconciliation for additive review and Queue tables skipped by the other branch's higher timestamp. Its snapshot includes both schemas and chains from the Queue snapshot. Historical SQL bytes are unchanged.

Tests reconstruct the exact two historical journals from canonical SQL without requiring Git history in CI. Fresh databases, both branch upgrade directions, existing message/preferences/Queue receipt data, ledger history, foreign keys and repeated startup are checked. The 11 migration/startup tests pass. A stale existing test expectation was updated for the already-existing queue_launch_known column and now selects its boundary by migration tag instead of journal index.

## Verification

- Final integrated focused pass: **464 tests across 55 isolated suites**, all pass.
- Runtime lane:118 tests; shell lane:130; review lane:70 outer tests (overlap with parent suite; not additive counts).
- Desktop build passes using main's pinned **Electron45.4.1 / ABI150** and better-sqlite3 13.2.0. Desktop/PTY and MCP native bindings rebuilt for that runtime.
- Native actual App browser passes: address/search behavior, persistent guest, terminal/browser switching, split ownership, modal layering, command palette and tab destruction (14.37s).
- Native PR workspaces pass in legacy and tabs modes with real Monaco/production snapshot IPC (2 tests,42.58s).
- Native mixed Queue and full-shell jump/peek pass (3.42s/35.89s).
- Cold MCP/real built daemon runtime checks pass (3 tests).
- Main types remain56 diagnostics; renderer improves69→68. Normalized comparison shows no new diagnostic signatures. Repository-wide TypeScript is not clean.
- Biome checks of26 conflict/root files have no errors, one warning; agent-owned formatting checks also pass. Staged diff check passes. Graphify module remains unavailable.

The tests use isolated databases/local fixtures and controlled external providers; no real PR publication, Git push, user chat or user browser state is changed. The native browser uses local fixture pages. Existing user app instances/global trust remain untouched.

## Local dependency delta

The user's only pre-merge edit was bun.lock's desktop version0.23.3→0.23.4. Main already contains that exact version correction along with its new dependency pins; the correction is preserved by the merge rather than reverting the new lockfile. The original delta is backed up before applying the merge. No push/release is part of this work.
