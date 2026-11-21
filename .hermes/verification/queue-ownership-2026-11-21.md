# Queue entity and question ownership — Lane A

Codex, sole agent in isolated `fix/queue-entity-ownership`. No subagents, push, merge, release, shared DB policy change, running app shutdown, global provider trust change, or `bun.lock` edit.

## Delivered contracts and behavior

- Shared contracts: `52fbe6cb`, `b328b6f0`. Implementation: `9aa52a89`, `d416ad8c`, `5315d2a5`, `30e8d91a`, `6d7f96b6`, `c5c4f891`. B helper commits through `62d60436` and native fixture `2984ae83` were cherry-picked; C's documentation-only `f355af71` was cherry-picked. Parent receives original commit IDs to avoid duplicate picks.
- Explicit workspace/coordinator entity metadata, project kind/path, orchestrator role, coordinator's own directory and linked scopes. Coordinators remain real coordinator records, never surrogate workspaces. Status, request, and report text are durable.
- Reports and questions retain validated terminal/provider/conversation targets. Current views reject closed or replaced owners, even if a sibling shell remains. Legacy ownerless reports cannot be cleared by managed siblings. Generic typing, opening, and wake-only actions do not answer questions or clear reports.
- `workspaceAnswer` checks exact revision/question identity and current inventory, then saves a bounded reply for the exact conversation. Shared `isQuestionAnswer` applies the same project/recipient/time/entity/terminal/provider/conversation predicate to resolution, duplicate prevention, and display. Wrong or old answers cannot poison a question. Existing MCP correlated answers use the same recipient derivation, including coordinator askers.
- Current MCP pins identity at startup and rejects stale generations. HTTP inbox fetch alone is not a receipt: MCP acknowledges only after successfully parsing the fetched response. The queue does not claim model consumption or task execution. No PTY input or automatic wake is used. Direct trusted in-process readers are the native stand-in transport.
- A report and plain turn-end receipt group only for a proven identical conversation. Questions, permissions, failures, differing acknowledgments, and differing deferrals remain separate. Group actions carry all member revisions, recheck fresh receipts, and change them atomically. Errors, stale state, evidence and provenance survive grouping.
- B's validated transition drives queue and manager state. Unconfirmed permissions request outcome review, not another approval. Semantic failures remain failed after generic Stop. Uncertain callbacks preserve receipts; cleared work stays cleared. Explicit new generations leave tombstones even if the old registration never produced a callback.

## Schema rationale

`0067_queue_entity_ownership` removes the workspace-only session and message-recipient foreign keys, persists coordinator needs/status text/report time, and adds message reporter/recipient/retrieval metadata. It copies old data explicitly, with new message identity fields NULL. Project foreign keys remain.

`0068_explicit_agent_entity_kind` adds the session owner kind and enforces real workspace/coordinator existence with kind-specific triggers. Pre-0067 session foreign keys establish legacy workspace ownership, even for a historical ID collision; only unambiguous coordinator rows introduced after 0067 are backfilled. Deleting a same-ID coordinator cannot delete a workspace session. New colliding IDs are rejected, ambiguous runtime resolution fails closed, and neither migration changes terminal persistence policy or the installed/dev DB choice.

Migration regression applies the actual migrator to an isolated pre-0067 DB with sessions/messages and a historical collision. It proves preserved content/identity, foreign_keys=1, a clean foreign_key_check, correct kind-specific deletion, and rejection of unknown/colliding owners.

## Evidence and coverage

Artifacts: [verification directory](queue-ownership-2026-11-21/).

- **Unit/service + controlled provider shapes:** 101 passing tests, 2,178 assertions across nine focused files. Includes worktree, folder, repo orchestrator and coordinator; Claude/Codex shapes; manual and managed registration; exact sibling/generation boundaries; correlated answer negative cases; migration, grouped receipt races, and cleanup. All owned investigation matrix defects are acceptance assertions, not renamed characterizations. The final diagnostic-only MCP assertion was verified separately.
- **Adjacent services:** 101 passing tests, 217 assertions across workspace service, control plane, folder context, cross-repo/coordinator launch and session manager. The manager fixture now supplies identified lifecycle events; an explicit legacy completion test proves it cannot auto-sleep. A final grouped-member regression run passes 36 tests / 241 assertions, including rejection of a stale standalone action on a now-grouped member.
- **Actual MCP subprocess/HTTP transport:** current, installed, and missing-identity comparison passes with 52 assertions. Isolated Electron-as-Node MCP processes, isolated control endpoint/SQLite and synthetic messages; no model execution. Covers actual pinned reply fetch/receipt, unconfirmed handoff, legacy absence of ownership, stale-process rejection, and linked repo/folder coordinator status.
- **Native Electron stand-ins:** both native suites pass after desktop build from `apps/desktop` (real native SQLite, sockets, PTYs, preload/tRPC and Chromium). B's fixture was corrected to bind its reporting terminal instead of relying on unsafe ownerless clearing. These are not authenticated providers or proof of C's expanded coordinator UI; the parent integration retest covers that combination.
- **Live authenticated providers:** not run by Lane A. Lane B owns and reports those probes separately. No authenticated launch-to-GUI claim is made here.
- **Build/checks:** production desktop build passes. Biome passes with 16 test non-null assertion warnings. Main TypeScript has 61 diagnostics, exactly matching the clean baseline after source-position/path normalization, with no additions/removals. Full test-project TypeScript has 206 diagnostics; no global clean claim. Graphify remains unavailable; commit hooks reported the missing module without bypass or installation.

## Explicit limits / remaining integration verification

- A saved reply does not wake the agent. Retrieval confirms transport receipt, not reading comprehension, successful action, or an answer to a provider-native permission dialog.
- MCP started before an exact conversation is registered remains unbound; restart it after registration. Legacy MCP processes cannot gain pinned reply capability just because disk files changed. Their ownerless history stays conservative and unavailable for exact reply delivery.
- Previously observed, replaced conversation generations cannot reclaim a reused terminal through a replayed SessionStart. Explicit reuse of an old generation in that same terminal is conservatively rejected; this lane does not invent a safe resume proof or create a shell to work around it.
- Authenticated complete launch/GUI behavior and the latest combined A/B/C tree require the separately requested integration retest. The installed/dev shared-DB collision remains expressly excluded.

Temporary dependency links used the parent's existing compatible installations without changing lockfiles, and were removed after checks. Both real apps remained running.
