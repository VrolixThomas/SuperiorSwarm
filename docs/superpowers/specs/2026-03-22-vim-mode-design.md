# Vim Mode for Monaco Editors

## Overview

Add native vim keybinding support to all Monaco editor instances in BranchFlux using the `monaco-vim` library. Vim mode is controlled by a single global toggle in the Settings panel, persisted across app restarts.

## Scope

**In scope:**
- Vim mode in `FileEditor` (standalone code editor)
- Vim mode in `DiffEditor` (modified side of diff views, including PR review)
- Global on/off toggle in Settings UI
- Vim status bar (mode indicator + command line) below each editor
- Persistence via `sessionState` table

**Out of scope:**
- Terminal emulator (xterm.js) — vim already works natively in the terminal
- Textareas (commit messages, review comments, PR comments)
- Text inputs (search fields, branch names, clone URLs)
- Custom vim keybinding configuration or vimrc support
- Extended vim features beyond what `monaco-vim` provides

## Architecture

### Persistence

Use the existing `sessionState` key-value table:
- Key: `"vimMode"`
- Value: `"true"` or `"false"` (default: `"false"`)

Exposed via tRPC procedures on the existing `session` router (or a minimal new `editorSettings` router):
- `editorSettings.getVimMode` — query returning boolean
- `editorSettings.setVimMode` — mutation accepting boolean

### Renderer State

A new Zustand store `useEditorSettingsStore` in `src/renderer/stores/editor-settings.ts`:

```typescript
interface EditorSettingsStore {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
}
```

On app startup, the store is hydrated from the tRPC query. When toggled, it:
1. Updates local Zustand state (immediate UI response)
2. Fires the tRPC mutation (async persistence)

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

1. Same status bar pattern below the diff editor container
2. Attach vim mode to `editor.getModifiedEditor()` — this returns an `ICodeEditor` compatible with `initVimMode()`
3. Original side remains read-only (no vim attachment needed)
4. Same dynamic toggle and cleanup lifecycle as FileEditor

**PRReviewFileTab (`src/renderer/components/PRReviewFileTab.tsx`):**

No changes needed — it uses `DiffEditor` which handles vim internally.

### Settings UI

New "Editor" section in `SettingsView.tsx`, positioned between "Integrations" and "AI Code Review":

- Section header: `EDITOR` (matching existing uppercase label style)
- Single row: "Vim Mode" label, "Vim keybindings in code editors" description, toggle switch
- Toggle switch uses the same component pattern as existing toggles (round slider, accent color when on)
- Toggle calls `setVimEnabled()` on the store, which handles persistence

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
Settings Toggle
    ↓
useEditorSettingsStore.setVimEnabled(true)
    ↓ (zustand)                    ↓ (tRPC mutation)
FileEditor / DiffEditor           sessionState table
subscribes to vimEnabled           key="vimMode" value="true"
    ↓
initVimMode(editor, statusBar)
    ↓
monaco-vim attaches keybindings
status bar shows "-- NORMAL --"
```

## Dependencies

- `monaco-vim` — npm package, ~25KB. Purpose-built vim emulation for Monaco Editor.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/renderer/stores/editor-settings.ts` | Create | Zustand store for vim toggle state |
| `src/renderer/components/FileEditor.tsx` | Modify | Add vim mode attachment and status bar |
| `src/renderer/components/DiffEditor.tsx` | Modify | Add vim mode on modified editor and status bar |
| `src/renderer/components/SettingsView.tsx` | Modify | Add "Editor" section with vim toggle |
| `src/main/trpc/routers/editor-settings.ts` | Create | tRPC router for vim setting CRUD |
| `src/main/trpc/index.ts` | Modify | Register new router |
| `package.json` | Modify | Add `monaco-vim` dependency |

## Edge Cases

- **Editor recreation:** When content/language changes cause model recreation in FileEditor, the vim mode instance stays attached to the editor (not the model). No re-initialization needed.
- **DiffEditor model swap:** Same as above — vim attaches to the editor instance, not the model.
- **Multiple editors open:** Each editor manages its own `VimMode` instance independently. The status bar reflects the focused editor's state.
- **Vim `:w` command:** `monaco-vim` fires a save event. FileEditor already has auto-save on content change, so `:w` will trigger the existing save debounce naturally.
- **Vim `:q` command:** Could be wired to close the current tab. Initially, leave unhandled (noop). Can be added later if desired.
