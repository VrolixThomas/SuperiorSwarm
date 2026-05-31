# Cross-repo orchestrator: richer agent card

**Date:** 2026-05-31
**Status:** Approved (design)
**Builds on:** `2026-05-31-cross-repo-orchestrator-overview-polish-design.md`

## Problem

The overview's agent card shows only a 2-line-clamped `statusText` and a cut-off `title` tooltip. The user cannot read what an agent actually reported ("just shows a sentence and nothing more"), cannot tell how fresh the status is, and the only clear path to real output (the agent terminal) is an undiscoverable whole-card click. The 2-line clamp was added earlier to stop an 84-line status from making a wall — so the card must satisfy BOTH: compact by default, fully readable on demand.

## Goal

An agent card that is readable and useful: expandable full status, a freshness timestamp, and an explicit way to open the agent's live terminal — using the horizontal space the single-column overview currently wastes.

## Decisions (locked)

- **Expandable status:** ~4 lines by default; a `Show more` / `Show less` toggle expands the full text inline (internally scrollable for very long statuses). No tooltip.
- **Freshness:** a relative timestamp ("3m ago") from `statusUpdatedAt`, shown by the phase pill.
- **Explicit terminal action:** an `Open terminal →` control on the card (opening the agent terminal — navigation behavior unchanged, per user "fine as is"). `Answer` remains for blocked agents.
- **Use the space:** lift the overview's 820px cap and widen the cards so status text has room.
- **Out of scope this round:** the on-disk event-log activity feed (offered, deferred by the user).

## Architecture

One backend field is added; the rest is the overview subcomponents.

### Unit 1 — `listCrossRepoMembers` returns `statusUpdatedAt`

`apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`

Add `statusUpdatedAt: workspaces.statusUpdatedAt` to the `.select({...})` in `listCrossRepoMembers` and `statusUpdatedAt: Date | null` to the Promise return-type array shape. (`workspaces.statusUpdatedAt` is an `integer(... {mode:"timestamp"})` column → `Date | null`.) superjson preserves the `Date` across tRPC.

### Unit 2 — `AgentCardData` gains `statusUpdatedAt`

`apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`

Add `statusUpdatedAt: string | null` to the `AgentCardData` interface (after `worktreePath`). The renderer carries it as a normalized ISO string (the canvas converts the `Date`), so `formatRelativeTime` (which takes `string | undefined`) can consume it directly.

### Unit 3 — Rich, expandable `AgentCard`

`apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`

Restructure the card from a single giant `<button>` into a static `<div>` with explicit action controls (this removes the nested-button-inside-button a11y workaround):

- **Header row:** branch (mono, truncate) · `StatusPill` · relative time from `formatRelativeTime(data.statusUpdatedAt ?? undefined)` in `--text-quaternary` (omitted when empty).
- **Status block:** when present, render `statusText` (or `Needs input: <needs>` when blocked) clamped to 4 lines by default (`[-webkit-line-clamp:4]`). When the text is long (heuristic: `statusText.length > 140`), render a `Show more` / `Show less` toggle (local `useState`) that expands to the full text in a `max-h-[240px] overflow-y-auto` block. No `title` tooltip.
- **Footer row:** an `Open terminal →` button (calls `onOpen`) on the left; when `blocked`, an `Answer` button (calls `onAnswer`) on the right. Both are real `<button>`s now that the card root is a `<div>`.
- Props unchanged in name: `{ data, onAnswer, onOpen }`. The card no longer has an outer `onClick`; `onOpen`/`onAnswer` are invoked from the explicit footer buttons.

### Unit 4 — Canvas passes the timestamp + widens the layout

`apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`

- In the `cardsByProject` push, add `statusUpdatedAt: m.statusUpdatedAt ? new Date(m.statusUpdatedAt).toISOString() : null` (robust whether the value arrives as a `Date` or string).
- Widen the content container: change the inner wrapper `max-w-[820px]` to `max-w-[1100px]` so the wider cards have room.
- `onOpen`/`onAnswer` wiring is unchanged (both call `openMember`).

### Unit 5 — Wider cards in the repo section

`apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx`

Change the per-card wrapper from `min-w-0 basis-[240px]` to `min-w-0 basis-[340px] grow` so cards are wider (status text gets line width) and grow to fill the row, while still wrapping and shrinking in a narrow pane.

## Data flow

```
listCrossRepoMembers → { …, statusUpdatedAt: Date|null }
  → canvas cardsByProject → AgentCardData.statusUpdatedAt (ISO string)
  → AgentCard header → formatRelativeTime → "3m ago"
AgentCard "Show more" → local expand (no nav)
AgentCard "Open terminal →" → onOpen → openMember (unchanged)
```

## Out of scope

- The event-log activity feed (deferred).
- Any change to `openMember` navigation (user confirmed "fine as is").
- Backend changes beyond adding the one existing column to the members query.
- `dispatchAcrossRepos` task-delivery gap (pre-existing, tracked separately).

## Testing

- `listCrossRepoMembers` returns `statusUpdatedAt` (extend the existing `cross-repo-orchestrator-members-worktree.test.ts`: seed a workspace with a known `statusUpdatedAt` and assert it round-trips; assert `null` when unset).
- The card changes are presentational: verify via renderer type-check (`npx tsc --project tsconfig.renderer.json --noEmit`) + Biome + manual smoke (status reads fully via Show more; relative time shows; `Open terminal →` opens the agent terminal; blocked card shows `Answer`; long status scrolls rather than walls).
