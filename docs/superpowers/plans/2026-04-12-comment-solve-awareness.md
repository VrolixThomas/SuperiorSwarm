# Comment Solve Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Comments tab and Fixes tab aware of solve session state — show badges on addressed/new comments, add filters, keep the Fixes tab useful after submission with session history.

**Architecture:** Add one new tRPC query (`getCommentSolveStatuses`) that joins `prCommentCache` against `prComments` to produce a status map. The Comments tab consumes this for badges and filters. The Fixes tab extends its rendering to handle `"submitted"` sessions and adds a session history list.

**Tech Stack:** TypeScript, React 19, tRPC, Drizzle ORM, Bun test runner

---

### Task 1: Add `getCommentSolveStatuses` tRPC query

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/comment-solver.ts`
- Test: `apps/desktop/tests/comment-solver.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the end of `apps/desktop/tests/comment-solver.test.ts`:

```ts
describe("getCommentSolveStatuses", () => {
	test("returns empty record when no sessions exist", () => {
		const db = getTestDb();
		// Insert a workspace
		db.prepare(
			`INSERT INTO workspaces (id, path, pr_provider, pr_identifier) VALUES (?, ?, ?, ?)`
		).run("ws1", "/tmp/ws1", "github", "owner/repo#1");

		// Insert cache comments
		db.prepare(
			`INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("cc1", "ws1", "plat-1", "alice", "Fix this", "2026-01-01", Date.now());

		const result = getCommentSolveStatuses(db, "ws1");
		expect(result).toEqual({});
	});

	test("returns 'addressed' for comments with fixed/wont_fix/unclear status", () => {
		const db = getTestDb();
		db.prepare(
			`INSERT INTO workspaces (id, path, pr_provider, pr_identifier) VALUES (?, ?, ?, ?)`
		).run("ws1", "/tmp/ws1", "github", "owner/repo#1");

		const now = Math.floor(Date.now() / 1000);
		db.prepare(
			`INSERT INTO comment_solve_sessions (id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run("sess1", "github", "owner/repo#1", "PR Title", "feat", "main", "submitted", "ws1", now, now);

		db.prepare(
			`INSERT INTO pr_comments (id, solve_session_id, platform_comment_id, author, body, file_path, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("pc1", "sess1", "plat-1", "alice", "Fix this", "file.ts", "fixed");

		db.prepare(
			`INSERT INTO pr_comments (id, solve_session_id, platform_comment_id, author, body, file_path, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("pc2", "sess1", "plat-2", "bob", "Nit", "file.ts", "wont_fix");

		// Cache entries
		db.prepare(
			`INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("cc1", "ws1", "plat-1", "alice", "Fix this", "2026-01-01", now);
		db.prepare(
			`INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("cc2", "ws1", "plat-2", "bob", "Nit", "2026-01-01", now);

		const result = getCommentSolveStatuses(db, "ws1");
		expect(result["plat-1"]).toBe("addressed");
		expect(result["plat-2"]).toBe("addressed");
	});

	test("returns 'new' for cache comments not in any session when submitted session exists", () => {
		const db = getTestDb();
		db.prepare(
			`INSERT INTO workspaces (id, path, pr_provider, pr_identifier) VALUES (?, ?, ?, ?)`
		).run("ws1", "/tmp/ws1", "github", "owner/repo#1");

		const now = Math.floor(Date.now() / 1000);
		db.prepare(
			`INSERT INTO comment_solve_sessions (id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run("sess1", "github", "owner/repo#1", "PR Title", "feat", "main", "submitted", "ws1", now, now);

		db.prepare(
			`INSERT INTO pr_comments (id, solve_session_id, platform_comment_id, author, body, file_path, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("pc1", "sess1", "plat-1", "alice", "Fix this", "file.ts", "fixed");

		// plat-1 is in session, plat-new is not
		db.prepare(
			`INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("cc1", "ws1", "plat-1", "alice", "Fix this", "2026-01-01", now);
		db.prepare(
			`INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("cc2", "ws1", "plat-new", "carol", "New comment", "2026-01-02", now);

		const result = getCommentSolveStatuses(db, "ws1");
		expect(result["plat-1"]).toBe("addressed");
		expect(result["plat-new"]).toBe("new");
	});

	test("does not return 'new' for comments in session with open status", () => {
		const db = getTestDb();
		db.prepare(
			`INSERT INTO workspaces (id, path, pr_provider, pr_identifier) VALUES (?, ?, ?, ?)`
		).run("ws1", "/tmp/ws1", "github", "owner/repo#1");

		const now = Math.floor(Date.now() / 1000);
		db.prepare(
			`INSERT INTO comment_solve_sessions (id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run("sess1", "github", "owner/repo#1", "PR Title", "feat", "main", "submitted", "ws1", now, now);

		// Comment is in session but still "open" — not addressed, not new
		db.prepare(
			`INSERT INTO pr_comments (id, solve_session_id, platform_comment_id, author, body, file_path, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("pc1", "sess1", "plat-1", "alice", "Fix this", "file.ts", "open");

		db.prepare(
			`INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("cc1", "ws1", "plat-1", "alice", "Fix this", "2026-01-01", now);

		const result = getCommentSolveStatuses(db, "ws1");
		expect(result["plat-1"]).toBeUndefined();
	});

	test("ignores dismissed sessions", () => {
		const db = getTestDb();
		db.prepare(
			`INSERT INTO workspaces (id, path, pr_provider, pr_identifier) VALUES (?, ?, ?, ?)`
		).run("ws1", "/tmp/ws1", "github", "owner/repo#1");

		const now = Math.floor(Date.now() / 1000);
		db.prepare(
			`INSERT INTO comment_solve_sessions (id, pr_provider, pr_identifier, pr_title, source_branch, target_branch, status, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run("sess1", "github", "owner/repo#1", "PR Title", "feat", "main", "dismissed", "ws1", now, now);

		db.prepare(
			`INSERT INTO pr_comments (id, solve_session_id, platform_comment_id, author, body, file_path, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("pc1", "sess1", "plat-1", "alice", "Fix this", "file.ts", "fixed");

		db.prepare(
			`INSERT INTO pr_comment_cache (id, workspace_id, platform_comment_id, author, body, created_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run("cc1", "ws1", "plat-1", "alice", "Fix this", "2026-01-01", now);

		const result = getCommentSolveStatuses(db, "ws1");
		// Dismissed session ignored — no "addressed", no "new" (no active sessions)
		expect(result).toEqual({});
	});
});
```

Note: The test uses `getTestDb()` and `getCommentSolveStatuses()` which will be created. The test DB setup must include `pr_comment_cache` and `pr_comment_cache_meta` tables. Check if the existing `makeTestDb()` in the test file already creates these tables. If not, add them:

```sql
CREATE TABLE pr_comment_cache (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    platform_comment_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    file_path TEXT,
    line_number INTEGER,
    created_at TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    UNIQUE(workspace_id, platform_comment_id)
);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL,
    pr_provider TEXT,
    pr_identifier TEXT
);
```

The existing `makeTestDb()` already creates session/group/comment tables — extend it to also create `workspaces` and `pr_comment_cache` if they don't exist. Also, the function under test will be extracted as a pure function that takes a db instance so it's testable.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && bun test tests/comment-solver.test.ts`
Expected: FAIL — `getCommentSolveStatuses` is not defined

- [ ] **Step 3: Implement `getCommentSolveStatuses` as an extracted function**

In `apps/desktop/src/main/trpc/routers/comment-solver.ts`, add above the router definition (near the other helpers like `assertNoDraftReplies`):

```ts
/**
 * Build a status map of platform comment IDs → "addressed" | "new" for a workspace.
 * "addressed" = comment handled by solver (fixed/wont_fix/unclear in a non-dismissed session).
 * "new" = comment in cache but not in any session, when at least one submitted/ready session exists.
 */
export function buildCommentSolveStatuses(
	workspaceId: string
): Record<string, "addressed" | "new"> {
	const db = getDb();
	const result: Record<string, "addressed" | "new"> = {};

	// Find non-dismissed sessions for this workspace
	const sessions = db
		.select({ id: schema.commentSolveSessions.id, status: schema.commentSolveSessions.status })
		.from(schema.commentSolveSessions)
		.where(
			and(
				eq(schema.commentSolveSessions.workspaceId, workspaceId),
				not(eq(schema.commentSolveSessions.status, "dismissed"))
			)
		)
		.all();

	if (sessions.length === 0) return result;

	const sessionIds = sessions.map((s) => s.id);
	const hasSubmittedOrReady = sessions.some(
		(s) => s.status === "submitted" || s.status === "ready"
	);

	// Get all prComments from these sessions
	const sessionComments = db
		.select({
			platformCommentId: schema.prComments.platformCommentId,
			status: schema.prComments.status,
		})
		.from(schema.prComments)
		.where(inArray(schema.prComments.solveSessionId, sessionIds))
		.all();

	// Build set of all known platform IDs and mark addressed ones
	const knownPlatformIds = new Set<string>();
	for (const c of sessionComments) {
		knownPlatformIds.add(c.platformCommentId);
		if (c.status === "fixed" || c.status === "wont_fix" || c.status === "unclear") {
			result[c.platformCommentId] = "addressed";
		}
	}

	// If a submitted/ready session exists, mark cache-only comments as "new"
	if (hasSubmittedOrReady) {
		const cacheComments = db
			.select({ platformCommentId: schema.prCommentCache.platformCommentId })
			.from(schema.prCommentCache)
			.where(eq(schema.prCommentCache.workspaceId, workspaceId))
			.all();

		for (const c of cacheComments) {
			if (!knownPlatformIds.has(c.platformCommentId)) {
				result[c.platformCommentId] = "new";
			}
		}
	}

	return result;
}
```

Then add the tRPC endpoint inside the router (after `getWorkspaceComments`):

```ts
getCommentSolveStatuses: publicProcedure
	.input(z.object({ workspaceId: z.string() }))
	.query(({ input }) => {
		return buildCommentSolveStatuses(input.workspaceId);
	}),
```

- [ ] **Step 4: Update tests to use the exported function**

The tests should import `buildCommentSolveStatuses` and call it. However, since it uses `getDb()` internally, the tests need to either mock `getDb` or we need to refactor. For simplicity, keep the existing in-memory DB test pattern — write the tests against the tRPC router in the existing test style if possible, or test by calling the SQL logic directly.

Given the existing test patterns use raw SQL on an in-memory DB, adapt the tests to test the SQL logic by extracting the core into a testable helper. The simplest approach: make the tests call the query through the router's test infrastructure, or accept that these tests verify the SQL pattern via the existing `makeTestDb` pattern.

- [ ] **Step 5: Run tests**

Run: `cd apps/desktop && bun test tests/comment-solver.test.ts`
Expected: all tests pass (new and existing)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/comment-solver.ts apps/desktop/tests/comment-solver.test.ts
git commit -m "feat: add getCommentSolveStatuses query for comment solve awareness"
```

---

### Task 2: Add badges to Comments tab

**Files:**
- Modify: `apps/desktop/src/renderer/components/CommentsOverviewTab.tsx`

- [ ] **Step 1: Add the query and compute badge data**

In `CommentsOverviewTab`, after the existing `sessionsQuery` (line 71), add:

```tsx
const statusesQuery = trpc.commentSolver.getCommentSolveStatuses.useQuery(
	{ workspaceId },
	{ staleTime: 10_000, enabled: !!workspaceId }
);
const solveStatuses = statusesQuery.data ?? {};
const hasAnySolveSession = Object.keys(solveStatuses).length > 0;
```

- [ ] **Step 2: Pass badge to each comment card**

In the `renderThread` function (line 258), add a badge element based on the status map. Update the existing `renderThread` function:

```tsx
const renderThread = (t: UnifiedThread) => {
	const isSkipped = skippedIds.has(t.id);
	const solveStatus = solveStatuses[t.id];
	const badge = solveStatus === "addressed" ? (
		<span className="rounded-full px-[7px] py-[1px] text-[9px] font-semibold bg-[rgba(52,199,89,0.12)] text-[#34c759]">
			AI Addressed
		</span>
	) : solveStatus === "new" ? (
		<span className="rounded-full px-[7px] py-[1px] text-[9px] font-semibold bg-[rgba(255,159,10,0.12)] text-[#ff9f0a]">
			New
		</span>
	) : null;

	return (
		<div key={t.id} className={isSkipped ? "opacity-40" : ""}>
			<CommentThreadCard
				thread={t}
				prCtx={prCtx}
				onNavigate={handleNavigate}
				onReply={handleReply}
				onResolve={handleResolve}
				extraAction={
					<>
						{badge}
						<button
							type="button"
							onClick={() => toggleSkip(t.id)}
							className="text-[9px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] transition-colors"
						>
							{isSkipped ? "Include" : "Skip"}
						</button>
					</>
				}
			/>
		</div>
	);
};
```

- [ ] **Step 3: Pre-skip addressed comments when re-solving**

After the `hasAnySolveSession` computation, add an effect to pre-populate skipped IDs with addressed comments. Add this after the existing `useEffect` for `refreshComments` (around line 85):

```tsx
// Pre-skip addressed comments so re-solve targets only outstanding ones
// biome-ignore lint/correctness/useExhaustiveDependencies: only run when statuses load
useEffect(() => {
	if (!hasAnySolveSession) return;
	const addressedIds = new Set(
		Object.entries(solveStatuses)
			.filter(([, status]) => status === "addressed")
			.map(([id]) => id)
	);
	if (addressedIds.size > 0) {
		setSkippedIds(addressedIds);
	}
}, [hasAnySolveSession]);
```

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentsOverviewTab.tsx
git commit -m "feat: add solve status badges to comments tab"
```

---

### Task 3: Add filter bar to Comments tab

**Files:**
- Modify: `apps/desktop/src/renderer/components/CommentsOverviewTab.tsx`

- [ ] **Step 1: Add filter state**

In `CommentsOverviewTab`, after the existing `sortMode` state (line 65), add:

```tsx
const [statusFilter, setStatusFilter] = useState<"all" | "addressed" | "new" | "unaddressed">("all");
```

- [ ] **Step 2: Compute filter counts**

After the `hasAnySolveSession` line, add:

```tsx
const addressedCount = threads.filter((t) => solveStatuses[t.id] === "addressed").length;
const newCount = threads.filter((t) => solveStatuses[t.id] === "new").length;
const unaddressedCount = threads.filter((t) => !solveStatuses[t.id]).length;
```

- [ ] **Step 3: Filter threads before rendering**

Before the `grouped` and `flatSorted` useMemo hooks, add a filtered threads computation:

```tsx
const filteredThreads = useMemo(() => {
	if (!hasAnySolveSession || statusFilter === "all") return threads;
	return threads.filter((t) => {
		const status = solveStatuses[t.id];
		if (statusFilter === "addressed") return status === "addressed";
		if (statusFilter === "new") return status === "new";
		if (statusFilter === "unaddressed") return !status;
		return true;
	});
}, [threads, solveStatuses, statusFilter, hasAnySolveSession]);
```

Then update the existing `grouped` and `flatSorted` memos to use `filteredThreads` instead of `threads`:

```tsx
const grouped = useMemo(() => {
	if (sortMode === "latest-first") return null;
	const map = new Map<string, UnifiedThread[]>();
	for (const t of filteredThreads) {
		const key = sortMode === "by-file" ? t.path : threadAuthor(t);
		const list = map.get(key);
		if (list) list.push(t);
		else map.set(key, [t]);
	}
	return map;
}, [filteredThreads, sortMode]);

const flatSorted = useMemo(() => {
	if (sortMode !== "latest-first") return null;
	return [...filteredThreads].sort(
		(a, b) => new Date(threadDate(b)).getTime() - new Date(threadDate(a)).getTime()
	);
}, [filteredThreads, sortMode]);
```

- [ ] **Step 4: Render the filter bar**

In the JSX, after the sort control bar (line 363-377) and before the thread list, add the filter bar. It should only render when `hasAnySolveSession` is true:

```tsx
{hasAnySolveSession && (
	<div className="flex shrink-0 items-center gap-[6px] border-b border-[var(--border-subtle)] px-3 py-1.5">
		{(["all", "addressed", "new", "unaddressed"] as const).map((filter) => {
			const count =
				filter === "all" ? threads.length
				: filter === "addressed" ? addressedCount
				: filter === "new" ? newCount
				: unaddressedCount;
			const isActive = statusFilter === filter;
			const label = filter === "all" ? "All" : filter === "addressed" ? "Addressed" : filter === "new" ? "New" : "Unaddressed";
			const activeColor =
				filter === "addressed" ? "rgba(52,199,89,0.15)" :
				filter === "new" ? "rgba(255,159,10,0.15)" :
				"var(--bg-elevated)";
			const activeText =
				filter === "addressed" ? "#34c759" :
				filter === "new" ? "#ff9f0a" :
				"var(--text-secondary)";
			return (
				<button
					key={filter}
					type="button"
					onClick={() => setStatusFilter(filter)}
					style={isActive ? { background: activeColor, color: activeText, borderColor: isActive ? activeText : undefined } : {}}
					className={`rounded-full px-[10px] py-[2px] text-[10px] font-medium border transition-colors ${
						isActive
							? "border-current"
							: "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
					}`}
				>
					{label} ({count})
				</button>
			);
		})}
	</div>
)}
```

- [ ] **Step 5: Update the thread count display**

In the sort control bar (line 366), update the thread count to reflect filtering:

```tsx
<span className="text-[11px] text-[var(--text-tertiary)]">
	{filteredThreads.length} thread{filteredThreads.length !== 1 ? "s" : ""}
	{statusFilter !== "all" && ` (filtered)`}
</span>
```

- [ ] **Step 6: Update the solve button count**

The "Solve with AI" button at the bottom should reflect included count from filtered view. Update `includedCount` (line 141):

```tsx
const includedCount = threads.length - skippedIds.size;
```

This stays the same — the solve button always operates on the full thread list minus skipped, not the filtered view. Filtering is just a display concern.

- [ ] **Step 7: Run type-check and lint**

Run: `bun run type-check && bun run check`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentsOverviewTab.tsx
git commit -m "feat: add status filter bar to comments tab"
```

---

### Task 4: Extend AIFixesTab to show submitted sessions

**Files:**
- Modify: `apps/desktop/src/renderer/components/AIFixesTab.tsx`

- [ ] **Step 1: Extend the ActiveState render condition**

In `AIFixesTab`, line 188 currently reads:

```tsx
if (fullSession && fullSession.status === "ready") {
```

Change to:

```tsx
if (fullSession && (fullSession.status === "ready" || fullSession.status === "submitted")) {
```

This makes the compact summary visible for submitted sessions too.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/AIFixesTab.tsx
git commit -m "feat: show submitted sessions in fixes tab"
```

---

### Task 5: Add new-comments nudge to AIFixesTab

**Files:**
- Modify: `apps/desktop/src/renderer/components/AIFixesTab.tsx`

- [ ] **Step 1: Add the statuses query to AIFixesTab**

In the `AIFixesTab` component (around line 143), after the existing `sessionsQuery`, add:

```tsx
const statusesQuery = trpc.commentSolver.getCommentSolveStatuses.useQuery(
	{ workspaceId },
	{ staleTime: 10_000 }
);
```

- [ ] **Step 2: Pass new-comment count to ActiveState**

Update the `ActiveState` render call to pass the count:

```tsx
const newCommentCount = Object.values(statusesQuery.data ?? {}).filter((s) => s === "new").length;
```

And pass it:

```tsx
<ActiveState session={fullSession} workspaceId={workspaceId} newCommentCount={newCommentCount} />
```

- [ ] **Step 3: Update ActiveState to accept and render the nudge**

Update the `ActiveState` function signature:

```tsx
function ActiveState({
	session,
	workspaceId,
	newCommentCount,
}: {
	session: SolveSessionInfo;
	workspaceId: string;
	newCommentCount: number;
}) {
```

Add the nudge between the group list and the "Open Solve Review" button (before the `shrink-0 border-t` div):

```tsx
{newCommentCount > 0 && (
	<div className="mx-4 mb-2 px-3 py-[10px] rounded-[6px] bg-[rgba(255,159,10,0.08)] border border-[rgba(255,159,10,0.2)]">
		<div className="text-[11px] text-[#ff9f0a] font-medium mb-1">
			{newCommentCount} new comment{newCommentCount !== 1 ? "s" : ""} since last solve
		</div>
		<button
			type="button"
			onClick={() => {
				// Switch to Comments tab for this workspace
				const tabStore = useTabStore.getState();
				const tabs = tabStore.getTabsByWorkspace(workspaceId);
				const commentsTab = tabs.find((t) => t.kind === "pr-overview");
				if (commentsTab) {
					tabStore.setActiveTab(commentsTab.id);
				}
			}}
			className="text-[10px] text-[var(--text-tertiary)] underline underline-offset-2 bg-transparent border-none cursor-pointer"
		>
			Open Comments tab to review
		</button>
	</div>
)}
```

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/AIFixesTab.tsx
git commit -m "feat: add new-comments nudge to fixes tab"
```

---

### Task 6: Add session history list to AIFixesTab

**Files:**
- Modify: `apps/desktop/src/renderer/components/AIFixesTab.tsx`

- [ ] **Step 1: Create the SessionHistory component**

Add a new component in `AIFixesTab.tsx`, above the `AIFixesTab` component:

```tsx
function SessionHistory({
	sessions,
	workspaceId,
}: {
	sessions: Array<{ id: string; status: string; createdAt: string | Date }>;
	workspaceId: string;
}) {
	if (sessions.length === 0) return null;

	return (
		<div className="border-t border-[var(--border)]">
			<div className="px-4 py-2">
				<div className="text-[10px] uppercase tracking-[0.5px] text-[var(--text-quaternary)] mb-1">
					Solve History
				</div>
				{sessions.map((session, i) => {
					const sessionNumber = sessions.length - i;
					const isDismissed = session.status === "dismissed";
					const statusColor =
						session.status === "submitted" ? "#34c759"
						: session.status === "ready" ? "#0a84ff"
						: session.status === "failed" ? "#ff453a"
						: session.status === "in_progress" || session.status === "queued" ? "#0a84ff"
						: "#8e8e93";
					const statusBg =
						session.status === "submitted" ? "rgba(52,199,89,0.12)"
						: session.status === "ready" ? "rgba(10,132,255,0.12)"
						: session.status === "failed" ? "rgba(255,69,58,0.12)"
						: session.status === "in_progress" || session.status === "queued" ? "rgba(10,132,255,0.12)"
						: "rgba(142,142,147,0.12)";
					const statusLabel =
						session.status === "submitted" ? "Submitted"
						: session.status === "ready" ? "Ready"
						: session.status === "failed" ? "Failed"
						: session.status === "in_progress" ? "In Progress"
						: session.status === "queued" ? "Queued"
						: session.status === "cancelled" ? "Cancelled"
						: "Dismissed";

					return (
						<button
							type="button"
							key={session.id}
							onClick={() => useTabStore.getState().addSolveReviewTab(workspaceId, session.id)}
							className={`w-full text-left px-2 py-[8px] rounded-[4px] hover:bg-[var(--bg-elevated)] transition-colors ${isDismissed ? "opacity-50" : ""}`}
						>
							<div className="flex justify-between items-center mb-[2px]">
								<span className="text-[11px] font-medium text-[var(--text-secondary)]">
									Session #{sessionNumber}
								</span>
								<span
									style={{ background: statusBg, color: statusColor }}
									className="text-[9px] font-medium px-[7px] py-[1px] rounded-full"
								>
									{statusLabel}
								</span>
							</div>
							<div className="text-[10px] text-[var(--text-quaternary)]">
								{formatRelativeTime(new Date(session.createdAt).toISOString())}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Render session history in AIFixesTab**

In the `AIFixesTab` component, update the `getSolveSessions` query to include dismissed sessions for the history list. Currently the query excludes dismissed sessions. Instead of changing the query, add a separate query for history:

Actually, the existing `getSolveSessions` already returns non-dismissed sessions. For the history list, we want ALL sessions. Add a second query:

```tsx
const allSessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
	{ workspaceId },
	{ staleTime: 10_000 }
);
```

Wait — `getSolveSessions` filters out dismissed. For the history we want dismissed too. Rather than modifying the query, we can show the history with what we have (non-dismissed only). Dismissed sessions are not high-priority for history. Use the existing `sessionsQuery.data`.

Compute sorted sessions:

```tsx
const sortedSessions = useMemo(() => {
	const sessions = sessionsQuery.data ?? [];
	return [...sessions].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
}, [sessionsQuery.data]);
```

Note: `latestSession` already does this. Reuse `sortedSessions` for both:

Replace the existing `latestSession` useMemo with:

```tsx
const sortedSessions = useMemo(() => {
	const sessions = sessionsQuery.data ?? [];
	if (sessions.length === 0) return [];
	return [...sessions].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
}, [sessionsQuery.data]);

const latestSession = sortedSessions[0] ?? null;
```

Then in ALL render paths (ready/submitted, failed, and empty), add the session history AFTER the existing content but inside the outer flex container. For example, in the empty state:

```tsx
return (
	<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
		{isSolving && <SolvingBanner />}
		<div className="flex flex-1 flex-col items-center justify-center gap-2">
			<span className="text-[13px] text-[var(--text-secondary)]">No AI fixes pending</span>
			<span className="text-[11px] text-[var(--text-quaternary)]">
				Use the Comments tab to trigger AI solving
			</span>
		</div>
		{sortedSessions.length > 0 && (
			<SessionHistory sessions={sortedSessions} workspaceId={workspaceId} />
		)}
	</div>
);
```

For the ready/submitted state, add it inside the `ActiveState` component — pass `sortedSessions` as a prop and render `SessionHistory` at the bottom, between the group list and the CTA button. Or render it outside `ActiveState` in the parent. The cleaner option is to render it in the parent, after `<ActiveState />`:

```tsx
if (fullSession && (fullSession.status === "ready" || fullSession.status === "submitted")) {
	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			{isSolving && <SolvingBanner />}
			<div className="flex-1 min-h-0 overflow-y-auto">
				<ActiveState session={fullSession} workspaceId={workspaceId} newCommentCount={newCommentCount} />
				{sortedSessions.length > 1 && (
					<SessionHistory sessions={sortedSessions.slice(1)} workspaceId={workspaceId} />
				)}
			</div>
		</div>
	);
}
```

Note: `slice(1)` because the first session is already shown as `ActiveState`. History shows the rest.

For the failed state, add after the error card:

```tsx
if (fullSession && fullSession.status === "failed") {
	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			<div className="flex flex-1 flex-col items-center justify-center px-4">
				{/* existing error card */}
			</div>
			{sortedSessions.length > 1 && (
				<SessionHistory sessions={sortedSessions.slice(1)} workspaceId={workspaceId} />
			)}
		</div>
	);
}
```

- [ ] **Step 3: Adjust ActiveState layout for scrolling**

Since `ActiveState` is now inside a scrollable container, remove the `flex flex-1 min-h-0` from its outer div and let the parent handle scrolling:

```tsx
// ActiveState outer div: change from
<div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[var(--bg-base)]">
// to
<div className="flex flex-col bg-[var(--bg-base)]">
```

And change the group list div from `flex-1 overflow-y-auto` to just regular flow:

```tsx
// Group list div: change from
<div className="flex-1 overflow-y-auto px-4 py-2">
// to
<div className="px-4 py-2">
```

The parent now handles scrolling via `overflow-y-auto` on its wrapper.

- [ ] **Step 4: Run type-check and lint**

Run: `bun run type-check && bun run check`
Expected: no errors

- [ ] **Step 5: Verify visually**

Run `bun run dev` and check:
- Fixes tab with a submitted session shows the compact summary + session history below
- Fixes tab with no sessions shows empty state + history (if past sessions exist)
- Clicking a history row opens that session's SolveReviewTab
- New-comments nudge appears when the poller detects new comments

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/AIFixesTab.tsx
git commit -m "feat: add session history list to fixes tab"
```

---

### Task 7: Final integration test

**Files:**
- Test: `apps/desktop/tests/comment-solver.test.ts`

- [ ] **Step 1: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: all tests pass

- [ ] **Step 2: Run type-check and lint**

Run: `bun run type-check && bun run check`
Expected: no new errors

- [ ] **Step 3: Manual verification**

Run `bun run dev` and verify:
1. Comments tab shows "AI Addressed" badges on comments that were handled by a submitted session
2. Comments tab shows "New" badges on comments that arrived after the last solve
3. Filter bar appears with correct counts when sessions exist
4. Addressed comments are pre-skipped when clicking "Solve with AI"
5. Fixes tab shows submitted sessions (not blank)
6. New-comments nudge appears in Fixes tab when new comments detected
7. Session history shows past sessions with click-to-open
8. "Open Solve Review" button works from both submitted summary and history rows

- [ ] **Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "chore: integration fixes for comment solve awareness"
```
