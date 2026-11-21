# Live PR review follow-up — dispatch record

Frontend checkpoint: `163c7059` on `investigate/explainable-pr-review-flow`.
Parent SuperiorSwarm workspace: `ydRE04dJT4oBzEE6OBd_q`.
All four child worktrees were created and dispatched using SuperiorSwarm MCP with `cli_preset: codex`, branching from this checkpoint.

| Lane | Branch | Workspace | Session |
|---|---|---|---|
| Durable path/conversation storage, validation, MCP/tRPC contracts | `feat/pr-reading-persistence` | `S8gtMIodzrOS5Q4COx_Mc` | `gL4JbuirFj_hIjeumeRXc` |
| Agent mapping/Ask execution, renderer adapters, auto-map | `feat/pr-reading-agent-runtime` | `3JdB_ea8I9Qc-K6G7MXPe` | `FUgvVHZTqLQybd4sTjAke` |
| Reviewer identity, outdated comments, exact provider revisions | `feat/pr-reading-provider-metadata` | `mT_HCiJHx8_PaZwDeidx9` | `Ehj7Jk9AJOe82wkjhAxiK` |
| Snapshot content wiring and end-to-end/native verification | `feat/pr-reading-integration` | `He_I3SmeMQCsydGuOPUnE` | `HGVKDtqOq-_GqTpyt7YDk` |

A owns all new schema/migrations, shared runtime types, AppRouter registration and MCP tool registration. B owns execution and frontend source/Ask/settings adapters. C owns provider metadata/auth identity. D owns snapshot service/content adapters and integration fixtures. Parent owns final ReviewWorkspace glue and cross-lane integration. Children must commit scoped work locally, report exact dependency SHAs, and coordinate rather than edit sibling files. Contract commit from A precedes dependent A/B/D wiring; independent investigations/tests proceed meanwhile.

Acceptance: live frontend never receives fixtures; provider/workspace/repo/PR/head/run/question identities stay fenced; cancelled/superseded callbacks cannot overwrite current state; mapping/Ask survive persistence/restart and expose errors; auto-map is idempotent and excludes authored/closed/unlinked PRs; Mine uses a proved login; outdated anchors stay off current lines; content uses pinned snapshots and distinguishes unavailable/empty/binary. Preserve existing submit/reply/resolve behavior and all frontend regressions.

Tests must use isolated DBs/providers/runners. Authenticated read-only metadata checks may be performed; real external comment/review/merge writes and unsolicited prompts into existing live terminals are not authorized. No pushes or main merges.

## MCP binding caveat

This conversation's directly exposed MCP connection was bound to sibling `activity-queue`. Its mistakenly changed status was restored immediately before any dispatch. Correctly bound MCP operations use `/tmp/pr-review-mcp.mjs`, which starts the installed SuperiorSwarm stdio launcher through the MCP SDK, supplies the validated PR-review workspace identity, and verifies `resolveContext` before any call. It preserves the app's normal dispatch approval path. No global MCP configuration or credentials were changed. The project event stream can be read through the existing MCP, but parent inbox/status/mutations must use the correctly bound client.

Dispatch prompts/results and assignment IDs: `/tmp/pr-review-dispatch-*.json`, `/tmp/pr-review-dispatched-*.jsonl`, `/tmp/pr-review-agent-assignments.json`. Latest coordination cursor is retained by the orchestrator; if resuming, reread inbox and reconcile workspace state before integration.

## Initial contract and parent integration notes

- A published shared contract `963c0b56`: runtime port startMapping/stopMapping/ask/cancelQuestion, fenced run scopes, independent question runs, durable settings. B coordinates optional full terminal launch descriptor.
- D's ContextFileView gains workspaceId/baseRef; parent must pass exact details.baseCommitOid/headCommitOid through ReviewReadingPane. D updates the StepDiff useStepContent caller itself.
- C exposes getCurrentReviewer and proved comment.authorId. Parent must wire GitHub login/ID and Bitbucket UUID-based Mine matching; never use display name as identity.
- All four agents reported working/kickoff. Parent explicitly approved these interfaces over MCP.
