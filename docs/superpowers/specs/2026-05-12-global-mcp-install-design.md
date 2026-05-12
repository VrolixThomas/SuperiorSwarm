# Global MCP Install — Design

**Status**: Draft
**Date**: 2026-05-12
**Owner**: Thomas

## Problem

SuperiorSwarm writes a `.mcp.json` (or per-CLI equivalent) into every worktree of every project, and rewrites it on every app boot. Consequences:

- Files show up in `git status` / commits unless ignored.
- Per-worktree duplication: every worktree of the same project gets its own copy.
- Boot-time rewrite churn: port/token rotate per app launch, so the file is rewritten every startup, polluting diffs even when contents semantically unchanged.
- Same problem replicated for Gemini (`.gemini/settings.json`), Codex (`.codex/config.json`), and OpenCode (`opencode.json`).

The app ships a stable MCP server (`mcp-standalone/server.mjs`). There is no reason the user must "install" it once per worktree.

## Goal

User installs the SuperiorSwarm MCP integration **once per CLI** into the CLI's user-scope config. From that moment, the MCP tools work in any worktree of any project, with no per-worktree files. Existing per-worktree files are migrated away. All current functionality (workspace-agent tools, AI review, comment solver, quick-action setup) keeps working.

## Non-goals

- Changing the MCP tool surface or tool semantics.
- Supporting CLIs other than Claude / Gemini / Codex / OpenCode.
- Cross-machine sync of MCP install state.

## Current state (what we're replacing)

Five places touch repo-local MCP config files today:

1. `apps/desktop/src/main/services/mcp-config.ts::writeWorkspaceMcpJson` — persistent workspace-agent entry. Called from:
   - `main/index.ts:283-295` (boot rewrite for every existing worktree)
   - `main/services/workspace-service.ts:147` (on workspace creation)
2. `apps/desktop/src/main/ai-review/cli-presets.ts::writeMcpConfig` — ephemeral entry per CLI per review/solve run. Cleaned up via `removeKey` after.
3. `apps/desktop/src/main/quick-actions/agent-setup.ts:72-84` — writes `.mcp.json` for quick-action setup runs. **No cleanup today.**
4. `apps/desktop/src/main/ai-review/orchestrator.ts:726` — cleanup `removeKey` for review.
5. `apps/desktop/mcp-standalone/server.mjs::finish_fix_group` — `git reset HEAD .mcp.json/.gemini/...` so they don't end up in solver commits.

The MCP server is launched via `process.execPath` (packaged Electron) + `ELECTRON_RUN_AS_NODE=1`, with env vars baked into each repo's config: `PROJECT_ID`, `WORKSPACE_ID`, `SUPERIORSWARM_CONTROL_PORT`, `SUPERIORSWARM_CONTROL_TOKEN` (workspace-agent), and `REVIEW_DRAFT_ID` / `SOLVE_SESSION_ID` / `QUICK_ACTION_SETUP` / `DB_PATH` (ephemeral modes).

## Design overview

Three new components and one refactor:

1. **Stable launcher** at `<userData>/bin/superiorswarm-mcp` — script that execs current Electron + bundled `server.mjs`. App rewrites on every boot.
2. **Discovery file** at `<userData>/control.json` — `{port, token, pid, updatedAt}`, mode 0600. Written at every `startControlPlane()`.
3. **Context resolver endpoint** `GET /context.resolve` on control plane — resolves a `cwd` and optional `taskToken` to `{projectId, workspaceId, mode, modeContext}`.
4. **Ephemeral mode plumbing** — orchestrator/agent-setup register a one-shot `taskToken → {mode, ids}` mapping in the control plane and pass the token via `SUPERIORSWARM_TASK_TOKEN` env to the launched CLI subprocess.

The MCP server reads `control.json` at startup, resolves context from cwd + optional task token, and registers tools accordingly. No repo files.

## Components

### Launcher

Path: `<userData>/bin/superiorswarm-mcp` (`.cmd` on Windows). chmod 0755.

Content (POSIX):
```sh
#!/usr/bin/env bash
ELECTRON_RUN_AS_NODE=1 exec "<absolute path to current Electron>" "<absolute path to server.mjs>" "$@"
```

App rewrites on every launch in `main/services/global-mcp-install.ts::ensureLauncher()`. Electron path resolution mirrors today's `getMcpServerPath()` (dev = repo path, prod = `app.asar.unpacked/...`). The corresponding Electron binary path:

- Dev: `process.execPath` (the worktree's `node_modules/.bun/electron@x/...`)
- Prod: `process.execPath` (the Electron binary inside the packaged `.app` / `.exe`)

In production `process.execPath` is stable across worktrees and re-runs of the same installed app. In dev it points at whichever SuperiorSwarm worktree most recently launched the app — acceptable (dev-only constraint).

### Discovery file

Path: `<userData>/control.json`. Mode 0600 (POSIX). Written at end of `startControlPlane()` and re-written if port/token change. Deleted on graceful app shutdown (best effort).

Schema:
```json
{
  "port": 51234,
  "token": "base64...",
  "pid": 12345,
  "updatedAt": "2026-05-12T12:34:56.789Z"
}
```

`server.mjs` reads at startup. On read failure or stale pid (process gone), tools return `"SuperiorSwarm is not running. Open the app and try again."` All tool handlers wrap the control-plane fetch in this graceful error path.

### Context resolver endpoint

`GET /context.resolve` on control plane. Auth: existing bearer token.

Query params:
- `cwd` (required): absolute path the CLI is running in
- `taskToken` (optional): one-shot token passed via env for ephemeral modes

Resolution:
1. If `taskToken` present, look up `taskRegistry[taskToken]`. If found, return `{mode, modeContext, projectId, workspaceId}` from the registration. Mark token consumed.
2. Else `realpath(cwd)` and look up in `worktrees` table joined with `workspaces`. If match → `mode = "workspace-agent"`, return `{projectId, workspaceId}`.
3. Else → `mode = "none"`.

Response:
```ts
{
  mode: "workspace-agent" | "review" | "solve" | "quick-action-setup" | "none",
  projectId?: string,
  workspaceId?: string,
  modeContext?: {
    reviewDraftId?: string,
    solveSessionId?: string,
    prMetadata?: string,
    dbPath?: string,
    worktreePath?: string,
  }
}
```

### Task registry (in-memory, control plane)

Module: `main/control-plane/task-registry.ts` (new).

API:
```ts
register(taskToken: string, task: TaskRegistration): void
consume(taskToken: string): TaskRegistration | null  // single-use, deletes after read
```

`TaskRegistration` = `{ mode, projectId, workspaceId, modeContext }`. Tokens are UUIDs. Single-use: consumed on first `/context.resolve` hit so a leaked env var can't be re-used after CLI exit. TTL 10 minutes as a fallback for abandoned spawns.

### server.mjs rewrite

Boot sequence:

```
1. Read <userData>/control.json (path computed from process.platform + HOME).
   Fail → all tools return "SuperiorSwarm not running" stub.
2. Compute baseUrl, authHeader from port + token.
3. Fetch GET /context.resolve?cwd=<process.cwd()>&taskToken=<env.SUPERIORSWARM_TASK_TOKEN || omitted>.
4. Based on response mode, register the relevant tool block(s):
   - "workspace-agent": workspace-agent tools (current `isWorkspaceAgentMode` block).
   - "review": review tools (`add_draft_comment`, `set_review_summary`, `finish_review`, `get_previous_comments`, `resolve_comment`, `flag_comment`, `get_pr_metadata`).
   - "solve": solver tools (current `isSolverMode` block).
   - "quick-action-setup": quick-action tools (current `isQuickActionMode` block).
   - "none": register no tools; server exits with a clear stderr line.
5. Open SQLite only if modeContext.dbPath present.
6. Start StdioServerTransport.
```

`modeContext` replaces all of: `REVIEW_DRAFT_ID`, `SOLVE_SESSION_ID`, `QUICK_ACTION_SETUP`, `DB_PATH`, `PR_METADATA`, `WORKTREE_PATH`, `PROJECT_ID`, `WORKSPACE_ID`, `SUPERIORSWARM_CONTROL_PORT`, `SUPERIORSWARM_CONTROL_TOKEN` env vars. Everything comes from the resolver response.

The `userData` path detection in `server.mjs`:
- macOS: `$HOME/Library/Application Support/SuperiorSwarm`
- Linux: `$XDG_CONFIG_HOME/SuperiorSwarm` || `$HOME/.config/SuperiorSwarm`
- Windows: `%APPDATA%\SuperiorSwarm`

Override for dev/testing: `SUPERIORSWARM_USER_DATA` env var (still allowed).

### Install module

`main/services/global-mcp-install.ts` (new).

```ts
ensureLauncher(): Promise<string>  // writes/refreshes launcher, returns path
detectInstalledCLIs(): Promise<CliPresetName[]>  // probes PATH via PTY login shell
installForCLI(cli: CliPresetName, launcherPath: string): Promise<void>
uninstallForCLI(cli: CliPresetName): Promise<void>
getInstallState(): InstallState[]  // from SQLite
```

User-scope config locations:

| CLI      | File                                        | Key path                              |
|----------|---------------------------------------------|---------------------------------------|
| Claude   | `~/.claude.json`                            | `mcpServers.superiorswarm`            |
| Gemini   | `~/.gemini/settings.json`                   | `mcpServers.superiorswarm`            |
| Codex    | `~/.codex/config.toml`                      | `mcp_servers.superiorswarm` (TOML)    |
| OpenCode | `~/.config/opencode/opencode.json`          | `mcp.superiorswarm`                   |

Each entry is `{command: <launcher>, args: [], env: {}}` for JSON CLIs. OpenCode uses `{type: "local", command: [<launcher>]}`. Codex needs a TOML writer (one new helper); same merge semantics as `mergeKey`.

Behavior:
- `installForCLI` merges entry, preserving any user-defined sibling MCP servers.
- Records `{cliPreset, configPath, installedAt}` in new SQLite table `global_mcp_install`.
- Idempotent.

Install trigger:
- Silent auto-install on first boot after global-MCP feature ships; toast: "MCP installed for Claude, Gemini" (lists detected CLIs).
- Settings UI lets user uninstall / reinstall per CLI.

### Settings UI

New "Integrations" section in existing settings pane:
- Per-CLI row: detected? installed? config path. Buttons: Install / Uninstall.
- Status of `<userData>/bin/superiorswarm-mcp` (path + last refresh).

Understated, no flashy framing.

### Migration

`main/services/global-mcp-migration.ts` (new), runs once on boot:

1. Check `migration_v2_complete` flag in SQLite. If set → skip.
2. For every worktree in `worktrees` table, for each of `.mcp.json`, `.gemini/settings.json`, `.codex/config.json`, `opencode.json`:
   - `removeKey(file, [mcpServers, superiorswarm])` (or the CLI-specific keypath).
   - If file is now empty container (`{"mcpServers": {}}`, etc.) → delete file.
3. Set `migration_v2_complete = true`.

Add `.mcp.json`, `.gemini/`, `.codex/`, `opencode.json` to the worktree-init `.gitignore` template so future stragglers (e.g. user-added entries that re-create the file) don't pollute commits.

### Wiring changes

**Removed**:
- `mcp-config.ts::writeWorkspaceMcpJson` and the file itself.
- `main/index.ts:264-295` `baseEnv` construction, `setMcpEnvProvider`, and the boot-rewrite loop.
- `workspace-service.ts` `mcpEnvProvider` injection point and the `writeWorkspaceMcpJson` call at line 144-151.
- `cli-presets.ts::setupMcp` on every preset, `writeMcpConfig`, `buildMcpEnv`, `mcpRuntimeCommand`.
- `agent-setup.ts:70-84` MCP config write block (replaced by task-registry registration + `SUPERIORSWARM_TASK_TOKEN` env).
- `orchestrator.ts:722-728` review cleanup block.
- `server.mjs` `finish_fix_group` git-reset block for `.mcp.json` / `.gemini/` / `opencode.json` / `.codex/` — no repo files left to exclude.

**Added**:
- Orchestrator (review): before spawning CLI, calls `taskRegistry.register(uuid, {mode:"review", ...})` and adds `SUPERIORSWARM_TASK_TOKEN=<uuid>` to CLI subprocess env.
- Orchestrator (solve): same with `mode:"solve"`.
- `agent-setup.ts`: same with `mode:"quick-action-setup"`.
- `control-plane/server.ts`: `/context.resolve` handler.
- `main/index.ts`: write `control.json` after `startControlPlane`, run global install + migration.

## Data flow

### Workspace-agent (interactive `claude` in a worktree)

```
User opens terminal in worktree → runs `claude`
  → claude reads ~/.claude.json → launches <userData>/bin/superiorswarm-mcp
  → script execs Electron + server.mjs with ELECTRON_RUN_AS_NODE=1
  → server reads control.json → port + token
  → server fetches /context.resolve?cwd=<worktree path>
  → control plane matches worktree → returns {mode:"workspace-agent", projectId, workspaceId}
  → server registers workspace-agent tools, sets X-Workspace-Id header for all control plane calls
  → claude calls tools → server forwards to control plane
```

### Review (orchestrator-launched claude)

```
User triggers AI review on a PR
  → orchestrator registers taskToken in taskRegistry: {mode:"review", reviewDraftId, prMetadata, dbPath, projectId, workspaceId}
  → orchestrator spawns claude in worktree cwd with env SUPERIORSWARM_TASK_TOKEN=<uuid>
  → claude reads ~/.claude.json → launches launcher → server.mjs
  → server reads control.json → reads env SUPERIORSWARM_TASK_TOKEN
  → server fetches /context.resolve?cwd=...&taskToken=<uuid>
  → control plane consumes token → returns {mode:"review", modeContext:{reviewDraftId, dbPath, prMetadata}}
  → server opens DB, registers review tools
  → review runs as today
```

### Solve and quick-action-setup: same shape with their respective modes.

### App not running

```
claude spawns launcher → server.mjs → no control.json (or stale pid).
Server registers no tools, prints to stderr, exits with clear message.
```

## Edge cases

- **Symlinked cwd / worktree paths**: `realpath()` both incoming `cwd` and stored `worktrees.path` before matching in `/context.resolve`.
- **App restart mid-CLI-session**: the running MCP server keeps its cached port/token from startup. Subsequent tool calls fail when control plane is unreachable. User restarts the CLI to re-resolve. Matches today's behavior (token rotation already breaks running sessions).
- **CLI launched outside any registered worktree**: `mode:"none"`. Server prints `"SuperiorSwarm: cwd not part of any registered workspace"` and exits cleanly; CLI shows no tools.
- **Multiple CLIs in different worktrees simultaneously**: each launcher invocation is a separate MCP process. Each independently resolves its cwd → unique workspaceId. No collision.
- **Single-use task token leaked**: consumed on first resolve; subsequent uses get `mode:"none"`. 10-min TTL bounds liveness for abandoned spawns.
- **Dev mode**: multiple SuperiorSwarm worktrees can produce conflicting launcher contents. Whichever launched the app last wins. Acceptable for dev-only.
- **User has pre-existing MCP servers in `~/.claude.json`**: `mergeKey` preserves siblings under `mcpServers`. Same for other CLIs.
- **Codex TOML**: use `@iarna/toml` (parse + stringify) to safely round-trip user content including comments and arrays-of-tables. A hand-rolled writer is too fragile.

## Schema changes

New SQLite migration (use `bun run db:generate --name global_mcp_install`):

```ts
export const globalMcpInstall = sqliteTable("global_mcp_install", {
  cliPreset: text("cli_preset").primaryKey(),       // "claude" | "gemini" | ...
  configPath: text("config_path").notNull(),
  installedAt: integer("installed_at").notNull(),
});

// And a simple key-value migrations table if not present, or reuse existing
// settings table for `migration_v2_complete` flag.
```

## Testing

Unit:
- `task-registry` register / consume / TTL / single-use semantics.
- `/context.resolve` resolution: taskToken path, cwd match, cwd miss, symlinks.
- `mergeKey` / TOML merge on existing config files with sibling entries — no clobber.
- Launcher script content valid on each platform (chmod, shebang, exec line).

Integration:
- Spawn `server.mjs` with `SUPERIORSWARM_USER_DATA` pointed at a temp dir containing a fake `control.json` + a stubbed HTTP control plane; assert correct tools register per mode.
- End-to-end: install for Claude, launch `claude` in a real worktree, verify MCP tools list contains workspace-agent tools and a `list_workspaces` call succeeds.

Manual smoke:
- Fresh app install → toast appears → `~/.claude.json` has `superiorswarm` entry → `claude` in worktree works.
- Uninstall → entry gone from `~/.claude.json`.
- Migration: existing user with 5 worktrees, each with `.mcp.json` → boot → all `.mcp.json` files cleaned, `git status` clean.

## Rollout

Single release. No long-lived feature flag — migration is one-shot and reversible (user can `removeKey` manually if needed). Ship release notes calling out the change.

## Risks

- **macOS Gatekeeper / quarantine on launcher script**: shell scripts in `userData` are not quarantined; Electron binary inside `.app` is already notarized. Low risk.
- **Codex TOML correctness**: writing TOML without a real parser is fragile if user has comments / arrays-of-tables. Mitigation: use a real TOML library.
- **Stale `control.json` on hard crash**: pid check on read; if pid gone, treat as not-running.
- **Token leak via process listing**: `SUPERIORSWARM_TASK_TOKEN` visible in `ps`. Single-use + 10-min TTL bound damage; token only grants access to one specific task context, not the full control plane.

## Out of scope (future)

- Cross-machine sync of install state.
- Health/status pings from server.mjs to control plane for observability.
- Per-CLI tool filtering (e.g. hide workspace-agent tools from Codex if user wants).
