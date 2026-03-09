# Window Split Feature — Design Document

**Date:** 2026-03-09
**Branch:** window-split
**Status:** Approved

## Goal

Allow users to split the main content area into multiple panes — horizontal and vertical — with each pane having its own independent tab bar. Any tab type (terminal, file editor, diff view, PR review) can live in any pane. Layouts persist per workspace and survive app restart.

## Architecture: Binary Split Tree

The pane layout is modeled as a recursive binary tree. Each node is either a **split** (divides space between two children) or a **leaf pane** (holds a tab bar with its own tabs).

This is the same model used by VS Code, iTerm2, and tmux. It maps cleanly to the existing `react-resizable-panels` dependency via nested `PanelGroup` components.

---

## 1. Data Model

```typescript
// Leaf node: a pane with its own independent tab list
type Pane = {
  type: "pane";
  id: string;                    // e.g. "pane-1"
  tabs: TabItem[];               // independent tab list per pane
  activeTabId: string | null;    // which tab is visible in this pane
};

// Interior node: splits space between two children
type SplitNode = {
  type: "split";
  id: string;                    // e.g. "split-1"
  direction: "horizontal" | "vertical"; // horizontal = side-by-side, vertical = stacked
  ratio: number;                 // 0-1, space allocated to first child (default 0.5)
  children: [LayoutNode, LayoutNode];
};

type LayoutNode = Pane | SplitNode;
```

### Key changes from current model

- `activeTabId` moves from global (tab-store) to per-pane
- New `focusedPaneId: string` tracks which pane has keyboard focus
- Layout tree root stored per workspace: `Record<workspaceId, LayoutNode>`
- The flat `tabs: TabItem[]` array is removed — tabs live inside panes
- On migration from old format: all existing tabs go into a single root pane

### ID generation

- Pane IDs: `pane-${counter++}`
- Split IDs: `split-${counter++}`

---

## 2. Component Architecture

```
MainContentArea
└── LayoutRenderer (recursive)
    ├── SplitNode → <PanelGroup direction={node.direction}>
    │                  <Panel defaultSize={ratio * 100}>
    │                    <LayoutRenderer node={children[0]} />
    │                  </Panel>
    │                  <PanelResizeHandle />
    │                  <Panel defaultSize={(1 - ratio) * 100}>
    │                    <LayoutRenderer node={children[1]} />
    │                  </Panel>
    │                </PanelGroup>
    │
    └── Pane → <PaneContainer>
                 <PaneTabBar tabs={pane.tabs} activeTabId={pane.activeTabId} />
                 <PaneContent>
                   <!-- Terminal tabs: absolute + visibility (same as today) -->
                   <!-- Non-terminal tabs: mount only if active -->
                 </PaneContent>
               </PaneContainer>
```

### Components

| Component | File | Role |
|-----------|------|------|
| `LayoutRenderer` | `components/panes/LayoutRenderer.tsx` | Recursive: SplitNodes become nested PanelGroups, Panes become PaneContainers |
| `PaneContainer` | `components/panes/PaneContainer.tsx` | Wraps a pane: focus ring, drop zones, context menu, click-to-focus |
| `PaneTabBar` | `components/panes/PaneTabBar.tsx` | Per-pane tab strip (derived from current TabBar, compact) |
| `PaneContent` | `components/panes/PaneContent.tsx` | Renders active tab content within the pane |
| `DropZoneOverlay` | `components/panes/DropZoneOverlay.tsx` | Drop targets during tab drag (left/right/top/bottom/center) |

### Focus management

- Clicking anywhere in a pane sets `focusedPaneId`
- Focused pane gets a 1px `--accent` border
- Keyboard shortcuts update `focusedPaneId`
- Terminal input routes to the focused pane's active terminal tab

---

## 3. Interactions

### Creating splits

**Context menu** (right-click on tab pill or pane background):
- "Split Right" — horizontal split, clicked tab moves to new right pane
- "Split Down" — vertical split, clicked tab moves to new bottom pane

**Keyboard shortcuts:**
- `Cmd+\` — split focused pane right (horizontal)
- `Cmd+Shift+\` — split focused pane down (vertical)
- Duplicates active tab to new pane (or creates new terminal)

**Drag-to-edge:**
- Dragging a tab shows translucent drop zone overlays on the target pane
- Drop zones: left 25%, right 25%, top 25%, bottom 25% (split), center 50% (add to pane)
- Dropping on edge creates a split; center moves tab into existing pane

### Closing panes

- Closing the last tab in a pane removes the pane
- The sibling node promotes up to replace the parent split node
- Tree collapses naturally — no empty panes

### Resizing

- Drag resize handles between panes to adjust ratio
- Double-click handle to reset to 50/50
- Ratios persist in the layout tree

### Moving tabs between panes

- Drag tab from one pane's tab bar to another (center drop zone)
- Tab moves (not copies) — source pane auto-closes if it becomes empty

### Keyboard navigation

- `Cmd+1` through `Cmd+9` — focus pane by index (DFS order: left-to-right, top-to-bottom)
- `Cmd+Option+Arrow` — move focus directionally to adjacent pane
- `Cmd+Shift+]` / `Cmd+Shift+[` — cycle tabs within focused pane

---

## 4. State Management

### New pane store (`pane-store.ts`)

```typescript
interface PaneStore {
  layouts: Record<string, LayoutNode>;  // workspaceId -> root layout node
  focusedPaneId: string | null;

  // Layout operations
  getLayout(workspaceId: string): LayoutNode;
  splitPane(paneId: string, direction: "horizontal" | "vertical", tabToMove?: TabItem): void;
  closePane(paneId: string): void;
  setPaneRatio(splitId: string, ratio: number): void;

  // Focus
  setFocusedPane(paneId: string): void;
  focusNextPane(direction: "left" | "right" | "up" | "down"): void;
  focusPaneByIndex(index: number): void;

  // Tab operations (delegated from tab-store)
  addTabToPane(paneId: string, tab: TabItem): void;
  removeTabFromPane(paneId: string, tabId: string): void;
  moveTabBetweenPanes(sourcePaneId: string, targetPaneId: string, tabId: string): void;
  setActiveTabInPane(paneId: string, tabId: string): void;

  // Persistence
  hydrateLayout(workspaceId: string, layout: LayoutNode): void;
  serializeLayout(workspaceId: string): string;
}
```

### Tab store changes

- Remove `tabs: TabItem[]` and `activeTabId`
- Keep `activeWorkspaceId`, `activeWorkspaceCwd`, `rightPanel`, `diffMode`
- Tab CRUD actions delegate to pane store (e.g., `addTerminalTab` → `paneStore.addTabToPane(focusedPaneId, tab)`)

### Persistence

- New `pane_layouts` table: `workspaceId (PK), layout (TEXT), updatedAt`
- Layout serialized as JSON blob of the full tree
- Saved via existing 30-second periodic save + `beforeunload` in App.tsx
- On restore: deserialize tree, re-attach terminals to PTYs

---

## 5. Visual Design

### Focused pane
- 1px `--accent` (#0a84ff) border
- Unfocused panes: no border, separated by resize handles only

### Per-pane tab bar
- Compact height: 36px (reduced from 52px)
- Smaller text/padding on tab pills
- "+" button (new terminal) at right of each pane's tab bar
- Pane number indicator on far left (small `1`, `2`, `3`) matching `Cmd+N` shortcuts
- Shows even with one tab (drag target + context menu)

### Drop zone overlays
- 4 directional zones: blue tint (`--accent` at 15% opacity) with dashed border
- Center zone: slightly different tint ("add to pane" vs "create split")
- Preview line shows where new split boundary would appear

### Resize handles
- Same style as existing panel-resize-handles
- Thin line, widens on hover, `--border-secondary` color

### Animation
- None. Split creation/removal is instant. Keeps things snappy.

---

## 6. Migration & Backward Compatibility

1. First load with new code: `tabs[]` array from old store migrates into a single root `Pane`
2. Session restore checks for `pane_layouts` table; if absent, falls back to old `terminal_sessions` format
3. Database migration adds `pane_layouts` table
4. No breaking changes to the PTY daemon or preload bridge — terminal lifecycle unchanged
