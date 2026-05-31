# Cross-repo orchestrator: split workspace redesign

**Date:** 2026-05-31
**Status:** Approved (design)
**Supersedes the open/discover portions of:** `2026-05-31-cross-repo-orchestrator-ux-design.md`

## Problem

The current cross-repo orchestrator sidebar has three concrete failures:

1. **Hard to get back to the orchestrator's workspaces.** Member worktrees are reachable only through an expandable sidebar body whose member links call `openXroCanvas` (reopen the canvas) instead of opening the member workspace.
2. **Visually cluttered.** Each row carries an icon, a name, two status chips, a count pill, a green Start pill, a meatball menu, and a chevron, plus an expandable repos/members body. Too many affordances competing at rest.
3. **Unclear what it portrays.** The `3·5` style counts and split status read as noise.

Compounding bug: clicking a row calls `openXroCanvas`, which **never calls `setActiveWorkspace`**, so the main content area (which renders `layouts[activeWorkspaceId]`) does not switch to the orchestrator. The canvas only appears if the xro workspace was already active.

## Goal

One click on an orchestrator opens a split workspace: the coordinator agent terminal on the left, an all-information overview on the right. The sidebar becomes a clean flat list. All orchestrator detail (repos, members, status, dispatch, member navigation) lives in the overview.

## Decisions (locked)

- **Split layout:** coordinator terminal left (~45%), overview right (~55%).
- **Coordinator start:** auto-start on first open; reattach (do not respawn) if a coordinator terminal already exists.
- **Sidebar body:** removed entirely. All info lives in the overview.
- **Member placement:** unchanged — member worktrees stay tagged in place under their home repo in the Projects section (option B).

## Architecture

The orchestrator (`xro-*`) already owns a `workDir` and uses its id as a renderer `workspaceId`, so its terminal tabs and the `xro-canvas` overview tab already share one pane layout. The pane-store already supports splits. This redesign is mostly a re-arrangement plus one new opener plus member-nav wiring. No schema changes except adding `worktreePath` to the member query.

### Unit 1 — `listCrossRepoMembers` returns `worktreePath`

`apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`

Add a left join from `workspaces.worktreeId` to `worktrees` and select `worktrees.path as worktreePath` (nullable string) in `listCrossRepoMembers`. Member navigation in the overview needs the worktree path, mirroring how `SidebarRail.navigateToWorkspace` opens a workspace via `setActiveWorkspace(ws.workspaceId, ws.worktreePath)`.

Return type gains: `worktreePath: string | null`.

### Unit 2 — coordinator launch command exposed server-side

`apps/desktop/src/main/services/cross-repo-orchestrators.ts` + router.

Replace the broadcaster-based `startCrossRepoOrchestratorAgent` flow (which lands a terminal in the focused pane, defeating deterministic split placement) with a query the renderer can place itself:

- New service function `getCoordinatorLaunch({ id })` returns `{ cwd: string, command: string }` where `command` is the CLI invocation built from `CLI_PRESETS[agentKind]` (`command` + `permissionFlag`), e.g. `claude --dangerously-skip-permissions`. The `cwd` is the orchestrator `workDir`. Preset knowledge stays in main.
- Keep a `markAgentStarted({ id })` mutation (or fold into existing `startAgent`) that sets `status = "working"`. Status is a display concern; spawning is renderer-driven.
- `stopAgent` is unchanged (flips status to idle).

The old broadcaster path (`defaultSpawnFn` → `dispatchBroadcaster`) is **not** used for the coordinator. Confirm no remaining caller depends on `startCrossRepoOrchestratorAgent`'s broadcast before removing it; the Row's old Start button is being deleted.

Router exposes `getCoordinatorLaunch` (query) and `markAgentStarted` (mutation).

### Unit 3 — `openXroWorkspace` opener

`apps/desktop/src/renderer/stores/tab-store.ts`

New action `openXroWorkspace(orchestratorId: string, name: string, workDir: string)`:

1. `setActiveWorkspace(orchestratorId, workDir)` — switches the main view (the bug fix).
2. `ensureLayout(orchestratorId)`.
3. **Reattach guard:** if a `terminal` tab with `presetName === "xro-coordinator"` already exists in this workspace's layout, focus its pane and ensure the `xro-canvas` tab exists in a sibling pane, then return. Do not spawn again.
4. **First open:** create the split deterministically so the terminal is LEFT and the canvas is RIGHT:
   - Create the coordinator terminal tab in the initial (left) pane via a terminal tab tagged `presetName: "xro-coordinator"`, title `"Coordinator"`.
   - `splitPane(workspaceId, leftPaneId, "horizontal", xroCanvasTab)` to push the overview into a new right pane. Verify split side empirically (precedent: `addSolveReviewTab({split:true})`); order the calls so terminal ends left, canvas right.
5. Return; the caller (Row) triggers coordinator start (Unit 4).

`openXroCanvas` is retained only for internal reuse (placing the canvas tab); the Row no longer calls it directly.

The `xro-canvas` deserialize behavior (dropped on restore, reopened on demand) is unchanged. Coordinator terminal tabs persist via the normal terminal-session restore path; on restore the reattach guard prevents a duplicate spawn.

### Unit 4 — Row click + auto-start

`apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx` (rewritten, simplified)

Row content at rest: accent icon + name + lightweight status. Status is computed from members: show `●working ●blocked` colored-dot counts when any are active, else `idle`. Removed: count pill, Start pill, chevron, expand toggle, and the `expanded`/`onToggle` props. Keep the right-click / meatball context menu for Rename and Delete.

Active state: when `activeWorkspaceId === orchestrator.id`, render the accent left-bar + tinted background (read `activeWorkspaceId` from the tab store).

Click handler:
1. Fetch `workDir` (via `crossRepoOrchestrators.get` query already loaded in the Row, or pass through from the group's `list`).
2. `openXroWorkspace(id, name, workDir)`.
3. If the coordinator was not already running (no existing coordinator terminal tab, surfaced by the opener returning a `{ started: boolean }` or the Row checking `getTabsByWorkspace`), call `getCoordinatorLaunch`, then after the terminal tab mounts write the command — mirror `App.tsx` `agentDispatch.onOpen`: `setTimeout(~300ms)` then `window.electron.terminal.write(terminalTabId, command + "\n")`. Call `markAgentStarted`. `attachTerminal` mutation as needed (mirror `SidebarRail.navigateToWorkspace`).

### Unit 5 — Group simplification

`apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx`

Remove the `expanded` state and the `CrossRepoOrchestratorBody` render. Section header (`Orchestrators` + `New`), the create popover, and the teaching empty-state card are unchanged. Rows render flat (no body). `CrossRepoOrchestratorBody.tsx` becomes orphaned and is deleted.

### Unit 6 — Overview member navigation

`apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx` + `orchestrator/AgentCard.tsx` / `RepoLane.tsx`

Wire the real handlers (today they are `() => {}`):

- `onOpen(member)`: `setActiveWorkspace(member.workspaceId, member.worktreePath)`, then if the member has no terminal tab, `addTerminalTab(workspaceId, worktreePath, branch)` + `attachTerminal({ workspaceId, terminalId })`. Mirror `SidebarRail.navigateToWorkspace`. Members with a null `worktreePath` render the card non-clickable.
- `onAnswer(member)`: opens/focuses the member workspace and its terminal (same as open) so the user can respond to the block. (No separate answer modal in v1.)
- The `AgentCardData` mapping in the canvas gains `worktreePath` from the extended member query.

Dispatch composer and activity rail are unchanged in this spec.

## Data flow

```
Sidebar Row click
  └─ openXroWorkspace(id, name, workDir)
       ├─ setActiveWorkspace(id, workDir)            → MainContentArea renders xro layout
       ├─ create coordinator terminal tab (left)
       └─ splitPane → xro-canvas tab (right)
  └─ if not already running:
       getCoordinatorLaunch(id) → { cwd, command }
       terminal.write(termTabId, command)            → coordinator CLI runs in left pane
       markAgentStarted(id)                            → status = working

Overview member card click
  └─ onOpen(member)
       ├─ setActiveWorkspace(member.workspaceId, member.worktreePath)
       └─ addTerminalTab + attachTerminal (if none)  → member's own workspace + terminal
```

## Out of scope

- `dispatchAcrossRepos` not delivering the task prompt to a spawned agent (pre-existing, tracked separately).
- Coordinator process lifecycle beyond v1 (PID tracking / SIGTERM). Closed coordinator tab = restart on next open is acceptable for v1.
- Any change to the dispatch composer behavior or the activity rail.

## Testing

- `listCrossRepoMembers` returns `worktreePath` for a member with a worktree, `null` when absent (service test).
- `getCoordinatorLaunch` builds the correct command per agent kind from `CLI_PRESETS` (service test).
- `openXroWorkspace` sets `activeWorkspaceId`, creates exactly one coordinator terminal + one canvas tab in a horizontal split with the terminal on the left, and on a second call does not add a duplicate coordinator (tab-store test).
- Reattach guard: calling `openXroWorkspace` when a coordinator terminal exists focuses it without spawning (tab-store test).
- Member `onOpen` calls `setActiveWorkspace` with the member's workspaceId + worktreePath (renderer/store test).
