# PR Panel Redesign — Repos Tab Visual Match

## Problem

The left-sidebar **PRs** tab is hard to scan. PRs are grouped by repo, but the group header is rendered as `text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]` — barely louder than the body text. The eye has to re-anchor every time it crosses a group boundary, and you can't tell at a glance which repo a given PR belongs to.

The **Repos** tab solves this exact problem with a strong visual primitive: 13px semibold project headers, a 2px accent stripe, and a gradient background when the project is active. The PR panel should reuse that primitive — not just match it visually, but render through the same component, so the chrome stays consistent automatically as the Repos tab evolves.

## Design

### 1. Extract a shared `RepoGroup` primitive

Create `apps/desktop/src/renderer/components/RepoGroup.tsx`. It owns the visual chrome that's currently inlined in `ProjectItem.tsx` (the project header + accent-stripe wrapper):

```tsx
interface RepoGroupProps {
  name: string;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  rightContent?: React.ReactNode; // e.g. Repos tab "+" button, PR tab count badge
  subTitle?: React.ReactNode;     // e.g. clone progress in Repos tab
  children: React.ReactNode;      // expanded body — workspaces or PR rows
}
```

Behavior, lifted verbatim from `ProjectItem.tsx`:

- When `isActive && isExpanded`: outer wrapper gets `borderLeft: 2px solid rgba(10, 132, 255, 0.19); borderRadius: 2`. Header gets `bg-gradient-to-br from-[#1a1a24] to-[#16161e]` and `rounded-r-[8px] rounded-l-none`.
- When inactive: header gets `bg-transparent hover:bg-[var(--bg-elevated)]` and `rounded-[8px]`.
- Header text color: `text-[var(--text)]` when active, `text-[#505058]` otherwise.
- Header layout: `flex w-full items-center gap-2 border-none px-3 py-1.5 cursor-pointer transition-all duration-[120ms] text-left`.
- Content layout, left-to-right inside the header:
  1. `<div className="min-w-0 flex-1">` containing `name` as `text-[13px] font-semibold truncate` and (if present) `subTitle` rendered below it.
  2. `rightContent` (optional, e.g., the Repos-tab "+" button or the PRs-tab count badge).
  3. Chevron SVG, `text-[var(--text-quaternary)]` when active else `text-[#3a3a42]`, with `transition-transform duration-[120ms]` and `rotate-90` class applied when `isExpanded`.
- Children render directly below the header inside the outer wrapper. `RepoGroup` does not add padding around `children` — consumers control inner spacing.

The component is purely presentational — no data fetching, no store reads. Both the Repos tab and the PRs tab pass in their own state.

### 2. Refactor `ProjectItem.tsx` to use `RepoGroup`

`ProjectItem.tsx` continues to handle clone polling, workspace fetching, and the create-worktree modal — but its render replaces the inlined chrome with a `<RepoGroup>` invocation:

- `name={project.name}`
- `isActive={isActiveProject}`
- `isExpanded={isExpanded}`
- `onToggle={isReady ? onToggle : undefined}`
- `onContextMenu={...}` (existing handler)
- `subTitle={isCloning ? <CloneProgress .../> : undefined}`
- `rightContent={isReady ? <CreateWorktreeButton .../> : undefined}`
- `children={visibleWorkspaces.map(ws => <WorkspaceItem .../>)}`

The visible behavior of the Repos tab does not change. The refactor exists so the PR panel can render through the same primitive.

### 3. Create `PullRequestGroup.tsx`

New file: `apps/desktop/src/renderer/components/PullRequestGroup.tsx`. Renders one repo group in the PRs tab via `RepoGroup`:

```tsx
interface PullRequestGroupProps {
  repoKey: string;            // "owner/repo" — used for collapse persistence
  displayName: string;        // matched Project.name when local; falls back to "owner/repo"
  prs: MergedPR[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activePRIdentifier: string | null;  // identifier of the PR whose workspace is currently active

  // Forwarded into each RichPRItem (existing data RichPRItem already consumes)
  enrichmentMap: Map<string, GitHubPREnriched>;
  enrichmentLoading: boolean;
  agentAlerts: Record<string, AgentAlert>;
  projectsList: Project[] | undefined;
  workspaceIdMap: Map<string, string>;
  onPRClick: (pr: MergedPR, e: React.MouseEvent) => void;
  onPRContextMenu: (pr: MergedPR, e: React.MouseEvent) => void;
}
```

Renders:

- `<RepoGroup>` with `name={displayName}`, `isActive={isGroupActive}`, `isExpanded={!isCollapsed}`, `onToggle={onToggleCollapse}`. `isGroupActive` is true when any PR in `prs` has an identifier equal to `activePRIdentifier`.
- `rightContent` is a count badge: `<span className="text-[11px] text-[var(--text-quaternary)] tabular-nums">{prs.length}</span>`.
- Children: a `flex flex-col` container (no extra padding — the `RichPRItem` rows handle their own indent via `pl-[22px]`) of `<RichPRItem>` instances, one per PR. Each receives `isActive` (its identifier matches `activePRIdentifier`) and `isInActiveGroup={isGroupActive}`.

### 4. Display name resolution

The current PR panel header shows the raw `repoKey` (e.g., `slotsgames/portal`). The Repos tab shows the local `Project.name` (e.g., `portal`). To keep the two tabs in lockstep:

- For each PR group, look up the matching project from `projectsList` using `(remoteOwner, remoteRepo) === (group.owner, group.repo)`. This lookup already exists in `handlePRClick` and `RichPRItem`.
- If a `Project` is found, use `project.name` as the display name.
- If not (the PR is from a repo the user hasn't cloned), fall back to `${owner}/${repo}` to keep the row useful.

This ensures that `portal` in the Repos tab and `portal` in the PRs tab refer to the same repo and read identically.

### 5. Active highlight in the PR panel

The PR panel mirrors the Repos tab's active rules:

- **Group is active** when one of its PRs has an open workspace and that workspace's ID equals `useTabStore.getState().activeWorkspaceId`. Mirrored from the Repos tab rule (project is active when one of its workspaces is active).
- **Active PR row** receives the same treatment a `WorkspaceItem` gets when active: `bg-[#17171e]`, `rounded-r-[6px] rounded-l-none`, left border `2px solid rgba(10, 132, 255, 0.5)`, `marginLeft: -2`, `pl-[20px]` instead of the default `pl-[22px]`.
- The collapsed-while-active behavior also mirrors Repos: the gradient + stripe only render `when isActive && isExpanded`. A collapsed group containing the active PR shows brighter text (`text-[var(--text)]`) but no stripe.

### 6. Update `RichPRItem` to support active state

`RichPRItem` (currently inlined in `PullRequestsTab.tsx` around line 84) gains two props: `isActive: boolean` and `isInActiveGroup: boolean`. These mirror `WorkspaceItem`'s `isActive` / `isInActiveProject`.

The current root-button classes are:

```tsx
`group flex w-full flex-col gap-0.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${...}`
```

They change to (mirroring `WorkspaceItem.tsx` lines 338–352):

```tsx
className={[
  "group flex w-full flex-col gap-0.5 border-none pr-3 py-[7px] text-left text-[12px]",
  "transition-all duration-[120ms] cursor-pointer",
  isActive
    ? "rounded-r-[6px] rounded-l-none bg-[#17171e] hover:bg-[#1c1c24]"
    : "rounded-[6px] bg-transparent hover:bg-[var(--bg-elevated)]",
  isActive && isInActiveGroup ? "pl-[20px]" : "pl-[22px]",
  isActive
    ? "text-[var(--text)]"
    : isReviewer
      ? "text-[var(--text-secondary)]"
      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
].join(" ")}
style={
  isActive && isInActiveGroup
    ? { borderLeft: "2px solid rgba(10, 132, 255, 0.5)", marginLeft: -2 }
    : undefined
}
```

The three-row body (title + status dot + #num / branch › target / author + reviewers) is unchanged. No content is removed. The padding shift from `px-2.5` (10px) to `pl-[22px] pr-3` is intentional — it brings PR rows under the project header at the same indent level workspace rows use, so the chrome reads as one system.

### 7. Wire it up in `PullRequestsTab.tsx`

The big render block at lines 975–1056 changes from:

```tsx
<div className="flex flex-col">
  {[...grouped.entries()].map(([repoKey, group]) => (
    <div key={repoKey}>
      <button>...</button>          {/* old uppercase header */}
      {!isCollapsed && <div>...</div>} {/* PR rows */}
    </div>
  ))}
</div>
```

to:

```tsx
<div className="flex flex-col gap-2 px-2 pt-2">
  {[...grouped.entries()].map(([repoKey, group]) => (
    <PullRequestGroup
      key={repoKey}
      repoKey={repoKey}
      displayName={resolveDisplayName(group, projectsList)}
      prs={group.items}
      isCollapsed={collapsedGroups.has(repoKey)}
      onToggleCollapse={() => toggleGroup(repoKey)}
      activePRIdentifier={activePRIdentifier}
      enrichmentMap={enrichmentMap}
      enrichmentLoading={enrichmentLoading}
      agentAlerts={agentAlerts}
      projectsList={projectsList}
      workspaceIdMap={workspaceIdMapRef.current}
      onPRClick={handlePRClick}
      onPRContextMenu={(pr, e) => { /* existing setContextMenu logic */ }}
    />
  ))}
</div>
```

`resolveDisplayName(group, projectsList)` is a small helper at the top of `PullRequestsTab.tsx`:

```ts
function resolveDisplayName(
  group: { owner: string; repo: string; name: string },
  projectsList: Project[] | undefined
): string {
  const project = projectsList?.find(
    (p) => p.remoteOwner === group.owner && p.remoteRepo === group.repo
  );
  return project?.name ?? group.name; // group.name is the existing "owner/repo" fallback
}
```

The current `grouped` Map's value already has a `name` field set to the `owner/repo` string — `resolveDisplayName` upgrades it to the local project name when one exists. The Map's value type gains explicit `owner` and `repo` fields (it already has them implicitly via the `repoKey`; this just makes the lookup unambiguous without re-splitting the key).

The outer container picks up `gap-2 px-2 pt-2` so groups have the same breathing room as projects in the Repos tab (`ProjectList.tsx`).

`activePRIdentifier` is computed once at the top of `PullRequestsTab`:

```ts
const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
const activePRIdentifier = useMemo(() => {
  for (const [identifier, wsId] of workspaceIdMapRef.current.entries()) {
    if (wsId === activeWorkspaceId) return identifier;
  }
  return null;
}, [activeWorkspaceId]);
```

### 8. Things explicitly **not** changing

- The grouping logic itself (`grouped` Map construction, lines 606–671). Same data, same keys.
- The collapse persistence (`collapsedGroupsList` from `tickets.getCollapsedGroups`).
- `handlePRClick` and all the workspace-opening logic.
- `RichPRItem`'s body content — title, branch, author, reviewer avatars, status dot, agent indicator. All preserved.
- The Sidebar tab switcher.
- Provider distinction (no GitHub/Bitbucket icon at the group level — we tried it in the mockup, decided against it for now since the displayName already disambiguates).

## File Changes

| File | Change |
|---|---|
| `apps/desktop/src/renderer/components/RepoGroup.tsx` | **New.** Shared chrome primitive — accent stripe, gradient header, chevron, hover/active states. |
| `apps/desktop/src/renderer/components/ProjectItem.tsx` | Refactor to render through `RepoGroup`. No behavior change. |
| `apps/desktop/src/renderer/components/PullRequestGroup.tsx` | **New.** Renders one repo's PRs via `RepoGroup`, computes active state, resolves display name. |
| `apps/desktop/src/renderer/components/PullRequestsTab.tsx` | Replace inlined group header (lines 975–1056) with `PullRequestGroup` invocations. Add `activeWorkspaceId` / `activePRIdentifier` derivation. Pass `isActive` into `RichPRItem`. |

## Success Criteria

- Opening the PRs tab, the user can identify which repo a PR belongs to within ~200ms — group headers are bold and visually distinct from PR rows.
- The visual primitives (stripe, gradient, rounded-right corners, hover bg, transition timings) in the PRs tab are byte-identical to the Repos tab — verified by both tabs rendering through `RepoGroup`.
- Clicking a PR opens its review workspace (existing behavior unchanged), and on return to the PRs tab, the active PR row and its parent group render with the active treatment.
- A PR whose repo is cloned locally shows the same display name in both tabs (e.g., `portal` in both, not `slotsgames/portal` in one and `portal` in the other).
- A PR from an uncloned repo still renders, with the fallback `owner/repo` display name.
- No regression in collapse persistence, click behavior, context menu, or PR row enrichment.

## Out of Scope

- Provider icons (GitHub vs Bitbucket badge at the group level).
- Per-repo color tagging.
- Reordering or filtering of PR groups.
- Any changes to the Tickets tab.
- Extracting `RichPRItem` into its own file (it stays inlined in `PullRequestsTab.tsx` to limit blast radius).
