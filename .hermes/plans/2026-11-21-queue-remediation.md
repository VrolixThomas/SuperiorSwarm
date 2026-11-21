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
