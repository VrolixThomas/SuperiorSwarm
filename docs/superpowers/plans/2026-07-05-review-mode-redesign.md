# Review Mode (Full-Window PR Review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped right-rail PR review UI with a full-window Review Mode: left navigator, three content views (Overview / Changes / Comments), one unified thread component, one submit flow.

**Architecture:** Review Mode renders as a fixed full-window overlay above the existing 3-pane shell (the shell stays mounted so terminals survive). A new zustand `review-mode-store` holds the open PR + active view; the existing `pr-review-session-store` keeps per-PR file/thread state. All server data stays in the existing tRPC routers (`github.*`, `aiReview.*`, `projects.*`, `diff.*`) — zero backend changes. Old components (`PRControlRail`, `PROverviewTab`, `PRReviewFileTab`, `SubmitReviewModal`, etc.) are deleted at the end.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4 with CSS-variable tokens, zustand, tRPC over IPC, Monaco diff editor, bun test.

**Spec:** `docs/superpowers/specs/2026-07-05-review-mode-redesign-design.md` — read it before starting any task.

## Global Constraints

- Biome formatting: tabs, line width 100, double quotes, semicolons, ES5 trailing commas. Run `bun run check` before every commit.
- Never use `npm`/`yarn`; always `bun`. Never add `Co-Authored-By` trailers. Never bypass pre-commit hooks.
- All commands run from `apps/desktop/` unless stated otherwise (tests: `bun test tests/<file>`; type check from repo root: `bun run type-check`).
- Font-size floor is 11px (`text-[11px]`). Never emit `text-[9px]` or `text-[10px]` in new code.
- Colors/spacing/radii come from existing CSS variables in `apps/desktop/src/renderer/styles.css` (`--bg-*`, `--text*`, `--border*`, `--accent`, `--color-*`, `--radius-*`). No new colors, no hex literals in components.
- Accent color only for: primary action (Submit review), active/selected states, focus rings. AI purple only via the existing `.ai-badge` class and gutter decorations.
- Cross-process/shared types go in `apps/desktop/src/shared/`, never inline in renderer code.
- New files stay under ~300 lines. If a task's file grows past that, split it.
- `docs/` is gitignored; plan/spec commits need `git add -f`. Source commits are normal.
- The graphify rebuild hook may print "Rebuild failed: No module named 'graphify'" on commit — ignore it, it is not a failure of your commit.

## File Structure (target)

```
apps/desktop/src/renderer/
  components/review-mode/
    ReviewModeShell.tsx          overlay: header + navigator + content + drawer
    ReviewHeader.tsx             back, title, view switcher, agent chip, submit
    SubmitReviewPopover.tsx
    AgentStatusChip.tsx
    TerminalDrawer.tsx
    navigator/
      ReviewNavigator.tsx        meta block + Files + Comments sections
      FileSection.tsx
      ThreadSection.tsx
    views/
      OverviewView.tsx
      ChangesView.tsx
      CommentsView.tsx
    thread/
      ThreadCard.tsx             variants: inline | full | row
      ReplyComposer.tsx
      ThreadActions.tsx
      ThreadStatusChip.tsx
      DiffContextSnippet.tsx
    hooks/
      useReviewKeymap.ts
      useInlineCommentZones.ts   extracted from PRReviewFileTab.tsx
      useThreadDecorations.ts    extracted
      useGutterPlusButton.ts     extracted
  lib/
    pr-review-threads.ts         thread mapping/sorting/filtering (single source)
    pr-review-submit.ts          pure submit loop
    review-keymap.ts             pure key → action mapping
    review-mode-nav.ts           open file/thread helpers
  stores/
    review-mode-store.ts
apps/desktop/tests/
  pr-review-threads.test.ts
  pr-review-submit.test.ts
  review-keymap.test.ts
  review-mode-store.test.ts
```

---

### Task 1: Thread logic library `pr-review-threads.ts`

Single source for the mapping/sorting/filtering logic currently copy-pasted across `PRControlRail.tsx:794-959`, `PROverviewTab.tsx:817-837`, and `PRReviewFileTab.tsx:897-993`.

**Files:**
- Create: `apps/desktop/src/renderer/lib/pr-review-threads.ts`
- Test: `apps/desktop/tests/pr-review-threads.test.ts`

**Interfaces:**
- Consumes: `AIDraftThread`, `GitHubReviewThread`, `UnifiedThread` from `src/shared/github-types.ts`; `DiffHunk`, `DiffLine` from `src/shared/diff-types.ts`.
- Produces (used by Tasks 2, 4-13):
  - `type ThreadFilter = "all" | "pending" | "accepted" | "declined" | "open" | "resolved"`
  - `type ThreadBucket = Exclude<ThreadFilter, "all">`
  - `type CondensedFilter = "all" | "attention" | "done"`
  - `CONDENSED_TO_FILTERS: Record<CondensedFilter, ThreadFilter[]>`
  - `threadBucket(t: UnifiedThread): ThreadBucket`
  - `matchesFilter(t: UnifiedThread, f: ThreadFilter): boolean`
  - `threadCounts(threads: UnifiedThread[]): Record<ThreadFilter, number>`
  - `mapDraftComment(c: DraftCommentLike, roundNumber?: number): AIDraftThread`
  - `pickLatestDraft<T extends DraftLike>(drafts: T[] | undefined, prIdentifier: string): T | undefined`
  - `groupThreadsByFile(threads: UnifiedThread[], fileOrder: string[]): Array<{ path: string; threads: UnifiedThread[] }>`
  - `threadAuthor(t: UnifiedThread): string`, `threadDate(t: UnifiedThread): string`, `threadExcerpt(t: UnifiedThread): string`
  - `extractDiffContext(hunks: DiffHunk[], line: number, context?: number): DiffLine[]`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/pr-review-threads.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { AIDraftThread, UnifiedThread } from "../src/shared/github-types";
import type { DiffHunk } from "../src/shared/diff-types";
import {
	CONDENSED_TO_FILTERS,
	extractDiffContext,
	groupThreadsByFile,
	mapDraftComment,
	matchesFilter,
	pickLatestDraft,
	threadBucket,
	threadCounts,
	threadExcerpt,
} from "../src/renderer/lib/pr-review-threads";

function aiThread(overrides: Partial<AIDraftThread> = {}): AIDraftThread {
	return {
		id: "ai-1",
		isAIDraft: true,
		draftCommentId: "1",
		path: "src/a.ts",
		line: 10,
		diffSide: "RIGHT",
		body: "First line of body\nSecond line",
		status: "pending",
		userEdit: null,
		createdAt: "2026-07-01T00:00:00Z",
		...overrides,
	};
}

function ghThread(overrides: Record<string, unknown> = {}): UnifiedThread {
	return {
		id: "gh-1",
		isResolved: false,
		path: "src/b.ts",
		line: 5,
		diffSide: "RIGHT",
		comments: [
			{
				id: "c1",
				body: "GH comment body",
				author: "alice",
				authorAvatarUrl: "",
				createdAt: "2026-07-02T00:00:00Z",
			},
		],
		...overrides,
	} as UnifiedThread;
}

describe("threadBucket", () => {
	test("AI statuses map to buckets", () => {
		expect(threadBucket(aiThread({ status: "pending" }))).toBe("pending");
		expect(threadBucket(aiThread({ status: "edited" }))).toBe("pending");
		expect(threadBucket(aiThread({ status: "error" }))).toBe("pending");
		expect(threadBucket(aiThread({ status: "user-pending" }))).toBe("accepted");
		expect(threadBucket(aiThread({ status: "approved" }))).toBe("accepted");
		expect(threadBucket(aiThread({ status: "rejected" }))).toBe("declined");
		expect(threadBucket(aiThread({ status: "submitted" }))).toBe("resolved");
	});
	test("GitHub threads map by isResolved", () => {
		expect(threadBucket(ghThread())).toBe("open");
		expect(threadBucket(ghThread({ isResolved: true }))).toBe("resolved");
	});
});

describe("matchesFilter / threadCounts / condensed", () => {
	const threads: UnifiedThread[] = [
		aiThread(),
		aiThread({ id: "ai-2", draftCommentId: "2", status: "user-pending" }),
		ghThread(),
		ghThread({ id: "gh-2", isResolved: true }),
	];
	test("all matches everything", () => {
		expect(threads.every((t) => matchesFilter(t, "all"))).toBe(true);
	});
	test("counts per bucket", () => {
		const c = threadCounts(threads);
		expect(c.all).toBe(4);
		expect(c.pending).toBe(1);
		expect(c.accepted).toBe(1);
		expect(c.open).toBe(1);
		expect(c.resolved).toBe(1);
		expect(c.declined).toBe(0);
	});
	test("condensed attention covers pending + open", () => {
		expect(CONDENSED_TO_FILTERS.attention).toEqual(["pending", "open"]);
		expect(CONDENSED_TO_FILTERS.done).toEqual(["declined", "resolved"]);
	});
});

describe("mapDraftComment", () => {
	test("maps raw draft comment to AIDraftThread", () => {
		const t = mapDraftComment(
			{
				id: "42",
				filePath: "src/x.ts",
				lineNumber: 7,
				side: null,
				body: "b",
				status: "pending",
				userEdit: null,
				createdAt: new Date("2026-07-01T00:00:00Z"),
				resolution: null,
			},
			3
		);
		expect(t.id).toBe("ai-42");
		expect(t.draftCommentId).toBe("42");
		expect(t.path).toBe("src/x.ts");
		expect(t.diffSide).toBe("RIGHT");
		expect(t.createdAt).toBe("2026-07-01T00:00:00.000Z");
		expect(t.roundNumber).toBe(3);
	});
});

describe("pickLatestDraft", () => {
	test("prefers ready > in_progress > queued, then highest round", () => {
		const drafts = [
			{ id: "a", prIdentifier: "p", status: "queued", roundNumber: 5 },
			{ id: "b", prIdentifier: "p", status: "ready", roundNumber: 1 },
			{ id: "c", prIdentifier: "p", status: "ready", roundNumber: 2 },
			{ id: "d", prIdentifier: "other", status: "ready", roundNumber: 9 },
		];
		expect(pickLatestDraft(drafts, "p")?.id).toBe("c");
		expect(pickLatestDraft([], "p")).toBeUndefined();
		expect(pickLatestDraft(undefined, "p")).toBeUndefined();
	});
});

describe("groupThreadsByFile", () => {
	test("groups in fileOrder, sorts by line, unknown files last", () => {
		const threads = [
			ghThread({ id: "g1", path: "src/b.ts", line: 20 }),
			ghThread({ id: "g2", path: "src/b.ts", line: 3 }),
			aiThread({ id: "a1", path: "src/a.ts", line: 1 }),
			ghThread({ id: "g3", path: "src/zz.ts", line: 1 }),
		];
		const groups = groupThreadsByFile(threads, ["src/b.ts", "src/a.ts"]);
		expect(groups.map((g) => g.path)).toEqual(["src/b.ts", "src/a.ts", "src/zz.ts"]);
		expect(groups[0]?.threads.map((t) => t.id)).toEqual(["g2", "g1"]);
	});
});

describe("threadExcerpt", () => {
	test("first line of AI body, honoring userEdit", () => {
		expect(threadExcerpt(aiThread())).toBe("First line of body");
		expect(threadExcerpt(aiThread({ userEdit: "Edited\nmore" }))).toBe("Edited");
	});
	test("first comment body for GitHub threads", () => {
		expect(threadExcerpt(ghThread())).toBe("GH comment body");
	});
});

describe("extractDiffContext", () => {
	const hunks: DiffHunk[] = [
		{
			header: "@@",
			oldStart: 1,
			oldLines: 5,
			newStart: 1,
			newLines: 6,
			lines: [
				{ type: "context", content: "l1", oldLineNumber: 1, newLineNumber: 1 },
				{ type: "added", content: "l2", newLineNumber: 2 },
				{ type: "context", content: "l3", oldLineNumber: 2, newLineNumber: 3 },
				{ type: "added", content: "l4", newLineNumber: 4 },
				{ type: "context", content: "l5", oldLineNumber: 3, newLineNumber: 5 },
				{ type: "context", content: "l6", oldLineNumber: 4, newLineNumber: 6 },
			],
		},
	];
	test("returns window around the target line", () => {
		const ctx = extractDiffContext(hunks, 4, 2);
		expect(ctx.map((l) => l.content)).toEqual(["l2", "l3", "l4", "l5", "l6"]);
	});
	test("empty when line not in any hunk", () => {
		expect(extractDiffContext(hunks, 99, 2)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/pr-review-threads.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/lib/pr-review-threads`.

- [ ] **Step 3: Implement `pr-review-threads.ts`**

Create `apps/desktop/src/renderer/lib/pr-review-threads.ts`:

```ts
import type { DiffHunk, DiffLine } from "../../shared/diff-types";
import type { AIDraftThread, GitHubReviewThread, UnifiedThread } from "../../shared/github-types";

// ── Filters ───────────────────────────────────────────────────────────────────

export type ThreadFilter = "all" | "pending" | "accepted" | "declined" | "open" | "resolved";
export type ThreadBucket = Exclude<ThreadFilter, "all">;
export type CondensedFilter = "all" | "attention" | "done";

export const CONDENSED_TO_FILTERS: Record<CondensedFilter, ThreadFilter[]> = {
	all: ["all"],
	attention: ["pending", "open"],
	done: ["declined", "resolved"],
};

export function threadBucket(t: UnifiedThread): ThreadBucket {
	if (t.isAIDraft) {
		switch (t.status) {
			case "pending":
			case "edited":
			case "error":
				return "pending";
			case "user-pending":
			case "approved":
				return "accepted";
			case "rejected":
				return "declined";
			case "submitted":
				return "resolved";
		}
	}
	return (t as GitHubReviewThread).isResolved ? "resolved" : "open";
}

export function matchesFilter(t: UnifiedThread, f: ThreadFilter): boolean {
	return f === "all" || threadBucket(t) === f;
}

export function threadCounts(threads: UnifiedThread[]): Record<ThreadFilter, number> {
	const counts: Record<ThreadFilter, number> = {
		all: threads.length,
		pending: 0,
		accepted: 0,
		declined: 0,
		open: 0,
		resolved: 0,
	};
	for (const t of threads) counts[threadBucket(t)]++;
	return counts;
}

// ── Draft mapping (was duplicated in PRControlRail/PROverviewTab/PRReviewFileTab)

export interface DraftCommentLike {
	id: string;
	filePath: string;
	lineNumber: number | null;
	side?: string | null;
	body: string;
	status: string;
	userEdit?: string | null;
	createdAt: string | Date;
	resolution?: string | null;
}

export function mapDraftComment(c: DraftCommentLike, roundNumber?: number): AIDraftThread {
	return {
		id: `ai-${c.id}`,
		isAIDraft: true,
		draftCommentId: c.id,
		path: c.filePath,
		line: c.lineNumber,
		diffSide: (c.side as "LEFT" | "RIGHT" | null) ?? "RIGHT",
		body: c.body,
		status: c.status as AIDraftThread["status"],
		userEdit: c.userEdit ?? null,
		createdAt: typeof c.createdAt === "string" ? c.createdAt : c.createdAt.toISOString(),
		resolution: c.resolution ?? null,
		roundNumber,
	};
}

export interface DraftLike {
	id: string;
	prIdentifier: string;
	status: string;
	roundNumber?: number | null;
}

const DRAFT_STATUS_PRIORITY: Record<string, number> = {
	ready: 0,
	in_progress: 1,
	queued: 2,
	submitted: 3,
	failed: 4,
};

/** Latest actionable draft for a PR: prefer ready > in_progress > queued, then highest round. */
export function pickLatestDraft<T extends DraftLike>(
	drafts: T[] | undefined,
	prIdentifier: string
): T | undefined {
	const matching = drafts?.filter((d) => d.prIdentifier === prIdentifier) ?? [];
	if (matching.length === 0) return undefined;
	return [...matching].sort((a, b) => {
		const pa = DRAFT_STATUS_PRIORITY[a.status] ?? 5;
		const pb = DRAFT_STATUS_PRIORITY[b.status] ?? 5;
		if (pa !== pb) return pa - pb;
		return (b.roundNumber ?? 1) - (a.roundNumber ?? 1);
	})[0];
}

// ── Grouping / display helpers ────────────────────────────────────────────────

export function groupThreadsByFile(
	threads: UnifiedThread[],
	fileOrder: string[]
): Array<{ path: string; threads: UnifiedThread[] }> {
	const byPath = new Map<string, UnifiedThread[]>();
	for (const t of threads) {
		const list = byPath.get(t.path);
		if (list) list.push(t);
		else byPath.set(t.path, [t]);
	}
	const orderIdx = new Map(fileOrder.map((p, i) => [p, i]));
	const paths = [...byPath.keys()].sort((a, b) => {
		const ia = orderIdx.get(a) ?? Number.MAX_SAFE_INTEGER;
		const ib = orderIdx.get(b) ?? Number.MAX_SAFE_INTEGER;
		return ia !== ib ? ia - ib : a.localeCompare(b);
	});
	return paths.map((path) => ({
		path,
		threads: (byPath.get(path) ?? []).sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
	}));
}

export function threadAuthor(t: UnifiedThread): string {
	if (t.isAIDraft) return "SuperiorSwarm AI";
	return (t as GitHubReviewThread).comments[0]?.author ?? "Unknown";
}

export function threadDate(t: UnifiedThread): string {
	if (t.isAIDraft) return t.createdAt;
	return (t as GitHubReviewThread).comments[0]?.createdAt ?? "";
}

export function threadExcerpt(t: UnifiedThread): string {
	const body = t.isAIDraft
		? (t.userEdit ?? t.body)
		: ((t as GitHubReviewThread).comments[0]?.body ?? "");
	return body.split("\n")[0] ?? "";
}

// ── Diff context for reading view ─────────────────────────────────────────────

/**
 * Lines surrounding `line` (a modified-side line number), `context` lines each
 * direction, clipped to the containing hunk. Empty when the line is in no hunk.
 */
export function extractDiffContext(hunks: DiffHunk[], line: number, context = 2): DiffLine[] {
	for (const hunk of hunks) {
		const idx = hunk.lines.findIndex((l) => l.newLineNumber === line);
		if (idx === -1) continue;
		const start = Math.max(0, idx - context);
		const end = Math.min(hunk.lines.length, idx + context + 1);
		return hunk.lines.slice(start, end);
	}
	return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/pr-review-threads.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/lib/pr-review-threads.ts tests/pr-review-threads.test.ts
git commit -m "feat(review-mode): add unified thread logic library"
```

---

### Task 2: `review-mode-store.ts`

**Files:**
- Create: `apps/desktop/src/renderer/stores/review-mode-store.ts`
- Test: `apps/desktop/tests/review-mode-store.test.ts`

**Interfaces:**
- Consumes: `PRContext` from `src/shared/github-types.ts`; `ThreadFilter` from Task 1.
- Produces (used by Tasks 3-14):

```ts
export type ReviewView = "overview" | "changes" | "comments";
export interface ReviewIntent {
	kind: "reply" | "edit" | "new-comment";
	threadId?: string;
	nonce: number;
}
export interface ReviewTerminal {
	tabId: string;
	workspaceId: string;
	cwd: string;
}
// store fields + actions:
// active: { workspaceId: string; prCtx: PRContext } | null
// view: ReviewView; navigatorCollapsed: boolean; drawerOpen: boolean
// terminal: ReviewTerminal | null; commentFilter: ThreadFilter
// intent: ReviewIntent | null
// open(workspaceId, prCtx); close(); setView(v); toggleNavigator()
// setDrawerOpen(open); setTerminal(t); setCommentFilter(f)
// sendIntent(kind, threadId?); clearIntent()
```

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/review-mode-store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import type { PRContext } from "../src/shared/github-types";
import { useReviewModeStore } from "../src/renderer/stores/review-mode-store";

const prCtx: PRContext = {
	provider: "github",
	owner: "o",
	repo: "r",
	number: 1,
	title: "t",
	sourceBranch: "feat",
	targetBranch: "main",
	repoPath: "/tmp/r",
};

beforeEach(() => {
	useReviewModeStore.getState().close();
});

describe("review-mode-store", () => {
	test("open sets active PR and resets view to overview", () => {
		const s = useReviewModeStore.getState();
		s.setView("comments");
		s.open("ws1", prCtx);
		const st = useReviewModeStore.getState();
		expect(st.active?.workspaceId).toBe("ws1");
		expect(st.view).toBe("overview");
	});

	test("close clears active, drawer, and intent", () => {
		const s = useReviewModeStore.getState();
		s.open("ws1", prCtx);
		s.setDrawerOpen(true);
		s.sendIntent("reply", "t1");
		s.close();
		const st = useReviewModeStore.getState();
		expect(st.active).toBeNull();
		expect(st.drawerOpen).toBe(false);
		expect(st.intent).toBeNull();
	});

	test("sendIntent bumps nonce so identical intents re-fire", () => {
		const s = useReviewModeStore.getState();
		s.sendIntent("edit", "a");
		const n1 = useReviewModeStore.getState().intent?.nonce ?? 0;
		s.sendIntent("edit", "a");
		const n2 = useReviewModeStore.getState().intent?.nonce ?? 0;
		expect(n2).toBeGreaterThan(n1);
	});

	test("toggleNavigator flips flag", () => {
		const before = useReviewModeStore.getState().navigatorCollapsed;
		useReviewModeStore.getState().toggleNavigator();
		expect(useReviewModeStore.getState().navigatorCollapsed).toBe(!before);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/review-mode-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `apps/desktop/src/renderer/stores/review-mode-store.ts`:

```ts
import { create } from "zustand";
import type { PRContext } from "../../shared/github-types";
import type { ThreadFilter } from "../lib/pr-review-threads";

export type ReviewView = "overview" | "changes" | "comments";

export interface ReviewIntent {
	kind: "reply" | "edit" | "new-comment";
	threadId?: string;
	nonce: number;
}

export interface ReviewTerminal {
	tabId: string;
	workspaceId: string;
	cwd: string;
}

export interface ReviewModeStore {
	active: { workspaceId: string; prCtx: PRContext } | null;
	view: ReviewView;
	navigatorCollapsed: boolean;
	drawerOpen: boolean;
	terminal: ReviewTerminal | null;
	commentFilter: ThreadFilter;
	intent: ReviewIntent | null;

	open: (workspaceId: string, prCtx: PRContext) => void;
	close: () => void;
	setView: (view: ReviewView) => void;
	toggleNavigator: () => void;
	setDrawerOpen: (open: boolean) => void;
	setTerminal: (terminal: ReviewTerminal | null) => void;
	setCommentFilter: (filter: ThreadFilter) => void;
	sendIntent: (kind: ReviewIntent["kind"], threadId?: string) => void;
	clearIntent: () => void;
}

let intentNonce = 0;

export const useReviewModeStore = create<ReviewModeStore>()((set) => ({
	active: null,
	view: "overview",
	navigatorCollapsed: false,
	drawerOpen: false,
	terminal: null,
	commentFilter: "all",
	intent: null,

	open: (workspaceId, prCtx) =>
		set({
			active: { workspaceId, prCtx },
			view: "overview",
			drawerOpen: false,
			commentFilter: "all",
			intent: null,
		}),
	close: () => set({ active: null, drawerOpen: false, intent: null }),
	setView: (view) => set({ view }),
	toggleNavigator: () => set((s) => ({ navigatorCollapsed: !s.navigatorCollapsed })),
	setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
	setTerminal: (terminal) => set({ terminal }),
	setCommentFilter: (commentFilter) => set({ commentFilter }),
	sendIntent: (kind, threadId) => set({ intent: { kind, threadId, nonce: ++intentNonce } }),
	clearIntent: () => set({ intent: null }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/review-mode-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/stores/review-mode-store.ts tests/review-mode-store.test.ts
git commit -m "feat(review-mode): add review-mode zustand store"
```

---

### Task 3: `ReviewModeShell` overlay + App.tsx integration

Review Mode is a fixed overlay above the existing shell. The shell (and its terminals) stays mounted underneath — do NOT conditionally unmount the `Group` in `App.tsx`.

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/ReviewModeShell.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/ReviewHeader.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (render shell after the `Group`, around line 722)

**Interfaces:**
- Consumes: `useReviewModeStore` (Task 2).
- Produces: `<ReviewModeShell />` self-contained (reads store itself, renders nothing when `active` is null). `ReviewHeader` props: `{ workspaceId: string; prCtx: PRContext }`.

- [ ] **Step 1: Create `ReviewHeader.tsx`** (view switcher + back; agent chip and submit land in Tasks 11-12)

```tsx
import type { PRContext } from "../../../shared/github-types";
import { type ReviewView, useReviewModeStore } from "../../stores/review-mode-store";

const VIEWS: Array<{ key: ReviewView; label: string }> = [
	{ key: "overview", label: "Overview" },
	{ key: "changes", label: "Changes" },
	{ key: "comments", label: "Comments" },
];

export function ReviewHeader({
	prCtx,
	commentCount,
	rightSlot,
}: {
	prCtx: PRContext;
	commentCount: number;
	rightSlot?: React.ReactNode;
}) {
	const view = useReviewModeStore((s) => s.view);
	const setView = useReviewModeStore((s) => s.setView);
	const close = useReviewModeStore((s) => s.close);

	return (
		<div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
			<button
				type="button"
				onClick={close}
				title="Back (Esc)"
				className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M10 3L5 8l5 5" />
				</svg>
			</button>
			<div className="flex min-w-0 items-baseline gap-2">
				<span className="truncate text-[14px] font-semibold text-[var(--text)]">{prCtx.title}</span>
				<span className="shrink-0 text-[12px] text-[var(--text-quaternary)]">#{prCtx.number}</span>
			</div>
			<div className="flex-1" />
			<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				{VIEWS.map((v) => (
					<button
						key={v.key}
						type="button"
						onClick={() => setView(v.key)}
						className={[
							"flex items-center gap-1.5 rounded-[4px] px-3 py-1 text-[12px] font-medium transition-all duration-[120ms]",
							view === v.key
								? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-sm)]"
								: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
						].join(" ")}
					>
						{v.label}
						{v.key === "comments" && commentCount > 0 && (
							<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 text-[11px] text-[var(--text-tertiary)]">
								{commentCount}
							</span>
						)}
					</button>
				))}
			</div>
			<div className="flex-1" />
			{rightSlot}
		</div>
	);
}
```

- [ ] **Step 2: Create `ReviewModeShell.tsx`** (navigator/content placeholders for now)

```tsx
import { useReviewModeStore } from "../../stores/review-mode-store";
import { ReviewHeader } from "./ReviewHeader";

export function ReviewModeShell() {
	const active = useReviewModeStore((s) => s.active);
	const view = useReviewModeStore((s) => s.view);
	const navigatorCollapsed = useReviewModeStore((s) => s.navigatorCollapsed);

	if (!active) return null;

	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg-base)]">
			<ReviewHeader prCtx={active.prCtx} commentCount={0} />
			<div className="flex min-h-0 flex-1">
				{!navigatorCollapsed && (
					<div className="w-[280px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-surface)]">
						{/* ReviewNavigator lands in Task 4 */}
					</div>
				)}
				<div className="min-w-0 flex-1 overflow-y-auto">
					{/* Views land in Tasks 8-10, 13 */}
					<div className="p-8 text-[13px] text-[var(--text-tertiary)]">{view}</div>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Mount in `App.tsx`**

In `apps/desktop/src/renderer/App.tsx`, import `ReviewModeShell` and render it immediately after the closing `</Group>` tag (line ~722), before the `{!rightPanelOpen && ...}` edge button:

```tsx
import { ReviewModeShell } from "./components/review-mode/ReviewModeShell";
// ... inside the non-settings branch, after </Group>:
<ReviewModeShell />
```

- [ ] **Step 4: Type check + smoke test**

Run: `bun run type-check` (repo root). Expected: PASS.
Temporary smoke: in dev tools console of `bun run dev`, run `useReviewModeStore` via a temporary button is NOT needed — verification comes when entry points are wired (Task 14). Visual check happens then.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/ src/renderer/App.tsx
git commit -m "feat(review-mode): add full-window shell overlay and header"
```

---

### Task 4: Navigator — meta block + file section

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/navigator/ReviewNavigator.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/navigator/FileSection.tsx`
- Modify: `apps/desktop/src/renderer/components/review-mode/ReviewModeShell.tsx` (mount navigator)

**Interfaces:**
- Consumes: `trpc.projects.getPRDetails` (same args as `PRControlRail.tsx:767-770`), `trpc.github.getViewedFiles` / `markFileViewed` (`PRControlRail.tsx:773-786`), `usePRReviewSessionStore` (`selectFile`, `setFileOrder`, session key via `prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx))`), `useReviewModeStore.setView`.
- Produces: `<ReviewNavigator workspaceId prCtx details threads />` where `details: GitHubPRDetails`, `threads: UnifiedThread[]`. `FileSection` props: `{ files: GitHubPRFile[]; viewedFiles: Set<string>; commentCountByFile: Map<string, number>; activeFilePath: string | null; onSelectFile: (path: string) => void; onToggleViewed: (path: string, viewed: boolean) => void }`.

- [ ] **Step 1: Implement `FileSection.tsx`**

Row spec (12px is allowed in the navigator — it is the compact zone): change-type dot (reuse the mapping from `PRControlRail.tsx:133-141`), filename with dimmed directory prefix, right side comment-count bubble + viewed check. Active row gets `border-l-2 border-[var(--accent)]`. Section header shows "Files" + `{viewedCount}/{files.length}` and a 2px progress line (`bg-[var(--accent)]`, width percent).

```tsx
import type { GitHubPRFile } from "../../../../shared/github-types";

const CHANGE_TYPE_DOT: Record<string, string> = {
	ADDED: "bg-[var(--term-green)]",
	MODIFIED: "bg-[var(--term-yellow)]",
	DELETED: "bg-[var(--term-red)]",
	RENAMED: "bg-[var(--accent)]",
	COPIED: "bg-[var(--accent)]",
	CHANGED: "bg-[var(--term-yellow)]",
	UNCHANGED: "bg-[var(--text-quaternary)]",
};

export function FileSection({
	files,
	viewedFiles,
	commentCountByFile,
	activeFilePath,
	onSelectFile,
	onToggleViewed,
}: {
	files: GitHubPRFile[];
	viewedFiles: Set<string>;
	commentCountByFile: Map<string, number>;
	activeFilePath: string | null;
	onSelectFile: (path: string) => void;
	onToggleViewed: (path: string, viewed: boolean) => void;
}) {
	const viewedCount = files.filter((f) => viewedFiles.has(f.path)).length;
	const pct = files.length === 0 ? 0 : Math.round((viewedCount / files.length) * 100);

	return (
		<div className="py-2">
			<div className="px-3 pb-1">
				<div className="flex items-baseline justify-between">
					<span className="text-[12px] font-medium text-[var(--text-secondary)]">Files</span>
					<span className="text-[11px] text-[var(--text-quaternary)]">
						{viewedCount}/{files.length} viewed
					</span>
				</div>
				<div className="mt-1.5 h-[2px] overflow-hidden rounded-full bg-[var(--bg-elevated)]">
					<div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
				</div>
			</div>
			{files.map((f) => {
				const dir = f.path.includes("/") ? `${f.path.slice(0, f.path.lastIndexOf("/"))}/` : "";
				const name = f.path.slice(dir.length);
				const isActive = f.path === activeFilePath;
				const isViewed = viewedFiles.has(f.path);
				const commentCount = commentCountByFile.get(f.path) ?? 0;
				return (
					<button
						key={f.path}
						type="button"
						onClick={() => onSelectFile(f.path)}
						className={[
							"group flex w-full items-center gap-2 py-1.5 pr-2 pl-3 text-left transition-colors duration-[120ms]",
							isActive
								? "border-l-2 border-[var(--accent)] bg-[var(--bg-elevated)]"
								: "border-l-2 border-transparent hover:bg-[var(--bg-elevated)]",
						].join(" ")}
					>
						<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CHANGE_TYPE_DOT[f.changeType] ?? ""}`} />
						<span className={`min-w-0 flex-1 truncate text-[12px] ${isViewed ? "text-[var(--text-quaternary)]" : "text-[var(--text-secondary)]"}`}>
							{dir && <span className="text-[var(--text-quaternary)]">{dir}</span>}
							{name}
						</span>
						{commentCount > 0 && (
							<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 text-[11px] text-[var(--text-tertiary)]">
								{commentCount}
							</span>
						)}
						<span
							role="checkbox"
							aria-checked={isViewed}
							tabIndex={-1}
							onClick={(e) => {
								e.stopPropagation();
								onToggleViewed(f.path, !isViewed);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									onToggleViewed(f.path, !isViewed);
								}
							}}
							title={isViewed ? "Mark not viewed" : "Mark viewed (V)"}
							className={[
								"flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[11px] transition-colors",
								isViewed
									? "border-[var(--color-success)] text-[var(--color-success)]"
									: "border-[var(--border)] text-transparent group-hover:text-[var(--text-quaternary)]",
							].join(" ")}
						>
							&#10003;
						</span>
					</button>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 2: Implement `ReviewNavigator.tsx`**

Meta block at top: repo `owner/repo`, `sourceBranch -> targetBranch` (12px mono chips), author, CI state dot + `reviewDecision` chip, reviewers list with decision color. Then `<FileSection>`. Data arrives via props (fetched once in `ReviewModeShell`, Task 5 step 3 moves queries there). `onSelectFile` = `selectFile(sessionKey, path)` on the session store + `setView("changes")`.

```tsx
import type { GitHubPRDetails, PRContext, UnifiedThread } from "../../../../shared/github-types";
import { formatPrIdentifier } from "../../../../shared/pr-identifier";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { trpc } from "../../../trpc/client";
import { FileSection } from "./FileSection";

const CI_DOT: Record<string, string> = {
	SUCCESS: "bg-[var(--color-success)]",
	FAILURE: "bg-[var(--color-danger)]",
	PENDING: "bg-[var(--color-warning)]",
	NEUTRAL: "bg-[var(--text-quaternary)]",
};

export function ReviewNavigator({
	workspaceId,
	prCtx,
	details,
	threads,
}: {
	workspaceId: string;
	prCtx: PRContext;
	details: GitHubPRDetails;
	threads: UnifiedThread[];
}) {
	const utils = trpc.useUtils();
	const sessionKey = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const selectFile = usePRReviewSessionStore((s) => s.selectFile);
	const activeFilePath = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const setView = useReviewModeStore((s) => s.setView);

	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);
	const viewedFiles = new Set(viewedFilesList ?? []);
	const markViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: () =>
			utils.github.getViewedFiles.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	const commentCountByFile = new Map<string, number>();
	for (const t of threads) {
		commentCountByFile.set(t.path, (commentCountByFile.get(t.path) ?? 0) + 1);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-[var(--border-subtle)] px-3 py-3">
				<div className="text-[12px] text-[var(--text-tertiary)]">
					{prCtx.owner}/{prCtx.repo}
				</div>
				<div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-quaternary)]">
					<span className="truncate rounded-[4px] bg-[var(--bg-elevated)] px-1.5 py-0.5">
						{prCtx.sourceBranch}
					</span>
					<span>&rarr;</span>
					<span className="truncate rounded-[4px] bg-[var(--bg-elevated)] px-1.5 py-0.5">
						{prCtx.targetBranch}
					</span>
				</div>
				<div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-quaternary)]">
					<span>{details.author}</span>
					{details.ciState && (
						<span className="flex items-center gap-1">
							<span className={`h-1.5 w-1.5 rounded-full ${CI_DOT[details.ciState] ?? ""}`} />
							CI
						</span>
					)}
					{details.reviewDecision && (
						<span className="text-[var(--text-tertiary)]">
							{details.reviewDecision === "APPROVED"
								? "Approved"
								: details.reviewDecision === "CHANGES_REQUESTED"
									? "Changes requested"
									: "Review required"}
						</span>
					)}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<FileSection
					files={details.files}
					viewedFiles={viewedFiles}
					commentCountByFile={commentCountByFile}
					activeFilePath={activeFilePath}
					onSelectFile={(path) => {
						selectFile(sessionKey, path);
						setView("changes");
					}}
					onToggleViewed={(path, viewed) =>
						markViewed.mutate({
							owner: prCtx.owner,
							repo: prCtx.repo,
							number: prCtx.number,
							filePath: path,
							viewed,
						})
					}
				/>
				{/* ThreadSection lands in Task 5 */}
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Mount in shell** — replace the navigator placeholder in `ReviewModeShell.tsx` with `<ReviewNavigator ... />`. For now pass `threads={[]}`; Task 5 lifts the data.

- [ ] **Step 4: Type check**

Run: `bun run type-check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/
git commit -m "feat(review-mode): navigator with PR meta and file section"
```

---

### Task 5: Shell data layer + navigator thread section

Lift all PR data fetching into `ReviewModeShell` so navigator, header, and views share one set of queries (mirrors `PRControlRail.tsx:766-975` but in ONE place).

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/useReviewData.ts`
- Create: `apps/desktop/src/renderer/components/review-mode/navigator/ThreadSection.tsx`
- Modify: `ReviewModeShell.tsx`, `ReviewNavigator.tsx`

**Interfaces:**
- Produces: `useReviewData(workspaceId: string, prCtx: PRContext)` returning:

```ts
{
	details: GitHubPRDetails | undefined;
	isLoading: boolean;
	matchingDraft: /* DraftLike from getReviewDrafts */ | undefined;
	aiDraft: /* getReviewDraft data */ | undefined;
	allThreads: UnifiedThread[];      // GH threads + AI drafts (pending/edited/error/user-pending)
	acceptedThreads: AIDraftThread[]; // status === "user-pending"
	pendingCount: number;             // bucket "pending"
	sessionKey: string;
	fileOrder: string[];              // details.files paths
}
```

- [ ] **Step 1: Implement `useReviewData.ts`**

```ts
import { useEffect, useMemo } from "react";
import type { AIDraftThread, PRContext, UnifiedThread } from "../../../shared/github-types";
import { formatPrIdentifier } from "../../../shared/pr-identifier";
import {
	mapDraftComment,
	pickLatestDraft,
	threadCounts,
} from "../../lib/pr-review-threads";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../../stores/pr-review-session-store";
import { trpc } from "../../trpc/client";

export function useReviewData(workspaceId: string, prCtx: PRContext) {
	const prIdentifier = formatPrIdentifier(prCtx);
	const sessionKey = prReviewSessionKey(workspaceId, prIdentifier);
	const setFileOrder = usePRReviewSessionStore((s) => s.setFileOrder);

	const { data: details, isLoading } = trpc.projects.getPRDetails.useQuery(
		{ provider: prCtx.provider, owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 5_000,
		refetchInterval: 5_000,
	});
	const matchingDraft = pickLatestDraft(reviewDraftsQuery.data, prIdentifier);
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id, refetchInterval: 5_000 }
	);
	const roundNumber = aiDraftQuery.data?.roundNumber ?? 1;

	const fileOrder = useMemo(
		() => details?.files.map((f) => f.path) ?? [],
		[details?.files]
	);
	useEffect(() => {
		if (fileOrder.length > 0) setFileOrder(sessionKey, fileOrder);
	}, [fileOrder, sessionKey, setFileOrder]);

	const draftComments = aiDraftQuery.data?.comments;
	const reviewThreads = details?.reviewThreads;

	const { allThreads, acceptedThreads } = useMemo(() => {
		const drafts: AIDraftThread[] = (draftComments ?? [])
			.filter(
				(c) =>
					c.status === "pending" ||
					c.status === "edited" ||
					c.status === "error" ||
					c.status === "user-pending"
			)
			.map((c) => mapDraftComment(c, roundNumber));
		const all: UnifiedThread[] = [...(reviewThreads ?? []), ...drafts];
		return {
			allThreads: all,
			acceptedThreads: drafts.filter((d) => d.status === "user-pending"),
		};
	}, [draftComments, reviewThreads, roundNumber]);

	const counts = useMemo(() => threadCounts(allThreads), [allThreads]);

	return {
		details,
		isLoading,
		matchingDraft,
		aiDraft: aiDraftQuery.data,
		allThreads,
		acceptedThreads,
		pendingCount: counts.pending,
		counts,
		sessionKey,
		fileOrder,
	};
}
```

- [ ] **Step 2: Implement `ThreadSection.tsx`**

Condensed filter (All / Needs attention / Done) as three tiny text buttons writing `useReviewModeStore.setCommentFilter` — condensed choice maps via `CONDENSED_TO_FILTERS` (set filter to `"all"`, or to the first element and let the Comments view treat condensed groups; simpler and store-consistent: store a `ThreadFilter`, the condensed control highlights "attention" when filter is `pending` or `open`). Keep it dead simple: three buttons set the filter to `"all"`, `"pending"`, `"resolved"` respectively and the row list ALWAYS shows all threads matching the current filter via `matchesFilter`. Rows: status dot + `file:line` (11px mono) + excerpt (12px, truncated). Click = `selectThread(sessionKey, t.id)` + `setView("comments")`.

```tsx
import type { PRContext, UnifiedThread } from "../../../../shared/github-types";
import { formatPrIdentifier } from "../../../../shared/pr-identifier";
import {
	matchesFilter,
	threadBucket,
	threadExcerpt,
} from "../../../lib/pr-review-threads";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";

const BUCKET_DOT: Record<string, string> = {
	pending: "bg-[var(--color-purple)]",
	accepted: "bg-[var(--accent)]",
	declined: "bg-[var(--text-quaternary)]",
	open: "bg-[var(--color-warning)]",
	resolved: "bg-[var(--color-success)]",
};

export function ThreadSection({
	workspaceId,
	prCtx,
	threads,
}: {
	workspaceId: string;
	prCtx: PRContext;
	threads: UnifiedThread[];
}) {
	const sessionKey = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const activeThreadId = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeThreadId ?? null
	);
	const filter = useReviewModeStore((s) => s.commentFilter);
	const setCommentFilter = useReviewModeStore((s) => s.setCommentFilter);
	const setView = useReviewModeStore((s) => s.setView);

	const visible = threads.filter((t) => matchesFilter(t, filter));

	return (
		<div className="border-t border-[var(--border-subtle)] py-2">
			<div className="flex items-center justify-between px-3 pb-1">
				<span className="text-[12px] font-medium text-[var(--text-secondary)]">Comments</span>
				<div className="flex gap-1 text-[11px]">
					{(
						[
							["all", "All"],
							["pending", "Attention"],
							["resolved", "Done"],
						] as const
					).map(([key, label]) => (
						<button
							key={key}
							type="button"
							onClick={() => setCommentFilter(key)}
							className={
								filter === key
									? "text-[var(--text-secondary)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
							}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			{visible.map((t) => {
				const filename = t.path.split("/").pop() ?? t.path;
				const isActive = t.id === activeThreadId;
				return (
					<button
						key={t.id}
						type="button"
						onClick={() => {
							selectThread(sessionKey, t.id);
							setView("comments");
						}}
						className={[
							"flex w-full flex-col gap-0.5 py-1.5 pr-2 pl-3 text-left transition-colors duration-[120ms]",
							isActive
								? "border-l-2 border-[var(--accent)] bg-[var(--bg-elevated)]"
								: "border-l-2 border-transparent hover:bg-[var(--bg-elevated)]",
						].join(" ")}
					>
						<span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-quaternary)]">
							<span className={`h-1.5 w-1.5 rounded-full ${BUCKET_DOT[threadBucket(t)] ?? ""}`} />
							{filename}
							{t.line != null && `:${t.line}`}
						</span>
						<span className="truncate text-[12px] text-[var(--text-tertiary)]">
							{threadExcerpt(t)}
						</span>
					</button>
				);
			})}
			{visible.length === 0 && (
				<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No comments</div>
			)}
		</div>
	);
}
```

Note: if `--color-purple` does not exist in `styles.css`, check the exact variable name (the explore pass found `--color-purple` among semantic tokens; verify with a search in `styles.css` and use what exists).

- [ ] **Step 3: Wire shell** — in `ReviewModeShell.tsx` call `useReviewData(active.workspaceId, active.prCtx)`, pass `details`/`allThreads` to `ReviewNavigator` (render skeleton rows while `isLoading`), pass `counts.pending + counts.open` as `commentCount` to `ReviewHeader`, and add `<ThreadSection>` under `<FileSection>` inside the navigator.

- [ ] **Step 4: Type check** — `bun run type-check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/
git commit -m "feat(review-mode): shared review data hook and navigator comments section"
```

---

### Task 6: Unified `ThreadCard` (full + row variants) with composer and actions

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/thread/ThreadCard.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/thread/ReplyComposer.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/thread/ThreadActions.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/thread/ThreadStatusChip.tsx`

**Interfaces:**
- Consumes: `UnifiedThread`, Task 1 helpers, `MarkdownRenderer` (`components/MarkdownRenderer.tsx`).
- Produces:

```ts
export interface ThreadCallbacks {
	onAccept?: (draftCommentId: string) => void;
	onDecline?: (draftCommentId: string) => void;
	onDelete?: (draftCommentId: string) => void;
	onSaveEdit?: (draftCommentId: string, body: string) => void;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
	onOpenInChanges?: (path: string, threadId: string) => void;
}
export function ThreadCard(props: {
	thread: UnifiedThread;
	variant: "inline" | "full";
	active?: boolean;
	callbacks: ThreadCallbacks;
	contextSlot?: React.ReactNode; // DiffContextSnippet, full variant only
}): JSX.Element;
export function ReplyComposer(props: {
	placeholder: string;
	initialValue?: string;
	autoFocus?: boolean;
	onSubmit: (body: string) => void;
	onCancel: () => void;
}): JSX.Element;
```

(The `row` variant from the spec is `ThreadSection`'s row, already built in Task 5 — do not duplicate it here.)

- [ ] **Step 1: Implement `ReplyComposer.tsx`**

Textarea with the existing keyboard idiom (Enter submit, Shift+Enter newline, Esc cancel — same as `CommentThreadCard.tsx:186-196`), 12px text, auto-growing rows (min 2, max 8), hint line at 11px.

```tsx
import { useEffect, useRef, useState } from "react";

export function ReplyComposer({
	placeholder,
	initialValue = "",
	autoFocus = false,
	onSubmit,
	onCancel,
}: {
	placeholder: string;
	initialValue?: string;
	autoFocus?: boolean;
	onSubmit: (body: string) => void;
	onCancel: () => void;
}) {
	const [body, setBody] = useState(initialValue);
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (autoFocus) {
			ref.current?.focus();
			ref.current?.select();
		}
	}, [autoFocus]);

	return (
		<div>
			<textarea
				ref={ref}
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder={placeholder}
				rows={Math.min(Math.max(body.split("\n").length, 2), 8)}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						if (body.trim()) onSubmit(body.trim());
					}
					if (e.key === "Escape") onCancel();
				}}
				className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
			/>
			<div className="mt-1 text-[11px] text-[var(--text-quaternary)]">
				Enter to send &middot; Shift+Enter for new line &middot; Esc to cancel
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Implement `ThreadStatusChip.tsx`**

```tsx
import type { UnifiedThread } from "../../../../shared/github-types";
import { threadBucket } from "../../../lib/pr-review-threads";

const CHIP: Record<string, { label: string; cls: string }> = {
	pending: { label: "Pending", cls: "bg-[var(--purple-subtle)] text-[var(--color-purple)]" },
	accepted: { label: "Accepted", cls: "bg-[var(--bg-overlay)] text-[var(--text-secondary)]" },
	declined: { label: "Declined", cls: "bg-[var(--bg-elevated)] text-[var(--text-quaternary)]" },
	open: { label: "Open", cls: "bg-[var(--warning-subtle)] text-[var(--color-warning)]" },
	resolved: { label: "Resolved", cls: "bg-[var(--success-subtle)] text-[var(--color-success)]" },
};

export function ThreadStatusChip({ thread }: { thread: UnifiedThread }) {
	if (thread.isAIDraft && thread.status === "error") {
		return (
			<span className="rounded-[4px] bg-[var(--danger-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-danger)]">
				Failed
			</span>
		);
	}
	const chip = CHIP[threadBucket(thread)];
	if (!chip) return null;
	return (
		<span className={`rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium ${chip.cls}`}>
			{chip.label}
		</span>
	);
}
```

Check `--purple-subtle` / `--warning-subtle` exist in `styles.css` (the token set has `-subtle` variants per the design-system audit); substitute the exact names found there.

- [ ] **Step 3: Implement `ThreadActions.tsx`**

Ghost buttons, 12px, always visible. AI pending/edited: Accept (success-tinted) / Edit / Decline. AI error: Remove. AI user-pending: Edit / Decline ("un-accept" = decline keeps existing semantics: status flows through `updateDraftComment`). GitHub unresolved: Reply / Resolve. Resolved/submitted: no actions. Every card also gets "Open in code" when `onOpenInChanges` is provided (full variant).

```tsx
import type { AIDraftThread, GitHubReviewThread, UnifiedThread } from "../../../../shared/github-types";
import type { ThreadCallbacks } from "./ThreadCard";

function GhostButton({
	label,
	tone = "default",
	onClick,
}: {
	label: string;
	tone?: "default" | "success" | "danger";
	onClick: () => void;
}) {
	const toneCls =
		tone === "success"
			? "text-[var(--color-success)] hover:bg-[var(--success-subtle)]"
			: tone === "danger"
				? "text-[var(--color-danger)] hover:bg-[var(--danger-subtle)]"
				: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]";
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium transition-colors duration-[120ms] ${toneCls}`}
		>
			{label}
		</button>
	);
}

export function ThreadActions({
	thread,
	callbacks,
	onStartReply,
	onStartEdit,
}: {
	thread: UnifiedThread;
	callbacks: ThreadCallbacks;
	onStartReply: () => void;
	onStartEdit: () => void;
}) {
	const buttons: React.ReactNode[] = [];

	if (thread.isAIDraft) {
		const ai = thread as AIDraftThread;
		if ((ai.status === "pending" || ai.status === "edited") && callbacks.onAccept) {
			buttons.push(
				<GhostButton key="accept" label="Accept" tone="success" onClick={() => callbacks.onAccept?.(ai.draftCommentId)} />
			);
		}
		if (ai.status !== "submitted" && ai.status !== "error" && callbacks.onSaveEdit) {
			buttons.push(<GhostButton key="edit" label="Edit" onClick={onStartEdit} />);
		}
		if ((ai.status === "pending" || ai.status === "edited" || ai.status === "user-pending") && callbacks.onDecline) {
			buttons.push(
				<GhostButton key="decline" label="Decline" onClick={() => callbacks.onDecline?.(ai.draftCommentId)} />
			);
		}
		if (ai.status === "error" && callbacks.onDelete) {
			buttons.push(
				<GhostButton key="remove" label="Remove" tone="danger" onClick={() => callbacks.onDelete?.(ai.draftCommentId)} />
			);
		}
	} else {
		const gh = thread as GitHubReviewThread;
		if (!gh.isResolved) {
			if (callbacks.onReply) buttons.push(<GhostButton key="reply" label="Reply" onClick={onStartReply} />);
			if (callbacks.onResolve)
				buttons.push(<GhostButton key="resolve" label="Resolve" onClick={() => callbacks.onResolve?.(gh.id)} />);
		}
	}

	if (callbacks.onOpenInChanges) {
		buttons.push(
			<GhostButton
				key="open"
				label="Open in code"
				onClick={() => callbacks.onOpenInChanges?.(thread.path, thread.id)}
			/>
		);
	}

	if (buttons.length === 0) return null;
	return <div className="flex items-center gap-1">{buttons}</div>;
}
```

- [ ] **Step 4: Implement `ThreadCard.tsx`**

Full variant: card with header row (AI badge or author, mono `file:line` button, status chip, relative date), optional `contextSlot`, markdown body at 13px, GH replies indented, action row, inline composer for reply/edit. Inline variant: same structure minus `contextSlot`, tighter padding, resolved GH threads collapse to a single-line expander. Listens to `useReviewModeStore.intent` to auto-open reply/edit when `intent.threadId === thread.id` (replaces the `pr-review-events` bus).

```tsx
import { useEffect, useState } from "react";
import type { AIDraftThread, GitHubReviewThread, UnifiedThread } from "../../../../shared/github-types";
import { threadAuthor, threadDate } from "../../../lib/pr-review-threads";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { ReplyComposer } from "./ReplyComposer";
import { ThreadActions } from "./ThreadActions";
import { ThreadStatusChip } from "./ThreadStatusChip";

export interface ThreadCallbacks {
	onAccept?: (draftCommentId: string) => void;
	onDecline?: (draftCommentId: string) => void;
	onDelete?: (draftCommentId: string) => void;
	onSaveEdit?: (draftCommentId: string, body: string) => void;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
	onOpenInChanges?: (path: string, threadId: string) => void;
}

function relativeDate(iso: string): string {
	const d = new Date(iso).getTime();
	if (Number.isNaN(d)) return "";
	const mins = Math.round((Date.now() - d) / 60_000);
	if (mins < 60) return `${Math.max(mins, 1)}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

export function ThreadCard({
	thread,
	variant,
	active = false,
	callbacks,
	contextSlot,
}: {
	thread: UnifiedThread;
	variant: "inline" | "full";
	active?: boolean;
	callbacks: ThreadCallbacks;
	contextSlot?: React.ReactNode;
}) {
	const [composer, setComposer] = useState<"reply" | "edit" | null>(null);
	const [collapsed, setCollapsed] = useState(
		variant === "inline" && !thread.isAIDraft && (thread as GitHubReviewThread).isResolved
	);
	const intent = useReviewModeStore((s) => s.intent);
	const clearIntent = useReviewModeStore((s) => s.clearIntent);

	useEffect(() => {
		if (!intent || intent.threadId !== thread.id) return;
		if (intent.kind === "reply" && !thread.isAIDraft) setComposer("reply");
		if (intent.kind === "edit" && thread.isAIDraft) setComposer("edit");
		clearIntent();
	}, [intent, thread, clearIntent]);

	const ai = thread.isAIDraft ? (thread as AIDraftThread) : null;
	const gh = thread.isAIDraft ? null : (thread as GitHubReviewThread);
	const filename = thread.path.split("/").pop() ?? thread.path;
	const pad = variant === "full" ? "px-4" : "px-3";

	if (collapsed && gh) {
		return (
			<button
				type="button"
				onClick={() => setCollapsed(false)}
				className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-left text-[12px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
			>
				<span className="text-[var(--color-success)]">&#10003;</span>
				Resolved &middot; {threadAuthor(thread)} &middot; expand
			</button>
		);
	}

	return (
		<div
			data-thread-id={thread.id}
			className={[
				"overflow-hidden rounded-[var(--radius-md)] border bg-[var(--bg-surface)]",
				active ? "border-[var(--accent)]" : "border-[var(--border-subtle)]",
			].join(" ")}
		>
			<div className={`flex items-center gap-2 border-b border-[var(--border-subtle)] py-2 ${pad}`}>
				{ai ? (
					<span className="ai-badge">AI</span>
				) : (
					<span className="text-[12px] font-medium text-[var(--text-secondary)]">
						{threadAuthor(thread)}
					</span>
				)}
				<button
					type="button"
					onClick={() => callbacks.onOpenInChanges?.(thread.path, thread.id)}
					className="font-mono text-[11px] text-[var(--text-quaternary)] hover:text-[var(--accent)]"
				>
					{filename}
					{thread.line != null && `:${thread.line}`}
				</button>
				{ai?.roundNumber != null && ai.roundNumber > 1 && (
					<span className="text-[11px] text-[var(--text-quaternary)]">Round {ai.roundNumber}</span>
				)}
				<div className="flex-1" />
				<ThreadStatusChip thread={thread} />
				<span className="text-[11px] text-[var(--text-quaternary)]">
					{relativeDate(threadDate(thread))}
				</span>
				{gh && variant === "inline" && gh.isResolved && (
					<button
						type="button"
						onClick={() => setCollapsed(true)}
						className="text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
					>
						Collapse
					</button>
				)}
			</div>

			{contextSlot}

			{ai && (
				<div className={`py-3 ${pad}`}>
					{composer === "edit" ? (
						<ReplyComposer
							placeholder="Edit comment"
							initialValue={ai.userEdit ?? ai.body}
							autoFocus
							onSubmit={(body) => {
								callbacks.onSaveEdit?.(ai.draftCommentId, body);
								setComposer(null);
							}}
							onCancel={() => setComposer(null)}
						/>
					) : (
						<MarkdownRenderer content={ai.userEdit ?? ai.body} />
					)}
				</div>
			)}

			{gh &&
				gh.comments.map((c, i) => (
					<div
						key={c.id}
						className={`py-3 ${pad} ${i > 0 ? "ml-4 border-l border-[var(--border-subtle)]" : ""} ${i < gh.comments.length - 1 ? "border-b border-[var(--border-subtle)]" : ""}`}
					>
						{i > 0 && (
							<div className="mb-1 flex items-center gap-2 text-[12px]">
								<span className="font-medium text-[var(--text-secondary)]">{c.author}</span>
								<span className="text-[11px] text-[var(--text-quaternary)]">
									{relativeDate(c.createdAt)}
								</span>
							</div>
						)}
						<MarkdownRenderer content={c.body} />
					</div>
				))}

			{composer === "reply" && gh && (
				<div className={`pb-3 ${pad}`}>
					<ReplyComposer
						placeholder="Reply..."
						autoFocus
						onSubmit={(body) => {
							callbacks.onReply?.(gh.id, body);
							setComposer(null);
						}}
						onCancel={() => setComposer(null)}
					/>
				</div>
			)}

			<div className={`border-t border-[var(--border-subtle)] py-1.5 ${pad}`}>
				<ThreadActions
					thread={thread}
					callbacks={callbacks}
					onStartReply={() => setComposer("reply")}
					onStartEdit={() => setComposer("edit")}
				/>
			</div>
		</div>
	);
}
```

Note: `MarkdownRenderer` body text — check `components/MarkdownRenderer.tsx` and `.markdown-body` CSS (`styles.css:517-575`); if its base size is below 13px, bump the `.markdown-body` font-size to 13px as part of this task (that class is shared; visually verify the local review flow still looks right).

- [ ] **Step 5: Type check + commit**

Run: `bun run type-check`. Expected: PASS.

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/thread/
git commit -m "feat(review-mode): unified ThreadCard with composer and actions"
```

---

### Task 7: `DiffContextSnippet`

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/thread/DiffContextSnippet.tsx`

**Interfaces:**
- Consumes: `extractDiffContext` (Task 1), `trpc.diff.getBranchDiff` (same args as `PRReviewFileTab.tsx:853-856`).
- Produces: `<DiffContextSnippet prCtx={PRContext} path={string} line={number} />` — renders nothing when the line is in no hunk.

- [ ] **Step 1: Implement**

A lightweight non-Monaco block: mono 12px lines, `+` lines tinted with `--success-subtle`, `-` lines with `--danger-subtle`, target line gets an accent-tinted background, old/new line numbers in a dimmed gutter. One `getBranchDiff` query per PR (React Query dedupes by key across all snippet instances — every snippet uses identical args, so this is one fetch, not N).

```tsx
import type { PRContext } from "../../../../shared/github-types";
import { extractDiffContext } from "../../../lib/pr-review-threads";
import { trpc } from "../../../trpc/client";

export function DiffContextSnippet({
	prCtx,
	path,
	line,
}: {
	prCtx: PRContext;
	path: string;
	line: number;
}) {
	const { data } = trpc.diff.getBranchDiff.useQuery(
		{ repoPath: prCtx.repoPath, baseBranch: prCtx.targetBranch, headBranch: prCtx.sourceBranch },
		{ staleTime: 60_000 }
	);
	const hunks = data?.files.find((f) => f.path === path)?.hunks;
	if (!hunks) return null;
	const lines = extractDiffContext(hunks, line, 2);
	if (lines.length === 0) return null;

	return (
		<div className="overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-base)] font-mono text-[12px] leading-[1.6]">
			{lines.map((l, i) => {
				const isTarget = l.newLineNumber === line;
				const rowBg = isTarget
					? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
					: l.type === "added"
						? "bg-[var(--success-subtle)]"
						: l.type === "removed"
							? "bg-[var(--danger-subtle)]"
							: "";
				return (
					<div key={`${l.newLineNumber ?? "o"}-${l.oldLineNumber ?? "n"}-${i}`} className={`flex ${rowBg}`}>
						<span className="w-10 shrink-0 select-none pr-2 text-right text-[var(--text-quaternary)]">
							{l.newLineNumber ?? ""}
						</span>
						<span className="w-4 shrink-0 select-none text-[var(--text-quaternary)]">
							{l.type === "added" ? "+" : l.type === "removed" ? "-" : ""}
						</span>
						<span className="whitespace-pre pr-4 text-[var(--text-secondary)]">{l.content}</span>
					</div>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 2: Type check + commit**

Run: `bun run type-check`. Expected: PASS.

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/thread/DiffContextSnippet.tsx
git commit -m "feat(review-mode): diff context snippet for reading view"
```

---

### Task 8: `CommentsView` (reading + triage surface)

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/views/CommentsView.tsx`
- Modify: `ReviewModeShell.tsx` (render when `view === "comments"`)

**Interfaces:**
- Consumes: `useReviewData` output (passed as props from shell), `ThreadCard` (full), `DiffContextSnippet`, Task 1 grouping/filtering, mutations copied from `PRReviewFileTab.tsx:924-948` (`aiReview.updateDraftComment`, `aiReview.deleteDraftComment`, `github.addReviewComment`, `github.resolveThread` — with the same `onSuccess` invalidations).
- Produces: `<CommentsView workspaceId prCtx allThreads counts fileOrder sessionKey />`.

- [ ] **Step 1: Implement**

Centered `max-w-[760px] mx-auto px-6 py-6` column. Filter chips row at top (All / Pending / Accepted / Declined / Open / Resolved with live counts from `threadCounts`; active chip = `bg-[var(--bg-elevated)] text-[var(--text)]`, inactive = quaternary text). Threads filtered by `matchesFilter(t, commentFilter)`, grouped via `groupThreadsByFile`, each group under a sticky mini header (`sticky top-0 bg-[var(--bg-base)] py-2 font-mono text-[12px] text-[var(--text-tertiary)]`). Cards spaced `gap-3`. Active thread (session store `activeThreadId`) scrolls into view on mount/CHANGE via `document.querySelector('[data-thread-id="..."]')?.scrollIntoView({ block: "center" })` in a `useEffect`.

Callbacks object (one place, passed to every card):

```tsx
const utils = trpc.useUtils();
const invalidateDrafts = () => {
	utils.aiReview.getReviewDrafts.invalidate();
	utils.aiReview.getReviewDraft.invalidate();
};
const invalidateDetails = () =>
	utils.projects.getPRDetails.invalidate({
		provider: prCtx.provider,
		owner: prCtx.owner,
		repo: prCtx.repo,
		number: prCtx.number,
	});

const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({ onSuccess: invalidateDrafts });
const deleteDraftComment = trpc.aiReview.deleteDraftComment.useMutation({ onSuccess: invalidateDrafts });
const addComment = trpc.github.addReviewComment.useMutation({ onSuccess: invalidateDetails });
const resolveThread = trpc.github.resolveThread.useMutation({ onSuccess: invalidateDetails });

const callbacks: ThreadCallbacks = {
	onAccept: (id) => updateDraftComment.mutate({ commentId: id, status: "user-pending" }),
	onDecline: (id) => updateDraftComment.mutate({ commentId: id, status: "rejected" }),
	onDelete: (id) => deleteDraftComment.mutate({ commentId: id }),
	onSaveEdit: (id, body) => updateDraftComment.mutate({ commentId: id, status: "edited", userEdit: body }),
	onReply: (threadId, body) =>
		addComment.mutate({ owner: prCtx.owner, repo: prCtx.repo, prNumber: prCtx.number, threadId, body }),
	onResolve: (threadId) =>
		resolveThread.mutate({ owner: prCtx.owner, repo: prCtx.repo, prNumber: prCtx.number, threadId }),
	onOpenInChanges: (path, threadId) => openThreadInChanges(workspaceId, prCtx, path, threadId),
};
```

IMPORTANT — verify mutation input shapes against the routers before finalizing: open `apps/desktop/src/main/trpc/` and check the actual zod inputs for `aiReview.updateDraftComment`, `aiReview.deleteDraftComment`, `github.addReviewComment`, `github.resolveThread` (the old call sites in `PRReviewFileTab.tsx` show the working shapes — copy from there verbatim, including how `updateDraftComment` carries `userEdit` and how accept maps to status `user-pending`, which you can confirm from the Accept handlers around `PRReviewFileTab.tsx`'s ThreadWidget usage and `PROverviewTab.tsx:189-249`).

Also create `apps/desktop/src/renderer/lib/review-mode-nav.ts` in this task:

```ts
import type { PRContext } from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import { prReviewSessionKey, usePRReviewSessionStore } from "../stores/pr-review-session-store";
import { useReviewModeStore } from "../stores/review-mode-store";

/** Open a file (optionally focused on a thread) in the Changes view. */
export function openThreadInChanges(
	workspaceId: string,
	prCtx: PRContext,
	path: string,
	threadId?: string
): void {
	const sessionKey = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const session = usePRReviewSessionStore.getState();
	session.selectFile(sessionKey, path);
	if (threadId !== undefined) session.selectThread(sessionKey, threadId);
	useReviewModeStore.getState().setView("changes");
}
```

Each full ThreadCard gets `contextSlot={thread.line != null ? <DiffContextSnippet prCtx={prCtx} path={thread.path} line={thread.line} /> : undefined}`.

Empty state: when no threads match the filter, a centered quiet message ("No comments match this filter") at 13px tertiary.

- [ ] **Step 2: Wire in shell** — `{view === "comments" && details && <CommentsView ... />}`.

- [ ] **Step 3: Type check** — `bun run type-check`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/views/CommentsView.tsx src/renderer/lib/review-mode-nav.ts src/renderer/components/review-mode/ReviewModeShell.tsx
git commit -m "feat(review-mode): comments reading and triage view"
```

---### Task 9: `ChangesView` — Monaco diff with extracted hooks

The heart of the migration. The three Monaco hook systems move out of `PRReviewFileTab.tsx` (1380 lines) into standalone hooks, and the inline widget becomes `ThreadCard variant="inline"`.

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/hooks/useInlineCommentZones.tsx` — extract from `PRReviewFileTab.tsx:455-633` verbatim, then swap its `ThreadWidget` render for `ThreadCard`
- Create: `apps/desktop/src/renderer/components/review-mode/hooks/useThreadDecorations.ts` — extract from `PRReviewFileTab.tsx:654-699` verbatim
- Create: `apps/desktop/src/renderer/components/review-mode/hooks/useGutterPlusButton.ts` — extract from `PRReviewFileTab.tsx:703-769` verbatim
- Create: `apps/desktop/src/renderer/components/review-mode/views/ChangesView.tsx`
- Modify: `ReviewModeShell.tsx`

**Interfaces:**
- Consumes: `DiffEditor` (`components/DiffEditor.tsx` — props: original/modified content, language, `renderSideBySide`, `onMount`), `MarkdownPreviewButton`, `MarkdownRenderedDiff`, `ThreadCard` (inline), `useReviewData` props, queries from `PRReviewFileTab.tsx:843-873` (`diff.getFileContent` x2, `diff.getBranchDiff`, `validDiffLines` memo at `:857-867`), viewed state (`:951-963`), mutations (same as Task 8 — pass one shared `ThreadCallbacks` built the same way).
- Produces: `<ChangesView workspaceId prCtx allThreads sessionKey callbacks />`.

- [ ] **Step 1: Extract the three hooks**

Copy the exact code ranges listed above into the new files. Keep signatures identical except: `useInlineCommentZones` takes a `renderThread: (thread: UnifiedThread) => React.ReactNode` parameter instead of hard-coding `ThreadWidget`, so the hook stays presentation-agnostic. The `createRoot`-per-zone registry, signature diffing, and cleanup logic must move unchanged — that code is churn-hardened; do not "improve" it.

- [ ] **Step 2: Implement `ChangesView.tsx`**

Structure (all data patterns copied from `PRReviewFileTab.tsx:786-1009`, minus the tab/swap machinery which dies — the active file now comes straight from the session store):

- Read `activeFilePath` from session store; when null, select `fileOrder[0]` in a `useEffect`.
- Sticky file header (36px, `border-b`, `bg-[var(--bg-surface)]`): mono 13px path, `+{additions} -{deletions}` (term-green/term-red, 12px), spacer, prev/next file buttons (chevrons, also j/k), Viewed toggle (same mutation as navigator), split/unified toggle (`useTabStore` `diffMode`/`setDiffMode` — reuse as-is), `MarkdownPreviewButton` for markdown files, "Collapse all" / "Expand all" for inline threads (state: `collapseNonce`, passed down so inline ThreadCards reset their collapsed state — implement as a `defaultCollapsed` prop flip; acceptable simplification: only resolved threads collapse, the buttons set a `allCollapsed: boolean | null` prop consumed by ThreadCard's `useState` initializer keyed via `key={`${thread.id}-${allCollapsed}`}`).
- Body: `DiffEditor` with `original`/`modified` from the two `getFileContent` queries, `renderSideBySide={diffMode === "split"}`, `onMount` captures the editor instance for the hooks. Markdown preview modes reuse the exact conditional structure from `PRReviewFileTab` (split panes / rendered / rich-diff via `MarkdownRenderedDiff`).
- File threads: filter `allThreads` for `t.path === activeFilePath` (statuses pending/edited/user-pending for AI + all GH threads, matching `PRReviewFileTab.tsx:970-993`).
- Wire hooks: `useInlineCommentZones(editor, fileThreads, (thread) => <ThreadCard thread={thread} variant="inline" active={thread.id === activeThreadId} callbacks={callbacks} />)`, `useThreadDecorations(editor, fileThreads, activeThreadId)`, `useGutterPlusButton(editor, validDiffLines, onAddComment)` where `onAddComment(line)` opens a new-comment composer zone (keep the `pendingLine` mechanism from `PRReviewFileTab.tsx:840` and its composer rendering — extract it along with the zones hook if they are entangled; the new-comment composer should render `ReplyComposer` in a zone and call `addComment`/`aiReview` user-draft creation exactly as the old `handleNewComment` does — locate it in `PRReviewFileTab.tsx` around the gutter-plus wiring and copy the mutation call).
- Scroll persistence: `setScroll`/`getScroll` per file from the session store (copy from `PRReviewFileTab`).
- Delete nothing yet — old `PRReviewFileTab` keeps working until Task 14.

- [ ] **Step 3: Wire in shell** — `{view === "changes" && details && <ChangesView ... />}`. Build the shared `callbacks` object once in `ReviewModeShell` (lift from Task 8's CommentsView into the shell, pass to both views) so accept/decline/reply behave identically everywhere.

- [ ] **Step 4: Type check + manual smoke**

Run: `bun run type-check`. Expected: PASS.
Manual (after Task 14 wires entry, or temporarily call `useReviewModeStore.getState().open(...)` from a dev-tools snippet): file renders diff, gutter dots show, inline cards appear on comment lines, gutter "+" only on valid diff lines.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/
git commit -m "feat(review-mode): changes view with extracted Monaco comment hooks"
```

---

### Task 10: Keyboard model — `review-keymap.ts` + `useReviewKeymap`

**Files:**
- Create: `apps/desktop/src/renderer/lib/review-keymap.ts` (pure)
- Create: `apps/desktop/src/renderer/components/review-mode/hooks/useReviewKeymap.ts`
- Modify: `ReviewModeShell.tsx` (install hook)
- Test: `apps/desktop/tests/review-keymap.test.ts`

**Interfaces:**
- Produces:

```ts
export type ReviewKeyAction =
	| "view-overview" | "view-changes" | "view-comments"
	| "escape" | "next" | "prev"
	| "toggle-viewed" | "new-comment" | "next-thread" | "prev-thread"
	| "accept" | "decline" | "edit" | "reply" | "open-in-changes"
	| "toggle-navigator";
export function mapReviewKey(
	event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
	view: ReviewView
): ReviewKeyAction | null;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mapReviewKey } from "../src/renderer/lib/review-keymap";

const ev = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
	key,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	...mods,
});

describe("mapReviewKey", () => {
	test("view switching everywhere", () => {
		expect(mapReviewKey(ev("1"), "changes")).toBe("view-overview");
		expect(mapReviewKey(ev("2"), "overview")).toBe("view-changes");
		expect(mapReviewKey(ev("3"), "comments")).toBe("view-comments");
	});
	test("j/k are contextual", () => {
		expect(mapReviewKey(ev("j"), "changes")).toBe("next");
		expect(mapReviewKey(ev("k"), "comments")).toBe("prev");
	});
	test("changes-only keys", () => {
		expect(mapReviewKey(ev("v"), "changes")).toBe("toggle-viewed");
		expect(mapReviewKey(ev("c"), "changes")).toBe("new-comment");
		expect(mapReviewKey(ev("n"), "changes")).toBe("next-thread");
		expect(mapReviewKey(ev("p"), "changes")).toBe("prev-thread");
		expect(mapReviewKey(ev("v"), "comments")).toBeNull();
	});
	test("comments-only triage keys", () => {
		expect(mapReviewKey(ev("a"), "comments")).toBe("accept");
		expect(mapReviewKey(ev("x"), "comments")).toBe("decline");
		expect(mapReviewKey(ev("e"), "comments")).toBe("edit");
		expect(mapReviewKey(ev("r"), "comments")).toBe("reply");
		expect(mapReviewKey(ev("o"), "comments")).toBe("open-in-changes");
		expect(mapReviewKey(ev("a"), "changes")).toBeNull();
	});
	test("escape everywhere, modifiers ignored", () => {
		expect(mapReviewKey(ev("Escape"), "overview")).toBe("escape");
		expect(mapReviewKey(ev("j", { metaKey: true }), "changes")).toBeNull();
	});
});
```

Run: `cd apps/desktop && bun test tests/review-keymap.test.ts` — expected FAIL.

- [ ] **Step 2: Implement `review-keymap.ts`**

```ts
import type { ReviewView } from "../stores/review-mode-store";

export type ReviewKeyAction =
	| "view-overview"
	| "view-changes"
	| "view-comments"
	| "escape"
	| "next"
	| "prev"
	| "toggle-viewed"
	| "new-comment"
	| "next-thread"
	| "prev-thread"
	| "accept"
	| "decline"
	| "edit"
	| "reply"
	| "open-in-changes"
	| "toggle-navigator";

export function mapReviewKey(
	event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
	view: ReviewView
): ReviewKeyAction | null {
	if (event.key === "." && (event.metaKey || event.ctrlKey)) return "toggle-navigator";
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
	switch (event.key) {
		case "1":
			return "view-overview";
		case "2":
			return "view-changes";
		case "3":
			return "view-comments";
		case "Escape":
			return "escape";
		case "j":
			return "next";
		case "k":
			return "prev";
	}
	if (view === "changes") {
		switch (event.key) {
			case "v":
				return "toggle-viewed";
			case "c":
				return "new-comment";
			case "n":
				return "next-thread";
			case "p":
				return "prev-thread";
		}
	}
	if (view === "comments") {
		switch (event.key) {
			case "a":
				return "accept";
			case "x":
				return "decline";
			case "e":
				return "edit";
			case "r":
				return "reply";
			case "o":
				return "open-in-changes";
		}
	}
	return null;
}
```

Run test again — expected PASS.

- [ ] **Step 3: Implement `useReviewKeymap.ts`**

Window keydown listener active only while `active !== null`. Guard: if `event.target` is an `input`, `textarea`, `select`, or `[contenteditable]`, only `Escape` passes (and only to blur/cancel — let the composer's own handler run, so check `event.defaultPrevented` after dispatch or simply skip entirely: composers call `stopPropagation`, which already prevents the window listener; rely on that and skip the target check for Escape too, EXCEPT still guard j/k etc. against Monaco's textarea — Monaco hosts a hidden textarea, so the input guard is mandatory).

Action dispatch:
- `view-*` → `setView`; `toggle-navigator` → `toggleNavigator()`.
- `escape` → if drawer open: close drawer; else `close()`.
- `next`/`prev` → in changes: `advanceFile(sessionKey, ±1)` (existing session-store action); in comments: advance `activeThreadId` through the ordered visible thread list (compute from `groupThreadsByFile` flattened — the shell passes a `getOrderedThreadIds()` ref); in overview: no-op.
- `toggle-viewed` → toggle viewed for `activeFilePath` (same mutation).
- `new-comment` → `sendIntent("new-comment")` (ChangesView listens and opens the composer at the current cursor/first valid line — reuse how `PRReviewKeyboardListener` triggered it via the old `emitPRReviewEvent("new-comment")`, check `components/PRReviewKeyboardListener.tsx` for the exact behavior before deleting it in Task 14).
- `next-thread`/`prev-thread` → advance `activeThreadId` within the current file's threads.
- `accept`/`decline` → look up active thread; if AI draft in pending/edited, call the shared callbacks.
- `edit`/`reply` → `sendIntent("edit"|"reply", activeThreadId)`.
- `open-in-changes` → `openThreadInChanges(...)` for the active thread.

- [ ] **Step 4: Install in shell, type check**

`useReviewKeymap(...)` called once in `ReviewModeShell` with the data it needs. Run `bun run type-check` + `bun test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/desktop && bun run check
git add src/renderer/lib/review-keymap.ts src/renderer/components/review-mode/hooks/useReviewKeymap.ts src/renderer/components/review-mode/ReviewModeShell.tsx tests/review-keymap.test.ts
git commit -m "feat(review-mode): consolidated keyboard model"
```

---

### Task 11: Submit flow — pure helper + popover

**Files:**
- Create: `apps/desktop/src/renderer/lib/pr-review-submit.ts`
- Create: `apps/desktop/src/renderer/components/review-mode/SubmitReviewPopover.tsx`
- Modify: `ReviewHeader.tsx` / `ReviewModeShell.tsx` (submit button in `rightSlot`)
- Test: `apps/desktop/tests/pr-review-submit.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SubmitThreadInput {
	draftCommentId: string;
	path: string;
	line: number | null;
	diffSide: "LEFT" | "RIGHT";
	body: string; // already resolved: userEdit ?? body
}
export interface SubmitDeps {
	createThread: (input: {
		owner: string; repo: string; prNumber: number; body: string;
		commitId: string; path: string; line?: number; side?: "LEFT" | "RIGHT";
	}) => Promise<unknown>;
	setDraftStatus: (commentId: string, status: "submitted" | "error") => Promise<unknown>;
}
export interface SubmitOutcome { posted: number; failed: number; errors: string[] }
export async function postAcceptedDrafts(
	prCtx: PRContext, headCommitOid: string, threads: SubmitThreadInput[], deps: SubmitDeps
): Promise<SubmitOutcome>;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import type { PRContext } from "../src/shared/github-types";
import { postAcceptedDrafts, type SubmitThreadInput } from "../src/renderer/lib/pr-review-submit";

const prCtx: PRContext = {
	provider: "github",
	owner: "o",
	repo: "r",
	number: 1,
	title: "t",
	sourceBranch: "s",
	targetBranch: "m",
	repoPath: "/tmp",
};

const thread = (id: string, line: number | null = 5): SubmitThreadInput => ({
	draftCommentId: id,
	path: "a.ts",
	line,
	diffSide: "RIGHT",
	body: `body-${id}`,
});

describe("postAcceptedDrafts", () => {
	test("posts each thread and marks submitted", async () => {
		const created: unknown[] = [];
		const statuses: Array<[string, string]> = [];
		const out = await postAcceptedDrafts(prCtx, "sha1", [thread("1"), thread("2", null)], {
			createThread: async (i) => created.push(i),
			setDraftStatus: async (id, s) => {
				statuses.push([id, s]);
			},
		});
		expect(out).toEqual({ posted: 2, failed: 0, errors: [] });
		expect(created).toHaveLength(2);
		expect((created[0] as { line?: number }).line).toBe(5);
		expect((created[1] as { line?: number }).line).toBeUndefined();
		expect(statuses).toEqual([
			["1", "submitted"],
			["2", "submitted"],
		]);
	});

	test("failure marks error, keeps going, reports message", async () => {
		const statuses: Array<[string, string]> = [];
		const out = await postAcceptedDrafts(prCtx, "sha1", [thread("1"), thread("2")], {
			createThread: async (i) => {
				if (i.body === "body-1") throw new Error("boom");
			},
			setDraftStatus: async (id, s) => {
				statuses.push([id, s]);
			},
		});
		expect(out.posted).toBe(1);
		expect(out.failed).toBe(1);
		expect(out.errors[0]).toContain("a.ts:5");
		expect(out.errors[0]).toContain("boom");
		expect(statuses).toEqual([
			["1", "error"],
			["2", "submitted"],
		]);
	});

	test("missing head commit fails everything upfront", async () => {
		const out = await postAcceptedDrafts(prCtx, "", [thread("1")], {
			createThread: async () => {},
			setDraftStatus: async () => {},
		});
		expect(out.posted).toBe(0);
		expect(out.failed).toBe(1);
		expect(out.errors).toEqual(["Missing head commit SHA"]);
	});
});
```

Run: `cd apps/desktop && bun test tests/pr-review-submit.test.ts` — expected FAIL.

- [ ] **Step 2: Implement `pr-review-submit.ts`**

Port the loop from `SubmitReviewModal.tsx:34-80` exactly (including best-effort error status marking):

```ts
import type { PRContext } from "../../shared/github-types";

export interface SubmitThreadInput {
	draftCommentId: string;
	path: string;
	line: number | null;
	diffSide: "LEFT" | "RIGHT";
	body: string;
}

export interface SubmitDeps {
	createThread: (input: {
		owner: string;
		repo: string;
		prNumber: number;
		body: string;
		commitId: string;
		path: string;
		line?: number;
		side?: "LEFT" | "RIGHT";
	}) => Promise<unknown>;
	setDraftStatus: (commentId: string, status: "submitted" | "error") => Promise<unknown>;
}

export interface SubmitOutcome {
	posted: number;
	failed: number;
	errors: string[];
}

export async function postAcceptedDrafts(
	prCtx: PRContext,
	headCommitOid: string,
	threads: SubmitThreadInput[],
	deps: SubmitDeps
): Promise<SubmitOutcome> {
	if (!headCommitOid) {
		return { posted: 0, failed: threads.length, errors: ["Missing head commit SHA"] };
	}
	let posted = 0;
	let failed = 0;
	const errors: string[] = [];
	for (const t of threads) {
		try {
			await deps.createThread({
				owner: prCtx.owner,
				repo: prCtx.repo,
				prNumber: prCtx.number,
				body: t.body,
				commitId: headCommitOid,
				path: t.path,
				...(t.line != null ? { line: t.line, side: t.diffSide } : {}),
			});
			await deps.setDraftStatus(t.draftCommentId, "submitted");
			posted++;
		} catch (err) {
			failed++;
			const msg =
				err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
			errors.push(`${t.path}${t.line != null ? `:${t.line}` : ""} - ${msg}`);
			try {
				await deps.setDraftStatus(t.draftCommentId, "error");
			} catch {
				// Best-effort - don't block the loop
			}
		}
	}
	return { posted, failed, errors };
}
```

Run test — expected PASS.

- [ ] **Step 3: Implement `SubmitReviewPopover.tsx`**

Anchored popover (absolute, right-aligned under the header button, `w-[400px]`, `rounded-[var(--radius-lg)]`, `shadow-[var(--shadow-lg)]`, closes on Esc and outside click). Contents top to bottom:
- Verdict segmented control (Comment / Approve / Request changes) — 12px, single-select state.
- Summary textarea (`ReplyComposer` NOT reused here — plain textarea, optional, placeholder "Review summary (optional)").
- Accepted drafts list: each row `file:line` mono 11px + excerpt 12px + remove button (remove = `updateDraftComment` status `pending`, i.e. back to triage). Empty state: "No accepted comments — only the verdict will be posted."
- Primary button `Submit review` (accent bg). On click: build `SubmitThreadInput[]` from `acceptedThreads` (`body: t.userEdit ?? t.body`), call `postAcceptedDrafts` with deps `{ createThread: (i) => createThread.mutateAsync(i), setDraftStatus: (id, status) => updateDraftComment.mutateAsync({ commentId: id, status }) }`, then verdict via `submitReview.mutateAsync({ owner, repo, prNumber, verdict, body })` following the exact needs-verdict/skip logic from `SubmitReviewModal.tsx:86-114`. Show outcome inline (posted/failed counts + error list, success/danger tinted). On full success: invalidate `projects.getPRDetails` + `github.getMyPRs` + draft queries (copy `PRControlRail.tsx:1116-1126`), close popover.

Header button (in `ReviewModeShell` `rightSlot`): accent primary, `Submit review` + count badge when `acceptedThreads.length > 0`, disabled while a submit is in flight.

- [ ] **Step 4: Type check + tests, commit**

Run: `bun run type-check && cd apps/desktop && bun test`. Expected: PASS.

```bash
cd apps/desktop && bun run check
git add src/renderer/lib/pr-review-submit.ts src/renderer/components/review-mode/SubmitReviewPopover.tsx src/renderer/components/review-mode/ tests/pr-review-submit.test.ts
git commit -m "feat(review-mode): single submit flow with popover"
```

---

### Task 12: Agent review — status chip, trigger, terminal drawer

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/AgentStatusChip.tsx`
- Create: `apps/desktop/src/renderer/components/review-mode/TerminalDrawer.tsx`
- Modify: `ReviewModeShell.tsx`, `ReviewHeader.tsx` slot

**Interfaces:**
- Consumes: trigger/cancel/follow-up mutations — copy EXACTLY from `PRControlRail.tsx:821-933` (`aiReview.triggerReview`, `triggerFollowUp`, `cancelReview`, `workspaces.attachTerminal`, `projects.getByRepo`, `addTerminalTab`, the 500ms-delayed `window.electron.terminal.write(tabId, "bash '<launchScript>'\n")`) with ONE change: instead of `splitPROverviewRight(...)`, call `useReviewModeStore.getState().setTerminal({ tabId, workspaceId: launchInfo.reviewWorkspaceId, cwd: launchInfo.worktreePath })` and `setDrawerOpen(true)`.
- `Terminal` component (`components/Terminal.tsx`, props `id`, `cwd`, `workspaceId` — see `panes/PaneContent.tsx:45-50`).
- Produces: `<AgentStatusChip workspaceId prCtx matchingDraft />` and `<TerminalDrawer />`.

- [ ] **Step 1: Implement `AgentStatusChip.tsx`**

States driven by `matchingDraft?.status`:
- No draft → secondary button "Start review".
- `queued`/`in_progress` → chip with pulsing dot (`animate-pulse`, `bg-[var(--accent)]`), label "Reviewing...", click toggles `drawerOpen`; small "x" cancel button inside calls `cancelReview` then offers restart (keep `handleUnifiedReview` semantics from `PRControlRail.tsx:892-933`).
- `ready`/`submitted`/`failed` → secondary button "Re-review" (follow-up via `triggerFollowUp` with `reviewChainId` from `aiDraft.reviewChainId ?? matchingDraft.id`, per `PRControlRail.tsx:817`).

- [ ] **Step 2: Implement `TerminalDrawer.tsx`**

```tsx
import { useReviewModeStore } from "../../stores/review-mode-store";
import { Terminal } from "../Terminal";

export function TerminalDrawer() {
	const drawerOpen = useReviewModeStore((s) => s.drawerOpen);
	const terminal = useReviewModeStore((s) => s.terminal);
	const setDrawerOpen = useReviewModeStore((s) => s.setDrawerOpen);

	if (!terminal) return null;
	return (
		<div
			className={`shrink-0 border-t border-[var(--border)] bg-[var(--bg-surface)] ${drawerOpen ? "h-[300px]" : "h-8"}`}
		>
			<button
				type="button"
				onClick={() => setDrawerOpen(!drawerOpen)}
				className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
			>
				<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
				Agent review terminal
				<span className="flex-1" />
				{drawerOpen ? "Hide" : "Show"}
			</button>
			{drawerOpen && (
				<div className="h-[calc(300px-2rem)]">
					<Terminal id={terminal.tabId} cwd={terminal.cwd} workspaceId={terminal.workspaceId} />
				</div>
			)}
		</div>
	);
}
```

Keep the `Terminal` mounted while the drawer is merely collapsed? The terminal tab also exists in the review workspace's pane (via `addTerminalTab`) — the daemon PTY survives regardless; remounting on expand is acceptable (same as app restart reattach). Keep this simple version.

- [ ] **Step 3: Wire into shell** — `TerminalDrawer` below the content row; `AgentStatusChip` into `ReviewHeader` `rightSlot` beside the submit button. Order: `[AgentStatusChip] [Submit review]`.

- [ ] **Step 4: Type check + commit**

Run: `bun run type-check`. Expected: PASS.

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/
git commit -m "feat(review-mode): agent review chip and terminal drawer"
```

---

### Task 13: `OverviewView`

**Files:**
- Create: `apps/desktop/src/renderer/components/review-mode/views/OverviewView.tsx`
- Modify: `ReviewModeShell.tsx`

**Interfaces:**
- Consumes: `details` (`GitHubPRDetails`), `aiDraft` (summary + rounds), `counts` from `useReviewData`; `MarkdownRenderer`; `trpc.aiReview.getReviewChainHistory` — check the exact input shape in `PROverviewTab.tsx` (search for `getReviewChainHistory` there and copy the call).
- Produces: `<OverviewView prCtx details aiDraft counts onJumpToComments={(filter) => ...} />`.

- [ ] **Step 1: Implement**

Centered `max-w-[760px] mx-auto px-6 py-8` column, sections spaced `gap-6`:
1. Title block: 18px/600 title, `#number` + author + state chip (Open/Draft/Merged/Closed from `details.state`/`isDraft`), 12px secondary.
2. Description: `MarkdownRenderer` on `details.body`; if empty, quiet "No description" at 13px tertiary.
3. AI review summary card (only when `aiDraft?.summaryMarkdown`): card (`bg-[var(--bg-surface)]`, `border-subtle`, radius-md, `p-4`) with `.ai-badge` + "Review summary" + round number header, then markdown. Collapsible previous rounds below it from `getReviewChainHistory` (each round: header row with round number + timestamp, expands to its summary markdown).
4. Stats strip: files changed count, `+adds -dels` totals (sum `details.files`), then one stat per non-zero bucket (Pending / Accepted / Declined / Open / Resolved) — each a plain clickable stat (`text-[13px]` number + 12px label) calling `onJumpToComments(bucket)` which sets `commentFilter` and `setView("comments")`.
5. Reviewers: rows of `details.reviewers` with decision-colored 11px chips (green Approved / red Changes requested / gray Commented-Pending).

No verdict UI here — submission lives only in the header popover.

- [ ] **Step 2: Wire in shell** — `{view === "overview" && details && <OverviewView ... />}`; delete the placeholder div.

- [ ] **Step 3: Type check + commit**

Run: `bun run type-check`. Expected: PASS.

```bash
cd apps/desktop && bun run check
git add src/renderer/components/review-mode/
git commit -m "feat(review-mode): overview view"
```

---

### Task 14: Entry-point migration + delete the old PR review UI

The cutover. After this task the old rail/tab flow is gone.

**Files:**
- Modify: `apps/desktop/src/renderer/components/GitHubPRList.tsx:293`, `apps/desktop/src/renderer/components/PullRequestsTab.tsx:199,587,651`, `apps/desktop/src/renderer/components/SidebarRail.tsx:553` — every `openPRReviewPanel(workspaceId, prCtx)` / `openPROverview(...)` call becomes `useReviewModeStore.getState().open(workspaceId, prCtx)`.
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts` — remove `openPRReviewPanel`, `openPRReviewFile`, `swapPRReviewFile`, `openPROverview`, the `pr-review-file` and `pr-overview` tab kinds, and the `"pr-review"` member of `PanelMode` (line 92) + `prCtx` from `RightPanelState`.
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx:260-289` — remove the `pr-review` mode branch (`PRControlRail` render).
- Modify: `apps/desktop/src/renderer/components/panes/PaneContent.tsx:78-95` — remove `pr-review-file` and `pr-overview` cases + imports.
- Modify: `apps/desktop/src/renderer/App.tsx:754` — remove `<PRReviewKeyboardListener />`.
- Delete: `PRControlRail.tsx`, `PROverviewTab.tsx`, `PRReviewFileTab.tsx`, `ReviewFileGroupCard.tsx`, `SubmitReviewModal.tsx`, `components/PRReviewKeyboardListener.tsx`, `components/review/ActiveThreadBar.tsx`, `lib/pr-review-events.ts`, `lib/pr-review-keymap.ts`, `lib/pr-review-nav.ts`, and `ReviewVerdictConfirmation.tsx` + `ReviewFilterTabs`-adjacent files ONLY IF unused by the local review flow — check imports first (`ReviewVerdictConfirmation` is imported by `PROverviewTab` only? verify; `ReviewHintBar`, `ReviewProgressBar`, `ReviewFilterTabs` belong to the LOCAL review flow — keep them).
- Keep: `CommentThreadCard.tsx` (used by `CommentsOverviewTab` in the local flow), `pr-panel-helpers.ts` if `splitPROverviewRight` has other callers (verify; if PR-review-only, delete).

- [ ] **Step 1: Rewire entry points** — swap the calls listed above; import `useReviewModeStore`.

- [ ] **Step 2: Remove dead flow from stores/panels** — tab-store, DiffPanel, PaneContent, App.tsx changes above. TypeScript will chase every remaining reference; fix all compile errors by deleting the dependent dead code (do NOT re-add shims).

- [ ] **Step 3: Delete files** — `git rm` the delete list after verifying no remaining imports (search each filename; the type-checker is the backstop).

- [ ] **Step 4: Full verification**

Run: `bun run type-check` (root) — PASS with zero errors.
Run: `cd apps/desktop && bun test` — all suites PASS.
Run: `bun run lint` (root) — clean.

- [ ] **Step 5: Manual end-to-end pass** (use the `verify` skill if available)

With `bun run dev`, on a real repo with an open PR:
1. Click a PR in the sidebar list → full-window Review Mode opens on Overview.
2. `2` → Changes: diff renders, navigator file rows work, j/k moves files, v toggles viewed, gutter "+" only on changed lines, inline cards render, reply/resolve work.
3. Start review → chip pulses, drawer shows terminal, drafts appear within one poll cycle; accept via `a` in Comments view; edit via `e`.
4. `3` → Comments: filters, context snippets, accept/decline/reply.
5. Submit review popover: accepted comments listed, submit posts to the provider, verdict works, failure rows render on induced error (e.g. stale head SHA) — optional.
6. Esc exits; workspace shell is intact (terminals still alive).

- [ ] **Step 6: Commit**

```bash
cd apps/desktop && bun run check
git add -A
git commit -m "feat(review-mode): cut over entry points and remove legacy PR review UI"
```

---

### Task 15: Polish pass against the spec's visual rules

**Files:** all `review-mode/` files.

- [ ] **Step 1: Audit type/spacing** — search `review-mode/` for `text-[9px]`/`text-[10px]` (must be zero), confirm body text is 13px in Overview/Comments cards, labels 12px, meta 11px floor. Confirm reading columns are `max-w-[760px]`.
- [ ] **Step 2: Audit color usage** — accent only on primary button, active states, focus; no hex literals; AI purple only badge + dots + gutter.
- [ ] **Step 3: Light theme check** — toggle `[data-theme="light"]`, verify contrast on chips, snippet tints, navigator active states.
- [ ] **Step 3b: Navigator resize** — make the 280px navigator drag-resizable between 220px and 360px: a 4px invisible drag handle on its right edge updating a `navigatorWidth` field added to `review-mode-store` (default 280, clamped 220-360, actions `setNavigatorWidth`). Pointer events only, no library — mirror the `.panel-resize-handle` hover style from `styles.css:432-455`.
- [ ] **Step 4: Run everything**

`bun run check && bun run type-check && cd apps/desktop && bun test` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "polish(review-mode): typography, spacing, and theme audit"
```

---

## Self-Review Notes (already applied)

- Spec 4.4 "Collapse all / expand all" is implemented via the `allCollapsed` key-flip in Task 9 — simplified but covered.
- Spec 4.9 `Cmd+Enter` submit-composer: composers submit on plain Enter (existing idiom preserved); Cmd+Enter dropped as redundant.
- Spec's navigator condensed filter maps to store filter values `all`/`pending`/`resolved` (Task 5) — a pragmatic narrowing of `CONDENSED_TO_FILTERS`; the full mapping helper stays available if the UX needs it later.
- `pr-review-session-store` is reused untouched; only `tab-store` loses PR members.
- Backend/routers untouched throughout; every mutation shape is copied from a working call site with a verify instruction.
