# Reading-path persistence lane handoff

Lane A, based on shared frontend checkpoint `163c7059`. Contract commits: `963c0b56`, then `3e71b80e`. The implementation commit follows those commits; no sibling implementation is required to build or test this lane.

## Integration

- `src/main/trpc/routers/index.ts` registers `reviewPath`; existing `reviewExplanation` registration is preserved.
- Lane B must call its `initializeReviewPathRuntime()` once during main-process bootstrap. It configures the injected port through `review-path/service.ts`. Until configured, launch/Ask fail explicitly as unavailable; persistence reads/settings still work. Parent owns final cross-lane integration. There is no second launcher here.
- Runtime uses `getReviewPathStorage()` and `getReviewPathApplication()` from `service.ts`. Storage exposes `getRun(id): Run | undefined`, `getActiveRuns()`, `finish`, `fail`, `cancel`, `attachTerminal`, and `attachReviewDraft`.
- Start and Ask validate the registered review workspace/provider/PR and re-read provider metadata. Same-head polling reads local persisted state; a changed-head read verifies the provider before changing stored head, so an older renderer cannot roll it back.
- Cancellation/supersession fences storage **before** awaiting runtime cleanup. Runtime must be able to stop an owned already-cancelled/superseded run. Stop failure is surfaced by the cancel mutation, while delayed writes remain rejected.
- On whole-app restart, Lane B should fail persisted running scopes as interrupted without sending prompts, even if a dedicated PTY survived. Capabilities are durably hashed, but the global control token rotates and consumed task tokens cannot bootstrap a replacement MCP process. Manual Retry gets a new scope; automatic polling does not retry a claimed head.

## Renderer routes

`identity` is `{ workspaceId, provider: "github" | "bitbucket", owner, repo, prNumber, headSha }`; SHA must be a complete 40/64-character lowercase hex object ID. Storage keys include provider and workspace, excluding head so the older path can be returned visibly stale. Every write includes the exact head/run/version.

| Route | Input | Result |
| --- | --- | --- |
| `reviewPath.get` | `{identity}` | `ReviewPathSnapshot` |
| `reviewPath.start` | `{identity, agent:{id,label}, alsoReview, auto?}` | `{run, launch?, snapshot}` |
| `reviewPath.cancel` / `cancelQuestion` | `{identity,id,version}` | snapshot |
| `reviewPath.ask` | `{identity,id,text,anchor?}` | `{run,question,launch?,snapshot}` |
| `reviewPath.addContext` | `{identity,entryId,step}` with context `addedBy:"user"` | snapshot |
| `reviewPath.removeContext` | `{identity,stepId}` | snapshot |
| `reviewPath.getSettings` | none | shared `ReviewPathSettings` |
| `reviewPath.updateSettings` / `importLegacySettings` | shared settings object | settings |

`importLegacySettings` writes only if no explicit/imported settings exist. Auto claims persist per exact provider/workspace/PR/head even when failed/cancelled; manual start can retry. Ask IDs are caller-generated idempotency keys. Each question has an independent run, supporting out-of-order answers.

Snapshots include unchanged `ReviewPath` / `AskMessage` objects plus pathVersion, current conversationId, runs, and correlated questions. History is retained across remaps. Display current messages by filtering questions to `snapshot.conversationId`; older history must be labelled with its run identity/revision. Do not display the unfiltered historical `messages` array as current-head answers.

## MCP/control plane

Runtime registers task mode `review-path` with `workspaceId` and mode context `reviewPathRunId`, `reviewPathRunVersion` (string). Consuming this registered launch token at `/context.resolve` validates the stored run/workspace and issues a run capability. `POST /review-path.tool` requires the normal control bearer plus `X-Review-Path-Capability`; arbitrary agent workspace/provider selectors are rejected. MCP has no raw DB write path for this mode.

Every tool accepts `run_id` and integer `run_version`:

- `get_review_path`
- `set_review_path`: `entries`, `otherFiles`, optional `reviewed`
- `add_path_step` / `add_context_step`: `entry_id`, `entry_title`, `step`
- `set_thread_note`: `thread_id`, `note`
- `answer_question`: `question_id`, `text`, optional `refs`; atomically completes its question run
- `finish_review_path`; closes mapping and rejects subsequent writes
- `fail_review_path`: `error`
- `add_review_finding`: `file_path`, optional `line_number`, `side`, `category`, and `body`
- `set_review_summary`: `summary`

Findings require an existing local `in_progress` draft bound with `attachReviewDraft(run,draftId)` before launch. The draft must match provider/PR/head and have exclusive run ownership. Attachment updates the workspace's draft pointer. Identical findings deduplicate by content within the run. Category is preserved as a Markdown prefix because the existing draft table has no category column. Finding files must be changed files. These tools never publish comments or reviews. Finish/fail/cancel/supersede update the owned in-progress draft status.

## Persistence and source routing

- `review-path/storage.ts`: SQLite document transactions, full-scope run fencing, independent questions, local draft bridge, settings, auto claims, capability hashes.
- `review-path/validation.ts`: strict schemas, safe relative paths, positive ordered ranges, unique entry/step/file coverage and exact changed/unchanged classification. Full replacement rejects missing coverage; incremental placement removes covered files from Other files.
- `review-path/application.ts`: provider verification and injected runtime delegation. `service.ts` binds registered workspaces/provider APIs and production DB.
- `review-path/control.ts`: task authorization and strict tool dispatch. `mcp-standalone/review-path.mjs` registers the actual tools from `server.mjs`.
- Migration `0065_add_review_path_persistence.sql`, journal entry and generated snapshot create `review_path_documents` (workspace FK cascade) and `review_path_preferences`. SQLite transactions atomically replace one scoped document. All new migration ownership remained in A.
- `TaskRegistry` launch-token consumption authorizes the capability; possession of the shared control bearer or a workspace header alone does not authorize a reading-path write.
- User-added context survives streamed path replacement and remapping; agents cannot impersonate or overwrite it. Context that becomes a changed file is omitted as context on remap.

Parent should use the above routing entries for final CLAUDE.md maintenance; this lane intentionally did not modify CLAUDE.md.

## Validation

- Meaningful RED tests preceded persistence/control implementation, user-context preservation and local findings.
- 47 tests across eight focused files pass; the neighboring `control-plane.test.ts` adds 27 passing tests: **74 total, zero failures**.
- Includes actual HTTP capability bootstrap/MCP handler transport, real tRPC factory, full isolated migration startup run twice, disk close/reopen durability, wrong provider/workspace/PR/head/run/question rejection, cancelled/completed/superseded runs, concurrent questions, malformed/missing/duplicate coverage and settings/auto-claim persistence.
- `bun run build` passes. Scoped Biome and `git diff --check` pass.
- TypeScript diagnostics unchanged after path/line normalization: main **66 → 66**, renderer **86 → 86**, tests **208 → 208**. Main baseline captured in this worktree; renderer/tests compared to parent's final checkpoint logs. Global type-check is not clean.
- Logs: `/tmp/pr-reading-persistence-validation/`. Tests involving Electron imports require `bun test --preload ./apps/desktop/tests/preload-electron-mock.ts ...` from repo root. All DB/RPC/provider/runtime tests use isolated doubles. No real provider writes or active review-terminal prompts were sent.
- Graphify hook ran normally and reported `No module named 'graphify'`; no hook bypass or graph edits.

## Limits

Runtime bootstrap and renderer glue require B/parent integration. Provider metadata and revision-pinned content remain owned by C/D. Stored history currently has no pruning policy and each document is read/written as JSON; large histories may merit indexed rows later. Full process reconnect is deliberately not claimed. Current-head detection follows supplied metadata changes plus provider verification on start/Ask; polling does not repeatedly query the provider when the supplied head is unchanged.

Provider integration dependency discovered during final source review: baseline GitHub `getPRDetails` caps `files(first:100)` and baseline Bitbucket `getPRFiles` returns accumulated partial files on a failed page. Lane C has been asked to paginate/verify completeness and throw on partial reads, or supply explicit completeness metadata. Parent must integrate that fix before treating large-PR coverage as complete; A does not modify provider-owned files.
