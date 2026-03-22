# Vim Mode for Monaco Editors

## Overview

Add native vim keybinding support to all Monaco editor instances in BranchFlux using the `monaco-vim` library. Vim mode is controlled by a single global toggle in the Settings panel, persisted across app restarts.

## Scope

**In scope:**
- Vim mode in `FileEditor` (standalone code editor)
- Vim mode in `DiffEditor` (modified side of diff views, including PR review and branch/working-tree diffs)
- Global on/off toggle in Settings UI
- Vim status bar (mode indicator + command line) below each editor
- Persistence via existing `sessionState` save cycle

**Out of scope:**
- Terminal emulator (xterm.js) — vim already works natively in the terminal
- Textareas (commit messages, review comments, PR comments)
- Text inputs (search fields, branch names, clone URLs)
- Custom vim keybinding configuration or vimrc support
- Extended vim features beyond what `monaco-vim` provides

## Architecture

### Persistence

Integrate into the existing `sessionState` periodic save cycle in `App.tsx`. The `collectSnapshot()` function builds a `state` key-value map from Zustand stores which is atomically written to the `sessionState` table every 30 seconds (and on quit). Adding vim mode follows this established pattern:

- `collectSnapshot()` reads `vimEnabled` from the `useEditorSettingsStore` and writes `state["vimMode"] = "true"` (or omits the key when false)
- On restore, `hydrate()` reads `state["vimMode"]` and sets the store value

This requires **no new tRPC router or backend code**. The setting piggybacks on the existing session persistence infrastructure, just like `baseBranchByWorkspace`, `sidebarSegment`, and other renderer-side state.

### Renderer State

A new Zustand store `useEditorSettingsStore` in `src/renderer/stores/editor-settings.ts`:

```typescript
interface EditorSettingsStore {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
}
```

**Hydration timing:** The store is hydrated during the existing session restore flow in `App.tsx`. The `restoreQuery` returns all `sessionState` rows, and `hydrate()` already processes them. The vim mode value is read from `state["vimMode"]` alongside all other session state. Since editors don't mount until after the restore completes (the app shows a loading state until then), there is no flash of incorrect vim state.

All Monaco editor components subscribe to `vimEnabled` from this store.

### Monaco Vim Integration

**Library:** `monaco-vim` (npm package)

**FileEditor (`src/renderer/components/FileEditor.tsx`):**

1. Layout changes: wrap editor div and status bar div in a flex column container
2. Status bar: a `<div>` rendered below the editor container, only when `vimEnabled` is true
3. Vim attachment: after `monaco.editor.create()`, if `vimEnabled`, call `initVimMode(editor, statusBarElement)`. Store the returned `VimMode` instance in a ref
4. Dynamic toggle: when `vimEnabled` changes, dispose existing `VimMode` (if any) and re-attach (or not). No editor recreation needed
5. Cleanup: dispose `VimMode` on component unmount

**DiffEditor (`src/renderer/components/DiffEditor.tsx`):**

1. Wrap the editor div and a status bar div in a flex column container (same pattern as FileEditor)
2. Status bar: a `<div>` rendered below the diff editor container, only when `vimEnabled` is true
3. Attach vim mode to `editor.getModifiedEditor()` — this returns an `ICodeEditor` compatible with `initVimMode()`. The modified editor sub-instance is stable across `setModel()` calls, so vim mode survives model swaps without re-initialization
4. Original side remains read-only (no vim attachment needed)
5. Same dynamic toggle and cleanup lifecycle as FileEditor

**Consumers of DiffEditor:**

- `PRReviewFileTab.tsx` — uses DiffEditor for PR review diffs. No changes needed since vim is handled inside DiffEditor itself
- `DiffFileTab.tsx` — uses DiffEditor for branch/working-tree diffs. No changes needed for the same reason

### Settings UI

New "Editor" section in `SettingsView.tsx`, positioned between the "Integrations" section and the "AI Code Review" section inside the existing `overflow-y-auto` scrollable area:

- Section header: `EDITOR` (matching existing uppercase label style)
- Single row: "Vim Mode" label, "Vim keybindings in code editors" description, toggle switch
- Toggle switch uses the same component pattern as existing toggles (round slider, accent color when on)
- Toggle calls `setVimEnabled()` on the store; persistence happens automatically via the periodic save cycle

### Status Bar Styling

The vim status bar rendered below each Monaco editor:

- Height: `20px`
- Background: `var(--bg-elevated)`
- Top border: `1px solid var(--border)`
- Font: `'SF Mono', 'JetBrains Mono', 'Fira Code', monospace` at `11px`
- Text color: `var(--text-secondary)` for mode indicator, `var(--text-tertiary)` for command input
- Padding: `0 8px`
- Only rendered when `vimEnabled` is true

`monaco-vim` renders mode text (`-- INSERT --`, `-- VISUAL --`, etc.) and the ex command line (`:w`, `/search`, etc.) into this element automatically.

## Data Flow

```
Settings Toggle (SettingsView)
    ↓
useEditorSettingsStore.setVimEnabled(true)
    ↓ (zustand subscription)              ↓ (periodic save cycle)
FileEditor / DiffEditor                  collectSnapshot() → sessionState table
subscribes to vimEnabled                  state["vimMode"] = "true"
    ↓
initVimMode(editor, statusBar)
    ↓
monaco-vim attaches keybindings
status bar shows "-- NORMAL --"

On app restart:
sessionState restore → state["vimMode"] → hydrate store → editors read vimEnabled
```

## Dependencies

- `monaco-vim` — npm package, ~25KB. Purpose-built vim emulation for Monaco Editor. Install in `apps/desktop/package.json` alongside the existing `monaco-editor` dependency.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/renderer/stores/editor-settings.ts` | Create | Zustand store for vim toggle state |
| `src/renderer/components/FileEditor.tsx` | Modify | Add vim mode attachment and status bar |
| `src/renderer/components/DiffEditor.tsx` | Modify | Add vim mode on modified editor and status bar |
| `src/renderer/components/SettingsView.tsx` | Modify | Add "Editor" section with vim toggle |
| `src/renderer/App.tsx` | Modify | Add vimMode to collectSnapshot() and hydrate flow |
| `apps/desktop/package.json` | Modify | Add `monaco-vim` dependency |

## Edge Cases

- **Editor recreation:** When content/language changes cause model recreation in FileEditor, the vim mode instance stays attached to the editor (not the model). No re-initialization needed.
- **DiffEditor model swap:** The modified editor sub-instance returned by `getModifiedEditor()` is stable across `setModel()` calls on the diff editor, so the vim mode instance persists across model swaps without re-initialization.
- **Multiple editors open:** Each editor manages its own `VimMode` instance independently. The status bar reflects the focused editor's state.
- **Vim `:w` command:** `monaco-vim` fires a custom save event, not a Monaco content change event. Since FileEditor already auto-saves on every keystroke with a 500ms debounce, the file is always saved. The `:w` command is effectively a noop. If explicit `:w` handling is desired later, it can be wired via `Vim.defineEx`.
- **Vim `:q` command:** Left unhandled (noop). Could be wired to close the current tab in a future iteration.
- **PR review DiffEditor:** In `PRReviewFileTab`, the DiffEditor is used without `onModifiedChange`, meaning vim edit commands (like `dd`, `x`) would mutate the in-memory buffer but nothing persists. This is harmless — the buffer resets on tab switch. The original diff content is read-only on the left side. If this becomes confusing, a future enhancement could make the DiffEditor read-only when no `onModifiedChange` is provided.
