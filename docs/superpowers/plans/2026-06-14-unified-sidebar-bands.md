# Unified Sidebar Bands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three bespoke sidebar sections (Folders, Repositories, Orchestrators) with one uniform, reorderable, individually-collapsible "band" system that supports choosing order, full minimise, single-click switch, and multiple-open-or-focus-one.

**Architecture:** A pure layout helper resolves per-band height styles; a dedicated zustand store owns order / open-state / heights with localStorage persistence; a generic `SidebarBand` renders header + collapsible body; a `SidebarBandStack` renders the ordered bands inside a `@dnd-kit` sortable context with draggable resize dividers. `Sidebar.tsx` feeds it three band descriptors. The old `SidebarSplit`, `ProjectList`, and `CrossRepoOrchestratorGroup` are removed.

**Tech Stack:** React 19 + TypeScript, zustand 5, @dnd-kit (core/sortable/utilities), trpc, Bun test runner, Biome. Tabs for indent, line width 100, double quotes, semicolons.

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/utils/sidebar-bands.ts` — pure `BandId`, `computeBandLayout`, `clampBandHeight`.
- `apps/desktop/src/renderer/stores/sidebar-bands.ts` — zustand store + pure `defaultBandState` / `parsePersisted` / `sanitizeOrder` helpers + localStorage persistence.
- `apps/desktop/src/renderer/components/FolderList.tsx` — folders band body.
- `apps/desktop/src/renderer/components/RepositoryList.tsx` — repositories band body.
- `apps/desktop/src/renderer/components/OrchestratorList.tsx` — orchestrators band body (extracted from `CrossRepoOrchestratorGroup`).
- `apps/desktop/src/renderer/components/SidebarBand.tsx` — generic collapsible sortable band.
- `apps/desktop/src/renderer/components/SidebarBandStack.tsx` — ordered band stack + dnd reorder + resize dividers.
- `apps/desktop/tests/sidebar-bands-layout.test.ts` — tests for `computeBandLayout` / `clampBandHeight`.
- `apps/desktop/tests/sidebar-bands-store.test.ts` — tests for store + `parsePersisted` migration.

**Modify:**
- `apps/desktop/src/renderer/components/SidebarSectionHeader.tsx` — add chevron + optional drag grip.
- `apps/desktop/src/renderer/components/Sidebar.tsx` — fetch projects, build band descriptors, render `SidebarBandStack`.
- `apps/desktop/src/renderer/stores/projects.ts` — remove orchestrator-pane fields.
- `apps/desktop/tests/projects-store.test.ts` — drop the removed orchestrator-pane describe block.

**Delete:**
- `apps/desktop/src/renderer/components/SidebarSplit.tsx`
- `apps/desktop/src/renderer/components/ProjectList.tsx`
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx`
- `apps/desktop/src/renderer/utils/sidebar-split.ts`

All commands run from `apps/desktop/`.

---

## Task 1: Pure layout helper

**Files:**
- Create: `apps/desktop/src/renderer/utils/sidebar-bands.ts`
- Test: `apps/desktop/tests/sidebar-bands-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/sidebar-bands-layout.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { clampBandHeight, computeBandLayout } from "../src/renderer/utils/sidebar-bands";

const present = { folders: true, repositories: true, orchestrators: true };
const open = { folders: true, repositories: true, orchestrators: true };
const noHeights = { folders: null, repositories: null, orchestrators: null };

function run(over: Partial<Parameters<typeof computeBandLayout>[0]> = {}) {
	return computeBandLayout({
		order: ["folders", "repositories", "orchestrators"],
		present,
		open,
		heights: noHeights,
		preferredFlex: "repositories",
		containerHeight: 1000,
		...over,
	});
}

describe("computeBandLayout", () => {
	test("preferred band flexes, other open auto bands are auto", () => {
		const l = run();
		expect(l.repositories.kind).toBe("flex");
		expect(l.folders.kind).toBe("auto");
		expect(l.orchestrators.kind).toBe("auto");
	});

	test("absent band is hidden", () => {
		const l = run({ present: { ...present, folders: false } });
		expect(l.folders.kind).toBe("hidden");
	});

	test("closed band is collapsed", () => {
		const l = run({ open: { ...open, orchestrators: false } });
		expect(l.orchestrators.kind).toBe("collapsed");
	});

	test("explicit height becomes a clamped fixed band", () => {
		const l = run({ heights: { ...noHeights, folders: 150 } });
		expect(l.folders).toEqual({ kind: "fixed", heightPx: 150 });
	});

	test("when preferred is closed, bottom-most open auto band flexes", () => {
		const l = run({ open: { ...open, repositories: false } });
		expect(l.repositories.kind).toBe("collapsed");
		expect(l.orchestrators.kind).toBe("flex");
		expect(l.folders.kind).toBe("auto");
	});

	test("when preferred has explicit height, it is fixed and another band flexes", () => {
		const l = run({ heights: { ...noHeights, repositories: 300 } });
		expect(l.repositories).toEqual({ kind: "fixed", heightPx: 300 });
		expect(l.orchestrators.kind).toBe("flex");
	});

	test("single open band flexes (focus on one)", () => {
		const l = run({ open: { folders: false, repositories: false, orchestrators: true } });
		expect(l.orchestrators.kind).toBe("flex");
	});
});

describe("clampBandHeight", () => {
	test("clamps below min to min", () => {
		expect(clampBandHeight(10, 1000)).toBe(80);
	});
	test("clamps above maxFraction to the cap", () => {
		expect(clampBandHeight(900, 1000)).toBe(600);
	});
	test("rounds values in range", () => {
		expect(clampBandHeight(200.4, 1000)).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sidebar-bands-layout.test.ts`
Expected: FAIL — module `../src/renderer/utils/sidebar-bands` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/desktop/src/renderer/utils/sidebar-bands.ts`:

```ts
export type BandId = "folders" | "repositories" | "orchestrators";

export const ALL_BANDS: BandId[] = ["folders", "repositories", "orchestrators"];

export type BandStyle =
	| { kind: "hidden" }
	| { kind: "collapsed" }
	| { kind: "flex" }
	| { kind: "fixed"; heightPx: number }
	| { kind: "auto" };

/**
 * Clamp a band's explicit (divider-dragged) height:
 *  - never below `min` px
 *  - never above `maxFraction` of the container height
 * If the container is so short that max < min, `min` wins.
 */
export function clampBandHeight(
	desired: number,
	containerHeight: number,
	opts: { min?: number; maxFraction?: number } = {}
): number {
	const min = opts.min ?? 80;
	const maxFraction = opts.maxFraction ?? 0.6;
	const max = Math.max(min, Math.floor(containerHeight * maxFraction));
	return Math.min(max, Math.max(min, Math.round(desired)));
}

export interface BandLayoutInput {
	order: BandId[];
	present: Record<BandId, boolean>;
	open: Record<BandId, boolean>;
	heights: Record<BandId, number | null>;
	preferredFlex: BandId;
	containerHeight: number;
}

/**
 * Resolve each band's render style. Exactly one open band "flexes" to absorb
 * leftover height: the preferred band when it is open and has no explicit
 * height, otherwise the bottom-most (last in order) open band with no explicit
 * height. Open bands with an explicit height are `fixed`; the rest are `auto`.
 */
export function computeBandLayout(input: BandLayoutInput): Record<BandId, BandStyle> {
	const { order, present, open, heights, preferredFlex, containerHeight } = input;

	const isOpenAuto = (id: BandId) => present[id] && open[id] && heights[id] == null;

	let flexId: BandId | null = null;
	if (isOpenAuto(preferredFlex)) {
		flexId = preferredFlex;
	} else {
		for (const id of order) {
			if (isOpenAuto(id)) flexId = id; // last match wins → bottom-most
		}
	}

	const result = {} as Record<BandId, BandStyle>;
	for (const id of ALL_BANDS) {
		if (!present[id]) {
			result[id] = { kind: "hidden" };
		} else if (!open[id]) {
			result[id] = { kind: "collapsed" };
		} else if (id === flexId) {
			result[id] = { kind: "flex" };
		} else if (heights[id] != null) {
			result[id] = { kind: "fixed", heightPx: clampBandHeight(heights[id] as number, containerHeight) };
		} else {
			result[id] = { kind: "auto" };
		}
	}
	return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sidebar-bands-layout.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/utils/sidebar-bands.ts apps/desktop/tests/sidebar-bands-layout.test.ts
git commit -m "feat(sidebar): pure band layout helper"
```

---

## Task 2: Band store with persistence + migration

**Files:**
- Create: `apps/desktop/src/renderer/stores/sidebar-bands.ts`
- Test: `apps/desktop/tests/sidebar-bands-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/sidebar-bands-store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import {
	defaultBandState,
	parsePersisted,
	sanitizeOrder,
	useSidebarBandsStore,
} from "../src/renderer/stores/sidebar-bands";

describe("sanitizeOrder", () => {
	test("returns the three ids in default order for empty input", () => {
		expect(sanitizeOrder([])).toEqual(["folders", "repositories", "orchestrators"]);
	});
	test("dedupes and drops unknown ids, appends missing in default order", () => {
		expect(sanitizeOrder(["orchestrators", "orchestrators", "bogus"])).toEqual([
			"orchestrators",
			"folders",
			"repositories",
		]);
	});
});

describe("parsePersisted", () => {
	test("defaults when raw is null and no legacy key", () => {
		expect(parsePersisted(null, null)).toEqual(defaultBandState());
	});
	test("valid JSON overrides defaults and ignores legacy", () => {
		const raw = JSON.stringify({
			order: ["orchestrators", "repositories", "folders"],
			open: { orchestrators: false },
			heights: { folders: 150 },
		});
		const s = parsePersisted(raw, "false");
		expect(s.order).toEqual(["orchestrators", "repositories", "folders"]);
		expect(s.open.orchestrators).toBe(false);
		expect(s.open.repositories).toBe(true);
		expect(s.heights.folders).toBe(150);
	});
	test("corrupt JSON falls back to defaults", () => {
		expect(parsePersisted("{not json", null)).toEqual(defaultBandState());
	});
	test("legacy orchCollapsed=true seeds orchestrators closed", () => {
		expect(parsePersisted(null, "true").open.orchestrators).toBe(false);
	});
	test("legacy orchCollapsed=false seeds orchestrators open", () => {
		expect(parsePersisted(null, "false").open.orchestrators).toBe(true);
	});
});

describe("useSidebarBandsStore", () => {
	beforeEach(() => {
		useSidebarBandsStore.setState({ ...defaultBandState(), hydrated: false });
	});
	test("toggleOpen flips a band", () => {
		useSidebarBandsStore.getState().toggleOpen("folders");
		expect(useSidebarBandsStore.getState().open.folders).toBe(false);
		useSidebarBandsStore.getState().toggleOpen("folders");
		expect(useSidebarBandsStore.getState().open.folders).toBe(true);
	});
	test("setOrder sanitizes input", () => {
		useSidebarBandsStore.getState().setOrder(["orchestrators"] as never);
		expect(useSidebarBandsStore.getState().order).toEqual([
			"orchestrators",
			"folders",
			"repositories",
		]);
	});
	test("setHeight stores an explicit height and null resets it", () => {
		useSidebarBandsStore.getState().setHeight("repositories", 240);
		expect(useSidebarBandsStore.getState().heights.repositories).toBe(240);
		useSidebarBandsStore.getState().setHeight("repositories", null);
		expect(useSidebarBandsStore.getState().heights.repositories).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sidebar-bands-store.test.ts`
Expected: FAIL — module `../src/renderer/stores/sidebar-bands` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/desktop/src/renderer/stores/sidebar-bands.ts`:

```ts
import { create } from "zustand";
import { ALL_BANDS, type BandId } from "../utils/sidebar-bands";

const STORAGE_KEY = "ss.sidebar.bands.v1";
const LEGACY_ORCH_COLLAPSED = "ss.sidebar.orchCollapsed";

export interface BandPersistedState {
	order: BandId[];
	open: Record<BandId, boolean>;
	heights: Record<BandId, number | null>;
}

export function defaultBandState(): BandPersistedState {
	return {
		order: [...ALL_BANDS],
		open: { folders: true, repositories: true, orchestrators: true },
		heights: { folders: null, repositories: null, orchestrators: null },
	};
}

export function sanitizeOrder(input: unknown[]): BandId[] {
	const seen = new Set<BandId>();
	const out: BandId[] = [];
	for (const x of input) {
		if (ALL_BANDS.includes(x as BandId) && !seen.has(x as BandId)) {
			out.push(x as BandId);
			seen.add(x as BandId);
		}
	}
	for (const id of ALL_BANDS) {
		if (!seen.has(id)) out.push(id);
	}
	return out;
}

export function parsePersisted(
	raw: string | null,
	legacyOrchCollapsed: string | null
): BandPersistedState {
	const base = defaultBandState();
	if (raw) {
		try {
			const p = JSON.parse(raw) as Partial<BandPersistedState>;
			if (Array.isArray(p.order)) base.order = sanitizeOrder(p.order);
			if (p.open && typeof p.open === "object") {
				for (const id of ALL_BANDS) {
					if (typeof p.open[id] === "boolean") base.open[id] = p.open[id] as boolean;
				}
			}
			if (p.heights && typeof p.heights === "object") {
				for (const id of ALL_BANDS) {
					const h = p.heights[id];
					if (typeof h === "number" || h === null) base.heights[id] = h;
				}
			}
			return base;
		} catch {
			return defaultBandState();
		}
	}
	if (legacyOrchCollapsed != null) {
		base.open.orchestrators = legacyOrchCollapsed !== "true";
	}
	return base;
}

function readStorage(): BandPersistedState {
	if (typeof window === "undefined") return defaultBandState();
	try {
		return parsePersisted(
			window.localStorage.getItem(STORAGE_KEY),
			window.localStorage.getItem(LEGACY_ORCH_COLLAPSED)
		);
	} catch {
		return defaultBandState();
	}
}

function writeStorage(state: BandPersistedState): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ order: state.order, open: state.open, heights: state.heights })
		);
	} catch {}
}

interface SidebarBandsStore extends BandPersistedState {
	hydrated: boolean;
	hydrate: () => void;
	toggleOpen: (id: BandId) => void;
	setOrder: (order: BandId[]) => void;
	setHeight: (id: BandId, height: number | null) => void;
}

export const useSidebarBandsStore = create<SidebarBandsStore>((set, get) => ({
	...defaultBandState(),
	hydrated: false,
	hydrate: () => {
		if (get().hydrated) return;
		set({ ...readStorage(), hydrated: true });
	},
	toggleOpen: (id) => {
		set((s) => ({ open: { ...s.open, [id]: !s.open[id] } }));
		writeStorage(get());
	},
	setOrder: (order) => {
		set({ order: sanitizeOrder(order) });
		writeStorage(get());
	},
	setHeight: (id, height) => {
		set((s) => ({ heights: { ...s.heights, [id]: height } }));
		writeStorage(get());
	},
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sidebar-bands-store.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/sidebar-bands.ts apps/desktop/tests/sidebar-bands-store.test.ts
git commit -m "feat(sidebar): band store with persistence and orch-collapse migration"
```

---

## Task 3: Section header — chevron + drag grip

**Files:**
- Modify: `apps/desktop/src/renderer/components/SidebarSectionHeader.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `apps/desktop/src/renderer/components/SidebarSectionHeader.tsx` with:

```tsx
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

export function SidebarSectionHeader({
	title,
	count,
	onNew,
	newLabel,
	onToggle,
	expanded,
	className,
	dragHandle,
}: {
	title: string;
	count?: number;
	onNew: () => void;
	newLabel: string;
	onToggle?: () => void;
	expanded?: boolean;
	className?: string;
	dragHandle?: { attributes: DraggableAttributes; listeners: SyntheticListenerMap | undefined };
}) {
	const titleContent = (
		<>
			{onToggle && (
				<svg
					aria-hidden="true"
					width="9"
					height="9"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="3"
					strokeLinecap="round"
					strokeLinejoin="round"
					className={`shrink-0 text-[var(--text-quaternary)] transition-transform duration-[120ms] ${
						expanded ? "rotate-90" : ""
					}`}
				>
					<path d="M9 18l6-6-6-6" />
				</svg>
			)}
			<span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
				{title}
			</span>
			{count != null && count > 0 && (
				<span className="shrink-0 rounded-full bg-[var(--bg-overlay)] px-[7px] py-[1px] text-[10px] font-semibold tabular-nums text-[var(--text-tertiary)]">
					{count}
				</span>
			)}
		</>
	);

	return (
		<div className={["flex items-center gap-2 px-3 pb-[8px] pt-[14px]", className ?? ""].join(" ")}>
			{onToggle ? (
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={expanded}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					{titleContent}
				</button>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-2">{titleContent}</div>
			)}
			<div className="flex shrink-0 items-center gap-1">
				{dragHandle && (
					<button
						type="button"
						aria-label="Reorder section"
						className="cursor-grab touch-none px-1 text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:text-[var(--text-secondary)] active:cursor-grabbing"
						{...dragHandle.attributes}
						{...dragHandle.listeners}
					>
						<svg
							aria-hidden="true"
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<circle cx="9" cy="6" r="1.6" />
							<circle cx="15" cy="6" r="1.6" />
							<circle cx="9" cy="12" r="1.6" />
							<circle cx="15" cy="12" r="1.6" />
							<circle cx="9" cy="18" r="1.6" />
							<circle cx="15" cy="18" r="1.6" />
						</svg>
					</button>
				)}
				<button
					type="button"
					onClick={onNew}
					title={newLabel}
					className="flex shrink-0 items-center gap-1 rounded-[6px] border border-[var(--border-subtle)] px-2 py-[3px] text-[12px] text-[var(--text-secondary)] transition-colors duration-[120ms] hover:border-[var(--border-active)] hover:text-[var(--text)]"
				>
					<span className="text-[13px] leading-none">+</span>
					New
				</button>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Type-check**

Run: `bun run type-check`
Expected: PASS (no errors introduced by this file).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/SidebarSectionHeader.tsx
git commit -m "feat(sidebar): chevron + drag grip in section header"
```

---

## Task 4: Band body components

**Files:**
- Create: `apps/desktop/src/renderer/components/FolderList.tsx`
- Create: `apps/desktop/src/renderer/components/RepositoryList.tsx`
- Create: `apps/desktop/src/renderer/components/OrchestratorList.tsx`

- [ ] **Step 1: Create `FolderList.tsx`**

```tsx
import type { ComponentProps } from "react";
import { useProjectStore } from "../stores/projects";
import { ProjectItem } from "./ProjectItem";

type ProjectRow = ComponentProps<typeof ProjectItem>["project"];

export function FolderList({ items }: { items: ProjectRow[] }) {
	const { expandedProjectIds, toggleProjectExpanded } = useProjectStore();
	return (
		<div className="flex flex-col gap-2">
			{items.map((project) => (
				<ProjectItem
					key={project.id}
					project={project}
					isExpanded={expandedProjectIds.has(project.id)}
					onToggle={() => toggleProjectExpanded(project.id)}
				/>
			))}
		</div>
	);
}
```

- [ ] **Step 2: Create `RepositoryList.tsx`**

```tsx
import type { ComponentProps } from "react";
import { useProjectStore } from "../stores/projects";
import { ProjectItem } from "./ProjectItem";

type ProjectRow = ComponentProps<typeof ProjectItem>["project"];

export function RepositoryList({ items }: { items: ProjectRow[] }) {
	const { expandedProjectIds, toggleProjectExpanded } = useProjectStore();
	return (
		<div className="flex flex-col gap-2">
			{items.map((project) => (
				<ProjectItem
					key={project.id}
					project={project}
					isExpanded={expandedProjectIds.has(project.id)}
					onToggle={() => toggleProjectExpanded(project.id)}
				/>
			))}
		</div>
	);
}
```

- [ ] **Step 3: Create `OrchestratorList.tsx`** (body extracted from `CrossRepoOrchestratorGroup`, header/collapse removed)

```tsx
import { usePaneStore } from "../stores/pane-store";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CrossRepoOrchestratorRow } from "./CrossRepoOrchestratorRow";

export function OrchestratorList() {
	const orchs = trpc.crossRepoOrchestrators.list.useQuery();
	const counts = trpc.crossRepoOrchestrators.memberCounts.useQuery(undefined, {
		refetchInterval: 30_000,
	});
	const utils = trpc.useUtils();
	const renameMut = trpc.crossRepoOrchestrators.rename.useMutation({
		onSuccess: () => utils.crossRepoOrchestrators.list.invalidate(),
	});
	const deleteMut = trpc.crossRepoOrchestrators.delete.useMutation({
		onSuccess: (_data, vars) => {
			usePaneStore.getState().clearLayout(vars.id);
			useTabStore.getState().cleanupWorkspace(vars.id);
			utils.crossRepoOrchestrators.list.invalidate();
			utils.workspaces.listByProject.invalidate();
		},
	});

	const all = orchs.data ?? [];
	if (all.length === 0) return null;

	return (
		<div className="flex flex-col gap-2">
			{all.map((o) => (
				<CrossRepoOrchestratorRow
					key={o.id}
					orchestrator={o}
					counts={counts.data?.[o.id] ?? { total: 0, working: 0, blocked: 0 }}
					onRename={() => {
						const name = window.prompt("Rename cross-repo orchestrator", o.name);
						if (name?.trim()) renameMut.mutate({ id: o.id, name: name.trim() });
					}}
					onDelete={async () => {
						if (!window.confirm(`Delete "${o.name}"?`)) return;
						const members = await utils.crossRepoOrchestrators.listMembers.fetch({ id: o.id });
						const n = members.filter((m) => m.createdByDispatch).length;
						let removeWorkspaces = false;
						if (n > 0) {
							removeWorkspaces = window.confirm(
								`Also permanently delete ${n} worktree workspace${n === 1 ? "" : "s"} this orchestrator created, including any uncommitted changes? Cancel keeps them.`
							);
						}
						deleteMut.mutate({ id: o.id, removeWorkspaces });
					}}
				/>
			))}
		</div>
	);
}
```

- [ ] **Step 4: Type-check**

Run: `bun run type-check`
Expected: PASS. (`ProjectList.tsx` and `CrossRepoOrchestratorGroup.tsx` still exist and are still imported by `Sidebar.tsx` at this point — they are removed in Task 7. The `useProjectStore` orchestrator-pane fields they read still exist until Task 7.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/FolderList.tsx apps/desktop/src/renderer/components/RepositoryList.tsx apps/desktop/src/renderer/components/OrchestratorList.tsx
git commit -m "feat(sidebar): extract folder/repository/orchestrator band bodies"
```

---

## Task 5: Generic `SidebarBand`

**Files:**
- Create: `apps/desktop/src/renderer/components/SidebarBand.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import type { BandId, BandStyle } from "../utils/sidebar-bands";
import { SidebarSectionHeader } from "./SidebarSectionHeader";

const BODY_CLASS = "flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2";

/** Outer sizing classes per resolved style (collapsed/hidden handled by caller). */
function sizingClass(style: BandStyle): string {
	switch (style.kind) {
		case "flex":
			return "flex min-h-0 flex-1 flex-col";
		case "fixed":
			return "flex min-h-0 shrink-0 flex-col";
		case "auto":
			return "flex max-h-[40%] shrink-0 flex-col";
		default:
			// collapsed: header only, no body
			return "flex shrink-0 flex-col";
	}
}

export function SidebarBand({
	id,
	title,
	count,
	onNew,
	newLabel,
	isOpen,
	onToggleOpen,
	style,
	children,
}: {
	id: BandId;
	title: string;
	count: number;
	onNew: () => void;
	newLabel: string;
	isOpen: boolean;
	onToggleOpen: () => void;
	style: BandStyle;
	children: ReactNode;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
	});

	const heightStyle =
		style.kind === "fixed" ? { height: `${style.heightPx}px` } : undefined;

	return (
		<div
			ref={setNodeRef}
			className={`border-b border-[var(--border-subtle)] ${sizingClass(style)}`}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				zIndex: isDragging ? 20 : undefined,
				opacity: isDragging ? 0.85 : 1,
				...heightStyle,
			}}
		>
			<SidebarSectionHeader
				title={title}
				count={count}
				onNew={onNew}
				newLabel={newLabel}
				onToggle={onToggleOpen}
				expanded={isOpen}
				className="shrink-0 bg-[var(--bg-surface)]"
				dragHandle={{ attributes, listeners }}
			/>
			{isOpen && <div className={BODY_CLASS}>{children}</div>}
		</div>
	);
}
```

- [ ] **Step 2: Type-check**

Run: `bun run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/SidebarBand.tsx
git commit -m "feat(sidebar): generic collapsible sortable band"
```

---

## Task 6: `SidebarBandStack`

**Files:**
- Create: `apps/desktop/src/renderer/components/SidebarBandStack.tsx`

- [ ] **Step 1: Create the file**

```tsx
import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSidebarBandsStore } from "../stores/sidebar-bands";
import { type BandId, clampBandHeight, computeBandLayout } from "../utils/sidebar-bands";
import { SidebarBand } from "./SidebarBand";

export interface BandDescriptor {
	id: BandId;
	title: string;
	count: number;
	onNew: () => void;
	newLabel: string;
	present: boolean;
	body: ReactNode;
}

/** Draggable resize handle. Sets the upper band's explicit height from the
 * pointer position relative to that band's top edge (its DOM previous sibling). */
function BandDivider({
	upperId,
	onResize,
}: {
	upperId: BandId;
	onResize: (id: BandId, rawHeight: number) => void;
}) {
	const ref = useRef<HTMLHRElement>(null);
	const topRef = useRef(0);

	const startDrag = (e: React.PointerEvent) => {
		if (!ref.current) return;
		e.preventDefault();
		const prev = ref.current.previousElementSibling as HTMLElement | null;
		topRef.current = prev ? prev.getBoundingClientRect().top : 0;
		document.body.style.cursor = "row-resize";
		const move = (ev: PointerEvent) => onResize(upperId, ev.clientY - topRef.current);
		const end = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
			document.body.style.cursor = "";
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
	};

	return (
		<hr
			ref={ref}
			onPointerDown={startDrag}
			aria-orientation="horizontal"
			tabIndex={0}
			className="group relative m-0 h-[7px] shrink-0 cursor-row-resize border-0 bg-transparent p-0 outline-none before:absolute before:inset-x-0 before:top-[3px] before:block before:h-px before:bg-[var(--border-subtle)] hover:before:bg-[var(--border-active)]"
		/>
	);
}

export function SidebarBandStack({ bands }: { bands: BandDescriptor[] }) {
	const order = useSidebarBandsStore((s) => s.order);
	const open = useSidebarBandsStore((s) => s.open);
	const heights = useSidebarBandsStore((s) => s.heights);
	const hydrate = useSidebarBandsStore((s) => s.hydrate);
	const toggleOpen = useSidebarBandsStore((s) => s.toggleOpen);
	const setOrder = useSidebarBandsStore((s) => s.setOrder);
	const setHeight = useSidebarBandsStore((s) => s.setHeight);

	useEffect(() => hydrate(), [hydrate]);

	const rootRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(0);
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
		ro.observe(el);
		setContainerHeight(el.clientHeight);
		return () => ro.disconnect();
	}, []);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
	);

	const byId = new Map(bands.map((b) => [b.id, b]));
	const present = {
		folders: byId.get("folders")?.present ?? false,
		repositories: byId.get("repositories")?.present ?? false,
		orchestrators: byId.get("orchestrators")?.present ?? false,
	};

	const layout = computeBandLayout({
		order,
		present,
		open,
		heights,
		preferredFlex: "repositories",
		containerHeight: containerHeight || 600,
	});

	const rendered = order.filter((id) => present[id]);

	const onDragEnd = (e: DragEndEvent) => {
		const { active, over } = e;
		if (!over || active.id === over.id) return;
		const from = order.indexOf(active.id as BandId);
		const to = order.indexOf(over.id as BandId);
		if (from === -1 || to === -1) return;
		setOrder(arrayMove(order, from, to));
	};

	const onResize = (id: BandId, rawHeight: number) =>
		setHeight(id, clampBandHeight(rawHeight, containerHeight || 600));

	return (
		<div ref={rootRef} className="flex h-full min-h-0 flex-col">
			<DndContext sensors={sensors} onDragEnd={onDragEnd}>
				<SortableContext items={rendered} strategy={verticalListSortingStrategy}>
					{rendered.map((id, idx) => {
						const band = byId.get(id);
						if (!band) return null;
						const isLast = idx === rendered.length - 1;
						return (
							<SidebarBand
								key={id}
								id={id}
								title={band.title}
								count={band.count}
								onNew={band.onNew}
								newLabel={band.newLabel}
								isOpen={open[id]}
								onToggleOpen={() => toggleOpen(id)}
								style={layout[id]}
							>
								{band.body}
							</SidebarBand>
						);
						// Divider rendered below via fragment in the same map iteration:
					})}
				</SortableContext>
			</DndContext>
		</div>
	);
}
```

> Note: dividers are added in Step 2 (the map above returns only bands so the diff is reviewable in two passes).

- [ ] **Step 2: Add resize dividers between open bands**

Replace the `rendered.map(...)` block inside `<SortableContext>` with this version that interleaves a `BandDivider` after each open, non-last band:

```tsx
					{rendered.map((id, idx) => {
						const band = byId.get(id);
						if (!band) return null;
						const isLast = idx === rendered.length - 1;
						const showDivider = !isLast && open[id];
						return (
							<div key={id} className="contents">
								<SidebarBand
									id={id}
									title={band.title}
									count={band.count}
									onNew={band.onNew}
									newLabel={band.newLabel}
									isOpen={open[id]}
									onToggleOpen={() => toggleOpen(id)}
									style={layout[id]}
								>
									{band.body}
								</SidebarBand>
								{showDivider && <BandDivider upperId={id} onResize={onResize} />}
							</div>
						);
					})}
```

> `className="contents"` keeps the wrapper from affecting flex layout while giving the divider a real previous sibling (the band div) inside the same flow. The `key` moves to the wrapper.

- [ ] **Step 3: Type-check**

Run: `bun run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/SidebarBandStack.tsx
git commit -m "feat(sidebar): band stack with dnd reorder and resize dividers"
```

---

## Task 7: Wire into `Sidebar.tsx`, remove old code

**Files:**
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`
- Modify: `apps/desktop/src/renderer/stores/projects.ts`
- Modify: `apps/desktop/tests/projects-store.test.ts`
- Delete: `SidebarSplit.tsx`, `ProjectList.tsx`, `CrossRepoOrchestratorGroup.tsx`, `utils/sidebar-split.ts`

- [ ] **Step 1: Update `Sidebar.tsx` imports**

In `apps/desktop/src/renderer/components/Sidebar.tsx`, replace these three imports:

```tsx
import { CrossRepoOrchestratorGroup } from "./CrossRepoOrchestratorGroup";
import { ProjectList } from "./ProjectList";
```
and
```tsx
import { SidebarSplit } from "./SidebarSplit";
```

with:

```tsx
import { FolderList } from "./FolderList";
import { OrchestratorList } from "./OrchestratorList";
import { RepositoryList } from "./RepositoryList";
import { type BandDescriptor, SidebarBandStack } from "./SidebarBandStack";
```

- [ ] **Step 2: Replace the store destructure + build band descriptors**

In `Sidebar.tsx`, replace this line:

```tsx
	const { openSettings } = useProjectStore();
```

with:

```tsx
	const { openSettings, openAddModal, openCreateCrossRepoModal } = useProjectStore();
	const { data: projectsList } = trpc.projects.list.useQuery();
```

Then replace this block:

```tsx
	// Empty orchestrator pane should size to its header, not reserve fixed split height.
	const orchCount = trpc.crossRepoOrchestrators.list.useQuery().data?.length ?? 0;
```

with:

```tsx
	const orchCount = trpc.crossRepoOrchestrators.list.useQuery().data?.length ?? 0;

	const all = projectsList ?? [];
	const folders = all.filter((p) => p.kind === "folder");
	const repos = all.filter((p) => p.kind !== "folder");
	const bands: BandDescriptor[] = [
		{
			id: "folders",
			title: "Folders",
			count: folders.length,
			onNew: openAddModal,
			newLabel: "Add Folder",
			present: folders.length > 0,
			body: <FolderList items={folders} />,
		},
		{
			id: "repositories",
			title: folders.length > 0 ? "Repositories" : "Projects",
			count: repos.length,
			onNew: openAddModal,
			newLabel: "Add Project",
			present: true,
			body: <RepositoryList items={repos} />,
		},
		{
			id: "orchestrators",
			title: "Orchestrators",
			count: orchCount,
			onNew: openCreateCrossRepoModal,
			newLabel: "New Orchestrator",
			present: true,
			body: <OrchestratorList />,
		},
	];
```

- [ ] **Step 3: Replace the `segment === "repos"` block**

Replace:

```tsx
				{segment === "repos" && (
					<SidebarSplit
						top={<ProjectList />}
						bottom={<CrossRepoOrchestratorGroup />}
						bottomAutoHeight={orchCount === 0}
					/>
				)}
```

with:

```tsx
				{segment === "repos" && <SidebarBandStack bands={bands} />}
```

- [ ] **Step 4: Remove orchestrator-pane fields from `projects.ts`**

In `apps/desktop/src/renderer/stores/projects.ts`, delete these interface members:

```tsx
	orchestratorPaneHeight: number;
	orchestratorPaneCollapsed: boolean;
```
```tsx
	setOrchestratorPaneHeight: (height: number) => void;
	toggleOrchestratorPaneCollapsed: () => void;
	setOrchestratorPaneCollapsed: (collapsed: boolean) => void;
```

delete these initial values:

```tsx
	orchestratorPaneHeight: 180,
	orchestratorPaneCollapsed: false,
```

and delete this action block:

```tsx
	setOrchestratorPaneHeight: (height) => set({ orchestratorPaneHeight: height }),
	toggleOrchestratorPaneCollapsed: () =>
		set((s) => ({ orchestratorPaneCollapsed: !s.orchestratorPaneCollapsed })),
	setOrchestratorPaneCollapsed: (collapsed) => set({ orchestratorPaneCollapsed: collapsed }),
```

- [ ] **Step 5: Remove the obsolete test block**

In `apps/desktop/tests/projects-store.test.ts`, delete the entire `describe("orchestrator pane state", ...)` block (lines 40-64 in the current file).

- [ ] **Step 6: Delete the dead files**

```bash
git rm apps/desktop/src/renderer/components/SidebarSplit.tsx \
       apps/desktop/src/renderer/components/ProjectList.tsx \
       apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx \
       apps/desktop/src/renderer/utils/sidebar-split.ts
```

- [ ] **Step 7: Verify no stale references remain**

Run: `grep -rn "SidebarSplit\|ProjectList\|CrossRepoOrchestratorGroup\|orchestratorPaneHeight\|orchestratorPaneCollapsed\|clampPaneHeight\|sidebar-split" apps/desktop/src apps/desktop/tests`
Expected: no output (all references removed).

- [ ] **Step 8: Type-check + full test suite + lint**

Run: `bun run type-check`
Expected: PASS.

Run: `bun test tests/sidebar-bands-layout.test.ts tests/sidebar-bands-store.test.ts tests/projects-store.test.ts`
Expected: PASS.

Run: `bun run check`
Expected: PASS (Biome formats/lints the new files clean).

- [ ] **Step 9: Commit**

```bash
git add -A apps/desktop/src/renderer apps/desktop/tests
git commit -m "feat(sidebar): unify Folders/Repositories/Orchestrators into reorderable bands"
```

---

## Task 8: Manual QA

**Files:** none (verification only).

- [ ] **Step 1: Launch dev**

Run (from repo root): `bun run dev`

- [ ] **Step 2: Verify each requirement against the running app**

- **Order:** drag the grip (six-dot handle) on a band header up/down — the three bands reorder. Reload the app — the new order persists.
- **Minimise fully:** click each band header — its body collapses to the header row only; chevron rotates. All three behave identically.
- **Switch:** single click any collapsed header re-opens it.
- **Multiple open / focus one:** open all three (they share height; Repositories fills the slack). Close two — the remaining band fills the full height. Reload — open/closed state persists.
- **Resize:** with two bands open, drag the divider between them — the upper band resizes; Repositories absorbs the remainder. Reload — height persists.
- **Migration:** if the app previously had the orchestrator pane collapsed (`ss.sidebar.orchCollapsed=true` in localStorage), the Orchestrators band starts collapsed on first load after upgrade.
- **Regressions:** inside the Repositories band, expand a project and drag-reorder its worktrees (inner dnd) — still works, and does not trigger band reordering. Switch to Tickets and PRs segments — unchanged.

- [ ] **Step 3: Update CLAUDE.md index if a non-obvious fact emerged**

If implementation surfaced a non-obvious durable fact (e.g. the nested-DndContext interaction), add a one-line entry to `CLAUDE.md` per its Maintenance rules and commit `docs: update CLAUDE.md`. Otherwise skip.

---

## Self-Review Notes

- **Spec coverage:** order (Task 6 grip + Task 2 setOrder), minimise fully (Task 3 chevron + Task 5 collapsed render), single-click switch (Task 5 onToggleOpen → Task 2 toggleOpen), multiple-open/focus (Task 1 flex resolution + Task 6 stack), height model (Task 1), persistence + migration (Task 2), edge cases — no folders / empty orchestrators / single open / corrupt JSON (Tasks 1, 2, 4), removal of old layouts (Task 7), tests (Tasks 1, 2). All covered.
- **Type consistency:** `BandId`, `BandStyle`, `computeBandLayout`, `clampBandHeight` (utils) and `defaultBandState`, `parsePersisted`, `sanitizeOrder`, `useSidebarBandsStore`, `BandPersistedState` (store) and `BandDescriptor` (stack) are used with identical signatures everywhere they appear.
- **Note for executor:** Task 6 builds the stack in two passes (bands first, then dividers) so each diff is small; the Step 2 block is the final shape.
