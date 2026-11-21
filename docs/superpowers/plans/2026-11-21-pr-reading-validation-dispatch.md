# PR reading path — merged validation round

User authorized merging every implementation lane into `investigate/explainable-pr-review-flow`, then dispatching independent intensive feature tests and code review.

Production-code checkpoint under test: **`0e79fa3d`**. All initial A/B/C/D implementations are integrated, plus C complete-manifest/thread-certainty fixes and B restart/cancellation/Ask-context fixes. Parent added runtime startup, exact identity/launch attachment, Mine ID matching, Ask pending/error/cancel UI, pinned context props, unknown-resolution UI, provider draft scoping and revision-scoped UI fences.

The merged desktop production build passes (`/tmp/pr-review-final-merge-build.log`). Parent focused core batch passes30 tests; connection/UI/controller checks pass. These are preflight results, not final acceptance of this round. Existing global TypeScript baseline errors and missing graphify remain documented.

## Active independent validation worktrees

| Branch | Workspace ID | Scope |
|---|---|---|
| `test/pr-reading-lifecycle` | `-rWExZY1yo1lYGJW5cGp6` | Integrated lifecycle/E2E, cancellation/restart/auto-map and production boundaries |
| `test/pr-reading-ui` | `JTume25WlMcRtnfPgS-UD` | Renderer/native interaction, Monaco, keyboard/overlays, visual and full UI wiring |
| `review/pr-reading-security` | `ormcbwK8TA24w61_rXv2D` | Adversarial backend/MCP/auth/path/launch/security review with isolated repros |
| `review/pr-reading-correctness` | `K-vmdJSwAk4SF2DzVdUeY` | Independent full-stack correctness/spec/regression review |

All four are new Codex sessions dispatched through correctly bound SuperiorSwarm MCP under parent workspace `ydRE04dJT4oBzEE6OBd_q`. They forked from 0e79fa3d and must validate the integrated code, not old per-lane branches. They can commit tests/evidence only; parent coordinates production fixes. Findings need priority, source location, reproducible trigger, assertion/evidence and impact. Final reports require pass/fail/unverified matrices, exact regression commits and residual limits. No pushes/main merges or external PR mutations. Live CLI checks, if possible, require disposable data and per-process configuration; existing user sessions and global MCP setup remain untouched.

Prompts/results/IDs are in `/tmp/pr-review-validation-*.json*`. MCP binding caveat and client are documented in the prior follow-up dispatch record; direct exposed status tools are bound to sibling activity-queue, so parent mutations/inbox use `/tmp/pr-review-mcp.mjs`. Read project events with epoch+cursor and filter these children; reconcile inbox/current workspace state after any reset before merging tests/fixes.

Next: gather independent findings, address confirmed defects, integrate useful regression tests, rerun focused gates, and obtain follow-up verification against corrected code before calling the feature ready. No remote push/release is authorized.
