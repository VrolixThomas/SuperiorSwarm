# Cross-Repo Orchestrator — UX Redesign

Date: 2026-05-31
Status: Approved (design), pending implementation plan
Mock: `docs/mocks/cross-repo-orchestrator-mock.html`

## Goal

One orchestrator that **dispatches and coordinates agent tasks across multiple repos**
(e.g. backend + frontend together) via the SuperiorSwarm MCP. Today the MCP orchestrator is
limited to a single repo. This redesign makes the cross-repo coordination visible, manageable,
and aesthetically consistent with the app (Apple × Linear, understated dark theme).

Out of scope: the cross-repo dispatch *backend* itself (MCP routing, membership, event
aggregation) already exists on this branch. This spec covers the **UX layer** on top of it.

## Design principles

- The orchestrator is **Mission Control**, not a sidebar pill. Its primary surface is a
  full-canvas tab; the sidebar is a fast entry point.
- **Physical truth in the tree.** A worktree lives once, in its home repo, and is shown once
  there. The orchestrator is a *lens* (tag + reference list + canvas), never a second home.
- **Uniform status language** everywhere: the same dot/pill color means the same thing in the
  sidebar, the lanes, and the timeline.
- Match existing tokens in `apps/desktop/src/renderer/styles.css`. No new aesthetic — extend
  the current one.

## Sidebar IA (decision: option B)

Membership is single-parent (`cross-repo-orchestrator-membership.ts` deletes any existing
parent on attach), so a worktree row can render in exactly one place. We keep it home.

- **Projects** section: worktrees stay nested under their home repo. Each member worktree wears
  a small accent tag (`◦ <orchestrator name>`) in the orchestrator's color, plus its status dot.
- **Orchestrators** section: each orchestrator is a launcher row (`name`, `repos·agents` count)
  that opens the canvas. Expanded, it shows a lightweight **reference list**
  (`repo / branch` with status dot) that jumps to the worktree or opens the canvas — pointers,
  not duplicate workspace rows.

Rejected: (A) moving worktrees under the orchestrator group — causes worktrees to disappear from
their home repo list. (C) mirroring in both places — duplicate rows, ambiguous canonical home,
fights the single-parent model.

## Mission Control canvas

Opens as a tab (orchestrator accent swatch in the tab). Three-region layout:
left main column + right activity rail.

### 1. Header
Crest (orchestrator glyph in accent), name, subtitle (`N repos · M agents · …`), and two
actions: `Manage repos` (link/unlink) and primary `Dispatch task`.

### 2. Coordinator strip
The orchestrator agent itself, made visible: a `● coordinating` badge and a one-line summary of
what it is currently doing (e.g. "splitting task X into 2 sub-tasks, dispatched to api + web"),
with an `Open thread` action.

### 3. Dispatch composer (hero)
The capability that does not exist today. A single textarea ("describe a task") with **repo
target chips** below (`api ✓`, `web ✓`, `mobile`, `+ auto-pick`). On dispatch, the orchestrator
creates a branch + agent in each selected repo and keeps them in sync. Footer hint explains the
fan-out; `⌘⏎` to dispatch.

### 4. Repo lanes
One column per linked repo, tagged `BACKEND` / `FRONTEND`. Each lane holds **agent cards**:
- Branch name (mono), status pill, one-line description, agent identity, and a contextual action.
- **Blocked** cards surface the agent's question inline with an `Answer →` affordance.
- **Done** cards show `View PR →`. **Queued** cards show cross-repo dependencies explicitly
  (e.g. "depends on api").
- Each lane has a `+ dispatch agent here` affordance.

### 5. Activity rail
A unified **cross-repo timeline** (one stream across all repos): blocked/needs-input, commits,
PRs opened, and orchestrator dispatch events, each with repo label + relative time. Blocked
events offer an inline `Reply from orchestrator`.

## Status tokens (new)

Add to `styles.css` (both themes). Semantics shared by sidebar dots, lane pills, timeline nodes:

| Status  | Meaning                          | Dark value (fg / bg)                          |
| ------- | -------------------------------- | --------------------------------------------- |
| working | agent actively running           | `#0a84ff` / `rgba(10,132,255,0.14)`           |
| blocked | needs human/orchestrator input   | `#e6a23c` / `rgba(230,162,60,0.14)`           |
| done    | finished, PR ready               | `#5dc983` / `rgba(93,201,131,0.13)`           |
| idle    | queued / unassigned              | `#8e8e93` / `rgba(142,142,147,0.12)`          |

Light-theme equivalents to be derived to match existing `--st-*` contrast conventions.

## Components (renderer)

New / changed under `apps/desktop/src/renderer/`:
- `components/CrossRepoOrchestratorCanvas.tsx` — the Mission Control tab (composes the regions).
- `components/orchestrator/DispatchComposer.tsx` — textarea + target chips + fan-out.
- `components/orchestrator/RepoLane.tsx` + `AgentCard.tsx` — lane and card.
- `components/orchestrator/CrossRepoActivityRail.tsx` — unified timeline.
- `components/CrossRepoOrchestratorRow.tsx` — restyle as launcher; expanded = reference list.
- `components/WorkspaceItem.tsx` — add member tag (accent badge) for orchestrator members.
- `hooks/useAgentStatus.ts` (or reuse) — derive working/blocked/done/idle per workspace.

Data already available via `trpc.crossRepoOrchestrators.*` (listMembers, listLinkedProjects,
startAgent) and the aggregated event stream from `orchestrator-event-sink`.

## Testing

- Sidebar: member worktrees render under home repo with tag; orchestrator row shows reference
  list; non-member worktrees render untagged.
- Canvas: lanes render per linked repo; cards map agent status to the correct pill; blocked card
  exposes the question + answer affordance.
- Dispatch composer: selecting N repos and dispatching calls the fan-out path once per repo.
- Activity rail: events from multiple repos interleave in one ordered stream.
