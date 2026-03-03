# Linear Issue Context Menu — Design Doc

## Problem

The current hover overlay on Linear issue rows is a poor UX:
- The opaque overlay with gradient fade obscures issue titles
- The chain icon (linked indicator) visually collides with the external link button
- The StatePicker dropdown in the overlay is cramped at 10px font in a ~180px-wide sidebar
- There is no way to create additional branches once an issue is already linked to a workspace (left-click navigates instead of opening the create-branch modal)
- The overlay approach doesn't scale — adding more actions means more crowding

## Solution

Replace the hover overlay with a right-click context menu. Issue rows become clean, static elements. All secondary actions move into the context menu.

## Design

### Issue Row (Clean, No Overlay)

Each issue row contains only:
1. **Status dot** — colored circle showing Linear state
2. **Identifier** — e.g. "ENG-123", quaternary text
3. **Title** — truncated, fills remaining space
4. **Chain icon** — accent-colored link icon, only shown when issue has linked workspaces

Hover effect: background changes to `var(--bg-elevated)`. No overlay, no gradient, no floating buttons.

### Left-Click Behavior (Unchanged)

Three-way dispatch based on linked workspace count:
- **0 workspaces** → Open `CreateBranchFromIssueModal`
- **1 workspace** → Navigate directly (set active workspace + ensure terminal tab)
- **2+ workspaces** → Open `WorkspacePopover` at click position

### Right-Click Context Menu (New)

Right-clicking any issue row opens `IssueContextMenu` at the cursor position. Menu structure:

```
┌─────────────────────────┐
│ ▸ State: In Progress    │  ← StatePicker (select element)
├─────────────────────────┤
│ Open in Linear     ↗    │  ← Opens issue URL externally
│ Create branch           │  ← Opens CreateBranchFromIssueModal
├─────────────────────────┤  ← Divider only if workspaces exist
│ my-feature-branch       │  ← Each linked workspace (navigates)
│ another-branch          │
└─────────────────────────┘
```

Menu items:
1. **State picker** — `<select>` showing current state name, same optimistic update mutation as today. Styled to match menu (elevated bg, 13px text).
2. **Divider** — `border-t border-[var(--border)]` with `my-1`
3. **Open in Linear** — calls `window.electron.shell.openExternal(issue.url)`. Includes external-link icon on the right.
4. **Create branch** — opens `CreateBranchFromIssueModal`. Available on ALL issues regardless of link status (this is the key UX fix — users can always create additional branches).
5. **Divider** — only rendered if the issue has linked workspaces
6. **Workspace entries** — one per linked workspace, showing workspace name. Clicking navigates to that workspace (same `navigateToWorkspace` logic).

### Component: `IssueContextMenu.tsx`

New file following the `WorkspaceContextMenu` pattern from `WorkspaceItem.tsx:42-110`:

- **Positioning**: `fixed z-50`, initial position from right-click event's `clientX`/`clientY`
- **Viewport clamping**: `useEffect` measures rendered menu via ref, clamps to `window.innerWidth/Height - 8px`
- **Dismissal**: click-outside via `mousedown` listener, Escape via `keydown` listener
- **Styling**: `min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]`
- **Menu items**: `w-full text-left px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms]`

Props:
```typescript
interface IssueContextMenuProps {
  position: { x: number; y: number };
  issue: {
    id: string;
    identifier: string;
    title: string;
    url: string;
    stateId: string;
    teamId: string;
  };
  workspaces: LinkedWorkspace[] | undefined;
  onClose: () => void;
  onStateUpdate: (issueId: string, stateId: string) => void;
  onCreateBranch: () => void;
  onNavigateToWorkspace: (ws: LinkedWorkspace) => void;
}
```

### Changes to `LinearIssueList.tsx`

**Remove:**
- `hoveredIssueId` state and `setHoveredIssueId`
- `onMouseEnter` / `onMouseLeave` handlers on the row wrapper
- The entire hover overlay div (gradient + opaque section with StatePicker + external link button)
- The `StatePicker` component definition (moves into `IssueContextMenu`)
- The `group relative` class on the row wrapper (no longer needed for hover overlay)

**Add:**
- `contextMenu` state: `{ position, issue, workspaces } | null`
- `onContextMenu` handler on each issue row button that calls `e.preventDefault()` and sets context menu state
- Render `<IssueContextMenu>` when `contextMenu` is non-null

**Keep unchanged:**
- All left-click behavior (3-way dispatch)
- `linkedMap` with `useMemo`
- `navigateToWorkspace` callback
- `WorkspacePopover` for multi-workspace left-click
- `CreateBranchFromIssueModal`
- `updateStateMutation` with optimistic updates
- Team selector
- Loading state

### `WorkspacePopover.tsx`

No changes.

## Files Changed

| File | Action |
|------|--------|
| `src/renderer/components/IssueContextMenu.tsx` | Create |
| `src/renderer/components/LinearIssueList.tsx` | Modify |

## Out of Scope

- Keyboard navigation within the context menu (arrow keys to move between items)
- Sub-menus or nested menus
- State picker as a sub-menu with radio buttons (keeping it as a native `<select>`)
- Changes to `WorkspacePopover.tsx`
- Changes to any tRPC routers or database schema
