# Final integrated provider retest — 709687f8

Codex, no additional agents. Final staging `709687f8dd3f17815d3ffc3c31b004c3c509417e` was merged into the clean isolated Lane B branch as `beacdbd506cffb91dc984b6aaeb8fdee2fb51bbd`. Equivalent cherry-pick conflicts were resolved in favor of staging. The production source and standalone MCP code have **zero differences from staging**. Only test-harness output-directory controls and an option to skip the previously completed approved-permission probe were added.

**Result: no actionable failure in this scoped final-source retest.**

| Layer | Final result | What it proves |
| --- | --- | --- |
| Focused unit / isolated SQLite | 156 passed, 0 failed; 2333 assertions across 14 files | Hook bridge/listener, bounded evidence, transition identity, failure/permission preservation, exact receipts, source/session persistence, ownership/matrix/workspace behavior and migrations |
| Actual MCP stdio subprocess / production HTTP | 1 passed, 0 failed; 44 assertions | Pinned conversation ownership, unpinned answer retrieval returning no messages, interrupted handoff leaving the receipt pending, successful parsed MCP retrieval acknowledging the answer, and stale-generation mutations being rejected |
| Authenticated Claude | Passed, including same-session follow-up | Current isolated bridge preserves actual question/reply text; narrowly preallowed isolated `set_status` executes and records the bound report; direct follow-up retires the old report |
| Authenticated Codex | Passed, including same-session follow-up | Actual PermissionRequest followed by Stop remains **outcome unconfirmed**; the blocked MCP call has no status HTTP write and is not labeled executed |
| Native GUI stand-ins | Not rerun in this scoped retest | Prior native results are retained in the earlier report, not represented as proof for final staging |

The live harness passed 21 assertions in 22.6 seconds. It ran two synthetic initial conversations and exact-session follow-ups with bounded subprocess deadlines, isolated DB/control endpoints and test directories. Codex used its existing reviewed global hook bridge/trust. No global hook, trust, approval or app configuration was changed. No broad permission approval was granted.

## Comparison and limitations

`comparison.json` confirms ordinary Claude/Codex outcomes match the earlier Lane B run: both exit successfully, both exact-session follow-ups return `COLOR_BLUE_DONE`, Claude's actual MCP report is delivered, and Codex's attempted MCP report remains permission-blocked and unexecuted. Final Codex projection retains `permission.outcome: "unconfirmed"` and the text “Permission outcome not confirmed; review the conversation”.

The earlier run included a third, narrowly approved Claude request that established the provider metadata limitation. **That probe was intentionally not repeated.** Automatic positive-permission cleanup without a correlatable request/outcome ID remains limited; neither old nor new results claim that it works. Matched explicit outcomes are covered by the deterministic transition tests.

New Codex bridge evidence transport under real provider trust and full authenticated production dispatch-to-GUI remain unverified. The real MCP subprocess suite is not a model-provider or full native GUI test. Desktop build/native GUI and whole-project TypeScript were not rerun for this scoped retest; the independent investigator is checking the wider integrated scope. Changed harnesses pass Biome, and `git diff --check` passes.

## Evidence and reproduction

- `focused.log`, `mcp.log`, `live.log`: complete bounded test results.
- `live-results.json`, provider diagnostics and `claude-hook-fields.jsonl`: synthetic provider text and selected identity/provenance/outcome metadata.
- `mcp-processes.json`: selected actual subprocess outcomes.
- `manifest.json`: exact source commits, counts and coverage boundaries.
- `comparison.json`: prior versus final ordinary provider outcomes.

From `apps/desktop` with compatible dependencies available:

```sh
bun test tests/agent-hooks tests/agent-event-transition.test.ts tests/agent-evidence-persistence.test.ts tests/activity-queue-agent-source.test.ts tests/activity-queue-ownership.test.ts tests/queue-investigation-matrix.test.ts tests/activity-queue-workspace.test.ts tests/queue-ownership-migration.test.ts
SS_QUEUE_MCP_EVIDENCE_DIR=/absolute/path/to/new-evidence bun test tests/queue-investigation-mcp.test.ts
SS_QUEUE_LIVE=1 SS_QUEUE_LIVE_SKIP_APPROVED=1 SS_QUEUE_LIVE_EVIDENCE_DIR=/absolute/path/to/new-evidence bun test tests/queue-investigation-live.test.ts
```

All earlier investigation and verification artifacts are preserved. Dependencies were temporarily linked without lockfile changes and removed afterward. No shared installed/development DB policy, running app, production policy, global configuration, push or release was changed. The only merge was the explicitly requested staging merge into this isolated branch. The normal commit hook reported the known missing graphify module; it was not installed or bypassed.
