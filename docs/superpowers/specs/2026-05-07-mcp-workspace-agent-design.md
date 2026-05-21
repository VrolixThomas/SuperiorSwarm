# MCP Workspace Agent — Design

**Date:** 2026-05-07
**Status:** Draft, pending implementation plan

## Problem

A user's coding agent (Claude Code, Codex, Gemini, OpenCode) running inside an
app-created worktree has no awareness of SuperiorSwarm. If the agent runs
`git worktree add` to spin up a follow-up worktree, the worktree is invisible
to the app: no `worktrees` row, no `workspaces` row, no shared-files symlinks,
no PR auto-detect. The agent cannot dispatch sub-agents into other workspaces
either — it can only operate where it was launched.

We want the agent to be a first-class participant: create worktrees that the
app knows about, list and inspect existing workspaces, and dispatch a child
agent into a workspace with a prompt.

## Goals

- Coding agent in an app-created worktree can create app-managed worktrees
  (registered, symlinked, PR-detected — same as the renderer flow).
- Agent can list/inspect workspaces in its project.
- Agent can dispatch a child agent (CLI preset of choice) into a workspace
  with a prompt, visible to the user as a regular terminal session.
- Agent can request workspace removal, with user confirmation.
- Single source of truth for workspace logic — no duplicated git/DB/symlink
  code between the tRPC router and the MCP server.

## Non-goals

- Headless / background agent dispatch. Terminal-only for now.
- Per-tool allow/deny settings UI. Confirm dialogs are the only safety layer.
- Remote (non-loopback) access to the control plane.
- Tools for "push branch" / "rename branch" / arbitrary git ops — agent uses
  the git CLI directly.
- Streaming or polling status of a dispatched session. Agent can
  `list_workspaces` to check.
- Adding workspace tools to existing review/solver/quick-action MCP modes.
  Each mode stays single-purpose.

## Architecture

```
                    ┌────────────────────────────────────────────────┐
                    │ Main process (Electron)                        │
                    │                                                │
   tRPC over IPC ──►│  ┌─ trpc/routers/workspaces.ts ──┐             │
   (renderer)       │  │   thin handlers                │            │
                    │  └────────┬───────────────────────┘            │
                    │           │ both call →                        │
                    │  ┌────────▼─────────────────────┐              │
                    │  │ services/workspace-service.ts │              │
                    │  │   createWorkspace(...)        │              │
                    │  │   dispatchAgent(...)          │              │
                    │  │   removeWorkspace(...)        │              │
                    │  │   listWorkspaces(projectId)   │              │
                    │  │   getWorkspace(id)            │              │
                    │  └────────▲─────────────────────┘              │
                    │           │                                    │
                    │  ┌────────┴──────────────────────┐             │
                    │  │ control-plane/server.ts        │             │
                    │  │   localhost:RANDOM, bearer tok │             │
                    │  │   POST /workspaces.create      │             │
                    │  │   POST /workspaces.dispatch    │             │
                    │  │   POST /workspaces.remove      │             │
                    │  │   GET  /workspaces.list        │             │
                    │  │   GET  /workspaces.get         │             │
                    │  └────────▲──────────────────────┘             │
                    └───────────┼──────────────────────────────────────┘
                                │ HTTP + bearer
                                │
              ┌─────────────────┴────────────────┐
              │  mcp-standalone/server.mjs       │
              │  WORKSPACE_AGENT mode            │
              │  env: PROJECT_ID, CONTROL_PORT,  │
              │       CONTROL_TOKEN              │
              │  thin client, no DB, no git      │
              └────────▲─────────────────────────┘
                       │ stdio (MCP)
                ┌──────┴──────────────────┐
                │ User's coding agent     │
                │ (Claude Code, Codex…)   │
                │ launched in worktree    │
                └─────────────────────────┘
```

### Components

- **`workspace-service.ts`** — pure async functions extracted from the
  existing tRPC handlers (`workspaces.create`, `.checkoutExisting`, `.remove`,
  `.listByProject`, `.getById`). Returns DTOs. Side-effects: git ops, DB
  writes, shared-file symlinks, PR poller lookups, terminal dispatch.
- **`control-plane/server.ts`** — Node `http` module (no framework).
  Binds `127.0.0.1:0` (random port). Bearer-token auth with constant-time
  compare. Body validation via zod schemas shared with `server.mjs`.
- **`control-plane/auth.ts`** — token gen (32-byte hex per app launch) and
  comparison helper.
- **`control-plane/confirm-bridge.ts`** — sends IPC request to renderer to
  show the confirm modal. Serialises requests (queue, max depth 3 — beyond
  that, auto-deny). 30s timeout = deny.
- **`renderer/components/ConfirmAgentActionModal.tsx`** — modal UI for
  confirm prompts.
- **`shared/control-plane.ts`** — zod schemas for request/response,
  consumed by `server.ts` and `server.mjs`.
- **`mcp-standalone/server.mjs`** — new `WORKSPACE_AGENT` mode gated by
  `PROJECT_ID + SUPERIORSWARM_CONTROL_PORT + SUPERIORSWARM_CONTROL_TOKEN`.
  No SQLite handle in this mode. Uses native `fetch`.

## Tools surface (MCP, WORKSPACE_AGENT mode)

```
create_worktree({
  branch: string,
  base_branch?: string,         // defaults to project.defaultBranch
}) → {
  workspace_id, worktree_id, path, branch, base_branch
}

list_workspaces({}) → {
  workspaces: [{
    id, name, type, branch, worktree_path,
    pr_provider, pr_identifier, draft_status
  }]
}

get_workspace({ workspace_id: string }) → {
  id, name, branch, worktree_path, base_branch,
  pr_provider, pr_identifier, has_uncommitted_changes
}

dispatch_agent({
  workspace_id: string,
  prompt: string,
  cli_preset?: "claude" | "codex" | "gemini" | "opencode",
  skip_permissions?: boolean,
}) → {
  session_id, terminal_id, status: "started"
}

remove_worktree({
  workspace_id: string,
  force?: boolean,              // override "uncommitted changes" guard
}) → {
  status: "removed" | "cancelled-by-user" | "blocked-uncommitted"
}
```

All tools are scoped to `PROJECT_ID` from env. `list_workspaces` returns only
that project's workspaces. `get_workspace` / `dispatch_agent` /
`remove_worktree` reject if `workspace_id` belongs to a different project (403).

`create_worktree` writes `.mcp.json` into the new worktree so a child agent
launched there inherits the same control plane (recursion-friendly).

## Trust, lifecycle, auth

### Token lifecycle

- `crypto.randomBytes(32).toString("hex")` generated once per app launch in
  `main/index.ts`. Held in module-scoped variable. Never persisted.
- Control-plane HTTP server binds `127.0.0.1:0` at app boot, captures the
  actual port.
- On every worktree create flow (renderer or MCP), `.mcp.json` is written
  into the new worktree:

  ```json
  {
    "mcpServers": {
      "superiorswarm": {
        "command": "<electron-execPath>",
        "args": ["<mcp-standalone-path>"],
        "env": {
          "ELECTRON_RUN_AS_NODE": "1",
          "WORKSPACE_AGENT": "1",
          "PROJECT_ID": "<id>",
          "SUPERIORSWARM_CONTROL_PORT": "<port>",
          "SUPERIORSWARM_CONTROL_TOKEN": "<token>"
        }
      }
    }
  }
  ```

- App restart rotates port + token. Mitigation: on boot, after the control
  plane is up, walk the `worktrees` table and rewrite each `.mcp.json` with
  fresh values. Cheap — N is small.

### Auth

- Every request requires `Authorization: Bearer <token>`. Constant-time
  compare. Reject with 401 otherwise.
- Reject any peer not on `127.0.0.1` (defence in depth — server already
  binds loopback only).
- Body validated with zod (schemas live in `shared/control-plane.ts`).

### Confirm dialogs (destructive ops)

`remove_worktree` and `dispatch_agent` route through `confirm-bridge`
before executing.

- Bridge sends IPC payload to main window; renderer renders
  `<ConfirmAgentActionModal>`.
- 30s timeout → treat as denial.
- Modal copy example:
  ```
  AI agent requests:
  Run "claude --skip-permissions ‹prompt›" in workspace "feature/x"
  [Allow] [Deny]
  ```

The `workspace-service` functions accept an optional `confirm` callback. tRPC
handlers pass `() => true` (renderer already gated by user UI). Control plane
passes the bridge's request fn.

### `.mcp.json` writer

- Helper in `workspace-service`: `writeWorkspaceMcpJson(worktreePath)`.
- Skips overwrite if file already exists *and* contains a non-superiorswarm
  server (preserve user customisations) — only updates the `superiorswarm`
  entry.
- On boot rewrite: same helper, called for every row.

## Data flow

### `create_worktree`

```
agent (claude code in worktree)
  └─ stdio MCP → server.mjs
       └─ POST http://127.0.0.1:PORT/workspaces.create
            Authorization: Bearer <token>
            { project_id, branch, base_branch }
          └─ control-plane/server.ts
               ├─ verify bearer + 127.0.0.1
               ├─ zod validate body
               └─ workspace-service.createWorkspace(...)
                    ├─ git worktree add (operations.ts)
                    ├─ insert worktrees + workspaces rows
                    ├─ symlinkSharedFiles
                    ├─ pr-poller match
                    ├─ writeWorkspaceMcpJson(worktreePath, port, token, projectId)
                    └─ return workspace dto
          └─ JSON 200 → server.mjs → MCP content
```

### `dispatch_agent` (with confirm)

```
agent → POST /workspaces.dispatch { workspace_id, prompt, cli_preset }
control-plane:
  ├─ resolve workspace, verify project_id match
  ├─ confirm-bridge.requestConfirm({ kind: "dispatch", workspace, prompt, cmd })
  │    └─ IPC mainWindow.webContents.send("agent-confirm:request", payload)
  │    └─ renderer renders modal, on click → IPC reply
  │    └─ Promise resolves with allow|deny (30s timeout = deny)
  ├─ if deny → return { status: "cancelled-by-user" }
  └─ workspace-service.dispatchAgent
       ├─ resolve cli preset (CLI_PRESETS[…])
       ├─ build launch script (mirror quick-actions/agent-setup.ts)
       ├─ daemon-client.spawn(workspaceId, launchScript, cwd)
       └─ persist new terminalSessions row, link to workspace
```

## File-level changes

### New files

- `apps/desktop/src/main/services/workspace-service.ts` (~250 LOC)
- `apps/desktop/src/main/control-plane/server.ts` (~150 LOC)
- `apps/desktop/src/main/control-plane/auth.ts`
- `apps/desktop/src/main/control-plane/confirm-bridge.ts`
- `apps/desktop/src/renderer/components/ConfirmAgentActionModal.tsx`
- `apps/desktop/src/shared/control-plane.ts` — zod request/response schemas

### Modified files

- `apps/desktop/src/main/index.ts` — start control plane after DB init,
  register confirm IPC handler, close server on shutdown.
- `apps/desktop/src/main/trpc/routers/workspaces.ts` — replace inline logic
  in `create / checkoutExisting / remove / listByProject / getById` with
  calls to `workspace-service`. Extend `create` and `checkoutExisting` to
  write `.mcp.json` after worktree exists.
- DB / boot location — after control plane starts, walk `worktrees` table
  and rewrite each `.mcp.json` with fresh port + token.
- `apps/desktop/mcp-standalone/server.mjs` — add `WORKSPACE_AGENT` mode
  branch. Uses native `fetch`. Existing modes untouched.

No new dependencies. Node 20 native fetch in `server.mjs`. Main process uses
the built-in `http` module.

## Error model

| Code | When | Body |
|------|------|------|
| 400 | Zod validation fail | `{ error: "validation", details: […] }` |
| 401 | Bad/missing token | `{ error: "unauthorized" }` |
| 403 | workspace_id ≠ project_id | `{ error: "forbidden" }` |
| 404 | workspace not found | `{ error: "not_found", id }` |
| 409 | git op fails (branch exists, dirty tree, …) | `{ error: "git_conflict", git_message }` |
| 499 | user denied confirm | `{ error: "cancelled_by_user" }` |
| 500 | unexpected | `{ error: "internal", request_id }` |

`server.mjs` maps non-2xx to MCP `{ content, isError: true }` so the agent
sees structured failure, not stack traces.

`fetch` `ECONNREFUSED` → MCP returns
`{ content: [{ text: "control plane unreachable — is SuperiorSwarm running?" }], isError: true }`.
No automatic retry.

## Concurrency

- `workspace-service` ops use Drizzle transactions where the original tRPC
  handlers did. No new locking.
- Confirm dialogs serialised via in-memory queue. Max depth 3; further
  requests auto-deny.

## Logging

- Every control-plane request logged via `log.info` with method, path,
  status, latency. Tokens redacted.
- Failed auth logged at `log.warn`.

## Testing strategy

1. **Unit — `workspace-service`** (`apps/desktop/tests/workspace-service.test.ts`)
   Mock git ops + db. Verify `createWorkspace` writes correct rows, calls
   symlink, etc. Verify `removeWorkspace` rejects on dirty tree unless
   `force`.

2. **Integration — control-plane**
   (`apps/desktop/tests/control-plane.test.ts`)
   Spin up real http server with in-memory SQLite + tmp git repo. Test:
   bearer auth (good/bad/missing), 127.0.0.1-only, zod validation, project
   scoping (403 cross-project), end-to-end create+list+remove flow. Mock
   `confirm-bridge` to auto-allow / auto-deny.

3. **Manual smoke — MCP**
   Build, launch app, create worktree, drop in `claude` CLI inside, ask it
   to call `list_workspaces`, `create_worktree`, `dispatch_agent`. Verify
   modals appear, terminal spawns, child agent inherits MCP. Restart app
   mid-session, verify stale-token recovery.

4. **Regression — existing tRPC routers**
   Existing tests around `workspaces.create` / `.remove` keep passing after
   refactor.

## Open questions

- Should `dispatch_agent` accept additional env vars / per-call MCP config
  overrides? (Out of scope for v1; revisit if a real use case appears.)
- Should we expose `branch` operations (create branch, push branch)? (No
  for v1 — agent has git CLI.)
