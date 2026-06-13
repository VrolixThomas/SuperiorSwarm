# Cross-repo orchestrator: overview polish

**Date:** 2026-05-31
**Status:** Approved (design)
**Builds on:** `2026-05-31-cross-repo-orchestrator-split-workspace-design.md`

## Problem

After the split-workspace redesign, the overview (right pane of the split) has three concrete failures, all visible in real use:

1. **Cramped.** `CrossRepoOrchestratorCanvas` hardcodes `grid-cols-[1fr_312px]` (a fixed 312px activity rail) plus a `grid-cols-3` repo grid. Inside a ~half-width split pane that leaves each repo lane ~150px wide. `AgentCard` renders the agent's entire `statusText` untruncated, so an agent that wrote an 84-line status turns its card into a single-word-per-line wall.
2. **Unclear right panel.** The "Cross-repo activity" rail is not a real timeline. Its events are derived from member `statusText` with empty timestamps (`relTime: ""`), so it restates the same text already on the cards. Redundant and purposeless.
3. **No way to add repos later.** The link/unlink-repo affordance lived in the sidebar body deleted in the prior redesign. Nothing replaced it. The dispatch composer's "Route to" only lists already-linked repos. The `linkProject` / `unlinkProject` / `listLinkedProjects` / `projects.list` procedures still exist but are unsurfaced.

## Goal

A single-column overview at full pane width: repos stacked as full-width sections with horizontal agent cards and clamped status text, plus a way to add and remove linked repos directly from the overview. No backend changes.

## Decisions (locked)

- **Activity rail:** removed entirely (`CrossRepoActivityRail.tsx` deleted, width reclaimed).
- **Repo layout:** stacked full-width sections (one per repo), agent cards in a wrapping horizontal row inside each.
- **Status text:** clamped to ~2 lines on the card; full detail via opening the member terminal (already wired).
- **Add/manage repos:** an `+ Add repo` picker in the overview header (`linkProject`); per-repo-section unlink (`unlinkProject`).

## Architecture

All changes are in the overview and its subcomponents. No tRPC, service, or schema changes — every procedure already exists.

### Unit 1 — Single-column canvas

`apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`

- Remove the `grid grid-cols-[1fr_312px]` wrapper; the root becomes a single scrolling column (`flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--bg-base)]`).
- Remove the `<CrossRepoActivityRail>` render, its `events` `useMemo`, and the `ActivityEvent`/`CrossRepoActivityRail` imports.
- Keep: the title + "N repos · N agents" line, the `DispatchComposer`, the `cardsByProject` map (still needed), `membersById`, and `openMember`.
- Replace the `<RepoLane>` grid with a vertical stack of repo sections (Unit 2), passing the same per-repo `cards` plus `onOpen`/`onAnswer` wired to `openMember`.
- Add the `+ Add repo` control (Unit 3) in the header area.

### Unit 2 — Repo section (full-width, horizontal cards)

`apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx` → repurposed as a full-width repo section. (Keep the filename to minimize churn; it is only imported by the canvas.)

- Root is a full-width section: `rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]`, no fixed `min-h`.
- Header row: repo name (mono) + agent count + an unlink button (`×`, calls a new `onUnlink` prop) revealed on hover. The existing `role` prop (backend/frontend tag) is retained but unused by the canvas (passes `null`) — leave the rendering guarded on `role` truthiness as today.
- Body: agent cards in `flex flex-wrap gap-[8px]`. Each `AgentCard` is wrapped to a fixed width so cards sit side by side and wrap: give the card a `w-[240px]` (or the section maps each card inside a `min-w-[240px] flex-1` cell, capped so a lone card does not stretch full width — use `w-[240px]`).
- Empty state (no cards): inline hint "No agents yet — dispatch a task to start one here" (replaces the current "No agents in this repo yet").
- Props become: `repoName: string`, `role: "backend" | "frontend" | null`, `cards: AgentCardData[]`, `onOpen: (workspaceId: string) => void`, `onAnswer: (workspaceId: string) => void`, `onUnlink: () => void`. The existing `onDispatchHere` prop is removed (it was never wired — the canvas passed `() => {}`).

### Unit 3 — Add / unlink repos

`apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx` (header control) + the `onUnlink` wiring into Unit 2.

- **Add:** a small `+ Add repo` button beside the "N repos · N agents" line. On click it opens an anchored popover listing projects from `projects.list` that are NOT in `listLinkedProjects` (compute the unlinked set in the canvas). Selecting one calls `linkProject.mutate({ id: orchestratorId, projectId })` and on success invalidates `listLinkedProjects` (+ `listMembers`) so the new repo section and the composer "Route to" chip appear. If there are no unlinked projects, the button is disabled with a tooltip "All repos linked". Reuse the interaction pattern from the deleted `CrossRepoOrchestratorBody`'s `LinkRepoButton` (outside-click closes).
- **Unlink:** each repo section's `onUnlink` calls `unlinkProject.mutate({ id: orchestratorId, projectId })` (guarded by a `window.confirm`), invalidating `listLinkedProjects` + `listMembers`.
- The popover may be a small inline component in the canvas file or a new `AddRepoButton.tsx` under `components/orchestrator/`; prefer a new focused file if it exceeds ~40 lines.

### Unit 4 — Clamp agent-card status

`apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`

- The status text block (`{data.statusText && (<div ...>...)}`) gets clamped to 2 lines: add Tailwind line-clamp utilities (`overflow-hidden` + `line-clamp-2`, or `[display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden`) and a `title={data.statusText}` for the full text on hover. The blocked-state "Needs input: <needs>" rendering is likewise clamped.
- No change to the card's click-to-open behavior. The card keeps its width constraint from Unit 2.

## Data flow

```
Add repo:   header "+ Add repo" → linkProject.mutate → invalidate listLinkedProjects + listMembers
            → new repo section renders + composer "Route to" chip appears
Unlink:     repo section × → confirm → unlinkProject.mutate → invalidate → section disappears
Open agent: card click → openMember(workspaceId) → setActiveWorkspace + terminal (unchanged)
```

## Out of scope

- Any backend / tRPC / schema change (all procedures already exist).
- The `dispatchAcrossRepos` task-not-delivered gap (pre-existing, tracked separately).
- A real chronological activity timeline (the rail is removed, not rebuilt).
- The `role` (backend/frontend) tag content — left as-is (canvas passes `null`).
- Auto-selecting newly added repos in the composer's `selected` set (composer seeds once on mount; acceptable).

## Testing

The changes are presentational; verification is type-check + lint + manual smoke. One light store-free check is feasible:

- `AgentCard` renders a `title` attribute equal to the full `statusText` while the visible block carries the line-clamp class (DOM assertion is optional; if a renderer test harness is not already used for these components, rely on type-check + lint + manual smoke per the prior redesign's pattern).
- Manual smoke: overview is single-column and not cramped; repos stack full-width with cards wrapping; a long status clamps to 2 lines with a tooltip; `+ Add repo` links an unlinked project and the section + composer chip appear; unlinking removes the section; clicking a card still opens the member terminal.
