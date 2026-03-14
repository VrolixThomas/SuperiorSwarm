# Window Split Pane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a split-pane system to MainContentArea where each pane has its own tab bar, supporting horizontal/vertical splits via context menu, keyboard shortcuts, and drag-to-edge, with per-workspace layout persistence.

**Architecture:** Binary split tree data structure. Each node is either a SplitNode (direction + ratio + 2 children) or a Pane (leaf with its own tab list). Recursive `LayoutRenderer` component maps the tree to nested `react-resizable-panels` `PanelGroup`s. New `pane-store.ts` Zustand store owns the layout tree; existing `tab-store.ts` is refactored to delegate tab operations to the pane store.

**Tech Stack:** React 19, Zustand, react-resizable-panels (already installed), Drizzle ORM + better-sqlite3, xterm.js, Bun test runner.

---

## Task 1: Define Layout Types

**Files:**
- Create: `apps/desktop/src/shared/pane-types.ts`

**Step 1: Write the type definitions**

```typescript
import type { TabItem } from "../renderer/stores/tab-store";

// Leaf node: a pane with its own independent tab list
export type Pane = {
	type: "pane";
	id: string;
	tabs: TabItem[];
	activeTabId: string | null;
};

// Interior node: splits space between two children
export type SplitNode = {
	type: "split";
	id: string;
	direction: "horizontal" | "vertical";
	ratio: number; // 0-1, space for first child (default 0.5)
	children: [LayoutNode, LayoutNode];
};

export type LayoutNode = Pane | SplitNode;

// Serializable versions (tabs stored as IDs, resolved at hydration)
export type SerializedPane = {
	type: "pane";
	id: string;
	tabIds: string[];
	activeTabId: string | null;
};

export type SerializedSplitNode = {
	type: "split";
	id: string;
	direction: "horizontal" | "vertical";
	ratio: number;
	children: [SerializedLayoutNode, SerializedLayoutNode];
};

export type SerializedLayoutNode = SerializedPane | SerializedSplitNode;
```

**Step 2: Verify TypeScript compiles**

Run: `bun run type-check`
Expected: PASS (no errors from the new file)

**Step 3: Commit**

```bash
git add apps/desktop/src/shared/pane-types.ts
git commit -m "feat(types): add pane layout tree type definitions"
```

---

## Task 2: Create Pane Store with Core Tree Operations

**Files:**
- Create: `apps/desktop/src/renderer/stores/pane-store.ts`
- Create: `apps/desktop/tests/pane-store.test.ts`

**Step 1: Write the failing tests for pane store**

Write tests covering:
- `getLayout()` returns a default single pane for new workspaces
- `splitPane()` replaces a pane with a SplitNode containing the original pane + new pane
- `splitPane()` moves specified tab to the new pane
- `closePane()` promotes sibling when a pane is removed
- `closePane()` on root pane does nothing (can't close the last pane)
- `addTabToPane()` adds a tab and makes it active in that pane
- `removeTabFromPane()` removes a tab, selects neighbor, auto-closes empty pane
- `moveTabBetweenPanes()` moves a tab from one pane to another
- `setActiveTabInPane()` sets the active tab
- `setPaneRatio()` updates ratio on a split node
- `setFocusedPane()` updates focused pane ID
- `focusPaneByIndex()` focuses pane by DFS order

Test file: `apps/desktop/tests/pane-store.test.ts`

```typescript
import { beforeEach, describe, expect, test } from "bun:test";
// Import store once created
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/pane-store.test.ts`
Expected: FAIL (store doesn't exist yet)

**Step 3: Implement pane-store.ts**

```typescript
import { create } from "zustand";
import type { LayoutNode, Pane, SplitNode } from "../../shared/pane-types";
import type { TabItem } from "./tab-store";

let paneCounter = 0;
let splitCounter = 0;

export function nextPaneId(): string {
	return `pane-${++paneCounter}`;
}
function nextSplitId(): string {
	return `split-${++splitCounter}`;
}

export function createDefaultPane(tabs: TabItem[] = []): Pane {
	return {
		type: "pane",
		id: nextPaneId(),
		tabs,
		activeTabId: tabs[0]?.id ?? null,
	};
}

// Tree traversal helpers
export function findPaneById(node: LayoutNode, paneId: string): Pane | null { ... }
export function findParentSplit(node: LayoutNode, childId: string): SplitNode | null { ... }
export function getAllPanes(node: LayoutNode): Pane[] { ... } // DFS order
export function removePaneFromTree(root: LayoutNode, paneId: string): LayoutNode | null { ... }
export function replacePaneInTree(root: LayoutNode, paneId: string, replacement: LayoutNode): LayoutNode { ... }

interface PaneStore {
	layouts: Record<string, LayoutNode>;
	focusedPaneId: string | null;

	getLayout(workspaceId: string): LayoutNode;
	ensureLayout(workspaceId: string): LayoutNode;
	splitPane(workspaceId: string, paneId: string, direction: "horizontal" | "vertical", tabToMove?: TabItem): string;
	closePane(workspaceId: string, paneId: string): void;
	setPaneRatio(workspaceId: string, splitId: string, ratio: number): void;

	setFocusedPane(paneId: string): void;
	focusPaneByIndex(workspaceId: string, index: number): void;
	getFocusedPane(workspaceId: string): Pane | null;

	addTabToPane(workspaceId: string, paneId: string, tab: TabItem): void;
	removeTabFromPane(workspaceId: string, paneId: string, tabId: string): void;
	moveTabBetweenPanes(workspaceId: string, sourcePaneId: string, targetPaneId: string, tabId: string): void;
	setActiveTabInPane(workspaceId: string, paneId: string, tabId: string): void;
	updateTabTitleInPane(tabId: string, title: string): void;

	// Find which pane contains a given tab
	findPaneForTab(workspaceId: string, tabId: string): Pane | null;

	// Persistence
	hydrateLayout(workspaceId: string, layout: LayoutNode): void;
	clearLayout(workspaceId: string): void;
	resetCounters(maxPaneId: number, maxSplitId: number): void;
}
```

Key implementation details:
- `splitPane()`: Find the target pane in the tree, replace it with a SplitNode whose children are the original pane and a new empty pane. If `tabToMove` is provided, remove it from the original pane and add it to the new pane.
- `closePane()`: Find the pane's parent SplitNode, replace the SplitNode with the sibling. If the pane is the root, don't close it.
- `removePaneFromTree()`: When removing a pane, its sibling promotes up to replace the parent split. Return null if root pane is the target (can't remove).
- All mutations produce new objects (immutable tree updates for Zustand).
- `getAllPanes()` returns panes in DFS order (left child first) for pane indexing.

**Step 4: Run tests to verify they pass**

Run: `bun test tests/pane-store.test.ts`
Expected: PASS

**Step 5: Run type-check**

Run: `bun run type-check`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/stores/pane-store.ts apps/desktop/tests/pane-store.test.ts
git commit -m "feat(store): add pane layout store with tree operations and tests"
```

---

## Task 3: Create LayoutRenderer Component

**Files:**
- Create: `apps/desktop/src/renderer/components/panes/LayoutRenderer.tsx`
- Create: `apps/desktop/src/renderer/components/panes/PaneContainer.tsx`
- Create: `apps/desktop/src/renderer/components/panes/PaneTabBar.tsx`
- Create: `apps/desktop/src/renderer/components/panes/PaneContent.tsx`

**Step 1: Create LayoutRenderer (recursive)**

This component takes a `LayoutNode` and recursively renders:
- `SplitNode` → `<PanelGroup direction={...}>` with two `<Panel>` children and a `<PanelResizeHandle>`
- `Pane` → `<PaneContainer>`

```tsx
// LayoutRenderer.tsx
import { Group, Panel, Separator } from "react-resizable-panels";
import type { LayoutNode } from "../../../shared/pane-types";
import { PaneContainer } from "./PaneContainer";

export function LayoutRenderer({ node, workspaceId, savedScrollback }: {
	node: LayoutNode;
	workspaceId: string;
	savedScrollback: Record<string, string>;
}) {
	if (node.type === "pane") {
		return <PaneContainer pane={node} workspaceId={workspaceId} savedScrollback={savedScrollback} />;
	}

	const orientation = node.direction === "horizontal" ? "horizontal" : "vertical";
	const firstSize = node.ratio * 100;
	const secondSize = (1 - node.ratio) * 100;

	return (
		<Group orientation={orientation}>
			<Panel id={`${node.id}-first`} defaultSize={`${firstSize}%`}>
				<LayoutRenderer node={node.children[0]} workspaceId={workspaceId} savedScrollback={savedScrollback} />
			</Panel>
			<Separator className={orientation === "horizontal" ? "panel-resize-handle" : "panel-resize-handle-vertical"} />
			<Panel id={`${node.id}-second`} defaultSize={`${secondSize}%`}>
				<LayoutRenderer node={node.children[1]} workspaceId={workspaceId} savedScrollback={savedScrollback} />
			</Panel>
		</Group>
	);
}
```

**Step 2: Create PaneContainer**

Wraps a single pane with focus handling, context menu trigger, and drop zone support (drop zones come in Task 7).

```tsx
// PaneContainer.tsx
import type { Pane } from "../../../shared/pane-types";
import { usePaneStore } from "../../stores/pane-store";
import { PaneContent } from "./PaneContent";
import { PaneTabBar } from "./PaneTabBar";

export function PaneContainer({ pane, workspaceId, savedScrollback }: {
	pane: Pane;
	workspaceId: string;
	savedScrollback: Record<string, string>;
}) {
	const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
	const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
	const isFocused = focusedPaneId === pane.id;
	const allPanes = usePaneStore((s) => {
		const layout = s.layouts[workspaceId];
		return layout ? getAllPanes(layout) : [];
	});
	const paneIndex = allPanes.findIndex((p) => p.id === pane.id) + 1;

	return (
		<div
			className={`flex h-full flex-col overflow-hidden ${isFocused ? "ring-1 ring-[var(--accent)]" : ""}`}
			onMouseDown={() => setFocusedPane(pane.id)}
		>
			<PaneTabBar pane={pane} workspaceId={workspaceId} paneIndex={paneIndex} />
			<PaneContent pane={pane} savedScrollback={savedScrollback} />
		</div>
	);
}
```

**Step 3: Create PaneTabBar**

Derived from existing `TabBar.tsx` (lines 107-181) but scoped to a single pane's tabs. Compact 36px height. Shows pane number index. Has "+" button for new terminal.

Key differences from existing TabBar:
- Takes `pane: Pane` prop instead of reading from global store
- Uses `paneStore.addTabToPane()` instead of `tabStore.addTab()`
- Uses `paneStore.setActiveTabInPane()` instead of `tabStore.setActiveTab()`
- Uses `paneStore.removeTabFromPane()` instead of `tabStore.removeTab()`
- Height: 36px instead of 52px
- Shows pane index number on the left

**Step 4: Create PaneContent**

Renders the active tab's content within the pane. Derived from `MainContentArea.tsx` lines 39-87 but scoped to one pane.

```tsx
// PaneContent.tsx — renders terminal or editor for the pane's active tab
import type { Pane } from "../../../shared/pane-types";
import { DiffFileTab } from "../DiffFileTab";
import { FileEditor } from "../FileEditor";
import { PRReviewFileTab } from "../PRReviewFileTab";
import { Terminal } from "../Terminal";

export function PaneContent({ pane, savedScrollback }: {
	pane: Pane;
	savedScrollback: Record<string, string>;
}) {
	const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
	const terminalTabs = pane.tabs.filter((t) => t.kind === "terminal");

	return (
		<div className="relative flex-1 overflow-hidden">
			{pane.tabs.length === 0 && (
				<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
					Empty pane — drag a tab here or press + to create a terminal
				</div>
			)}

			{/* Terminal tabs: always mounted, CSS visibility toggled */}
			{terminalTabs.map((tab) => (
				<div
					key={tab.id}
					className={`absolute inset-0 ${tab.id === pane.activeTabId ? "visible" : "invisible"}`}
				>
					<Terminal
						id={tab.id}
						cwd={tab.kind === "terminal" ? tab.cwd : undefined}
						initialContent={savedScrollback[tab.id]}
					/>
				</div>
			))}

			{/* Non-terminal: mount only if active */}
			{activeTab?.kind === "diff-file" && (
				<div className="absolute inset-0">
					<DiffFileTab
						key={`${activeTab.diffCtx.repoPath}:${activeTab.filePath}`}
						diffCtx={activeTab.diffCtx}
						filePath={activeTab.filePath}
						language={activeTab.language}
					/>
				</div>
			)}
			{activeTab?.kind === "file" && (
				<div className="absolute inset-0">
					<FileEditor
						key={`${activeTab.repoPath}:${activeTab.filePath}`}
						tabId={activeTab.id}
						repoPath={activeTab.repoPath}
						filePath={activeTab.filePath}
						language={activeTab.language}
						initialPosition={activeTab.initialPosition}
					/>
				</div>
			)}
			{activeTab?.kind === "pr-review-file" && (
				<div className="absolute inset-0">
					<PRReviewFileTab
						key={`${activeTab.prCtx.owner}/${activeTab.prCtx.repo}#${activeTab.prCtx.number}:${activeTab.filePath}`}
						prCtx={activeTab.prCtx}
						filePath={activeTab.filePath}
						language={activeTab.language}
					/>
				</div>
			)}
		</div>
	);
}
```

**Step 5: Run type-check**

Run: `bun run type-check`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/panes/
git commit -m "feat(ui): add LayoutRenderer, PaneContainer, PaneTabBar, PaneContent components"
```

---

## Task 4: Integrate Pane Layout into MainContentArea

**Files:**
- Modify: `apps/desktop/src/renderer/components/MainContentArea.tsx` (entire file)
- Modify: `apps/desktop/src/renderer/components/TabBar.tsx` (may become unused for main area)

**Step 1: Rewrite MainContentArea to use LayoutRenderer**

Replace the current flat tab rendering with the recursive layout renderer:

```tsx
// MainContentArea.tsx
import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";
import { LayoutRenderer } from "./panes/LayoutRenderer";

export function MainContentArea({ savedScrollback }: { savedScrollback: Record<string, string> }) {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const layout = usePaneStore((s) =>
		activeWorkspaceId ? s.layouts[activeWorkspaceId] : null
	);
	const ensureLayout = usePaneStore((s) => s.ensureLayout);

	// Ensure a default layout exists for the active workspace
	const effectiveLayout = activeWorkspaceId
		? layout ?? ensureLayout(activeWorkspaceId)
		: null;

	if (!activeWorkspaceId || !effectiveLayout) {
		return (
			<main className="flex h-full min-w-0 items-center justify-center overflow-hidden">
				<div className="text-[13px] text-[var(--text-quaternary)]">
					Select a workspace to open a terminal
				</div>
			</main>
		);
	}

	return (
		<main className="flex h-full min-w-0 flex-col overflow-hidden">
			<LayoutRenderer
				node={effectiveLayout}
				workspaceId={activeWorkspaceId}
				savedScrollback={savedScrollback}
			/>
		</main>
	);
}
```

**Step 2: Verify the app builds**

Run: `bun run type-check`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/MainContentArea.tsx
git commit -m "feat(ui): integrate pane layout renderer into MainContentArea"
```

---

## Task 5: Refactor Tab Store to Delegate to Pane Store

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`
- Modify: `apps/desktop/tests/tab-store.test.ts`

**Step 1: Update tab-store actions to use pane-store**

The tab store needs to bridge existing consumers (WorkspaceItem, CreateWorktreeModal, DiffPanel, etc.) to the new pane store. The key changes:

- `addTerminalTab()`: Create tab, call `paneStore.addTabToPane(workspaceId, focusedPaneId, tab)`
- `removeTab()`: Find which pane has the tab via `paneStore.findPaneForTab()`, then call `paneStore.removeTabFromPane()`
- `setActiveTab()`: Find the pane, call `paneStore.setActiveTabInPane()`
- `addTab()`: Same pattern — add to focused pane
- `openDiffFile()`, `openFile()`, `openPRReviewFile()`: Find or create tab in focused pane
- `updateTabTitle()`: Delegate to `paneStore.updateTabTitleInPane()`
- `getVisibleTabs()`: Return all tabs across all panes for the active workspace (for backwards compatibility with things like session save)
- `hydrate()`: Build a single-pane layout from restored sessions

Keep `activeWorkspaceId`, `activeWorkspaceCwd`, `diffMode`, `rightPanel` in tab-store (these are UI-level, not pane-level).

Remove `tabs: TabItem[]` and `activeTabId` from tab-store state (now in pane-store).

**Step 2: Update tab-store tests**

The existing tests in `tests/tab-store.test.ts` need minor updates since tabs are now in the pane store. Some tests may need to reset the pane store too. The `resetStore()` helper needs to also reset pane-store.

**Step 3: Run all tests**

Run: `bun test`
Expected: PASS

**Step 4: Run type-check**

Run: `bun run type-check`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts apps/desktop/tests/tab-store.test.ts
git commit -m "refactor(store): delegate tab operations from tab-store to pane-store"
```

---

## Task 6: Add Vertical Resize Handle CSS

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css:181-206`

**Step 1: Add vertical resize handle styles**

The existing `.panel-resize-handle` is styled for horizontal orientation (column resize). Add a vertical variant for horizontal split handles:

```css
/* After existing .panel-resize-handle rules (~line 206) */

.panel-resize-handle-vertical {
	position: relative;
	height: 1px;
	background: var(--border-subtle);
	transition: background-color var(--transition-fast);
}

.panel-resize-handle-vertical::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	top: -2px;
	height: 5px;
	cursor: row-resize;
}

.panel-resize-handle-vertical[data-separator="hover"] {
	background: var(--text-quaternary);
}

.panel-resize-handle-vertical[data-separator="active"] {
	background: var(--accent);
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "style: add vertical panel resize handle CSS"
```

---

## Task 7: Add Context Menu for Split Actions

**Files:**
- Create: `apps/desktop/src/renderer/components/panes/PaneContextMenu.tsx`
- Modify: `apps/desktop/src/renderer/components/panes/PaneTabBar.tsx` (add right-click handler)
- Modify: `apps/desktop/src/renderer/components/panes/PaneContainer.tsx` (add right-click handler on background)

**Step 1: Create PaneContextMenu**

A simple context menu component with "Split Right" and "Split Down" options. Use a `<div>` positioned at mouse coordinates with click-outside-to-close.

```tsx
export function PaneContextMenu({ x, y, onSplitRight, onSplitDown, onClose }: {
	x: number;
	y: number;
	onSplitRight: () => void;
	onSplitDown: () => void;
	onClose: () => void;
}) { ... }
```

**Step 2: Wire context menu to PaneTabBar and PaneContainer**

- Right-click on a tab pill: show context menu with split options (the clicked tab moves to the new pane)
- Right-click on pane background: show context menu with split options (creates new terminal in the new pane)

Both call `paneStore.splitPane(workspaceId, paneId, direction, tabToMove)`.

**Step 3: Verify manually** (run `bun run dev` and test)

**Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/panes/
git commit -m "feat(ui): add context menu for split right/down on tabs and panes"
```

---

## Task 8: Add Keyboard Shortcuts

**Files:**
- Create: `apps/desktop/src/renderer/hooks/usePaneShortcuts.ts`
- Modify: `apps/desktop/src/renderer/App.tsx` (mount the hook)

**Step 1: Create usePaneShortcuts hook**

```typescript
import { useEffect } from "react";
import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";

export function usePaneShortcuts() {
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const meta = e.metaKey || e.ctrlKey;

			// Cmd+\ — split right
			if (meta && !e.shiftKey && e.key === "\\") { ... }
			
			// Cmd+Shift+\ — split down
			if (meta && e.shiftKey && e.key === "\\") { ... }

			// Cmd+1-9 — focus pane by index
			if (meta && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") { ... }

			// Cmd+Option+Arrow — directional focus
			if (meta && e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { ... }

			// Cmd+Shift+]/[ — cycle tabs within focused pane
			if (meta && e.shiftKey && (e.key === "]" || e.key === "[")) { ... }
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);
}
```

**Step 2: Mount in App.tsx**

Add `usePaneShortcuts()` call in the `App` component.

**Step 3: Note on Cmd+1-9 conflict**

Check if Cmd+1-9 is already used for anything. If so, use a different modifier (e.g., Cmd+Option+1-9). The tab-bar currently has no numbered shortcuts, so Cmd+1-9 should be available.

**Step 4: Commit**

```bash
git add apps/desktop/src/renderer/hooks/usePaneShortcuts.ts apps/desktop/src/renderer/App.tsx
git commit -m "feat(shortcuts): add keyboard shortcuts for pane split, focus, and tab cycling"
```

---

## Task 9: Add Drag-to-Edge Tab Splitting

**Files:**
- Create: `apps/desktop/src/renderer/components/panes/DropZoneOverlay.tsx`
- Modify: `apps/desktop/src/renderer/components/panes/PaneTabBar.tsx` (make tab pills draggable)
- Modify: `apps/desktop/src/renderer/components/panes/PaneContainer.tsx` (add drop zone overlay)

**Step 1: Make tab pills draggable**

Add `draggable` attribute to TabPill, set `dataTransfer` with tab ID and source pane ID on `dragstart`.

**Step 2: Create DropZoneOverlay**

Renders during a drag event. Shows 4 edge zones (left/right/top/bottom at 25% each) and a center zone. Uses `onDragOver` + `onDrop` to determine the split direction or tab move.

```tsx
export function DropZoneOverlay({ paneId, workspaceId, onDrop }: {
	paneId: string;
	workspaceId: string;
	onDrop: (zone: "left" | "right" | "top" | "bottom" | "center", tabId: string, sourcePaneId: string) => void;
}) {
	// State: which zone is hovered
	// Render: 5 drop zones with visual feedback
	// On drop: parse dataTransfer, call onDrop with zone info
}
```

**Step 3: Wire drop zones in PaneContainer**

When a tab is dropped:
- `center` → `paneStore.moveTabBetweenPanes(sourcePane, targetPane, tabId)`
- `left`/`right` → `paneStore.splitPane(targetPane, "horizontal", tab)` (left puts new pane first)
- `top`/`bottom` → `paneStore.splitPane(targetPane, "vertical", tab)` (top puts new pane first)

**Step 4: Add drop zone CSS to styles.css**

```css
.drop-zone-highlight {
	background: rgba(10, 132, 255, 0.15);
	border: 1px dashed var(--accent);
	border-radius: 4px;
	pointer-events: auto;
	transition: opacity 80ms;
}

.drop-zone-center-highlight {
	background: rgba(10, 132, 255, 0.08);
	border: 1px dashed var(--accent);
	border-radius: 4px;
}
```

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/panes/ apps/desktop/src/renderer/styles.css
git commit -m "feat(ui): add drag-to-edge tab splitting with drop zone overlays"
```

---

## Task 10: Add Database Migration for Pane Layouts

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts` (add `paneLayouts` table)
- Create migration via: `bun run db:generate`

**Step 1: Add paneLayouts table to schema**

Add to `schema.ts` after the `sessionState` table:

```typescript
export const paneLayouts = sqliteTable("pane_layouts", {
	workspaceId: text("workspace_id")
		.primaryKey()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	layout: text("layout").notNull(), // JSON serialized layout tree
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type PaneLayout = typeof paneLayouts.$inferSelect;
export type NewPaneLayout = typeof paneLayouts.$inferInsert;
```

**Step 2: Generate migration**

Run: `bun run db:generate`
Expected: Creates a new migration file `0009_*.sql` with `CREATE TABLE pane_layouts`

**Step 3: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/migrations/
git commit -m "feat(db): add pane_layouts table for per-workspace layout persistence"
```

---

## Task 11: Add Persistence Layer for Pane Layouts

**Files:**
- Modify: `apps/desktop/src/main/db/session-persistence.ts`
- Modify: `apps/desktop/src/main/trpc/routers/terminal-sessions.ts`
- Modify: `apps/desktop/src/renderer/App.tsx:21-40` (update `collectSnapshot`)
- Modify: `apps/desktop/src/renderer/App.tsx:57-80` (update restore logic)

**Step 1: Add pane layout save/restore to session-persistence.ts**

```typescript
// Add to saveTerminalSessions or create separate function
export function savePaneLayouts(layouts: Record<string, string>): void {
	const db = getDb();
	const now = new Date();
	db.transaction((tx) => {
		for (const [workspaceId, layoutJson] of Object.entries(layouts)) {
			tx.insert(schema.paneLayouts)
				.values({ workspaceId, layout: layoutJson, updatedAt: now })
				.onConflictDoUpdate({
					target: schema.paneLayouts.workspaceId,
					set: { layout: layoutJson, updatedAt: now },
				})
				.run();
		}
	});
}
```

**Step 2: Add restore query to terminal-sessions router**

Update the `restore` procedure to also return saved pane layouts:

```typescript
const layoutRows = db.select().from(schema.paneLayouts).all();
const paneLayouts: Record<string, string> = {};
for (const row of layoutRows) {
	paneLayouts[row.workspaceId] = row.layout;
}
return { sessions, state, paneLayouts };
```

**Step 3: Update save input schema**

Add `paneLayouts: z.record(z.string(), z.string()).optional()` to the save input.

**Step 4: Update collectSnapshot in App.tsx**

Serialize each workspace's layout tree from the pane store and include in the snapshot.

**Step 5: Update restore logic in App.tsx**

After hydrating tabs, deserialize pane layouts and hydrate the pane store.

**Step 6: Run type-check and test**

Run: `bun run type-check && bun test`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/main/db/session-persistence.ts apps/desktop/src/main/trpc/routers/terminal-sessions.ts apps/desktop/src/renderer/App.tsx
git commit -m "feat(persistence): save and restore pane layouts per workspace"
```

---

## Task 12: Update Workspace Switching

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts` (setActiveWorkspace)
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx` (if it creates initial tabs)

**Step 1: Update setActiveWorkspace**

When switching workspaces, the pane store already has the layout for the target workspace (or creates a default). Ensure `focusedPaneId` is updated to the first pane of the new workspace's layout.

**Step 2: Update WorkspaceItem initial terminal creation**

Currently `WorkspaceItem.tsx` calls `addTerminalTab()`. This should now go through the pane store to add the terminal to the workspace's first pane.

**Step 3: Run type-check**

Run: `bun run type-check`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/renderer/stores/ apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat: update workspace switching to use pane layouts"
```

---

## Task 13: Update External Tab Consumers

**Files:**
- Audit and modify all files that call `useTabStore` for tab operations

**Step 1: Find all consumers**

Search for `addTerminalTab`, `addTab`, `removeTab`, `setActiveTab`, `openDiffFile`, `openFile`, `openPRReviewFile` usage across the renderer.

Key files to check:
- `components/WorkspaceItem.tsx` — creates initial terminal
- `components/CreateWorktreeModal.tsx` — creates terminal for new worktree
- `components/DiffPanel.tsx` — opens diff file tabs
- `components/Sidebar.tsx` — may switch tabs
- Any component calling `useTabStore` tab operations

**Step 2: Update each consumer**

Most consumers should work unchanged if tab-store delegates to pane-store internally. But verify each one:
- `addTerminalTab()` → should add to focused pane (handled by tab-store bridge)
- `openDiffFile()` / `openFile()` → should open in focused pane (handled by tab-store bridge)
- `removeTab()` → should remove from the correct pane (handled by tab-store bridge)

**Step 3: Run type-check and lint**

Run: `bun run type-check && bun run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: update all tab consumers to work with pane layout system"
```

---

## Task 14: Run Full Test Suite and Fix Issues

**Files:** Various

**Step 1: Run all tests**

Run: `bun test`
Expected: PASS (fix any failures)

**Step 2: Run type-check**

Run: `bun run type-check`
Expected: PASS (fix any type errors)

**Step 3: Run lint**

Run: `bun run lint`
Expected: PASS (fix any lint issues)

**Step 4: Run format**

Run: `bun run check`
Expected: PASS

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test failures and type errors from pane layout integration"
```

---

## Task 15: Manual Testing Checklist

This task is for manual verification. Run `bun run dev` and test:

1. [ ] App starts with single pane (backward compatible with no saved layout)
2. [ ] Right-click tab → "Split Right" creates horizontal split
3. [ ] Right-click tab → "Split Down" creates vertical split
4. [ ] Each pane has its own tab bar with independent active tab
5. [ ] "+" button in each pane creates a new terminal in that pane
6. [ ] Closing last tab in a pane removes the pane and promotes sibling
7. [ ] Resize handles work between panes (drag to resize)
8. [ ] Double-click resize handle resets to 50/50
9. [ ] Cmd+\\ splits focused pane right
10. [ ] Cmd+Shift+\\ splits focused pane down
11. [ ] Cmd+1/2/3 focuses panes by index
12. [ ] Cmd+Option+Arrow moves focus directionally
13. [ ] Focused pane has accent border
14. [ ] Drag tab to another pane's edge creates a split
15. [ ] Drag tab to another pane's center moves it
16. [ ] Switch workspaces — each workspace has its own layout
17. [ ] Restart app — pane layouts are restored
18. [ ] Terminal resize (xterm FitAddon) works correctly in all pane sizes
19. [ ] File editor tabs work in any pane
20. [ ] Diff file tabs work in any pane
