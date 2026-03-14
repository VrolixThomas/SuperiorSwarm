# Files Tab Redesign

## Goal

Replace the bare-bones file explorer in the right panel's Files tab with a polished, feature-rich tree view that matches the quality of the Changes tab redesign.

## Current Problems

- No file/folder icons — plain text list with no visual differentiation
- No search capability
- No compact folder chains (deeply nested single-child dirs waste space)
- No git status indicators (have to switch to Changes tab to see what's modified)
- No context menu, no keyboard navigation, no breadcrumbs
- Visually flat — no indent guides, no hierarchy cues beyond indentation

## Design

### Component Structure

Complete rewrite of `RepoFileTree.tsx`. The Files tab layout becomes:

```
+----------------------------------+
| [Search bar]            Cmd+F    |
+----------------------------------+
| src > renderer > App.tsx         |  <- Breadcrumb (active file path)
+----------------------------------+
| [Compact] [Expand All] [Collapse]|  <- Toolbar
+----------------------------------+
| > src/renderer/components/       |  <- Compact folder chain
|   > BranchChanges.tsx  M  ●      |  <- File with git status dot
|   > CommittedStack.tsx            |
|   > DiffPanel.tsx      M  ●      |
| > src/main/                      |
|   ...                            |
| .gitignore                       |
| package.json           M  ●      |
| README.md              A  ●      |
+----------------------------------+
```

### 1. Fuzzy Search

- Fixed at top of the tree panel
- Subsequence matching: "brch" matches "**Br**an**ch**Changes.tsx"
- Algorithm: iterate through query chars, match in order against full file path. Score by consecutive matches and match position
- Always shows full tree (no filtering) — search jumps to matches
- Enter = next match, Shift+Enter = previous match
- Auto-expands parent folders to reveal matched file
- Highlights matched characters in filename with `--accent` color
- Shows "N of M" counter in search bar
- Cmd+F focuses search from anywhere in the panel

### 2. Breadcrumb Bar

- Shows path segments of the currently active file in the editor
- Each segment clickable — scrolls tree to that folder and expands it
- Segments separated by `>` chevrons in `--text-quaternary`
- Active segment (filename) in `--text-secondary`
- Hidden when no file is open (saves space)
- Data source: `activeTab` from tab-store

### 3. Toolbar

Three icon buttons in a compact row:
- **Compact toggle** — collapses/expands single-child directory chains
- **Expand all** — expands every folder in the tree
- **Collapse all** — collapses every folder in the tree

### 4. Compact Folders

- Single-child directory chains collapsed into one node: `src/renderer/components` as one row
- Toggle via toolbar button, state persisted in component
- When compact is on, a chain like `src/ > renderer/ > components/` renders as a single `src/renderer/components/` node with the folder icon
- Expanding a compact node reveals its children normally

### 5. File Type Icons

Inline SVG icons with language-specific colors:

| Extension | Color | Icon |
|-----------|-------|------|
| `.ts/.tsx` | #3178c6 (blue) | TypeScript file |
| `.js/.jsx` | #f7df1e (yellow) | JavaScript file |
| `.json` | #69db7c (term-green) | JSON file |
| `.css` | #a855f6 (purple) | Style file |
| `.md` | #f5f5f7 (text) | Markdown file |
| `.html` | #e34c26 (orange) | HTML file |
| Directories | --text-quaternary | Folder (open/closed) |
| Default | --text-quaternary | Generic file |

Icons are small (12x12) inline SVGs, positioned before the filename.

### 6. Git Status Dots

- Small colored dot after the filename for files with git changes
- Same color scheme as Changes tab: green (added), yellow (modified), red (deleted)
- Data source: `getWorkingTreeStatus` query (already exists) — map file paths to status
- Dots propagate to parent folders: if any child is modified, the folder shows a dot too

### 7. Right-Click Context Menu

Custom-positioned context menu with:
- **Copy path** — absolute path to clipboard
- **Copy relative path** — relative to repo root
- **Reveal in Finder** — uses `shell.showItemInFinder` via preload bridge
- **Open in terminal** — focuses workspace terminal and runs `cd` to the directory

Menu styled with `--bg-elevated` background, `--border` border, `--radius-md` rounding, `--shadow-md` drop shadow. Items are `12px` text with `120ms` hover transition.

### 8. Keyboard Navigation

- Arrow up/down: move focus through visible (expanded) nodes
- Right arrow: expand folder, or move to first child if already expanded
- Left arrow: collapse folder, or move to parent if already collapsed or is a file
- Enter: open file in editor / toggle folder
- Home/End: jump to first/last visible node
- Focus indicator: subtle `--accent` outline ring on focused node

### 9. Indent Guides

Subtle 1px vertical lines in `--border-subtle` connecting parent-child relationships. Lines align with the expand/collapse chevrons. Guides help track hierarchy in deeply nested trees.

## Visual Style

Consistent with the existing Changes tab dark theme:
- `12px` text for filenames, `11px` for toolbar labels
- `--text-secondary` for files, `--text-tertiary` for folders
- `120ms` transitions on hover states
- `--bg-elevated` for hover and active backgrounds
- `--radius-sm` rounding on row hover/active states
- Row height: compact `py-0.5` for dense information display

## Data Flow

- File listing: existing `listDirectory` tRPC procedure (lazy-loaded per folder)
- Git status: existing `getWorkingTreeStatus` query, mapped to tree nodes
- File opening: existing `openFile` on tab-store
- Active file: existing `activeTabId` + `tabs` from tab-store
- Context menu actions: preload bridge (`window.electron.shell`)

## Implementation Notes

- The tree needs a flat virtualized list internally for keyboard navigation and search jumping, but can render as nested components visually
- Compact folder logic: walk children — if a directory has exactly one child and that child is also a directory, merge them into a single display node
- Fuzzy search should run client-side against the already-loaded tree data (no new tRPC calls)
- Context menu requires checking what preload bridge methods exist; may need to add `shell.showItemInFinder` if not present
