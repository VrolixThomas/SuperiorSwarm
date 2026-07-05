# Search Everywhere (Double-Shift) — Design

**Date:** 2026-07-05
**Status:** Approved for planning

## Goal

Rider-style "Search Everywhere" popup: double-tap Shift opens a modal search over the active
workspace with tabs **All / Files / Symbols / Text**. Enter opens the result in an editor tab,
jumping to the exact line for symbols and text occurrences.

## Scope

- Trigger: **double Shift** (two clean Shift taps within 400ms).
- Available in **workspace view only** (requires an active workspace / repo path).
- Tabs in v1: **All** (files + symbols merged), **Files**, **Symbols**, **Text**.
- Actions are NOT included (⌘K Command Palette remains separate).
- Approach: lean reuse — no new dependencies, `git grep` text backend behind tRPC
  (swappable for ripgrep later without UI changes).

## Architecture

New pieces, following the existing `CommandPalette` / `BranchPalette` patterns:

| Piece | Location | Role |
|---|---|---|
| `search-everywhere-store.ts` | `apps/desktop/src/renderer/stores/` | zustand: `isOpen`, `activeTab`, `open/close` |
| `SearchEverywherePopup.tsx` | `apps/desktop/src/renderer/components/` | portal overlay UI, tab row, result list |
| `fuzzy-match.ts` | `apps/desktop/src/renderer/utils/` | subsequence scorer for file paths + symbol names |
| Double-Shift detector | `useShortcutListener.ts` | keyup-based double-tap tracking |
| `diff.searchText` proc | `apps/desktop/src/main/trpc/routers/diff.ts` | `git grep` text search |
| `search-text.ts` | `apps/desktop/src/main/git/` | spawns `git grep`, parses output |

Mount `<SearchEverywherePopup />` next to `<CommandPalette />` in `App.tsx`.

## Trigger

- Detection lives in `useShortcutListener`'s existing window keydown/keyup capture scope:
  - On `Shift` keydown: mark "shift press candidate". Any other key pressed while Shift is
    down (i.e. Shift used as a modifier) cancels the candidate.
  - On clean `Shift` keyup: record timestamp. Two clean taps ≤ 400ms apart → toggle popup.
  - Any non-Shift keydown between taps resets the tracker.
  - Held Shift (long press) does not count as a tap.
- Works when terminal/editor/input is focused — Shift alone types nothing, so this bypasses
  `shouldSkipShortcutHandling` deliberately (detector runs before that check, only for Shift keys).
- Gated on `activeWorkspaceId !== null` (workspace view only).
- Also registered as action `general.searchEverywhere` (category General) with
  `displayShortcut: { key: "Shift", shift: true }` so it appears in ⌘K and shortcut settings.
  Add `Shift: "⇧"` to `KEY_SYMBOLS` in `ShortcutBadge.tsx` so the badge renders as ⇧⇧.
  `execute()` opens the popup; the double-tap itself is handled by the detector, not
  shortcut matching.
- Double-Shift while popup open closes it. Esc closes.

## Popup shell

- Portal overlay like `CommandPalette`: scrim, centered panel ~640px wide, max-height 60vh.
- Layout top-to-bottom: tab row (All / Files / Symbols / Text), search input (autofocused),
  scrollable result list, footer bar showing the selected result's full repo-relative path.
- Keyboard: ↑/↓ move selection, Enter opens, Esc closes, **Tab cycles tabs** (Shift+Tab
  reverse), typing filters. Mouse: click row opens, hover selects, click outside closes.
- Query and active tab persist while popup is open; reset to All + empty on reopen.
- Default tab on open: **All**.

## Data sources

### Files
- `trpc.diff.listAllFiles({ repoPath })` (existing, gitignore-aware, cached 60s).
- Client-side fuzzy subsequence match on repo-relative path. Scoring priority:
  filename starts-with > filename substring > filename subsequence > path substring/subsequence;
  shorter paths win ties. ~40 lines, no library.
- Row: `FileIcon` + filename + dimmed directory path.
- Enter → `useTabStore.openFile(wsId, repoPath, path, detectLanguage(path))`
  (same call `RepoFileTree` uses).

### Text
- New proc `diff.searchText({ repoPath, query })`:
  - Runs `git grep -n -I --untracked --fixed-strings` (plus `-i` when the query is
    all-lowercase → smart case).
  - Cap 200 matches; truncate line text to 200 chars server-side.
  - Exit code 1 (no matches) → empty result, not an error. Other failures → error surfaced
    as an inline "search failed" row in the popup.
  - Returns `{ path, line, text }[]` (+ `truncated: boolean`).
- Renderer: min 2 chars, debounce 200ms, stale responses dropped via request counter.
- Row: matched line text with query highlighted + dimmed `path:line`.
- Enter → `openFile(..., { lineNumber, column })` (editor already supports `initialPosition`).

### Symbols
- New tRPC proc `lsp.searchWorkspaceSymbols({ repoPath, query })`: main process fans
  `workspace/symbol` out to all initialized LSP server connections for the repo
  (3s per-server timeout), merges + dedups (name+path+line), caps at 100.
  (Main-side fan-out instead of renderer-side: main owns the connections and the
  config→language mapping.) Renderer debounces 200ms, min 2 chars.
- Server not running / method unsupported / timeout → that server contributes nothing
  (silent). No servers running → Symbols tab shows hint: "No language servers running —
  symbols appear once files are opened in the editor."
- Row: symbol-kind glyph (fn/class/var etc.) + name + dimmed container/path.
- Enter → `openFile` with the returned repo-relative path and 1-based line/column.

### All tab
- Files + symbols merged (text excluded, Rider parity). Ranking: exact filename match >
  exact symbol name match > filename fuzzy score > symbol fuzzy score. Cap ~50 rows.

## Error handling

- Text search process errors → inline error row; never crashes popup.
- LSP requests race a 10s timeout (existing passthrough behavior); rejected promises ignored
  per-server.
- Stale async results (query changed, tab switched, popup closed) discarded via request id.
- Workspace switched while open → popup closes.

## Testing

- `tests/` unit tests (bun test, run per-directory):
  - Double-tap detector: two clean taps → open; Shift+key combo cancels; held Shift no-op;
    >400ms gap no-op; third tap toggles closed.
  - Fuzzy scorer: filename-start beats substring beats path match; tie-break by length.
  - All-tab ranking merge.
  - `search-text` parsing: `git grep` output lines, exit-code-1 handling, cap + truncation
    (fixture repo like existing git tests).
- Manual verify: popup over terminal focus, jump-to-line lands correct line, symbols after
  opening a TS file.

## Out of scope (later increments)

- Actions tab inside Search Everywhere (⌘K already covers actions).
- Ripgrep backend swap (only if `git grep` proves slow on large repos).
- Recent-files boost / usage-based ranking.
- Eager LSP warm-start for symbols on popup open.
- "Include non-solution items"-style toggle (search outside gitignore).
