# File Tab Persistence Across Refreshes

## Problem

Pane layouts persist across app refreshes, but only terminal tabs survive. File tabs (diff-file, file, pr-review-file) are lost because they are never serialized. This leaves behind empty panes in the restored layout.

## Root Cause

`SerializedPane` stores `tabIds: string[]` — just IDs, not tab data. On restore, `deserializeLayout` resolves IDs against restored tabs, but only terminal tabs exist (from `terminal_sessions` table). File tab IDs resolve to nothing and are silently dropped.

## Solution

Embed full `TabItem` objects in the serialized layout JSON instead of bare IDs.

### Type Change

`pane-types.ts` — `SerializedPane`:

```ts
// Before
interface SerializedPane {
  type: "pane";
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

// After
interface SerializedPane {
  type: "pane";
  id: string;
  tabs: TabItem[];
  activeTabId: string | null;
}
```

### Serialization (`App.tsx` — `serializeLayout`)

Replace `tabIds: node.tabs.map(t => t.id)` with `tabs: node.tabs`. Strip `initialPosition` from `file` tabs during serialization since it is a one-shot navigation hint that becomes stale.

`collectSnapshot()` calls `serializeLayout` — no additional changes needed there.

### Deserialization (`App.tsx` — `deserializeLayout`)

New signature:

```ts
function deserializeLayout(
  node: SerializedLayoutNode,
  terminalSessionMap: Map<string, TabItem>
): LayoutNode | null
```

Per-tab logic:
- **Terminal tabs** (`kind === "terminal"`): Replace with the entry from `terminalSessionMap` (which has fresh `cwd`, `title` from the backend). If the session no longer exists, drop the tab.
- **File tabs** (`kind === "diff-file" | "file" | "pr-review-file"`): Use directly from serialized data.
- **Empty panes**: Return `null` so the existing split-node collapsing logic removes them from the tree.

### Backward Compatibility

Old serialized layouts use `tabIds: string[]`. On deserialization, detect the old format (`"tabIds" in node`) and fall back to the current lookup-based approach (matching IDs against terminal sessions only). This gracefully degrades — old layouts lose file tabs (same as today), new layouts preserve them.

### File Tab ID Counter Reset

`fileTabCounter` in `tab-store.ts` is never reset after restore, risking ID collisions with restored file tabs. Add counter extraction in `extractMaxIds` (or a sibling function) to scan restored tabs for `file-tab-N` IDs and reset `fileTabCounter` to the max value. Expose a `resetFileTabCounter(max: number)` or extend the existing counter reset mechanism.

### Restore Flow (`App.tsx` — `useEffect`)

1. `tab-store.hydrate()` runs first (creates terminal tabs, populates single-pane layouts per workspace).
2. Build `Map<string, TabItem>` from the hydrated terminal sessions.
3. For each saved pane layout, call `deserializeLayout(serialized, terminalSessionMap)`.
4. `hydrateLayout()` overwrites the single-pane layout from step 1 with the deserialized multi-pane layout.
5. Reset pane/split counters (existing) AND file tab counter (new).

### No Backend Changes

`pane_layouts` table stores opaque JSON text. The JSON payload grows slightly — a few hundred bytes to low KB per tab depending on context metadata.

## Files Changed

1. `src/shared/pane-types.ts` — `SerializedPane` type
2. `src/renderer/App.tsx` — `serializeLayout`, `deserializeLayout`, restore `useEffect`, counter reset
3. `src/renderer/stores/tab-store.ts` — expose `fileTabCounter` reset (new export or extend existing mechanism)

## Not In Scope

- Caching file content (tabs re-fetch on mount)
- Persisting scroll position within file tabs
- New DB tables or migrations
- Refreshing stale PR/diff metadata on restore (titles, branch names may drift — acceptable since content is re-fetched)
