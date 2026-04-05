# Quick Actions — Top Bar Command Buttons

Customizable command buttons in the top bar that let users run common tasks (build, test, open CLI agents, etc.) in a new terminal tab. Commands can be scoped globally or per-repo, and optionally set up via an AI agent that auto-detects the project.

## Data Model

New `quickActions` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | text (PK) | UUID |
| `projectId` | text \| null | FK to `projects.id`. Null = global action |
| `label` | text | Display name ("Build", "Test") |
| `command` | text | Shell command ("bun run build") |
| `cwd` | text \| null | Relative subdirectory. Null = repo/worktree root |
| `shortcut` | text \| null | Electron accelerator string ("CommandOrControl+Shift+B") |
| `sortOrder` | integer | Display order in top bar |
| `createdAt` | integer | Timestamp |
| `updatedAt` | integer | Timestamp |

**Scoping**: When displaying actions for a repo, query `WHERE projectId = ? OR projectId IS NULL`, ordered by `sortOrder`. Global actions appear alongside repo-specific ones.

## UI Components

### QuickActionBar

Renders inline in the top bar after the branch chip. Ghost/text-only button style — minimal, just text with subtle hover state. Separator (`|`) between branch area and action buttons. A `+` button at the end opens the popover.

Props: `projectId`, `repoPath`.

Fetches actions via `trpc.quickActions.list`.

### QuickActionPopover

Triggered by the `+` button. Fields:

- **Label** — text input (required)
- **Command** — monospace text input (required)
- **Working directory** — text input, optional, placeholder shows repo root
- **Shortcut** — keypress capture input, optional
- **Scope** — toggle: "Global" / "This repo"
- **"Ask agent" button** — launches CLI chat for agent-assisted setup

Save and Cancel buttons.

### QuickActionContextMenu

Right-click on any existing action button. Options:

- Edit (reopens popover pre-filled)
- Delete (with confirmation)
- Move left / Move right (reorder)

### Integration Point

`QuickActionBar` slots into `MainContentArea` alongside the existing `BranchChip`, separated by a divider.

## tRPC Router

New `quickActions` router with routes:

- `quickActions.list` — query by projectId, includes globals, ordered by sortOrder
- `quickActions.create` — insert new action
- `quickActions.update` — edit existing action
- `quickActions.delete` — remove action
- `quickActions.reorder` — update sortOrder values
- `quickActions.launchSetupAgent` — prepare and return launch script for agent-assisted setup

## Command Execution Flow

When a user clicks a quick action button:

1. Call `useTabStore.addTerminalTab(workspaceId, resolvedCwd, label)` to create a new terminal tab titled with the action's label.
2. Resolve CWD: if action has relative `cwd`, resolve against workspace repo/worktree path. If null, use repo root.
3. Terminal created via existing PTY daemon: `window.electron.terminal.create(id, resolvedCwd, workspaceId)`.
4. Write command to terminal: `window.electron.terminal.write(id, command + '\n')`.

No new IPC channels or backend logic needed — piggybacks on existing terminal infrastructure.

## Keyboard Shortcuts

Registered via Electron's `globalShortcut` module in the main process. When the active project changes, unregister old project-specific shortcuts and register new ones. Global action shortcuts stay registered always.

The shortcut handler sends an IPC event to the renderer, which triggers the same terminal execution flow.

## Agent-Assisted Setup

Reuses the existing CLI agent pattern (PR review / comment solving):

1. User clicks "Ask agent" in popover. Renderer calls `trpc.quickActions.launchSetupAgent`.
2. Main process:
   - Writes MCP config (`.mcp.json`) with a quick-actions MCP server exposing tools: `add_quick_action(label, command, cwd?, shortcut?, scope)`, `list_quick_actions()`, `remove_quick_action(id)`.
   - Writes prompt file: "Explore this repository and help the user set up quick action commands. Look at package.json, Makefile, Cargo.toml, etc. to suggest relevant build/test/dev commands."
   - Writes launch script that `cd`s to repo and starts user's preferred CLI.
   - Returns launch script path.
3. Renderer creates terminal tab titled "Setup Quick Actions", writes `bash '{launchScript}'\n`.
4. Agent explores repo, chats with user, calls MCP tools to save actions to DB.
5. UI updates reactively — `quickActions.list` query invalidates via TanStack Query when MCP tools write to DB (agent hooks pattern).

The MCP server is a thin wrapper around the same DB operations the tRPC routes use, following the standalone MCP server pattern from `src/main/mcp-standalone/`.

## Testing

- **Unit tests**: Quick action DB operations — CRUD, scope filtering (global + repo merge), sort ordering.
- **Component tests**: `QuickActionBar` renders correct buttons from mock data, popover open/close, form validation (label + command required, shortcut format).
- **Integration test**: Create action via tRPC, verify in list query, delete, verify removal.
- **Manual testing**: Keyboard shortcut registration/unregistration on project switch, agent setup flow end-to-end.

Terminal execution is already tested by existing terminal tests — no need to duplicate.
