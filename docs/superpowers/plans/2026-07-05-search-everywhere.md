# Search Everywhere (Double-Shift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-tap Shift opens a Rider-style Search Everywhere popup with All / Files / Symbols / Text tabs over the active workspace; Enter opens the result in an editor tab, jumping to the exact line for symbols and text hits.

**Architecture:** New `SearchEverywherePopup` renderer component + zustand store, modeled on the existing `CommandPalette`. Double-Shift detection is a pure module wired into `useShortcutListener`. Files tab fuzzy-matches the existing `diff.listAllFiles` query client-side. Text tab calls a new `diff.searchText` tRPC proc wrapping `git grep`. Symbols tab calls a new `lsp.searchWorkspaceSymbols` tRPC proc that fans `workspace/symbol` out to running LSP servers in the main process (deviation from spec's renderer-side fan-out: main already owns server connections, so this avoids leaking config→language mapping to the renderer — update the spec in Task 7).

**Tech Stack:** Electron, React 19, TypeScript (strict), zustand, tRPC over IPC, simple-git conventions (but `node:child_process.execFile` for grep exit-code handling), bun test, Biome (tabs, double quotes, width 100).

**Spec:** `docs/superpowers/specs/2026-07-05-search-everywhere-design.md`

## Global Constraints

- Bun only (`bun test`, `bun run type-check`); never npm/yarn.
- Biome style: tabs, double quotes, semicolons, ES5 trailing commas, line width 100.
- Strict TS: `strictNullChecks`, `noUncheckedIndexedAccess` (index access returns `T | undefined` — guard it), `noUnusedLocals`, `noUnusedParameters`.
- Cross-process types go in `apps/desktop/src/shared/`, not inline in process code.
- Renderer↔main only via preload + tRPC (both new procs are tRPC; LSP passthrough already exists in preload).
- Full-suite `bun test` is flaky; run per-file/per-directory (`bun test tests/<file>.test.ts`).
- All paths below are relative to `apps/desktop/` unless stated otherwise. Run all commands from `apps/desktop/`.
- Double-tap window: 400ms. Text search: min 2 chars, 200-match cap, 200-char line cap, smart case. Symbols: min 2 chars, 3s per-server timeout, dedup, 100 cap. All tab: 50 rows, no text results.
- Never add `Co-Authored-By` to commits. Never `--no-verify`.

---

### Task 1: Double-Shift tap detector (pure module)

**Files:**
- Create: `src/renderer/hooks/double-shift-detector.ts`
- Test: `tests/double-shift-detector.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createDoubleShiftDetector(onTrigger: () => void): { keydown(e: DetectorKeyEvent, now: number): void; keyup(e: DetectorKeyEvent, now: number): void }` and `type DetectorKeyEvent = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }`. Task 2 wires it into `useShortcutListener`.

A "clean tap" is Shift pressed and released with no other key involved (no modifier held on press, no other key pressed while Shift is down). Two clean taps whose keyups are ≤400ms apart fire `onTrigger`. The tap state resets after firing so a third tap starts a new sequence.

- [ ] **Step 1: Write the failing test**

Create `tests/double-shift-detector.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
	type DetectorKeyEvent,
	createDoubleShiftDetector,
} from "../src/renderer/hooks/double-shift-detector";

function shift(overrides: Partial<DetectorKeyEvent> = {}): DetectorKeyEvent {
	return { key: "Shift", metaKey: false, ctrlKey: false, altKey: false, ...overrides };
}

function key(k: string): DetectorKeyEvent {
	return { key: k, metaKey: false, ctrlKey: false, altKey: false };
}

function tap(d: ReturnType<typeof createDoubleShiftDetector>, downAt: number, upAt: number) {
	d.keydown(shift(), downAt);
	d.keyup(shift(), upAt);
}

describe("createDoubleShiftDetector", () => {
	test("two clean taps within 400ms trigger", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		tap(d, 200, 250);
		expect(fired).toBe(1);
	});

	test("taps more than 400ms apart do not trigger", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		tap(d, 500, 550);
		expect(fired).toBe(0);
	});

	test("shift used as modifier (other key while held) does not count", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		d.keydown(shift(), 0);
		d.keydown(key("A"), 10);
		d.keyup(shift(), 50);
		tap(d, 100, 150);
		expect(fired).toBe(0);
	});

	test("non-shift key between two taps resets the sequence", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		d.keydown(key("a"), 100);
		tap(d, 200, 250);
		expect(fired).toBe(0);
	});

	test("shift pressed with meta held does not count", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		d.keydown(shift({ metaKey: true }), 0);
		d.keyup(shift({ metaKey: true }), 50);
		tap(d, 100, 150);
		expect(fired).toBe(0);
	});

	test("gap measured between keyups: long-held first tap still chains", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 600); // held 600ms, released at 600
		tap(d, 700, 750); // keyup gap 150ms
		expect(fired).toBe(1);
	});

	test("state resets after firing: four taps fire twice, three fire once", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		tap(d, 100, 150); // fires
		tap(d, 200, 250); // new sequence, pending
		expect(fired).toBe(1);
		tap(d, 300, 350); // fires again
		expect(fired).toBe(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/double-shift-detector.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/hooks/double-shift-detector`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/hooks/double-shift-detector.ts`:

```ts
const DOUBLE_TAP_MS = 400;

export interface DetectorKeyEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
}

export interface DoubleShiftDetector {
	keydown: (e: DetectorKeyEvent, now: number) => void;
	keyup: (e: DetectorKeyEvent, now: number) => void;
}

/**
 * Detects two "clean" Shift taps (no other key involved) whose keyups are
 * ≤ DOUBLE_TAP_MS apart. Timestamps are injected for testability.
 */
export function createDoubleShiftDetector(onTrigger: () => void): DoubleShiftDetector {
	let shiftDown = false;
	let dirty = false;
	let lastTapAt = Number.NEGATIVE_INFINITY;

	return {
		keydown(e, _now) {
			if (e.key === "Shift") {
				if (!shiftDown) {
					shiftDown = true;
					dirty = e.metaKey || e.ctrlKey || e.altKey;
				}
			} else {
				// Any other key taints a held Shift and cancels a pending first tap.
				if (shiftDown) dirty = true;
				lastTapAt = Number.NEGATIVE_INFINITY;
			}
		},
		keyup(e, now) {
			if (e.key !== "Shift") return;
			const wasClean = shiftDown && !dirty;
			shiftDown = false;
			dirty = false;
			if (!wasClean) {
				lastTapAt = Number.NEGATIVE_INFINITY;
				return;
			}
			if (now - lastTapAt <= DOUBLE_TAP_MS) {
				lastTapAt = Number.NEGATIVE_INFINITY;
				onTrigger();
			} else {
				lastTapAt = now;
			}
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/double-shift-detector.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add tests/double-shift-detector.test.ts src/renderer/hooks/double-shift-detector.ts
git commit -m "feat(search): add double-shift tap detector"
```

---

### Task 2: Store, popup shell, trigger wiring

**Files:**
- Create: `src/renderer/stores/search-everywhere-store.ts`
- Create: `src/renderer/components/SearchEverywherePopup.tsx`
- Modify: `src/renderer/hooks/useShortcutListener.ts`
- Modify: `src/renderer/actions/core-actions.ts` (General section, after `general.commandPalette`)
- Modify: `src/renderer/components/ShortcutBadge.tsx` (KEY_SYMBOLS)
- Modify: `src/renderer/App.tsx` (mount next to `<CommandPalette />`, line ~753)

**Interfaces:**
- Consumes: `createDoubleShiftDetector` from Task 1; `useTabStore` (`activeWorkspaceId: string | null`, `activeWorkspaceCwd: string`, `openFile(workspaceId, repoPath, filePath, language, initialPosition?) => string`); `detectLanguage(filePath: string): string` from `src/shared/diff-types.ts`.
- Produces: `useSearchEverywhereStore` — `{ isOpen: boolean; activeTab: SearchTab; open(): void; close(): void; toggle(): void; setActiveTab(tab: SearchTab): void; cycleTab(delta: 1 | -1): void }` with `type SearchTab = "all" | "files" | "symbols" | "text"`; `ResultItem` union + `resultKey()` exported from `SearchEverywherePopup.tsx` — Tasks 4/6/8/9 fill in the per-tab result sources inside this component.

- [ ] **Step 1: Create the store**

Create `src/renderer/stores/search-everywhere-store.ts`:

```ts
import { create } from "zustand";

export type SearchTab = "all" | "files" | "symbols" | "text";

export const SEARCH_TABS: SearchTab[] = ["all", "files", "symbols", "text"];

interface SearchEverywhereStore {
	isOpen: boolean;
	activeTab: SearchTab;
	open: () => void;
	close: () => void;
	toggle: () => void;
	setActiveTab: (tab: SearchTab) => void;
	cycleTab: (delta: 1 | -1) => void;
}

export const useSearchEverywhereStore = create<SearchEverywhereStore>()((set, get) => ({
	isOpen: false,
	activeTab: "all",

	open: () => set({ isOpen: true, activeTab: "all" }),
	close: () => set({ isOpen: false }),
	toggle: () => (get().isOpen ? get().close() : get().open()),
	setActiveTab: (tab) => set({ activeTab: tab }),
	cycleTab: (delta) => {
		const idx = SEARCH_TABS.indexOf(get().activeTab);
		const next = SEARCH_TABS[(idx + delta + SEARCH_TABS.length) % SEARCH_TABS.length];
		if (next) set({ activeTab: next });
	},
}));
```

- [ ] **Step 2: Create the popup shell**

Create `src/renderer/components/SearchEverywherePopup.tsx`. Result list is empty for now; Tasks 4/6/8/9 populate it. Complete file:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { detectLanguage } from "../../shared/diff-types";
import {
	SEARCH_TABS,
	type SearchTab,
	useSearchEverywhereStore,
} from "../stores/search-everywhere-store";
import { useTabStore } from "../stores/tab-store";

const TAB_LABELS: Record<SearchTab, string> = {
	all: "All",
	files: "Files",
	symbols: "Symbols",
	text: "Text",
};

export type ResultItem =
	| { type: "file"; path: string }
	| {
			type: "symbol";
			name: string;
			kind: number;
			path: string;
			line: number;
			column: number;
			container?: string;
	  }
	| { type: "text"; path: string; line: number; text: string };

export function resultKey(item: ResultItem): string {
	switch (item.type) {
		case "file":
			return `file:${item.path}`;
		case "symbol":
			return `symbol:${item.name}:${item.path}:${item.line}`;
		case "text":
			return `text:${item.path}:${item.line}`;
	}
}

function resultPath(item: ResultItem): string {
	return item.type === "text" || item.type === "symbol" ? `${item.path}:${item.line}` : item.path;
}

export function SearchEverywherePopup() {
	const isOpen = useSearchEverywhereStore((s) => s.isOpen);
	const close = useSearchEverywhereStore((s) => s.close);
	const activeTab = useSearchEverywhereStore((s) => s.activeTab);
	const setActiveTab = useSearchEverywhereStore((s) => s.setActiveTab);
	const cycleTab = useSearchEverywhereStore((s) => s.cycleTab);

	const workspaceId = useTabStore((s) => s.activeWorkspaceId);
	const repoPath = useTabStore((s) => s.activeWorkspaceCwd);
	const openFile = useTabStore((s) => s.openFile);

	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Reset on open
	useEffect(() => {
		if (isOpen) {
			setQuery("");
			setSelectedIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [isOpen]);

	// Close if the workspace changes while open
	useEffect(() => {
		if (isOpen && !workspaceId) close();
	}, [isOpen, workspaceId, close]);

	// Per-tab results; populated by later tasks.
	const results: ResultItem[] = useMemo(() => [], []);

	useEffect(() => {
		if (selectedIndex >= results.length) {
			setSelectedIndex(Math.max(0, results.length - 1));
		}
	}, [results.length, selectedIndex]);

	useEffect(() => {
		const selected = listRef.current?.querySelector("[data-selected='true']");
		selected?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	function openResult(item: ResultItem) {
		if (!workspaceId || !repoPath) return;
		close();
		if (item.type === "file") {
			openFile(workspaceId, repoPath, item.path, detectLanguage(item.path));
		} else {
			openFile(workspaceId, repoPath, item.path, detectLanguage(item.path), {
				lineNumber: item.line,
				column: item.type === "symbol" ? item.column : 1,
			});
		}
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Tab") {
			e.preventDefault();
			cycleTab(e.shiftKey ? -1 : 1);
			setSelectedIndex(0);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const item = results[selectedIndex];
			if (item) openResult(item);
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	}

	if (!isOpen) return null;

	const selected = results[selectedIndex];

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]"
			onClick={(e) => {
				if (e.target === e.currentTarget) close();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="fixed inset-0 bg-[var(--scrim)]" aria-hidden="true" />

			<div className="relative z-10 flex w-[640px] max-h-[60vh] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)] backdrop-blur-md">
				{/* Tab row */}
				<div className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-3 pt-2">
					{SEARCH_TABS.map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => {
								setActiveTab(tab);
								setSelectedIndex(0);
								inputRef.current?.focus();
							}}
							className={`rounded-t-[4px] border-b-2 px-3 py-1.5 text-[12px] transition-colors ${
								activeTab === tab
									? "border-[var(--accent)] text-[var(--text)]"
									: "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
							}`}
						>
							{TAB_LABELS[tab]}
						</button>
					))}
				</div>

				{/* Search input */}
				<div className="flex items-center border-b border-[var(--border-subtle)] px-4 py-3">
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						className="mr-3 shrink-0 text-[var(--text-quaternary)]"
						aria-hidden="true"
					>
						<circle cx="7" cy="7" r="5" />
						<path d="M11 11l3.5 3.5" strokeLinecap="round" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelectedIndex(0);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search files, symbols, text..."
						className="flex-1 bg-transparent text-[14px] text-[var(--text)] placeholder-[var(--text-quaternary)] outline-none"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>

				{/* Results */}
				<div ref={listRef} className="min-h-[120px] overflow-y-auto py-2" role="listbox">
					{results.length === 0 && (
						<div className="px-4 py-6 text-center text-[13px] text-[var(--text-quaternary)]">
							{query.trim().length === 0 ? "Type to search" : "No results"}
						</div>
					)}
					{results.map((item, i) => (
						<ResultRow
							key={resultKey(item)}
							item={item}
							isSelected={i === selectedIndex}
							onSelect={() => openResult(item)}
							onHover={() => setSelectedIndex(i)}
						/>
					))}
				</div>

				{/* Footer: selected path */}
				<div className="truncate border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--text-quaternary)]">
					{selected ? resultPath(selected) : " "}
				</div>
			</div>
		</div>,
		document.body
	);
}

function ResultRow({
	item,
	isSelected,
	onSelect,
	onHover,
}: {
	item: ResultItem;
	isSelected: boolean;
	onSelect: () => void;
	onHover: () => void;
}) {
	const name =
		item.type === "file" ? (item.path.split("/").pop() ?? item.path) : ("name" in item ? item.name : item.path);
	return (
		<div
			role="option"
			aria-selected={isSelected}
			data-selected={isSelected}
			onClick={onSelect}
			onMouseEnter={onHover}
			className={`mx-2 flex cursor-pointer items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] transition-colors ${
				isSelected
					? "bg-[var(--bg-elevated)] text-[var(--text)]"
					: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
			}`}
		>
			<span className="truncate">{name}</span>
			<span className="min-w-0 flex-1 truncate text-right text-[11px] text-[var(--text-quaternary)]">
				{item.type === "file" ? item.path : `${item.path}:${item.line}`}
			</span>
		</div>
	);
}
```

Note: `ResultRow` is a placeholder renderer; Tasks 4/6/8 replace its body with type-specific rows. The `name` computation for `text` items is temporary.

- [ ] **Step 3: Wire the detector into `useShortcutListener`**

In `src/renderer/hooks/useShortcutListener.ts`:

Add imports at top:

```ts
import { useSearchEverywhereStore } from "../stores/search-everywhere-store";
import { useTabStore } from "../stores/tab-store";
import { createDoubleShiftDetector } from "./double-shift-detector";
```

Replace the body of the `useEffect` in `useShortcutListener()` with:

```ts
	useEffect(() => {
		const detector = createDoubleShiftDetector(() => {
			if (useTabStore.getState().activeWorkspaceId === null) return;
			useSearchEverywhereStore.getState().toggle();
		});

		function handleKeyDown(e: KeyboardEvent) {
			// Double-shift detection runs before skip logic: Shift alone types
			// nothing, so it is safe even with terminal/input focus.
			detector.keydown(e, Date.now());

			const target = e.target as HTMLElement | null;
			if (shouldSkipShortcutHandling(e, target)) {
				return;
			}

			const actions = useActionStore.getState().actions;
			for (const action of actions.values()) {
				if (!action.shortcut) continue;
				if (!matchesShortcut(e, action.shortcut)) continue;
				if (action.when && !action.when()) continue;

				e.preventDefault();
				e.stopPropagation();
				action.execute();
				return;
			}
		}

		function handleKeyUp(e: KeyboardEvent) {
			detector.keyup(e, Date.now());
		}

		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("keyup", handleKeyUp, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("keyup", handleKeyUp, true);
		};
	}, []);
```

- [ ] **Step 4: Register the action and badge symbol**

In `src/renderer/actions/core-actions.ts`, add import:

```ts
import { useSearchEverywhereStore } from "../stores/search-everywhere-store";
```

Insert into `registerMany`, directly after the `general.commandPalette` entry:

```ts
		{
			id: "general.searchEverywhere",
			label: "Search Everywhere",
			category: "General",
			displayShortcut: { key: "Shift", shift: true },
			when: hasWorkspace,
			execute: () => useSearchEverywhereStore.getState().toggle(),
			keywords: ["find", "files", "symbols", "text", "occurrences", "go to"],
		},
```

In `src/renderer/components/ShortcutBadge.tsx`, add to `KEY_SYMBOLS`:

```ts
	Shift: "⇧",
```

- [ ] **Step 5: Mount in App.tsx**

In `src/renderer/App.tsx`: add import `import { SearchEverywherePopup } from "./components/SearchEverywherePopup";` alongside the `CommandPalette` import, and render `<SearchEverywherePopup />` on the line after `<CommandPalette />` (~line 753).

- [ ] **Step 6: Verify**

Run: `bun run type-check` (from repo root or `apps/desktop/`) — expected: clean.
Run: `bun test tests/shortcut-matching.test.ts tests/action-store.test.ts tests/double-shift-detector.test.ts` — expected: pass.
Manual: `bun run dev` → open a workspace → double-tap Shift → popup opens with 4 tabs, "Type to search", Esc closes, double-Shift toggles, Tab cycles tabs, ⌘K palette lists "Search Everywhere" with ⇧⇧ badge. Double-Shift on home screen (no workspace) does nothing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/stores/search-everywhere-store.ts src/renderer/components/SearchEverywherePopup.tsx src/renderer/hooks/useShortcutListener.ts src/renderer/actions/core-actions.ts src/renderer/components/ShortcutBadge.tsx src/renderer/App.tsx
git commit -m "feat(search): add search-everywhere popup shell with double-shift trigger"
```

---

### Task 3: Fuzzy path matcher

**Files:**
- Create: `src/renderer/utils/fuzzy-match.ts`
- Test: `tests/fuzzy-match.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `fuzzyScore(query: string, path: string): number` (higher = better, `-1` = no match) and `fuzzyFilterPaths(query: string, paths: string[], limit: number): string[]` (sorted best-first). Tasks 4 and 9 consume both; Task 9 also reuses `fuzzyScore` for symbol names (passing the name as `path`).

Scoring (all comparisons lowercase; `filename` = substring after last `/`):
exact filename `2000` > filename starts-with `1000` > filename substring `800` > filename subsequence `600` > path substring `400` > path subsequence `200`; each minus `path.length` as tiebreak (shorter wins). Empty query matches everything at score `0`.

- [ ] **Step 1: Write the failing test**

Create `tests/fuzzy-match.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fuzzyFilterPaths, fuzzyScore } from "../src/renderer/utils/fuzzy-match";

describe("fuzzyScore", () => {
	test("exact filename beats starts-with", () => {
		expect(fuzzyScore("app", "src/app.ts")).toBeGreaterThan(fuzzyScore("app", "src/apple.ts"));
	});

	test("filename starts-with beats filename substring", () => {
		expect(fuzzyScore("store", "src/store.ts")).toBeGreaterThan(
			fuzzyScore("store", "src/tab-store.ts")
		);
	});

	test("filename substring beats path substring", () => {
		expect(fuzzyScore("store", "a/tab-store.ts")).toBeGreaterThan(
			fuzzyScore("store", "stores/index.ts")
		);
	});

	test("subsequence on filename matches", () => {
		expect(fuzzyScore("sep", "components/SearchEverywherePopup.tsx")).toBeGreaterThan(-1);
	});

	test("no match returns -1", () => {
		expect(fuzzyScore("zzz", "src/app.ts")).toBe(-1);
	});

	test("shorter path wins ties", () => {
		expect(fuzzyScore("app", "app.ts")).toBeGreaterThan(fuzzyScore("app", "deep/nested/app.ts"));
	});

	test("case-insensitive", () => {
		expect(fuzzyScore("APP", "src/App.tsx")).toBeGreaterThan(-1);
	});

	test("empty query scores 0", () => {
		expect(fuzzyScore("", "src/app.ts")).toBe(0);
	});
});

describe("fuzzyFilterPaths", () => {
	test("sorts best-first and applies limit", () => {
		const paths = ["stores/index.ts", "src/tab-store.ts", "src/store.ts", "unrelated.md"];
		const result = fuzzyFilterPaths("store", paths, 2);
		expect(result).toEqual(["src/store.ts", "src/tab-store.ts"]);
	});

	test("excludes non-matches", () => {
		expect(fuzzyFilterPaths("zzz", ["a.ts", "b.ts"], 10)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/fuzzy-match.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/utils/fuzzy-match.ts`:

```ts
function isSubsequence(needle: string, haystack: string): boolean {
	let i = 0;
	for (const ch of haystack) {
		if (ch === needle[i]) i++;
		if (i === needle.length) return true;
	}
	return needle.length === 0;
}

/** Higher = better. -1 = no match. Case-insensitive. */
export function fuzzyScore(query: string, path: string): number {
	const q = query.toLowerCase();
	if (q.length === 0) return 0;
	const p = path.toLowerCase();
	const slash = p.lastIndexOf("/");
	const filename = slash === -1 ? p : p.slice(slash + 1);
	const tiebreak = -path.length;

	if (filename === q) return 2000 + tiebreak;
	if (filename.startsWith(q)) return 1000 + tiebreak;
	if (filename.includes(q)) return 800 + tiebreak;
	if (isSubsequence(q, filename)) return 600 + tiebreak;
	if (p.includes(q)) return 400 + tiebreak;
	if (isSubsequence(q, p)) return 200 + tiebreak;
	return -1;
}

export function fuzzyFilterPaths(query: string, paths: string[], limit: number): string[] {
	const scored: { path: string; score: number }[] = [];
	for (const path of paths) {
		const score = fuzzyScore(query, path);
		if (score >= 0) scored.push({ path, score });
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((s) => s.path);
}
```

Note on the first test: `src/app.ts` and `src/apple.ts` both hit the starts-with band (1000), so the shorter-path tiebreak decides — that is what the test asserts.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/fuzzy-match.test.ts`
Expected: 10 pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fuzzy-match.test.ts src/renderer/utils/fuzzy-match.ts
git commit -m "feat(search): add fuzzy path matcher"
```

---

### Task 4: Files tab

**Files:**
- Modify: `src/renderer/components/SearchEverywherePopup.tsx`

**Interfaces:**
- Consumes: `trpc.diff.listAllFiles.useQuery({ repoPath })` → `{ entries: { path: string; type: "file" | "directory" }[] }`; `fuzzyFilterPaths` from Task 3.
- Produces: `results` populated for `files` and `all` tabs with `{ type: "file", path }` items. Task 9 replaces the `all` branch with the merged ranking.

- [ ] **Step 1: Add the files data source**

In `SearchEverywherePopup.tsx`, add imports:

```ts
import { trpc } from "../trpc/client";
import { fuzzyFilterPaths } from "../utils/fuzzy-match";
```

Inside the component, after the `repoPath` declaration, add:

```ts
	const filesQuery = trpc.diff.listAllFiles.useQuery(
		{ repoPath },
		{ enabled: isOpen && repoPath.length > 0, staleTime: 60_000 }
	);

	const filePaths = useMemo(
		() =>
			(filesQuery.data?.entries ?? []).filter((e) => e.type === "file").map((e) => e.path),
		[filesQuery.data]
	);
```

Replace the `results` memo:

```ts
	const results: ResultItem[] = useMemo(() => {
		const q = query.trim();
		if (activeTab === "files" || activeTab === "all") {
			if (q.length === 0) return [];
			return fuzzyFilterPaths(q, filePaths, 50).map((path) => ({ type: "file" as const, path }));
		}
		return [];
	}, [activeTab, query, filePaths]);
```

- [ ] **Step 2: Give file rows their real look**

Replace `ResultRow`'s body with type-dispatching rendering (name bold-ish, dimmed directory on the right — matches the Rider screenshot layout):

```tsx
function ResultRow({
	item,
	isSelected,
	onSelect,
	onHover,
}: {
	item: ResultItem;
	isSelected: boolean;
	onSelect: () => void;
	onHover: () => void;
}) {
	let primary: string;
	let secondary: string;
	if (item.type === "file") {
		const slash = item.path.lastIndexOf("/");
		primary = slash === -1 ? item.path : item.path.slice(slash + 1);
		secondary = slash === -1 ? "" : item.path.slice(0, slash);
	} else if (item.type === "symbol") {
		primary = item.name;
		secondary = `${item.container ? `${item.container} — ` : ""}${item.path}:${item.line}`;
	} else {
		primary = item.text.trim();
		secondary = `${item.path}:${item.line}`;
	}

	return (
		<div
			role="option"
			aria-selected={isSelected}
			data-selected={isSelected}
			onClick={onSelect}
			onMouseEnter={onHover}
			className={`mx-2 flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-1.5 text-[13px] transition-colors ${
				isSelected
					? "bg-[var(--bg-elevated)] text-[var(--text)]"
					: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
			}`}
		>
			<span className="truncate">{primary}</span>
			<span className="min-w-0 flex-1 truncate text-right text-[11px] text-[var(--text-quaternary)]">
				{secondary}
			</span>
		</div>
	);
}
```

- [ ] **Step 3: Verify**

Run: `bun run type-check` — clean.
Manual: `bun run dev` → double-Shift → type a filename fragment → Files and All tabs list matches, filename left / dimmed dir right, Enter opens the file in an editor tab, footer shows full path of selection.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SearchEverywherePopup.tsx
git commit -m "feat(search): files tab with fuzzy matching"
```

---

### Task 5: Text search backend (`git grep`)

**Files:**
- Create: `src/main/git/search-text.ts`
- Modify: `src/main/trpc/routers/diff.ts`
- Test: `tests/search-text.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `searchText(repoPath: string, query: string): Promise<TextSearchResult>`, `parseGrepOutput(stdout: string): TextSearchResult` where `TextSearchResult = { matches: { path: string; line: number; text: string }[]; truncated: boolean }`; tRPC proc `diff.searchText({ repoPath: string, query: string (min 2) })` returning `TextSearchResult`. Task 6 consumes the proc.

- [ ] **Step 1: Write the failing tests**

Create `tests/search-text.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_MATCHES, parseGrepOutput, searchText } from "../src/main/git/search-text";

const run = promisify(execFile);

describe("parseGrepOutput", () => {
	test("parses path:line:text lines", () => {
		const out = "src/a.ts:12:const x = 1;\nsrc/b.ts:3:hello\n";
		expect(parseGrepOutput(out)).toEqual({
			matches: [
				{ path: "src/a.ts", line: 12, text: "const x = 1;" },
				{ path: "src/b.ts", line: 3, text: "hello" },
			],
			truncated: false,
		});
	});

	test("keeps colons in the matched text", () => {
		const out = "a.ts:1:url: https://example.com\n";
		expect(parseGrepOutput(out).matches[0]?.text).toBe("url: https://example.com");
	});

	test("skips malformed lines", () => {
		expect(parseGrepOutput("garbage\n\n").matches).toEqual([]);
	});

	test("caps matches and sets truncated", () => {
		const out = Array.from({ length: MAX_MATCHES + 10 }, (_, i) => `a.ts:${i + 1}:x`).join("\n");
		const result = parseGrepOutput(out);
		expect(result.matches.length).toBe(MAX_MATCHES);
		expect(result.truncated).toBe(true);
	});

	test("truncates long lines to 200 chars", () => {
		const long = "y".repeat(500);
		const result = parseGrepOutput(`a.ts:1:${long}\n`);
		expect(result.matches[0]?.text.length).toBe(200);
	});
});

describe("searchText (fixture repo)", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await mkdtemp(join(tmpdir(), "search-text-"));
		await run("git", ["init"], { cwd: repo });
		await writeFile(join(repo, "tracked.ts"), "const greeting = 'Hello World';\n");
		await run("git", ["add", "."], { cwd: repo });
		await writeFile(join(repo, "untracked.ts"), "// hello there\n");
	});

	afterAll(async () => {
		await rm(repo, { recursive: true, force: true });
	});

	test("finds matches in tracked and untracked files (smart case: lowercase query)", async () => {
		const result = await searchText(repo, "hello");
		const paths = result.matches.map((m) => m.path).sort();
		expect(paths).toEqual(["tracked.ts", "untracked.ts"]);
	});

	test("uppercase in query makes it case-sensitive", async () => {
		const result = await searchText(repo, "Hello World");
		expect(result.matches.length).toBe(1);
		expect(result.matches[0]?.path).toBe("tracked.ts");
		expect(result.matches[0]?.line).toBe(1);
	});

	test("no matches returns empty, not an error", async () => {
		const result = await searchText(repo, "zzznomatch");
		expect(result).toEqual({ matches: [], truncated: false });
	});

	test("query starting with dash is treated literally", async () => {
		await expect(searchText(repo, "--fixed")).resolves.toEqual({
			matches: [],
			truncated: false,
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/search-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/git/search-text.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MAX_MATCHES = 200;
const MAX_LINE_LENGTH = 200;

export interface TextMatch {
	path: string;
	line: number;
	text: string;
}

export interface TextSearchResult {
	matches: TextMatch[];
	truncated: boolean;
}

export function parseGrepOutput(stdout: string): TextSearchResult {
	const matches: TextMatch[] = [];
	let truncated = false;

	for (const line of stdout.split("\n")) {
		if (line.length === 0) continue;
		if (matches.length >= MAX_MATCHES) {
			truncated = true;
			break;
		}
		const first = line.indexOf(":");
		if (first === -1) continue;
		const second = line.indexOf(":", first + 1);
		if (second === -1) continue;
		const lineNum = Number.parseInt(line.slice(first + 1, second), 10);
		if (Number.isNaN(lineNum)) continue;
		matches.push({
			path: line.slice(0, first),
			line: lineNum,
			text: line.slice(second + 1, second + 1 + MAX_LINE_LENGTH),
		});
	}

	return { matches, truncated };
}

/**
 * Literal (fixed-string) text search via `git grep`. Searches tracked +
 * untracked (non-ignored) files, skips binaries. Smart case: all-lowercase
 * queries match case-insensitively.
 */
export async function searchText(repoPath: string, query: string): Promise<TextSearchResult> {
	const args = ["grep", "-n", "-I", "--untracked", "--fixed-strings"];
	if (query === query.toLowerCase()) args.push("-i");
	args.push("-e", query);

	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd: repoPath,
			maxBuffer: 16 * 1024 * 1024,
		});
		return parseGrepOutput(stdout);
	} catch (err) {
		// git grep exits 1 when nothing matched — that's an empty result.
		const e = err as { code?: number | string };
		if (e.code === 1) return { matches: [], truncated: false };
		throw err;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/search-text.test.ts`
Expected: 9 pass.

- [ ] **Step 5: Add the tRPC proc**

In `src/main/trpc/routers/diff.ts`: add to the existing import block from `../../git/file-tree` area a new import line:

```ts
import { searchText } from "../../git/search-text";
```

Add a proc directly after `listAllFiles` (line ~234):

```ts
	searchText: publicProcedure
		.input(z.object({ repoPath: z.string().min(1), query: z.string().min(2) }))
		.query(({ input }) => searchText(input.repoPath, input.query)),
```

- [ ] **Step 6: Verify**

Run: `bun run type-check` — clean.
Run: `bun test tests/search-text.test.ts` — pass.

- [ ] **Step 7: Commit**

```bash
git add tests/search-text.test.ts src/main/git/search-text.ts src/main/trpc/routers/diff.ts
git commit -m "feat(search): git-grep text search backend with searchText proc"
```

---

### Task 6: Text tab UI

**Files:**
- Create: `src/renderer/hooks/useDebouncedValue.ts`
- Modify: `src/renderer/components/SearchEverywherePopup.tsx`

**Interfaces:**
- Consumes: `trpc.diff.searchText.useQuery({ repoPath, query })` from Task 5.
- Produces: `useDebouncedValue<T>(value: T, delayMs: number): T`; `results` populated for the `text` tab. Task 8 reuses `useDebouncedValue` for symbols.

- [ ] **Step 1: Create the debounce hook**

Create `src/renderer/hooks/useDebouncedValue.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return debounced;
}
```

- [ ] **Step 2: Wire the text tab**

In `SearchEverywherePopup.tsx`, add import:

```ts
import { useDebouncedValue } from "../hooks/useDebouncedValue";
```

Inside the component, after `filePaths`, add:

```ts
	const debouncedQuery = useDebouncedValue(query.trim(), 200);
	const textEnabled = isOpen && activeTab === "text" && debouncedQuery.length >= 2;
	const textQuery = trpc.diff.searchText.useQuery(
		{ repoPath, query: debouncedQuery },
		{ enabled: textEnabled && repoPath.length > 0, staleTime: 10_000 }
	);
```

(React-query keys the request on `{repoPath, query}`, so stale responses for old queries never overwrite newer ones — no manual request-id needed.)

Extend the `results` memo with a `text` branch:

```ts
	const results: ResultItem[] = useMemo(() => {
		const q = query.trim();
		if (activeTab === "files" || activeTab === "all") {
			if (q.length === 0) return [];
			return fuzzyFilterPaths(q, filePaths, 50).map((path) => ({ type: "file" as const, path }));
		}
		if (activeTab === "text") {
			return (textQuery.data?.matches ?? []).map((m) => ({
				type: "text" as const,
				path: m.path,
				line: m.line,
				text: m.text,
			}));
		}
		return [];
	}, [activeTab, query, filePaths, textQuery.data]);
```

In the results `<div>`, extend the empty-state to cover text-tab states — replace the existing `{results.length === 0 && (...)}` block with:

```tsx
					{results.length === 0 && (
						<div className="px-4 py-6 text-center text-[13px] text-[var(--text-quaternary)]">
							{activeTab === "text" && textQuery.isError
								? "Search failed"
								: activeTab === "text" && query.trim().length > 0 && query.trim().length < 2
									? "Type at least 2 characters"
									: query.trim().length === 0
										? "Type to search"
										: textQuery.isFetching && activeTab === "text"
											? "Searching..."
											: "No results"}
						</div>
					)}
					{activeTab === "text" && textQuery.data?.truncated && (
						<div className="px-4 pb-1 text-center text-[11px] text-[var(--text-quaternary)]">
							Showing first {results.length} matches
						</div>
					)}
```

- [ ] **Step 3: Verify**

Run: `bun run type-check` — clean.
Manual: `bun run dev` → double-Shift → Text tab → type a known string → matched lines appear with `path:line` dimmed, Enter jumps to the exact line in the editor, no-match query shows "No results".

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/useDebouncedValue.ts src/renderer/components/SearchEverywherePopup.tsx
git commit -m "feat(search): text occurrences tab"
```

---

### Task 7: Workspace symbol backend (LSP fan-out in main)

**Files:**
- Create: `src/main/lsp/workspace-symbols.ts`
- Modify: `src/main/lsp/server-manager.ts` (add `getRunningConnections`)
- Modify: `src/main/trpc/routers/lsp.ts` (add `searchWorkspaceSymbols` proc)
- Modify: `docs/superpowers/specs/2026-07-05-search-everywhere-design.md` (repo root — symbols section)
- Test: `tests/workspace-symbols.test.ts`

**Interfaces:**
- Consumes: `ServerManager.servers` map (`serverKey` = `` `${configId}:${repoPath}` ``, instances have `initialized: boolean`, `connection: MessageConnection`).
- Produces: `normalizeWorkspaceSymbols(raw: unknown[], repoPath: string): WorkspaceSymbolHit[]` where `WorkspaceSymbolHit = { name: string; kind: number; path: string; line: number; column: number; container?: string }` (1-based line/column, repo-relative path, deduped, capped at 100 — exported as `MAX_SYMBOLS`); `serverManager.getRunningConnections(repoPath): { configId: string; connection: MessageConnection }[]`; tRPC proc `lsp.searchWorkspaceSymbols({ repoPath, query (min 2) })` → `{ symbols: WorkspaceSymbolHit[]; serversQueried: number }`. Task 8 consumes the proc.

- [ ] **Step 1: Write the failing test for normalization**

Create `tests/workspace-symbols.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
	MAX_SYMBOLS,
	normalizeWorkspaceSymbols,
} from "../src/main/lsp/workspace-symbols";

const REPO = "/Users/me/proj";

function sym(name: string, uri: string, line = 4, character = 2) {
	return {
		name,
		kind: 12,
		containerName: "Outer",
		location: { uri, range: { start: { line, character }, end: { line, character: 9 } } },
	};
}

describe("normalizeWorkspaceSymbols", () => {
	test("converts SymbolInformation to repo-relative 1-based hits", () => {
		const hits = normalizeWorkspaceSymbols([sym("doThing", `file://${REPO}/src/a.ts`)], REPO);
		expect(hits).toEqual([
			{ name: "doThing", kind: 12, path: "src/a.ts", line: 5, column: 3, container: "Outer" },
		]);
	});

	test("handles WorkspaceSymbol with location without range", () => {
		const hits = normalizeWorkspaceSymbols(
			[{ name: "X", kind: 5, location: { uri: `file://${REPO}/b.ts` } }],
			REPO
		);
		expect(hits).toEqual([{ name: "X", kind: 5, path: "b.ts", line: 1, column: 1 }]);
	});

	test("decodes URI escapes", () => {
		const hits = normalizeWorkspaceSymbols(
			[sym("y", `file://${REPO}/my%20dir/c.ts`)],
			REPO
		);
		expect(hits[0]?.path).toBe("my dir/c.ts");
	});

	test("keeps absolute path when outside repo", () => {
		const hits = normalizeWorkspaceSymbols([sym("z", "file:///other/place/d.ts")], REPO);
		expect(hits[0]?.path).toBe("/other/place/d.ts");
	});

	test("dedups by name+path+line and caps at MAX_SYMBOLS", () => {
		const raw = [
			sym("dup", `file://${REPO}/a.ts`),
			sym("dup", `file://${REPO}/a.ts`),
			...Array.from({ length: MAX_SYMBOLS + 20 }, (_, i) =>
				sym(`s${i}`, `file://${REPO}/f${i}.ts`)
			),
		];
		const hits = normalizeWorkspaceSymbols(raw, REPO);
		expect(hits.filter((h) => h.name === "dup").length).toBe(1);
		expect(hits.length).toBe(MAX_SYMBOLS);
	});

	test("ignores malformed entries", () => {
		expect(normalizeWorkspaceSymbols([null, {}, { name: "n" }], REPO)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workspace-symbols.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the normalizer**

Create `src/main/lsp/workspace-symbols.ts`:

```ts
export const MAX_SYMBOLS = 100;

export interface WorkspaceSymbolHit {
	name: string;
	kind: number;
	path: string;
	line: number;
	column: number;
	container?: string;
}

interface RawLocation {
	uri?: string;
	range?: { start?: { line?: number; character?: number } };
}

interface RawSymbol {
	name?: string;
	kind?: number;
	containerName?: string;
	location?: RawLocation;
}

function uriToRepoRelative(uri: string, repoPath: string): string {
	let p = uri.replace(/^file:\/\//, "");
	try {
		p = decodeURIComponent(p);
	} catch {
		// keep raw path on malformed escapes
	}
	if (p === repoPath) return "";
	if (p.startsWith(`${repoPath}/`)) return p.slice(repoPath.length + 1);
	return p;
}

/**
 * Normalizes `workspace/symbol` responses (SymbolInformation[] or
 * WorkspaceSymbol[]) into repo-relative, 1-based hits. Dedups by
 * name+path+line, caps at MAX_SYMBOLS.
 */
export function normalizeWorkspaceSymbols(raw: unknown[], repoPath: string): WorkspaceSymbolHit[] {
	const hits: WorkspaceSymbolHit[] = [];
	const seen = new Set<string>();

	for (const entry of raw) {
		if (hits.length >= MAX_SYMBOLS) break;
		if (typeof entry !== "object" || entry === null) continue;
		const s = entry as RawSymbol;
		if (typeof s.name !== "string" || typeof s.location?.uri !== "string") continue;

		const path = uriToRepoRelative(s.location.uri, repoPath);
		const start = s.location.range?.start;
		const line = (start?.line ?? 0) + 1;
		const column = (start?.character ?? 0) + 1;

		const key = `${s.name}:${path}:${line}`;
		if (seen.has(key)) continue;
		seen.add(key);

		hits.push({
			name: s.name,
			kind: typeof s.kind === "number" ? s.kind : 0,
			path,
			line,
			column,
			...(s.containerName ? { container: s.containerName } : {}),
		});
	}

	return hits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/workspace-symbols.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Expose running connections on ServerManager**

In `src/main/lsp/server-manager.ts`, add a public method directly after `getOrCreate` (line ~467):

```ts
	getRunningConnections(repoPath: string): { configId: string; connection: MessageConnection }[] {
		const suffix = `:${repoPath}`;
		const out: { configId: string; connection: MessageConnection }[] = [];
		for (const [key, instance] of this.servers) {
			if (!key.endsWith(suffix)) continue;
			if (!instance.initialized || instance.shuttingDown) continue;
			out.push({ configId: key.slice(0, key.length - suffix.length), connection: instance.connection });
		}
		return out;
	}
```

- [ ] **Step 6: Add the tRPC proc**

In `src/main/trpc/routers/lsp.ts`, add import:

```ts
import { normalizeWorkspaceSymbols } from "../../lsp/workspace-symbols";
```

Add a proc after `getPresets` (line ~62):

```ts
	searchWorkspaceSymbols: publicProcedure
		.input(z.object({ repoPath: z.string().min(1), query: z.string().min(2) }))
		.query(async ({ input }) => {
			const running = serverManager.getRunningConnections(input.repoPath);
			const perServer = await Promise.all(
				running.map(async ({ connection }) => {
					try {
						const res = await Promise.race([
							connection.sendRequest("workspace/symbol", { query: input.query }),
							new Promise((_, reject) =>
								setTimeout(() => reject(new Error("workspace/symbol timeout")), 3000)
							),
						]);
						return Array.isArray(res) ? res : [];
					} catch {
						return [];
					}
				})
			);
			return {
				symbols: normalizeWorkspaceSymbols(perServer.flat(), input.repoPath),
				serversQueried: running.length,
			};
		}),
```

(Check the file's existing imports: `serverManager` is already imported for `getHealth`; `z` is already imported.)

- [ ] **Step 7: Update the spec's Symbols section**

In `docs/superpowers/specs/2026-07-05-search-everywhere-design.md` (repo root), replace the first two bullets of the `### Symbols` section with:

```markdown
- New tRPC proc `lsp.searchWorkspaceSymbols({ repoPath, query })`: main process fans
  `workspace/symbol` out to all initialized LSP server connections for the repo
  (3s per-server timeout), merges + dedups (name+path+line), caps at 100.
  (Main-side fan-out instead of renderer-side: main owns the connections and the
  config→language mapping.) Renderer debounces 200ms, min 2 chars.
```

- [ ] **Step 8: Verify + commit**

Run: `bun run type-check` — clean.
Run: `bun test tests/workspace-symbols.test.ts` — pass.

```bash
git add src/main/lsp/workspace-symbols.ts src/main/lsp/server-manager.ts src/main/trpc/routers/lsp.ts tests/workspace-symbols.test.ts
git add -f ../../docs/superpowers/specs/2026-07-05-search-everywhere-design.md
git commit -m "feat(search): workspace symbol search across running LSP servers"
```

---

### Task 8: Symbols tab UI

**Files:**
- Modify: `src/renderer/components/SearchEverywherePopup.tsx`

**Interfaces:**
- Consumes: `trpc.lsp.searchWorkspaceSymbols.useQuery({ repoPath, query })` → `{ symbols: WorkspaceSymbolHit[]; serversQueried: number }` from Task 7; `useDebouncedValue` from Task 6.
- Produces: `results` populated for the `symbols` tab; `symbolHits` memo that Task 9 merges into the `all` tab; `SYMBOL_KIND_GLYPHS` map.

- [ ] **Step 1: Wire the symbols query**

In `SearchEverywherePopup.tsx`, add after the `textQuery` declaration:

```ts
	const symbolsEnabled =
		isOpen && (activeTab === "symbols" || activeTab === "all") && debouncedQuery.length >= 2;
	const symbolsQuery = trpc.lsp.searchWorkspaceSymbols.useQuery(
		{ repoPath, query: debouncedQuery },
		{ enabled: symbolsEnabled && repoPath.length > 0, staleTime: 10_000 }
	);

	const symbolHits: ResultItem[] = useMemo(
		() =>
			(symbolsQuery.data?.symbols ?? []).map((s) => ({
				type: "symbol" as const,
				name: s.name,
				kind: s.kind,
				path: s.path,
				line: s.line,
				column: s.column,
				container: s.container,
			})),
		[symbolsQuery.data]
	);
```

Extend the `results` memo with a `symbols` branch (before the final `return []`), and add `symbolHits` to its dependency array:

```ts
		if (activeTab === "symbols") {
			return symbolHits;
		}
```

- [ ] **Step 2: Symbol kind glyphs**

Add above `ResultRow` (LSP `SymbolKind` numbering):

```ts
const SYMBOL_KIND_GLYPHS: Record<number, string> = {
	5: "C", // Class
	6: "M", // Method
	9: "⊕", // Constructor
	10: "E", // Enum
	11: "I", // Interface
	12: "F", // Function
	13: "V", // Variable
	14: "K", // Constant
	23: "S", // Struct
};
```

In `ResultRow`, for symbol items render a leading glyph badge. Replace the `<span className="truncate">{primary}</span>` line with:

```tsx
			{item.type === "symbol" && (
				<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-[var(--bg-base)] text-[10px] text-[var(--text-tertiary)]">
					{SYMBOL_KIND_GLYPHS[item.kind] ?? "•"}
				</span>
			)}
			<span className="truncate">{primary}</span>
```

- [ ] **Step 3: Symbols empty-state hint**

Extend the empty-state block: when `activeTab === "symbols"` and `query.trim().length >= 2` and `!symbolsQuery.isFetching` and `(symbolsQuery.data?.serversQueried ?? 0) === 0`, show:

```tsx
							"No language servers running — symbols appear once files are opened in the editor"
```

Concretely, replace the empty-state ternary chain with a small helper above the return:

```ts
	function emptyStateMessage(): string {
		const q = query.trim();
		if (q.length === 0) return "Type to search";
		if (activeTab === "text") {
			if (textQuery.isError) return "Search failed";
			if (q.length < 2) return "Type at least 2 characters";
			if (textQuery.isFetching) return "Searching...";
		}
		if (activeTab === "symbols") {
			if (q.length < 2) return "Type at least 2 characters";
			if (symbolsQuery.isFetching) return "Searching...";
			if ((symbolsQuery.data?.serversQueried ?? 0) === 0)
				return "No language servers running — symbols appear once files are opened in the editor";
		}
		return "No results";
	}
```

and render `{emptyStateMessage()}` in the empty-state div.

- [ ] **Step 4: Verify**

Run: `bun run type-check` — clean.
Manual: `bun run dev` → open a TS file (warms tsserver) → double-Shift → Symbols tab → type a known function name → hits with glyph + container/path, Enter jumps to definition line. Fresh workspace without opened files shows the "No language servers running" hint.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SearchEverywherePopup.tsx
git commit -m "feat(search): symbols tab via workspace/symbol"
```

---

### Task 9: All tab merge + ranking

**Files:**
- Create: `src/renderer/utils/merge-all-results.ts`
- Modify: `src/renderer/components/SearchEverywherePopup.tsx`
- Test: `tests/merge-all-results.test.ts`

**Interfaces:**
- Consumes: `fuzzyScore` from Task 3; `ResultItem` shape from Task 2 (import type from the popup would create a cycle — the util defines structural param types instead).
- Produces: `mergeAllResults<F extends { type: "file"; path: string }, S extends { type: "symbol"; name: string }>(query: string, files: F[], symbols: S[], limit: number): (F | S)[]` — takes pre-built file/symbol result items, returns them interleaved by rank.

Ranking per spec: exact filename match > exact symbol name match > filename fuzzy score > symbol fuzzy score. Implemented as: score files with `fuzzyScore(query, path)`, symbols with `fuzzyScore(query, name)`; exact filename gets 2000-band (already), exact symbol name gets a 1900-band boost; sort descending, stable within band by input order, cap `limit`.

- [ ] **Step 1: Write the failing test**

Create `tests/merge-all-results.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mergeAllResults } from "../src/renderer/utils/merge-all-results";

type Item =
	| { type: "file"; path: string }
	| { type: "symbol"; name: string; path: string };

function file(path: string): Item {
	return { type: "file", path };
}
function symbol(name: string, path = "src/x.ts"): Item {
	return { type: "symbol", name, path };
}

describe("mergeAllResults", () => {
	test("exact filename beats exact symbol name", () => {
		const merged = mergeAllResults("store.ts", [file("src/store.ts")], [symbol("store.ts")], 10);
		expect(merged[0]).toEqual(file("src/store.ts"));
	});

	test("exact symbol beats fuzzy filename", () => {
		const merged = mergeAllResults(
			"openFile",
			[file("src/open-file-helpers.ts")],
			[symbol("openFile")],
			10
		);
		expect(merged[0]).toEqual(symbol("openFile"));
	});

	test("non-matching items are dropped", () => {
		const merged = mergeAllResults("zzz", [file("a.ts")], [symbol("b")], 10);
		expect(merged).toEqual([]);
	});

	test("caps at limit", () => {
		const files = Array.from({ length: 60 }, (_, i) => file(`src/store-${i}.ts`));
		const merged = mergeAllResults("store", files, [], 50);
		expect(merged.length).toBe(50);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/merge-all-results.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/utils/merge-all-results.ts`:

```ts
import { fuzzyScore } from "./fuzzy-match";

interface FileLike {
	type: "file";
	path: string;
}

interface SymbolLike {
	type: "symbol";
	name: string;
}

/**
 * Merges file and symbol results for the All tab. Files rank by path fuzzy
 * score (exact filename = 2000 band). Exact symbol names get a 1900 band so
 * they beat everything except exact filenames; other symbols rank by name
 * fuzzy score.
 */
export function mergeAllResults<F extends FileLike, S extends SymbolLike>(
	query: string,
	files: F[],
	symbols: S[],
	limit: number
): (F | S)[] {
	const q = query.trim().toLowerCase();
	const scored: { item: F | S; score: number; order: number }[] = [];
	let order = 0;

	for (const f of files) {
		const score = fuzzyScore(q, f.path);
		if (score >= 0) scored.push({ item: f, score, order: order++ });
	}
	for (const s of symbols) {
		const base = fuzzyScore(q, s.name);
		if (base < 0) continue;
		const score = s.name.toLowerCase() === q ? 1900 : Math.min(base, 1800);
		scored.push({ item: s, score, order: order++ });
	}

	scored.sort((a, b) => b.score - a.score || a.order - b.order);
	return scored.slice(0, limit).map((s) => s.item);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/merge-all-results.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Use it in the All tab**

In `SearchEverywherePopup.tsx`, add import:

```ts
import { mergeAllResults } from "../utils/merge-all-results";
```

In the `results` memo, split the current `files || all` branch into two, so `all` merges symbols. Final memo:

```ts
	const results: ResultItem[] = useMemo(() => {
		const q = query.trim();
		if (activeTab === "files") {
			if (q.length === 0) return [];
			return fuzzyFilterPaths(q, filePaths, 50).map((path) => ({ type: "file" as const, path }));
		}
		if (activeTab === "all") {
			if (q.length === 0) return [];
			const fileItems = fuzzyFilterPaths(q, filePaths, 50).map((path) => ({
				type: "file" as const,
				path,
			}));
			const symbolItems = symbolHits.filter(
				(s): s is Extract<ResultItem, { type: "symbol" }> => s.type === "symbol"
			);
			return mergeAllResults(q, fileItems, symbolItems, 50);
		}
		if (activeTab === "symbols") {
			return symbolHits;
		}
		if (activeTab === "text") {
			return (textQuery.data?.matches ?? []).map((m) => ({
				type: "text" as const,
				path: m.path,
				line: m.line,
				text: m.text,
			}));
		}
		return [];
	}, [activeTab, query, filePaths, symbolHits, textQuery.data]);
```

(The `symbolsEnabled` flag from Task 8 already includes `activeTab === "all"`, so symbols load on the All tab too.)

- [ ] **Step 6: Verify + commit**

Run: `bun run type-check` — clean.
Run: `bun test tests/merge-all-results.test.ts tests/fuzzy-match.test.ts` — pass.
Manual: All tab shows files + symbols interleaved, exact filename first.

```bash
git add tests/merge-all-results.test.ts src/renderer/utils/merge-all-results.ts src/renderer/components/SearchEverywherePopup.tsx
git commit -m "feat(search): all tab merges files and symbols"
```

---

### Task 10: Final verification pass

**Files:**
- Modify: none expected (fixes only if checks fail).

**Interfaces:** N/A.

- [ ] **Step 1: Type-check + lint**

From repo root:
Run: `bun run type-check` — expected: clean.
Run: `bun run check` — expected: clean (Biome may auto-fix formatting; re-stage if it does).

- [ ] **Step 2: Run the feature's test files**

From `apps/desktop/`:
Run: `bun test tests/double-shift-detector.test.ts tests/fuzzy-match.test.ts tests/search-text.test.ts tests/workspace-symbols.test.ts tests/merge-all-results.test.ts tests/shortcut-matching.test.ts tests/action-store.test.ts`
Expected: all pass.

- [ ] **Step 3: End-to-end manual verify (bun run dev)**

1. Double-Shift in workspace → popup (All tab). Double-Shift again → closes.
2. Shift+letter typing in editor/terminal does NOT open popup.
3. Files: fragment → fuzzy hits → Enter opens file.
4. Text: string with a known line → Enter lands on that exact line.
5. Symbols: open a `.ts` file first, search a function name → Enter jumps to definition.
6. All: exact filename outranks symbols; Tab/Shift+Tab cycles tabs.
7. Home screen (no workspace): double-Shift inert.

- [ ] **Step 4: Rebuild the knowledge graph**

From repo root:
Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
(If it fails with "No module named 'graphify'", note it and move on — the commit hook showed the same.)

- [ ] **Step 5: Commit any straggler fixes**

```bash
git status
# if dirty:
git add -A && git commit -m "chore(search): final lint/type fixes for search everywhere"
```
