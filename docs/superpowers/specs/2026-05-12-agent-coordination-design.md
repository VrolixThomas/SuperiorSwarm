# Agent Coordination — Design

**Date:** 2026-05-12
**Status:** Draft, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-05-07-mcp-workspace-agent-design.md`

## Problem

The MCP workspace-agent feature (shipped 2026-05-11) lets a coding agent
create worktrees and dispatch other agents into them. But once dispatched,
those agents have no way to coordinate:

- A child agent can't tell the user (or a parent) "I'm blocked, need a
  decision on X."
- A parent agent can't follow up with a child mid-flight ("retry with
  approach Y").
- Status of N parallel child agents is only visible by tabbing into each
  terminal and reading scrollback.

The leading multi-agent frameworks (AutoGen, CrewAI, LangGraph, OpenAI
Swarm) all assume one agent live at a time with synchronous handoffs.
Anthropic's own multi-agent research deliberately avoids mid-flight chatter
(subagents return one string at exit). None of them target the
SuperiorSwarm topology of concurrent CLI agents in separate worktrees.

What works for this topology: **agents publish structured status, an
orchestrator agent reads and acts on those signals, the orchestrator wakes
children by resuming their CLI sessions with follow-up prompts.** Status
flows agent→orchestrator via Server-Sent Events; commands flow
orchestrator→agent via `claude --resume`.

## Goals

- Every workspace publishes a `current_phase` (idle/working/blocked/done) +
  free-form `status_text` and `needs`. The user sees this in the sidebar.
- One workspace per project can be designated the **orchestrator**. Only it
  can wake (resume) other agents.
- The orchestrator runs continuously via Claude Code's `Monitor` tool on a
  Server-Sent Events feed from the app's control plane. Status changes
  arrive as inline notifications; the orchestrator decides whether to
  follow up.
- Resume is `claude --resume <session_id> "<message>"` in the workspace's
  existing terminal. We mint the session ID at dispatch time so we always
  know it.
- Agents can leave durable peer-to-peer notes (`send_message`) without
  involving the orchestrator. The orchestrator sees these too and decides
  whether to act on them.
- Identity is environmental: every workspace's `.mcp.json` includes
  `WORKSPACE_ID`. The MCP server uses it on every request; the control
  plane derives "who's calling" from headers, not user input.

## Non-goals

- Real-time multi-agent chat. Communication is async, event-driven.
- Automatic question routing. The orchestrator decides who answers what.
- Peer-to-peer resume. Only the orchestrator can wake an agent.
- Multi-CLI auto-resume. Claude Code only for v1. Codex/Gemini/OpenCode
  workspaces show status but can't be auto-resumed (their session-resume
  semantics aren't verified yet).
- Headless orchestrator. The orchestrator runs in a terminal like any other
  agent. The user starts it manually.
- Per-message ACLs / channels. Messages are either DM (to a workspace) or
  broadcast (to the project). No groups, no channels.
- Schema migrations for old `.mcp.json` files. New env vars (`WORKSPACE_ID`)
  are written by the boot-time rewrite already shipped.

## Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │ Main process (Electron)                         │
                    │                                                 │
   tRPC over IPC ──►│  ┌─ trpc/routers/workspaces.ts ──┐              │
   (renderer)       │  │   + setOrchestrator           │              │
                    │  └────────┬───────────────────────┘             │
                    │           │                                     │
                    │  ┌────────▼─────────────────────┐               │
                    │  │ services/workspace-service.ts│               │
                    │  │   + setStatus                │               │
                    │  │   + sendMessage              │               │
                    │  │   + readMessages             │               │
                    │  │   + resumeAgent              │               │
                    │  │   + watchWorkspaces (SSE)    │               │
                    │  │   + setOrchestrator          │               │
                    │  └────────▲─────────────────────┘               │
                    │           │                                     │
                    │  ┌────────┴──────────────────────┐              │
                    │  │ control-plane/server.ts        │             │
                    │  │   POST /workspaces.set_status  │             │
                    │  │   POST /workspaces.send_message│             │
                    │  │   GET  /workspaces.read_messages              │
                    │  │   POST /workspaces.resume_agent│             │
                    │  │   GET  /workspaces.watch (SSE) │             │
                    │  │   header: X-Workspace-Id       │             │
                    │  └────────▲──────────────────────┘              │
                    └───────────┼──────────────────────────────────────┘
                                │ HTTP + bearer + X-Workspace-Id
                                │
              ┌─────────────────┴────────────────┐
              │  mcp-standalone/server.mjs       │
              │  WORKSPACE_AGENT mode            │
              │  env: PROJECT_ID, WORKSPACE_ID,  │
              │       CONTROL_PORT, CONTROL_TOKEN│
              │  + set_status / send_message     │
              │  + read_messages / resume_agent  │
              └────────▲─────────────────────────┘
                       │ stdio (MCP)
                ┌──────┴──────────────────┐
                │ User's coding agent     │
                │ (Claude Code)           │
                │ launched in worktree    │
                └─────────────────────────┘

  Orchestrator-only addition (no new MCP tool — uses Claude Code's
  built-in Monitor tool against the SSE endpoint):

    Orchestrator session ─Monitor─► curl -N /workspaces.watch ─event─►
      orchestrator receives notification ─decides─► resume_agent / answer
```

## Components

- **`workspaces` table extensions** — new columns: `current_phase`,
  `status_text`, `needs`, `status_updated_at`, `cli_session_id`,
  `cli_preset`, `is_orchestrator`.
- **`agent_messages` table** — new. Durable log of peer-to-peer notes,
  questions, answers, broadcasts, and resume invocations.
- **`workspace-service.ts` additions** — pure async functions for
  `setStatus`, `sendMessage`, `readMessages`, `resumeAgent`,
  `setOrchestrator`, plus an SSE event emitter (`watchWorkspaces`).
- **Control plane** — new routes, plus extraction of `X-Workspace-Id`
  header on every authenticated request. New `/workspaces.watch` SSE
  endpoint.
- **`mcp-standalone/server.mjs`** — adds the four new tools to
  WORKSPACE_AGENT mode. Reads `WORKSPACE_ID` from env, sends as header.
  Tools no longer need a `workspace_id` input parameter for the "self"
  case.
- **Dispatch flow modification** — at dispatch time, generate a UUID, pass
  to `claude --session-id <uuid> --print '<prompt>'`, store on
  `workspaces.cli_session_id`.
- **Resume flow** — `resume_agent` looks up the workspace's most-recent
  terminal session, writes `claude --resume <uuid> '<message>'` into it
  via `daemon.write`.
- **UI** — sidebar shows phase badge + status_text per workspace.
  Orchestrator is visually distinguished. Workspace context menu has
  "Set as orchestrator." Optional: a global message feed panel
  (read-only audit log).

## Data model

### `workspaces` extensions

```ts
workspaces:
  + current_phase       enum: "idle" | "working" | "blocked" | "done"
                        DEFAULT "idle"
  + status_text         TEXT NULLABLE
  + needs               TEXT NULLABLE
  + status_updated_at   TIMESTAMP NULLABLE
  + cli_session_id      TEXT NULLABLE
  + cli_preset          TEXT NULLABLE  ("claude" | "codex" | "gemini" | "opencode")
  + is_orchestrator     INTEGER NOT NULL DEFAULT 0  (SQLite-style boolean)
```

Migration: descriptive name `add_agent_coordination_fields`.

`is_orchestrator` is unique per project — enforced at the service layer
(`setOrchestrator` flips others to 0). Not enforced via a DB constraint
because partial unique indexes are not portable.

### `agent_messages` table (NEW)

```ts
agent_messages:
  id                 TEXT PRIMARY KEY     (nanoid)
  project_id         TEXT NOT NULL
  from_workspace_id  TEXT NOT NULL        (FK → workspaces.id ON DELETE CASCADE)
  to_workspace_id    TEXT NULLABLE        (FK → workspaces.id ON DELETE CASCADE)
                                          NULL = broadcast to project
  kind               TEXT NOT NULL        ("resume" | "note" | "question" |
                                           "answer" | "broadcast")
  content            TEXT NOT NULL
  in_reply_to        TEXT NULLABLE        (FK → agent_messages.id ON DELETE SET NULL)
  created_at         TIMESTAMP NOT NULL

Indexes:
  CREATE INDEX agent_messages_to_idx ON agent_messages(to_workspace_id, created_at);
  CREATE INDEX agent_messages_project_idx ON agent_messages(project_id, created_at);
```

No `read_at` column. Read state is the agent's responsibility (cursor-based
via `since` parameter on `read_messages`).

`kind: "resume"` rows are written by the control plane every time
`resume_agent` is invoked. The `content` is the follow-up prompt.

## Identity & authorization

### `WORKSPACE_ID` env var

`.mcp.json` gets one new key:

```json
{
  "mcpServers": {
    "superiorswarm": {
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "WORKSPACE_AGENT": "1",
        "PROJECT_ID": "<id>",
        "WORKSPACE_ID": "<id>",                          // ← NEW
        "SUPERIORSWARM_CONTROL_PORT": "<port>",
        "SUPERIORSWARM_CONTROL_TOKEN": "<token>"
      }
    }
  }
}
```

`writeWorkspaceMcpJson` (in `services/mcp-config.ts`) gains a
`workspaceId` parameter and writes it into the env block. The boot-time
rewrite (`main/index.ts`) passes each workspace's id.

### Header on every request

`server.mjs` reads `WORKSPACE_ID` from env and sends it as
`X-Workspace-Id: <id>` on every HTTP call to the control plane.

The control plane validates on every authenticated request:

1. `Authorization: Bearer <token>` matches the per-app-launch token.
2. Peer is loopback (already in place).
3. `X-Workspace-Id` header exists, belongs to a workspace whose
   `projectId` matches `PROJECT_ID` from the URL/body. If absent or
   mismatched, 401.

Tool-specific authorization (e.g. `resume_agent` requires
`X-Workspace-Id == project.orchestrator_workspace_id`) sits on top.

### Backward compat

Existing tools (`list_workspaces`, `get_workspace`, `create_worktree`,
`dispatch_agent`, `remove_worktree`) keep working even if
`X-Workspace-Id` is missing — they're already scoped by `PROJECT_ID` in
the body. The header is *required only for the new tools*. This means
old `.mcp.json` files (pre-rewrite) keep working for the existing
surface; the boot-time rewrite upgrades them.

## MCP tools (WORKSPACE_AGENT mode additions)

```
set_status({
  phase: "idle" | "working" | "blocked" | "done",
  status_text?: string,
  needs?: string,
}) → { ok: true }

send_message({
  to_workspace_id?: string,      // omit = broadcast
  kind: "note" | "question" | "answer",
  content: string,
  in_reply_to?: string,
}) → { message_id: string }

read_messages({
  since?: string,                // ISO timestamp; default: last 1h
  include_broadcasts?: boolean,  // default true
}) → {
  messages: Array<{
    id, from_workspace_id, to_workspace_id, kind, content,
    in_reply_to, created_at
  }>
}

resume_agent({
  workspace_id: string,
  message: string,
}) → { ok: true, message_id: string }
```

All four tools derive the caller's identity (workspace_id) from the
`X-Workspace-Id` header, not from input. Removes one parameter and one
class of bugs (agent A claiming to be agent B).

`resume_agent` is authorized only if the caller is the project's
orchestrator. Returns 403 otherwise.

## Control plane endpoints

### `POST /workspaces.set_status`
Body: `{ phase, status_text?, needs? }`.
Updates the caller's workspace row. Fires SSE event `status`. Returns
`{ ok: true, request_id }`.

### `POST /workspaces.send_message`
Body: `{ to_workspace_id?, kind, content, in_reply_to? }`.
Validates: `to_workspace_id` (if provided) must be same-project. `kind`
must be in `{note, question, answer}`. `kind: "resume"` is reserved for
the control plane's internal use, rejected from this endpoint.
Inserts an `agent_messages` row. Fires SSE event `message`.

### `GET /workspaces.read_messages?since=...&include_broadcasts=...`
Returns rows where `to_workspace_id = caller.workspace_id`
OR (`include_broadcasts=true` AND `to_workspace_id IS NULL`),
AND `created_at > since`. Ordered ascending. Default `since = now - 1h`.
Pagination: cap at 200 rows per call.

### `POST /workspaces.resume_agent`
Body: `{ workspace_id, message }`.
Authorization: caller must be project orchestrator.
Behavior:
1. Look up target workspace. Must be same project, must have
   `cli_session_id`, must have `cli_preset = "claude"`. If not, 409
   `{ error: "resume_not_supported", message: "..." }`.
2. Look up the most-recent `terminalSessions` row for the target
   workspace. If none, open a new terminal in the workspace via the
   existing dispatch broadcaster path, then write the resume command
   into it.
3. Write `claude --resume <session_id> '<escaped message>'\n` to the
   terminal via `daemon.write`.
4. Insert `agent_messages` row: `kind="resume"`, `from=orchestrator`,
   `to=target`, `content=message`.
5. Fire SSE event `message` for the resume row.
6. Return `{ ok: true, message_id, request_id }`.

The terminal is assumed to be at a shell prompt — the previous
`claude --print` invocation exits after its turn, so this holds. If
not (terminal is busy with something else), `daemon.write` succeeds
but the command lands in whatever's there. Acceptable failure mode —
human can intervene.

### `GET /workspaces.watch?projectId=...` (SSE)

Server-Sent Events stream. Long-lived HTTP connection. Auth: bearer +
X-Workspace-Id (the watcher's workspace, scoped to project).

Event types:
```
data: {"event":"status","workspace_id":"<id>","phase":"blocked","status_text":"...","needs":"...","ts":"<iso>"}

data: {"event":"message","message_id":"<id>","from":"<ws>","to":"<ws>","kind":"question","content":"...","ts":"<iso>"}

data: {"event":"heartbeat","ts":"<iso>"}
```

Heartbeat every 30s to keep connection alive. Client reconnect on
disconnect; events between disconnect and reconnect are missed (no
durable subscription). Acceptable for v1 — important events (status
changes, blocked agents) are also visible via `list_workspaces` and
`read_messages` so the orchestrator can catch up on reconnect.

### Identity propagation

Every request reads `X-Workspace-Id` header. Loaded into a
per-request context object passed to service functions. Service
functions never accept a caller workspace id as a parameter — only the
header-derived value.

## Resume mechanism

### Session ID at dispatch

`workspace-service.dispatchAgent` modification:

1. Generate `cliSessionId = randomUUID()` if `cliPreset === "claude"`
   and `cliSessionId` isn't already set on the workspace.
2. Persist `workspaces.cli_session_id = cliSessionId` and
   `workspaces.cli_preset = "claude"`.
3. `buildLaunchScript` produces:
   ```bash
   #!/bin/bash
   cd '<cwd>'
   claude --session-id '<uuid>' [--dangerously-skip-permissions] \
     --print '<escaped prompt>'
   ```
   `--print` ensures the process exits after the turn, leaving the
   shell prompt visible and ready for `claude --resume` later.

For `cli_preset !== "claude"`, no session id is generated; resume
calls 409 with `resume_not_supported` for those workspaces. The
existing dispatch + status flow still works (their agents can
`set_status` etc.); they just can't be auto-resumed.

### Verification

The `--session-id` flag's exact name/behavior in the user's Claude
Code version must be verified before merge. Two fallbacks if it's
unsupported:
- Run `claude --print --output-format json '<prompt>'` and parse the
  `session_id` from the first JSON line emitted, store it, then
  continue with the regular flow.
- If even that fails, fall back to `--continue` which resumes "the
  most recent session" — works for single-agent workspaces but
  ambiguous when multiple terminal tabs exist.

The plan's T1 dedicates a step to verifying the flag. Implementation
gates v1 behind `--session-id` working; if not, plan adjusts.

### Resume into existing terminal

`resume_agent` → main process:
1. Query `terminalSessions WHERE workspaceId = <target>` ordered by
   `updatedAt DESC LIMIT 1`. Call this `existing`.
2. If `existing` exists AND its daemon-side PTY is alive:
   `daemon.write(existing.id, "claude --resume '<uuid>' '<escapedMsg>'\n")`.
3. If not (no row, or daemon says PTY is gone): re-broadcast a
   dispatch payload to the renderer (`agent-dispatch:open`) with a
   launch script that does the resume. Renderer opens a new tab.

Daemon PTY liveness check: the daemon-client already tracks
`liveSessions: Set<string>`. Treat membership as "alive".

### Why `--print` instead of interactive

Interactive `claude "<prompt>"` keeps the REPL open after the first
turn. Subsequent input has to be piped into stdin (fragile, racy).
`--print` runs to completion and exits, so the shell prompt is
predictably visible between turns. Tradeoff: the user can't type
inline mid-turn (they have to wait, then type or click Resume). For
the orchestrator-driven model this is the right tradeoff — humans
intervene through the SuperiorSwarm UI, not by typing into the agent
terminal.

## Orchestrator workflow

### Designation

UI: workspace context menu adds "Set as orchestrator." Calls tRPC
`workspaces.setOrchestrator({ workspaceId })`. Service function flips
the bit on the chosen workspace and clears it on all other workspaces
in the same project. One orchestrator per project, enforced by the
service.

### Starting the orchestrator

User dispatches a regular agent into the workspace they've designated
(typically the main repo root, not a feature worktree). The user's
prompt should instruct the agent to:

1. Read `list_workspaces` to learn what's in flight.
2. Start a `Monitor` on the SSE endpoint:
   ```bash
   curl -N -H "Authorization: Bearer $SUPERIORSWARM_CONTROL_TOKEN" \
     "http://127.0.0.1:$SUPERIORSWARM_CONTROL_PORT/workspaces.watch?projectId=$PROJECT_ID"
   ```
3. Process incoming events: status changes, messages.
4. Call `resume_agent` or `send_message` as appropriate.

We don't ship a canned orchestrator prompt in v1. The user writes it.
A future task can bundle a starter template, but the contract is
defined entirely by the MCP tools — anything goes.

### Lifecycle

The orchestrator is a long-lived `claude --print` invocation. It
runs until:
- Its turn completes (it stops calling tools / generates a final
  message). Then the user resumes it via `resume_agent` on itself,
  or by typing in the terminal.
- The user kills the terminal.
- The Monitor disconnects (control plane restart, token rotation
  → 401). Then the user starts a new orchestrator turn.

The orchestrator doesn't auto-restart on app reboot. v1 keeps this
manual — the user notices the Monitor died (no notifications) and
restarts.

## UI surface

### Sidebar (per workspace)

- Phase badge (small colored dot): grey=idle, blue=working,
  orange=blocked, green=done.
- One-line `status_text` under the workspace name when present.
- One-line `needs` in italic when `phase === "blocked"`.
- "Orchestrator" pill on the orchestrator workspace.

### Workspace context menu

- "Set as orchestrator" / "Unset as orchestrator."

### Global message feed (optional v1)

Read-only panel showing recent `agent_messages` for the active
project. Filterable by workspace. Useful for debugging "what did the
orchestrator say." If implementation time is tight, this can ship in
a follow-up.

### No notifications

We don't surface push notifications for status changes or messages.
The orchestrator agent is the consumer of those events. Adding
desktop notifications later is straightforward.

## Error model

| Code | When | Body |
|------|------|------|
| 400 | Validation fail | `{ error: "validation", details, request_id }` |
| 401 | Bad token, missing/invalid `X-Workspace-Id`, non-loopback | `{ error: "unauthorized", request_id }` |
| 403 | `resume_agent` caller is not the orchestrator | `{ error: "forbidden", request_id }` |
| 404 | Workspace or message not found | `{ error: "not_found", request_id }` |
| 409 | Resume on a non-claude workspace, or missing session id | `{ error: "resume_not_supported", message, request_id }` |
| 500 | Unexpected | `{ error: "internal", request_id }` |

SSE endpoint: long-lived 200 OK with `Content-Type: text/event-stream`.
Errors during stream emit `event: error` then close.

## Concurrency & lifecycle

- `setStatus`: single row UPDATE, atomic. SSE emits after commit.
- `sendMessage`: INSERT then SSE emit. No transactional wrapper —
  emit can land before consumer fetches via `read_messages`. The
  consumer always re-fetches by id, so eventual consistency is fine.
- `resumeAgent`: INSERT agent_messages + `daemon.write`. If daemon
  write fails, we still leave the row (audit trail). 500 to caller.
- `watchWorkspaces`: per-connection state. On disconnect, no cleanup
  needed — node http handles it. Server-side subscriber list is a
  module-level Set of `ServerResponse` objects.
- Control plane shutdown: end all SSE connections gracefully (write
  `event: shutdown\n`, then `res.end()`).

## Trust

- `WORKSPACE_ID` is in `.mcp.json` which lives inside the worktree
  filesystem. Any process inside that worktree can read it and pose
  as that workspace. Treat workspace identity as a within-host signal,
  not a security boundary. The actual security boundary is the bearer
  token (limits access to anyone *on the host*).
- Token rotation on app restart already rotates per-launch; nothing
  new here.
- Orchestrator authorization: relies on `WORKSPACE_ID` from header
  matching `project.orchestrator_workspace_id`. Sound under the same
  trust assumption (host-local, not cross-host).

## Testing strategy

1. **Unit — `workspace-service`** (`workspace-service.test.ts` extensions):
   - `setStatus` updates row + status_updated_at.
   - `sendMessage` inserts row, rejects bad kind, rejects
     cross-project targets.
   - `readMessages` returns DM'd + broadcasts + filters by `since`.
   - `resumeAgent` rejects non-orchestrator caller (403),
     rejects non-claude target (409), succeeds + writes message row.
   - `setOrchestrator` flips bit, clears prior orchestrator.

2. **Integration — control plane** (`control-plane.test.ts` extensions):
   - `X-Workspace-Id` required + validated on the new routes.
   - SSE: connect, trigger `setStatus`, receive event. Heartbeat
     fires. Disconnect cleanly.
   - `resume_agent` returns 403 when caller isn't orchestrator,
     returns 409 for non-claude workspaces, succeeds for orchestrator.

3. **Manual smoke** — orchestrator + 2 children:
   - Designate orchestrator, dispatch with prompt that starts
     Monitor.
   - Dispatch child A and child B (claude preset).
   - Verify status changes from children appear in orchestrator's
     terminal as notifications.
   - Have child A set `phase: blocked, needs: "..."`. Verify
     orchestrator receives event and calls `resume_agent(A, "...")`
     successfully.
   - Verify resume command lands in A's existing terminal.
   - Restart app. Verify orchestrator pill persists. Verify children
     keep their `cli_session_id`. Try `resume_agent` after restart
     (new token, walked-rewrite restored). Should still work because
     session ID is persisted and the new token is in the new
     `.mcp.json`.

4. **Regression** — existing 33 MCP tests must keep passing.

## Open questions

- **Codex/Gemini/OpenCode resume**: deferred to a follow-up. Likely
  doable with each CLI's session-resume equivalent (some have it,
  some don't). v1 silently 409s these workspaces from
  `resume_agent`. UI should make this visible somehow (badge:
  "claude only").
- **Stale SSE on token rotation**: when the user restarts the app,
  old MCP processes get 401 (covered by existing design). The
  orchestrator's Monitor will see the 401 and exit; the user
  re-runs the orchestrator. Worth a UX nicety later — main process
  could detect "orchestrator workspace lost connection" and surface
  a banner.
- **Bounded inboxes**: `agent_messages` grows monotonically. v1
  doesn't prune. Background cleanup job (delete > 30 days) can ship
  in a follow-up.
- **`--session-id` flag verification**: gating concern — plan T1
  must confirm before everything else.
