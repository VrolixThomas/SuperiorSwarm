# Coordinator terminal resolution verification

Base: `2cda5a38` (`v0.23.2`). Implementation and review used repository source,
generated temporary directories, and isolated migrated SQLite fixtures. No
installed bundle or real coordinator database was consulted. No migration,
record recreation, folder move, or service restart is required.

## Vertical TDD record

Each RED below was run before its production change. Commands ran from
`apps/desktop`. Dependency-loading failures were resolved before recording RED.

| Slice | RED | GREEN |
| --- | --- | --- |
| Real resolver and `terminal:create`: ordinary roots, coordinator roots, canonical aliases, absent records, unsupported kinds, invalid/deleted/non-directory roots, restored attach, schema defaults | `bun test tests/terminal-workspace.test.ts`: 2 pass, 15 fail | 17 pass |
| Restart restoration: coordinator sessions/layouts, stale coordinator tabs, unsupported records | same command: 17 pass, 3 fail | 20 pass |
| IPC identity/root binding, structured failures, renderer cwd, rollback, daemon inventory, untrusted frame | same command: 20 pass, 12 fail | 32 pass |
| Renderer workspace errors, explicit retry, transport-only reconnection, redacted unknown errors | `bun test tests/terminal-file-terminal.test.tsx`: 18 pass, 6 fail | 24 pass |
| Review: cross-window owner replacement, renderer save rebinding, stale lease after failed registration | workspace suite: 32 pass, 3 fail | 35 pass |
| Review: folder deletion during file ownership validation | workspace suite: 36 pass, 1 fail | 37 pass |
| Review: older cancelled restore must not revoke a newer mount | workspace suite: 37 pass, 1 fail | 38 pass |

Refactoring after GREEN removed duplicate canonicalization at terminal resolver
callers, centralized safe error messages and canonical owner metadata checks,
and made ownership rollback specific to its registration. Biome applied the
repository format. The final preload test also exercises IPC structured cloning
and contextBridge's message-only Error boundary.

## Caller and authorization review

- `agent-launch/workspace-cwd-lookup.ts` checks ordinary workspaces first. An
  invalid ordinary row never falls through to a coordinator. Coordinator lookup
  is by exact ID, accepts only `kind = workspace`, and uses stored `workDir`.
- Schema `kind` and `workDir` are NOT NULL; legacy inserts receive the existing
  `workspace` default. Unknown/empty kinds fail closed. No schema change.
- `terminal/ipc.ts` authorizes the frame before persistence, derives the cwd
  from the record, checks persisted and daemon roots before restored attach,
  and rechecks record/root/inode after the asynchronous daemon inventory query.
  New and restored sessions share that path. Failed attempts revoke only their
  own registration; successful detach invalidates file ownership.
- `trpc/routers/terminal-files.ts` re-resolves the same workspace/coordinator ID
  before using its registered root. Equal paths and similar IDs do not provide
  a fallback for deleted records.
- `trpc/routers/agent-launch.ts` and `git/workspace-file-root.ts` already call the
  shared resolver and retain their existing caller/root checks.
- `trpc/routers/terminal-sessions.ts` no longer discards coordinators during
  restoration. Stale `xro-` tabs remain visible for diagnosis; the prefix is
  used only for UI retention and never authorizes a directory or an attach.
- `db/session-persistence.ts` lets renderer saves rename/reorder existing
  terminals, while preserving their original identity and launch root.
- The IPC error envelope carries stable codes and safe messages. Preload
  preserves the code in Error.message through contextBridge. Renderer copy
  never prints raw filesystem errors. Only transport failures promise and
  trigger automatic reconnection retries; other failures offer Retry terminal.

## Quality gates

- Focused resolver/create/attach/restore suite: 38 pass; workspace precedence:
  3 pass; terminal file-owner suite: 16 pass; actual preload/file IPC: 12 pass;
  mounted terminal component: 24 pass; session persistence: 6 pass.
- Daemon directory: 134 pass across 10 files. Legacy file input: 7 pass.
- Passing adjacent suites: terminal file authorization, controller, drafts,
  delivery, paths, transport, wire integration, terminal input routing and
  transport, exit messages, navigation persistence, worktree session removal,
  agent launch scripts and session stores, file-browser paths/repository IPC,
  cross-repo membership/CRUD/worktree membership, event sink, orchestrator
  creation/membership/auto-dispatch.
- Three neighboring orchestrator suites require `setEventsDir()` startup
  initialization. Their bare-command failures reproduced identically in an
  untouched temporary `git archive HEAD` snapshot. With a temporary preload
  that initializes a generated event directory, all three pass (16 + 8 + 11).
  Production event-sink code was not changed.
- Dependencies were installed with `bun install --frozen-lockfile
  --ignore-scripts`. The package's PTY `spawn-helper` executable permission was
  applied only to private copies inside this worktree's dependencies, as the
  existing desktop postinstall specifies. Native daemon/legacy tests then pass.
- Main, preload, renderer, and test TypeScript configurations were checked.
  No diagnostics affect changed paths. Preload passes outright; existing
  main/renderer/test diagnostics match the untouched baseline after normalizing
  temporary checkout and dependency paths.
- Production desktop `bun run build`, Biome on all changed TypeScript files,
  and `git diff --check` pass.

Raw execution logs for this session are in `/tmp/coordinator-*.log`. No push,
PR, merge, deployment, release, real database edit, credential access, or app/
daemon restart was performed.
