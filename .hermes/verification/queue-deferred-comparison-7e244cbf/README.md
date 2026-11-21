# One deferred-only native comparison — 7e244cbf

**PASS with optional MCP (`SS_QUEUE_REQUIRE_MCP=0`).** The one requested `codex-folder-manual` case completed in 23.30 seconds (test body 23142.75 ms). The GUI slot was released immediately after observing completion; no second native case or repeat probe was run.

Requested source `7e244cbfbbb0824f754d0b795b508138100f6784` was merged into this clean isolated branch as `02a198db211d7bf47fdf283df936f5e376718c91`. Production source and standalone MCP match that exact candidate. The staging branch advanced to `f9921a2d74d68adb3528f37c1d34e3a49d0afb81` during coordination; that moving ref is recorded by the fixture but was **not** the code under test. No production code was changed.

The staged fixture still hardcoded its evidence path. A test-only `SS_QUEUE_EVIDENCE_DIR` override was added so this run could preserve all existing artifacts. Desktop build passed from `apps/desktop` before the native run.

## Exact observation

| Observation | Recorded initial-wait failure | Deferred-only candidate |
| --- | --- | --- |
| Context resolution | 1620 ms recorded HTTP latency; reporter already bound | Reporter null; deferred admission offered |
| Context response → catalog sent | 8 ms | 10 ms |
| Catalog vs SessionStart receipt | Exact relative timestamp absent from preserved baseline | Catalog sent **1486 ms before** SessionStart |
| Catalog vs UserPromptSubmit receipt | Not available in preserved baseline | Catalog sent **1552 ms before** prompt receipt |
| First model MCP action | None; `TOOL_UNAVAILABLE` | `set_status` completed |
| Reporter identity | No first action to bind | Exact CLI session `01a1ff49-d7fa-7f90-9e95-8ad11fdfe632` |
| QueueView / direct follow-up | First-turn assertion failed | Exact terminal selected; `COLOR_BLUE_DONE` returned in the same conversation; real sibling preserved |

Candidate timestamps in Unix milliseconds: context response `1795284392105`, catalog sent `1795284392115`, SessionStart receipt `1795284393601`, prompt receipt `1795284393667`, PreToolUse `1795284399087`, PostToolUse `1795284399159`. The 72 ms tool lifecycle interval brackets the action; it is not an exact HTTP execution-duration measurement. The independent fixture asserts that the first actual MCP status action's persisted reporter equals the CLI session before checking the QueueView flow.

The initial-wait failure's synthetic startup/driver/log files are copied unchanged under `baseline-initial-wait/`, with original paths and SHA-256 hashes in `comparison.json`. Candidate artifacts include the native results, startup timing, screenshot, build log and test log.

## Scope and command

This was actual CLI → MCP → isolated native SQLite/QueueView → real PTY follow-up, using the production launcher. The fixture uses the actual Codex print/exec CLI with a readline adapter, not the provider's interactive TUI. It reuses existing reviewed global hooks/trust and narrowly authorizes only the synthetic isolated status action. No global settings/trust, broad approvals, shared DB policy or running app changes occurred. No subagents, push, release, or merge into the parent. One successful observation does not establish general race-free reliability.

From `apps/desktop`, after `bun run build`:

```sh
SS_QUEUE_NATIVE_LIVE=1 SS_QUEUE_NATIVE_CASES=codex-folder-manual SS_QUEUE_REQUIRE_MCP=0 SS_QUEUE_EVIDENCE_DIR=/absolute/path/to/new-evidence bun test tests/queue-postpatch-native-live.test.ts
```

Temporary dependency links were removed afterward. Biome and diff checks passed for the test-only change. The normal commit hook reported the known missing graphify module; it was not installed or bypassed.
