# Cross-Repo Orchestrator — Design

**Date:** 2026-05-19
**Status:** Draft, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-05-12-agent-coordination-design.md`, `docs/superpowers/specs/2026-05-16-orchestrator-grouping-design.md`

## Problem

The orchestrator concept today is bound to a single project. An orchestrator
is a workspace with `isOrchestrator = true` that lives inside one `projects`
row, and the `orchestrator_members` join enforces same-project membership
(`apps/desktop/src/main/services/orchestrator-membership.ts:29`). The MCP
server (`apps/desktop/mcp-standalone/server.mjs`) resolves a single
`PROJECT_ID` per session and scopes every coordination tool to it. The
per-project event sink writes to `<userData>/events/<projectId>.jsonl`.

This works when all coordinated work lives in one repo. It does not work for
features that span repos — for example, an "Auth migration" that touches a
frontend repo and a backend repo. The user has to run two independent
orchestrators that can't see each other.

## Goals

- Introduce a **cross-repo orchestrator**: a first-class entity that lives
  outside any project and can attach workspaces from any of the repos linked
  to it.
- Preserve the existing **per-repo orchestrator** unchanged. Both modes
  coexist; a workspace can be a child of either (not both).
- Surface cross-repo orchestrators as a new top-level sidebar group,
  visually parallel to `Projects`.
- Extend the MCP `superiorswarm` server with a new `cross-repo-orchestrator`
  mode that grants the orchestrator agent multi-project access without
  breaking the single-`PROJECT_ID` contract that existing tools rely on.
- Aggregate events from all linked projects into a single per-orchestrator
  stream so the agent's `Monitor(tail -F)` invariant is preserved.

## Non-Goals

- **Multi-tenant / multi-user organizations.** No `orgs` table. The cross-repo
  orchestrator is itself the container; no separate "team" or "workspace-of-
  workspaces" entity above it.
- **Nesting per-repo orchestrators inside a cross-repo orchestrator.**
  Members are leaf workspaces only. Same two-level rule as today.
- **Multi-parent membership.** A workspace still has at most one parent
  orchestrator (per-repo OR cross-repo). Single-parent V1 rule preserved.
- **Nested cross-repo orchestrators.** A cross-repo orchestrator cannot
  contain another cross-repo orchestrator.
- **Web / remote orchestrator.** Everything remains local Electron.
- **Cross-repo orchestrator runs inside a git worktree.** The agent's cwd is
  not a git repo; it accesses linked repos through MCP tools and absolute
  paths.

## Mental Model

Two kinds of orchestrator now exist:

- **Per-repo orchestrator** (unchanged): a workspace inside a project with
  `isOrchestrator = true`. Children must come from the same project. UI and
  data model untouched.
- **Cross-repo orchestrator** (new): a row in a new `cross_repo_orchestrators`
  table, not a workspace, not tied to a project. Has a set of *linked
  projects* (the repos it can see) and a set of *member workspaces* drawn
  from any of those linked projects. Runs as an agent process in a dedicated
  app-data directory.

A workspace, from the sidebar's perspective, is either:

- A child of a per-repo orchestrator (shown nested under it inside its
  project — current behavior).
- A child of a cross-repo orchestrator (shown nested under it inside the
  new top-level group, qualified as `repo / branch`).
- Loose (shown at top level inside its project).

## Architecture

### Data model

Three schema changes (one migration, `0045_add_cross_repo_orchestrators.sql`):

**New table `cross_repo_orchestrators`:**

```
id            text PRIMARY KEY
name          text NOT NULL
work_dir      text NOT NULL          -- absolute path in app-data
agent_kind    text NOT NULL          -- 'claude' | 'codex' | …
status        text NOT NULL          -- 'idle' | 'working' | …
color_index   integer                -- 0..7, same palette as per-repo orchs
sort_order    integer NOT NULL
created_at    integer NOT NULL
updated_at    integer NOT NULL
```

**New join `cross_repo_orchestrator_projects`:**

```
orchestrator_id  text NOT NULL REFERENCES cross_repo_orchestrators(id) ON DELETE CASCADE
project_id       text NOT NULL REFERENCES projects(id)                  ON DELETE CASCADE
sort_order       integer NOT NULL
created_at       integer NOT NULL
PRIMARY KEY (orchestrator_id, project_id)
```

**Column on existing `orchestrator_members`:**

```
parent_kind  text NOT NULL DEFAULT 'workspace'   -- 'workspace' | 'cross_repo'
```

Semantics of `orchestrator_members`:

- `parent_kind = 'workspace'` (default): `orchestrator_id` references a row
  in `workspaces` whose `isOrchestrator = true`. Same-project check applies.
  This is the existing behavior; no row is rewritten by the migration.
- `parent_kind = 'cross_repo'`: `orchestrator_id` references a row in
  `cross_repo_orchestrators`. The child workspace's `project_id` must be in
  this orchestrator's `cross_repo_orchestrator_projects` list.

`orchestrator_id` is a text column with no FK constraint to either parent
table; the constraint is enforced in application code based on
`parent_kind`. (Alternative considered: two nullable FK columns. Rejected as
heavier and not enforceable as a single-parent rule by FK alone.)

### Membership service

`apps/desktop/src/main/services/orchestrator-membership.ts` gains parallel
functions for cross-repo:

- `attachToCrossRepoOrchestrator({ orchestratorId, workspaceId })` — looks
  up the cross-repo orch, verifies the workspace's `projectId` is in the
  linked-projects list, removes any existing membership (single-parent),
  inserts with `parent_kind = 'cross_repo'`.
- `detachFromCrossRepoOrchestrator({ workspaceId })` — symmetric to today's
  `detachFromOrchestrator`. Reassigns `sort_order` for the now-loose
  workspace, same as the per-repo version.
- `detachAllFromCrossRepoOrchestrator({ orchestratorId })` — symmetric.
- `listCrossRepoMembers({ orchestratorId })` — returns members grouped by
  project for the sidebar's `repo / branch` rendering.
- `addProjectToCrossRepoOrchestrator({ orchestratorId, projectId })` /
  `removeProjectFromCrossRepoOrchestrator({ orchestratorId, projectId })`.
  Removing a project cascades: detach every member whose `projectId` was
  this project, then delete the join row.

The same-project guard at line 29 stays exactly as written; only per-repo
attaches go through `attachToOrchestrator`. The two paths share helpers
where straightforward (e.g. sort-order math).

### Orchestrator runtime

Each cross-repo orchestrator owns a directory under
`app.getPath('userData')/cross-repo-orchestrators/<id>/`. Subdirs:

```
.claude/                  per-agent state (settings, hooks)
notes/                    scratch files the agent writes for itself
events.jsonl              aggregated event stream (see below)
```

The agent process (claude, codex, etc.) is spawned with this directory as
`cwd`. The directory is not a git repo; the agent reaches linked repos via
MCP tools that return absolute paths (e.g. `list_workspaces` already returns
worktree paths in its response payloads).

`work_dir` is created on cross-repo orchestrator creation and removed when
the orchestrator is deleted. Deletion order: stop agent → detach all members
→ delete project links → remove `work_dir` → delete `cross_repo_orchestrators`
row.

### Event stream

`apps/desktop/src/main/control-plane/orchestrator-event-sink.ts` today
appends to `<userData>/events/<projectId>.jsonl` if-and-only-if the project
has a per-repo orchestrator. It will be extended to also append to each
cross-repo orchestrator's stream when one or more cross-repo orchestrators
link the event's project.

New file layout:

```
<userData>/events/
  <projectId>.jsonl                       (existing — per-repo)
  cross-repo/
    <crossRepoOrchestratorId>.jsonl       (new — per cross-repo orch)
```

On each event with `projectId = P`:

1. If a per-repo orchestrator exists in project `P` → append to
   `<P>.jsonl` (existing behavior, unchanged).
2. Look up all cross-repo orchestrators linked to `P` via
   `cross_repo_orchestrator_projects`. For each result, append to
   `cross-repo/<orchId>.jsonl`.

Both lookups are cached analogously to today's `orchestratorPresence` map.
A new cache `projectCrossRepoLinks: Map<projectId, Set<crossRepoOrchId>>`
is invalidated whenever a project is added to or removed from a cross-repo
orchestrator, and whenever a cross-repo orchestrator is created or deleted.

An event may land in up to two files (one per-repo, one or more cross-repo).
Consumers are independent — no deduplication required.

### MCP server scope

`apps/desktop/mcp-standalone/server.mjs` and the host's `context.resolve`
endpoint gain a new mode `cross-repo-orchestrator`. Returned context shape:

```js
{
  mode: "cross-repo-orchestrator",
  crossRepoOrchestratorId: "...",
  linkedProjectIds: ["proj-frontend", "proj-backend"],
  orchestratorEventsPath: ".../events/cross-repo/<id>.jsonl",
  isOrchestrator: true,
  // existing fields:
  modeContext: { dbPath, … }
}
```

The server's startup code branches on `mode`:

- `mode === "workspace-agent"` (existing) → `PROJECT_ID`, `WORKSPACE_ID`,
  `IS_ORCHESTRATOR`. Unchanged.
- `mode === "cross-repo-orchestrator"` (new) → `CROSS_REPO_ID`,
  `LINKED_PROJECT_IDS`, `IS_ORCHESTRATOR = true`. `PROJECT_ID` is null.

Tools that today read `PROJECT_ID` get a new shape under the cross-repo
mode. The full set of affected tools:

| Tool | Today (workspace-agent) | Cross-repo orchestrator |
|------|-------------------------|--------------------------|
| `list_workspaces` | implicit `PROJECT_ID` | optional `projectId` arg; defaults to all linked projects merged |
| `get_workspace` | implicit `PROJECT_ID` | takes `projectId`; required when ambiguous, derivable from `workspaceId` otherwise |
| `create_worktree` | implicit `PROJECT_ID` | required `projectId` arg, must be in `LINKED_PROJECT_IDS` |
| `dispatch_agent` | implicit `PROJECT_ID` | required `projectId` arg, must be in `LINKED_PROJECT_IDS` |
| `remove_worktree` | implicit `PROJECT_ID` | derived from `workspaceId` |
| `set_status` | publishes own status | unchanged — keyed by `CROSS_REPO_ID` instead of `WORKSPACE_ID` |
| `send_message`, `read_messages` | inbox by workspace id | unchanged — `CROSS_REPO_ID` is the sender/recipient id |
| `resume_agent` | workspace id | unchanged |

`send_message`, `read_messages`, `set_status`, `resume_agent` are keyed off
opaque ids today and need no per-project scoping. The shared id-space —
cross-repo orchestrator ids and workspace ids both live in the same
`messages` / `agent_status` tables — must be globally unique. Adding a
short prefix (`xro_` for cross-repo, `ws_` for workspace) prevents
collisions and lets the consumer distinguish without a lookup. Migration
backfills prefixes for existing rows; alternative IDs (UUIDs) already
collision-free can keep their existing format with no prefix change.

Orchestrator-mode instructions (the prompt embedded at MCP `initialize`)
get a second variant for cross-repo. The reminder text mentions that
`create_worktree` and `dispatch_agent` now require a `projectId` argument.

### Sidebar

`Sidebar.tsx` adds a second top-level group below the existing project
list:

```
Projects
└── (existing rendering, per-repo orchs intact)

Cross-repo orchestrators        [+ new]
├── Auth migration              [colored swatch · 2 repos]
│   ├── REPOS
│   │   ├── frontend
│   │   └── backend
│   └── MEMBERS
│       ├── frontend / feat/login-ui
│       └── backend / main
```

Components:

- `CrossRepoOrchestratorGroup.tsx` — top-level section header + ordered
  list of cross-repo orchs.
- `CrossRepoOrchestratorRow.tsx` — parallel to `OrchestratorRow.tsx`.
  Expand chevron, colored swatch (reusing the `--orch-1`..`--orch-8`
  palette), name, repo-count badge, context menu (rename, delete, detach
  all).
- `CrossRepoOrchestratorBody.tsx` — when expanded, renders the REPOS and
  MEMBERS sublists. Members link back to the workspace's tab and show as
  `<repo-short> / <branch>` (the rendering already exists for per-repo
  via `WorkspaceItem`; the new component wraps it with a prefix).

Drag-drop:

- Dragging a workspace from inside a project onto a cross-repo orch row
  attaches it (if the project is linked). Drop is rejected with a tooltip
  if the workspace's project isn't linked.
- Dragging within a cross-repo orch's MEMBERS list reorders.
- Repos are added via a `+` button on the orch row that opens a list of
  projects (filtered to exclude already-linked ones).

Color palette assignment reuses `useOrchestratorColor`. The hook gains a
parallel `useCrossRepoOrchestratorColor` that draws from the same 8-slot
palette and persists per cross-repo orch id (separate `appSettings` key
from per-repo orchs — they're independent palettes; a per-repo orch and a
cross-repo orch can share a color without confusion since they never
appear side-by-side).

### Lifecycle / tRPC routes

New routes under `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts`:

```ts
crossRepoOrchestrators.list()
crossRepoOrchestrators.get({ id })
crossRepoOrchestrators.create({ name, agentKind })
crossRepoOrchestrators.rename({ id, name })
crossRepoOrchestrators.delete({ id })
crossRepoOrchestrators.linkProject({ id, projectId })
crossRepoOrchestrators.unlinkProject({ id, projectId })
crossRepoOrchestrators.listMembers({ id })
crossRepoOrchestrators.attachMember({ id, workspaceId })
crossRepoOrchestrators.detachMember({ workspaceId })
crossRepoOrchestrators.reorderMembers({ id, orderedWorkspaceIds })
crossRepoOrchestrators.startAgent({ id })
crossRepoOrchestrators.stopAgent({ id })
```

`startAgent` spawns the agent process with cwd set to `work_dir`, the
`SUPERIORSWARM_TASK_TOKEN` env var pointing at a new context-resolve token
that returns the `cross-repo-orchestrator` mode payload.

### Data flow: dispatching a child

1. User creates a cross-repo orchestrator, links two projects, starts the
   agent.
2. Agent calls `list_workspaces` (no `projectId`) → receives merged list
   across both linked projects.
3. Agent decides to spawn a new child in the backend repo: calls
   `dispatch_agent({ projectId: "proj-backend", branchName: …, prompt: … })`.
4. Host validates `projectId ∈ LINKED_PROJECT_IDS`, creates a worktree in
   the backend repo (existing path), inserts the workspace row.
5. Host atomically inserts an `orchestrator_members` row with
   `parent_kind = 'cross_repo'`, `orchestrator_id = <cross-repo id>`.
6. Child workspace boots in `workspace-agent` mode (its own MCP server has
   `PROJECT_ID = proj-backend`, unchanged). It reports `set_status` keyed by
   its `WORKSPACE_ID`.
7. Event sink writes the status event to `events/proj-backend.jsonl` (only
   if a per-repo orch exists there) and to `events/cross-repo/<orchId>.jsonl`
   (always, because this cross-repo orch links proj-backend).
8. Cross-repo orchestrator's `Monitor(tail -F)` on its own events file
   surfaces the line.

### Migration / backwards compat

- Migration `0045_add_cross_repo_orchestrators.sql`:
  - `CREATE TABLE cross_repo_orchestrators` (columns above)
  - `CREATE TABLE cross_repo_orchestrator_projects` (columns above)
  - `ALTER TABLE orchestrator_members ADD COLUMN parent_kind TEXT NOT NULL DEFAULT 'workspace'`
  - Indices: `cross_repo_orch_projects_proj_idx` on `(project_id)` for
    event-sink lookup; `orch_members_parent_kind_idx` on `(parent_kind,
    orchestrator_id)`.
- Existing rows in `orchestrator_members` default to `parent_kind =
  'workspace'`. Per-repo orchestrator code paths read this column but the
  default makes the change transparent.
- Rollback: drop the two new tables, drop the column. No data loss for
  per-repo orchestrators.
- Run via the existing `initializeDatabase()` auto-apply. Name the migration
  with `bun run db:generate --name add_cross_repo_orchestrators` per
  project policy.

## Open questions

- **Agent kind selection on create.** Today per-repo orchs inherit the
  workspace's agent kind. Cross-repo orchs have no host workspace, so the
  create modal must ask. Default to `claude` for V1.
- **Per-repo orch attached to a project that's also linked from a cross-repo
  orch.** Both orchestrators will receive events from that project. That's
  intended (different consumers). Confirm there's no UX implication other
  than the double-file write cost.
- **Existing ID format.** Workspace IDs today are already prefixed/UUIDs
  (verify in `workspaces.id` generator). If they already use a distinct
  prefix, cross-repo IDs only need their own (`xro_`); no backfill needed.
  Confirm before writing the migration.

## Out of Scope (re-statement)

- `orgs` / team entities
- Nested or multi-parent membership
- Remote / web orchestrator
- Cross-repo orchestrator running inside a git worktree
