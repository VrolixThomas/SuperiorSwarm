# Unified Tickets & PRs Sidebar Design

## Goal

Replace the three separate integration panels (Atlassian, Linear, GitHub) with a single unified section that groups tickets and PRs by their native project, with a segmented control to toggle between the two views.

## Architecture

The sidebar keeps a single scrollable area with two collapsible regions: Workspaces (existing ProjectList, unchanged) and a new unified "Tickets & PRs" section. A compact segmented control toggles between a Tickets tab (Jira + Linear issues) and a Pull Requests tab (Bitbucket + GitHub PRs). Connect/disconnect controls remain in the Settings view from the previous redesign.

## Design Decisions

- **Segmented control** (not tabs or stacked sections) to toggle Tickets vs PRs
- **Group by native project** — Linear team name / Jira project key for tickets; repo slug for PRs
- **Sort by status within groups** — In Progress > To Do > Backlog > Done
- **Provider as subtle badge** — Small icon (10px, opacity-40) at row's far right
- **Persist group collapse state** — Stored in `sessionState` table
- **No team selector** — Grouping by project makes filtering redundant
- **Single scroll area** — Workspaces and Tickets/PRs as collapsible sections in one scrollable container

## Component Architecture

### New Components

- **`UnifiedTicketsSection.tsx`** — Collapsible section with SectionHeader, segmented control, and active tab content
- **`TicketsTab.tsx`** — Fetches Jira issues + Linear issues, merges, groups by native project, sorts by status
- **`PullRequestsTab.tsx`** — Fetches Bitbucket PRs + GitHub PRs, merges, groups by repo

### Modified Components

- **`Sidebar.tsx`** — Replace `<AtlassianPanel />`, `<LinearPanel />`, `<GitHubPanel />` with single `<UnifiedTicketsSection />`

### Removed from Sidebar

- `AtlassianPanel.tsx`, `LinearPanel.tsx`, `GitHubPanel.tsx` no longer rendered in sidebar (connect/disconnect already in SettingsView)

### Store Changes

- Add `ticketsPrTab: "tickets" | "prs"` + `setTicketsPrTab()` to Zustand store
- Add `collapsedGroups: Set<string>` + `toggleGroupCollapsed(groupId)` persisted via `sessionState` table

### Data Flow

Each tab queries its providers independently via existing tRPC calls (no new backend routes). Client-side merge + group + sort.

## Visual Design

### Segmented Control

- Container: `rounded-[6px] bg-[var(--bg-base)] p-0.5` inside section, full width with horizontal margin
- Segment: `rounded-[5px] px-3 py-1 text-[11px] font-medium`
- Active: `bg-[var(--bg-elevated)] text-[var(--text)]`
- Inactive: `text-[var(--text-tertiary)]`

### Group Headers

- Project name: `text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]`
- Provider icon (12px, muted) left of name
- Collapse chevron + count badge (same pattern as SectionHeader)

### Ticket Rows

- Status indicator: reuse `StateIcon` for Linear, colored dot for Jira
- Identifier: `text-[11px] font-mono text-[var(--text-tertiary)]` (e.g., `ENG-42`, `PROJ-123`)
- Title: `text-[12px] text-[var(--text-secondary)]`, truncated with ellipsis
- Provider icon: `10px, opacity-40` at far right
- Linked to workspace: identifier in `text-[var(--accent)]` instead of tertiary

### PR Rows

- State dot: green (open), purple (merged), red (closed)
- PR number: `text-[11px] font-mono` (e.g., `#123`)
- Title: `text-[12px] text-[var(--text-secondary)]`, truncated
- Provider icon at far right
- Same linked indicator as tickets

### Interaction

- Click: same behavior as today (navigate to workspace if linked, create-branch modal if unlinked, popover if multiple links)
- Right-click: context menu with state transitions + "Link to workspace"
- Group collapse: click chevron, state persisted in `sessionState`
