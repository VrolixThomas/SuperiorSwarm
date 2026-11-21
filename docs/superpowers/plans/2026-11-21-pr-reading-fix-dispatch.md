# PR reading path — findings remediation dispatch

User explicitly authorized dispatching agents to fix the independent validation findings.

Common fix baseline: **`f298e114`** on `investigate/explainable-pr-review-flow`. This adds all V1/V2/V3/V4 independent tests, native fixtures and reports to production-code baseline `0e79fa3d`. The new regression tests are intentionally RED; only assertions/evidence were integrated before dispatch. No assertion has been weakened and no production fix is claimed yet.

Parent SuperiorSwarm workspace: `ydRE04dJT4oBzEE6OBd_q`. Four fresh app-managed worktrees, all dispatched with `cli_preset: codex`:

| Lane | Branch | Workspace ID |
|---|---|---|
| F1 State and authority | `fix/pr-reading-state-authority` | `NYLp6jisOwV0gjYq-iehY` |
| F2 Execution and publishing | `fix/pr-reading-execution-publishing` | `vSSgCBnJL2FjyeUuQuIXT` |
| F3 Review wiring | `fix/pr-reading-review-wiring` | `RTEz0u2Ptm96Mj-2fbPr2` |
| F4 Editor and Ask | `fix/pr-reading-editor-ask` | `PxsuUz3OnRF5m-DVp-x2Z` |

## Deduplicated findings and ownership

| Finding | Priority | Owner | Required outcome |
|---|---|---|---|
| F01 Invalid/replayed task token falls back to workspace authority | P1 | F1 | Fail closed without role escalation; valid/tokenless normal modes remain defined |
| F02 Late provider response rolls back newer durable head/run | P1 | F1 | Cross-instance scoped acceptance fence for get/start/ask, including mismatch paths |
| F03 Fresh-ID replacement erases user-owned context at same path | P2 | F1 | Preserve complete user ownership/record or reject atomically |
| F04 Runtime Git check executes promisor helpers or blocks main | P1 | F2 | Hardened bounded asynchronous local-only Git validation |
| F05 Old Bitbucket refresh overwrites replacement account tokens | P1 | F2 | Atomic originating credential/account generation checks |
| F06 Old findings displayed/submitted against a newer head | P1 | F2 backend + F3 renderer | Provenance preserved and enforced through rendering and publication; F4 supplies exact comment revision |
| F07 Repeated mapping selects previous ready draft | P1 | F3 | Authoritative bound draft/chain and exact revision, progressive findings and correct Submit |
| F08 Ask terminal unreachable / automatic-map terminal not restored | P2 | F3 | Reachable owned terminal and safe descriptor hydration, no relaunch/prompt |
| F09 Changes deep link leaves overview visible | P2 | F3 | Navigation exposes selected diff/thread |
| F10 Non-current queue rows lack workspace identity/status | P2 | F3 | Scoped read-only status discovery; no guessed identities or mutating workspace creation |
| F11 LEFT selections Ask/comment on RIGHT instead | P1 | F4 | Side-correct real Monaco selection, keyboard anchors and composer |
| F12 Context return triggers BUSY and permanent unavailable diff | P1 | F4 | Bounded concurrency/retry coordination; transient vs missing distinction |
| F13 Pre-persistence Ask rejection loses question and error | P2 | F4 | Input/retry retained until acknowledgement and mutation errors survive unrelated polls |
| F14 Concurrent successful mutation loses terminal descriptor | P2 | F4 | Separate snapshot freshness from exactly-once scoped result delivery |

## Source boundaries and coordination

F1 owns application/storage/control-plane task scope and state validation. F2 owns runtime Git check, Atlassian auth and backend publisher/add-comment provenance. F3 owns authoritative draft selection/stale projection, shared thread provenance types, workspace/top bar/terminal recovery, deep links and queue status. F4 owns live source controller/Ask, side-aware selection/comment hooks, content lifecycle and snapshot concurrency.

F2/F3/F4 must agree the revision provenance contract early. F3 requests snapshot/draft/terminal binding exports from F4 rather than independently editing `review-path-source.ts`; F2 requests comment revision input from F4 rather than independently editing `useStepComments.ts`. F1 retains storage mutation ownership; F3 may own separate read-only queue projection/API with a coordinated storage read seam. No unannounced same-file edits across lanes.

All supplied independent assertions remain intact. Each agent reproduces assigned failures first, adds targeted tests, implements root-cause fixes, and commits locally. Mixed native/shared suites may remain red on another lane; reports must identify individual checks rather than claim whole-suite success. Parent will integrate scoped fixes into this branch, then resume original validation agents against the corrected merged head. No main merge, push or release is authorized.

Testing uses disposable profiles, Git repositories, databases, credentials and dedicated test processes. No live app DB writes, real provider review/comment mutations, existing-user-session prompts or unrelated-agent cancellation. No global MCP/config/package/native-dependency changes. Baseline TS diagnostics and missing graphify remain explicit; hooks run normally.

Prompts and dispatch evidence: `/tmp/pr-review-fix-prompts.py`, `/tmp/pr-review-fix-dispatch-*.json`, `/tmp/pr-review-fix-started-*.jsonl`, `/tmp/pr-review-fix-assignments.json`. Parent mutations/inbox continue through verified `/tmp/pr-review-mcp.mjs` because the conversation's default MCP connection is bound to sibling activity-queue. Project events can be polled with saved stream epoch/cursor and filtered by these workspace IDs.
