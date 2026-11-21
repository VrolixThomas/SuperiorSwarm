# Queue remediation and independent retest

User authorized fixing the independent investigation findings, following up with agents, then having agents test the patched feature again. Integrate locally on activity-queue; no push/release. Preserve unrelated bun.lock and leave installed/dev shared-state policy unchanged.

Investigation tests/report merged first from investigation/queue-e2e-followups-2026-11-21. Baseline verdict was FAIL; characterization GAP tests must become acceptance assertions for fixed behavior, not simply keep passing because a defect is expected.

## Codex lanes

- A: fix/queue-entity-ownership, workspace hBDQSa6WStv4YJ6zrLR3Y. Schema, explicit coordinator/workspace ownership, durable reports/questions, exact targets, safe correlated reply service, legacy ownership, backend projection/group semantics. Owns shared activity-queue contract and entity/reconcile code.
- B: fix/queue-provider-evidence, workspace NTbnEmMOrGHNwP8emn3FL. Provider bridge/listener/event evidence, permission lifecycle, missing-identity replay semantics; publishes helper contract for A and C.
- C: fix/queue-conversation-actions, workspace hGaR_BE_gPr2Q-ah7fXM2. Exact-conversation navigation, context/related-item presentation, correlated question UI and native rendered checks. Consumes A/B contracts.
- Independent retest: existing investigator dmb94y1WzMSK71TdeY6CU, branch investigation/queue-e2e-followups-2026-11-21; resume against integrated commit after patches.

## Gates

1. Early additive contracts coordinated by MCP messages; each lane tests and commits its scope.
2. Parent reviews commits, integrates in dependency order, resolves conflicts without losing identity or lifecycle invariants.
3. Run focused tests, native Electron tests and build; compare known type baseline.
4. Resume implementation lanes for integrated-scope tests and independent investigator for complete matrix: Claude/Codex × repo/folder/repo-orchestrator/cross-repo-orchestrator × manual/dispatched, including direct reply, queue navigation, missing/replayed hooks, cleanup, questions, permissions, restart/reconnect, and task context.
5. Follow up every actionable failure with owning lane; retest changed paths. Do not equate provider-shaped stand-ins or passing GAP characterizations with live end-to-end proof. Record remaining unverified cells and exact blockers honestly.

No arbitrary PTY injection, replacement shell on navigation, broad trust/permission bypass, or acknowledgement of unrelated sibling work. Provider probes use isolated benign tasks and sanitized evidence.

## Final integration and retest

All three Codex implementation lanes completed and retested their integrated scope. The original independent investigator repeated the positive acceptance matrix and found additional inbox starvation, dynamic coordinator scope, coordinator dispatch/resume and actual cold Codex MCP binding/catalog issues. Each was routed back to its owner, fixed and rechecked.

The final functional implementation was tested as `7e244cbf` (later commits are evidence, comments and test-harness changes). The independent actual-provider native matrix passed all 16 combinations: Claude/Codex × repo-worktree/folder/repo-orchestrator/cross-repo-coordinator × manual/dispatched. It uses real authenticated CLI print/exec processes, real isolated PTYs, native SQLite, production IPC and QueueView, with a disclosed readline/input adapter; it does not claim provider TUI/shipped-app bootstrap coverage. Each case checks exact first MCP action, real sibling isolation, follow-up, fresh completion, attach-only navigation and reporter-close cleanup. Full matrix duration: 248.28 seconds.

The cold Codex regression was reproduced with a successful but unbound first MCP write. Initial blocking admission then exposed optional tool-catalog timing; the final asynchronous first-generation lease admits the exact original conversation without delaying initialization. The default optional-MCP path passed independently twice, without requiring a global configuration change or unsafe rebinding.

Detailed independent final report: `.hermes/investigations/2026-11-21-queue-e2e-postpatch.md`. Implementation-lane and final integrated evidence are retained separately under `.hermes/verification/`. Before-patch FAIL evidence remains intact. Parent-controlled guard suites and type comparisons were also run; known type baseline remains, not a globally clean typecheck claim.

Explicit limits remain: provider permission outcomes without correlatable metadata are shown as unconfirmed; saved inbox replies are not claimed consumed/executed; old unidentifiable reports stay conservative; installed/dev shared-state collision remains excluded by user. True whole-app restart, actual provider TUI and process hibernation remain separately qualified in the report.

Finish by merging validated staging into `activity-queue`, preserving the user's unrelated `bun.lock`, without push/release. Temporary dependency links in the integration worktree are removed after verification.
