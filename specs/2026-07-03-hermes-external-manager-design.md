# External Manager Support (Hermes) — Design

Date: 2026-07-03
Status: approved

## Goal

Let an external agent runtime (first target: [Hermes](https://github.com/nousresearch/hermes-agent)) act as a
SuperiorSwarm manager: create worktrees, dispatch agents, follow their status, and resume them —
the same contract our in-app orchestrators have, but driven from outside the app (e.g. Hermes
reacting to a Telegram message).

## Background

The superiorswarm MCP server (`apps/desktop/mcp-standalone/server.mjs`) is a thin stdio client over
the local control plane (`src/main/control-plane/server.ts`, loopback + bearer token from
`control.json`). Caller identity today:

- `X-Workspace-Id` — a workspace agent, resolved from cwd via `GET /context.resolve`
- `X-Cross-Repo-Orchestrator-Id` (xro) — resolved from cwd matching the xro's `workDir`
- one-shot task tokens (review/solve/quick-action), 10-min TTL

Four gaps block an external manager:

1. **Identity** — Hermes runs from an arbitrary cwd and owns no worktree; `context.resolve`
   returns `mode: "none"` and the MCP server exits.
2. **Events** — orchestrators consume the events jsonl by running Claude Code's `Monitor` tool
   (`tail -F`). Hermes (and codex/gemini orchestrators) have no equivalent.
3. **Approvals** — `dispatch_agent` / `remove_worktree` block on an app modal; an away-from-desk
   manager hangs forever.
4. **Locality** — control plane is loopback-only. v1 targets Hermes running on the same machine;
   remote is out of scope (future: MCP over Streamable HTTP).

## Design

### Identity: external manager = cross-repo orchestrator variant

External managers reuse the xro plumbing (multi-project links, aggregated events file, header
auth, project-scoped tools). Additive columns on `cross_repo_orchestrators`:

| column            | type                                | default       |
|-------------------|-------------------------------------|---------------|
| `kind`            | `"workspace" \| "external"`         | `"workspace"` |
| `token_hash`      | text, nullable (SHA-256 hex)        | null          |
| `dispatch_policy` | `"confirm" \| "auto"`               | `"confirm"`   |
| `last_seen_at`    | timestamp, nullable                 | null          |

`workDir` stays non-null: external managers get `<userData>/external-managers/<id>` (unused for
cwd matching, keeps schema simple).

Migration: `add_external_manager_support`.

### Token auth

- Creation (Settings UI → tRPC) generates a 32-byte hex token (`auth.ts generateToken()`).
  DB stores only its SHA-256 hash; the raw token is shown once.
- `server.mjs` reads `SUPERIORSWARM_MANAGER_TOKEN` from its env (set in the client's MCP config)
  and passes it to `GET /context.resolve?managerToken=…`. Match → response
  `{ mode: "external-manager", crossRepoOrchestratorId, linkedProjectIds }`, and `last_seen_at`
  is updated.
- Every subsequent control-plane call from an external manager sends BOTH
  `X-Cross-Repo-Orchestrator-Id` and `X-Manager-Token`. `resolveCaller` requires a valid token
  match for `kind="external"` rows (workspace-kind xros are unchanged). Timing-safe compare.

### Events: long-poll instead of Monitor

New route `GET /events.poll?afterSeq=<n>&waitMs=<m>`:

- Allowed callers: per-repo orchestrator workspaces (their project events file) and xros/external
  managers (their aggregated file).
- Cursor = 1-based line count of the events jsonl. Response
  `{ events: [...], nextSeq }`. If `nextSeq < afterSeq` (file was reset), the client restarts
  from 0.
- If no new lines, hold the request up to `waitMs` (cap 55 s, default 25 s), polling the file at
  500 ms.

MCP tool `wait_for_events({ after_seq?, timeout_s? })` wraps this. Registered for external
managers AND regular/xro orchestrators — fixes the existing gap where non-Claude orchestrators
cannot Monitor-tail.

### New MCP tools (external-manager mode)

`create_worktree` (all coordination modes) reuses existing branches: if the branch exists
locally or as a fetched `origin/` ref, the worktree checks it out (branch = its own base,
`reusedExistingBranch: true` in the response) instead of failing on `worktree add -b`.

Same coordination tools as cross-repo mode (`create_worktree` with required `project_id`,
`list_workspaces`, `get_workspace`, `dispatch_agent`, `remove_worktree`, `set_status`,
`send_message`, `read_messages`, `resume_agent`), plus:

- `wait_for_events` — above.
- `list_projects` — new route `GET /projects.list`; returns only the caller's linked projects
  (id, name, repoPath, defaultBranch, kind).
- `get_agent_output({ workspace_id, lines? })` — new route `GET /workspaces.agent_output`.
  v1 reads the most recently updated `terminal_sessions.scrollback` row for the workspace,
  strips ANSI, returns the last N lines (default 100, max 500). Slightly stale (scrollback is
  persisted on the renderer's cadence) — documented in the tool description. Also registered in
  orchestrator/xro modes.

Instructions block for external managers: no Monitor requirement; contract is
"dispatch → `wait_for_events` loop → on `blocked`/`done` act via `resume_agent`; use
`get_agent_output` to inspect a silent child." Works with Hermes's tool loop and its cron
automations for periodic follow-up.

### Dispatch policy

`POST /workspaces.dispatch`: when the caller is an external manager with
`dispatch_policy = "auto"`, skip the confirm modal (the dispatched terminal still appears in the
app). `remove_worktree` ALWAYS confirms — destructive. Default policy is `confirm`; `auto` is an
explicit per-manager opt-in with warning copy (dispatched agents run with
`--dangerously-skip-permissions`).

### Setup UX

Settings → **External Managers**:

- create (name, linked projects, dispatch policy) → one-time token display
- ready-to-paste Hermes snippet:

```yaml
mcp_servers:
  superiorswarm:
    command: "<userData>/bin/superiorswarm-mcp"
    env:
      SUPERIORSWARM_MANAGER_TOKEN: "<token>"
```

- "Install into Hermes" button: YAML-merge the entry into `~/.hermes/config.yaml` (new
  `McpFormat: "yaml"` + yaml-merge util alongside `toml-merge.ts`). NOT part of the startup
  global auto-install — a manager token is per-manager, minted explicitly.
- edit linked projects / policy, regenerate token, delete.

tRPC: new `externalManagersRouter` (create/list/update/regenerateToken/delete), reusing
`cross-repo-orchestrator-membership` for project links.

### Security notes

- Trust boundary unchanged: loopback + control.json bearer. Manager token adds identity
  (which manager) and revocability, and is required per-request for external callers.
- DB stores token hash only (per repo rule: no plaintext secrets at rest). The raw token lives in
  the client's MCP config (`~/.hermes/config.yaml`) — standard MCP env-secret pattern, user-owned.
- Revoking = regenerate/delete row; next request 401s.

### Out of scope (follow-ups)

- Remote Hermes (VPS) via MCP over Streamable HTTP behind the manager token.
- `hermes` as a dispatch `cliPreset` (Hermes workers inside workspaces) — needs verification of
  hermes CLI non-interactive invocation; resume stays claude-only either way.
- Push notifications to the manager's gateway on `blocked`/`done` (Hermes cron + `wait_for_events`
  covers v1).

## Touched files

- `src/main/db/schema.ts` + migration `add_external_manager_support`
- `src/main/control-plane/server.ts` (context.resolve, resolveCaller, events.poll, projects.list,
  agent_output, dispatch policy), `auth.ts` (hashToken helper)
- `src/main/services/external-managers.ts` (new), `cross-repo-orchestrator-membership.ts` (reuse)
- `src/main/services/global-mcp-install.ts`, new `yaml-merge.ts`, `src/shared/mcp-format.ts`
- `src/main/trpc/routers/external-managers.ts` (new) + `routers/index.ts`
- `apps/desktop/mcp-standalone/server.mjs`
- renderer settings section (new)
- `src/shared/control-plane.ts` (schemas/DTOs)
- tests: control-plane auth/poll/policy, yaml-merge, external-managers service
