# PR Reviewer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped sidebar review triage with a dedicated `ReviewWorkspaceTab`, adding cancel support, file-grouped comment triage, review chain visibility, and live progress.

**Architecture:** New `ReviewWorkspaceTab` component renders instead of `PROverviewTab` when an active AI review draft exists (dispatched via a new `"review-workspace"` tab kind in `PaneContent`). Backend adds `cancelled` status, PID tracking, batch mutations, chain history query, and parameterized verdict. Resolution deltas (NEW/RESOLVED/STILL_OPEN/REGRESSED) are computed on the fly, not stored.

**Tech Stack:** React 19, TypeScript, tRPC, Drizzle ORM, SQLite, Tailwind (via existing CSS vars), Bun test runner. Use `frontend-design` skill for all renderer components.

**Spec:** `docs/superpowers/specs/2026-04-12-pr-reviewer-redesign-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `apps/desktop/src/main/db/migrations/0030_*.sql` | Add `pid`, `last_activity_at` to `review_drafts` |
| `apps/desktop/src/renderer/components/ReviewWorkspaceTab.tsx` | Main review triage workspace tab |
| `apps/desktop/src/renderer/components/ReviewFileGroupCard.tsx` | File-grouped comment card with per-comment triage |
| `apps/desktop/src/renderer/components/ReviewVerdictConfirmation.tsx` | Inline verdict picker at bottom bar |
| `apps/desktop/tests/review-state-machine.test.ts` | Tests for updated state machine + cancel logic |
| `apps/desktop/tests/review-chain-history.test.ts` | Tests for chain history + resolution delta computation |

### Modified files
| File | Changes |
|------|---------|
| `apps/desktop/src/main/db/schema-ai-review.ts` | Add `pid`, `lastActivityAt` columns to `reviewDrafts` |
| `apps/desktop/src/main/ai-review/orchestrator.ts` | Add `cancelled` to state machine, add `cancelReview()`, PID tracking in `startReview()` |
| `apps/desktop/src/main/ai-review/review-publisher.ts` | Parameterize verdict in `publishReview()` |
| `apps/desktop/src/main/trpc/routers/ai-review.ts` | Add `cancelReview`, `batchUpdateDraftComments`, `getReviewChainHistory` mutations/queries; update `submitReview` to accept verdict |
| `apps/desktop/src/renderer/stores/tab-store.ts` | Add `"review-workspace"` tab kind + `addReviewWorkspaceTab()` helper |
| `apps/desktop/src/renderer/components/panes/PaneContent.tsx` | Wire up `"review-workspace"` tab kind |
| `apps/desktop/src/renderer/components/PRControlRail.tsx` | Simplify Comments tab when review draft is active |
| `apps/desktop/src/shared/pane-types.ts` | (Indirect — `TabItem` union is in `tab-store.ts`, already covered) |

---

### Task 1: Schema Migration — Add PID and Activity Tracking

**Files:**
- Modify: `apps/desktop/src/main/db/schema-ai-review.ts:24-41`
- Create: `apps/desktop/src/main/db/migrations/0030_*.sql`

- [ ] **Step 1: Add columns to schema definition**

In `apps/desktop/src/main/db/schema-ai-review.ts`, add two columns to the `reviewDrafts` table definition, after the `previousDraftId` column:

```typescript
pid: integer("pid"),
lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
```

- [ ] **Step 2: Generate the migration**

Run:
```bash
cd apps/desktop && bun run db:generate
```

Expected: A new migration file `0030_*.sql` is created in `src/main/db/migrations/` with two `ALTER TABLE` statements.

- [ ] **Step 3: Verify migration content**

Read the generated migration file. It should contain:
```sql
ALTER TABLE review_drafts ADD COLUMN pid integer;
ALTER TABLE review_drafts ADD COLUMN last_activity_at integer;
```

- [ ] **Step 4: Run type-check**

Run:
```bash
cd apps/desktop && bun run type-check
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/db/schema-ai-review.ts apps/desktop/src/main/db/migrations/
git commit -m "feat: add pid and last_activity_at columns to review_drafts schema"
```

---

### Task 2: State Machine — Add `cancelled` Status and Cancel Logic

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts:34-48`
- Test: `apps/desktop/tests/review-state-machine.test.ts`

- [ ] **Step 1: Write failing tests for the updated state machine**

Create `apps/desktop/tests/review-state-machine.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { validateTransition } from "../src/main/ai-review/orchestrator";

describe("review state machine with cancelled status", () => {
	test("allows cancelled from queued", () => {
		expect(() => validateTransition("queued", "cancelled")).not.toThrow();
	});

	test("allows cancelled from in_progress", () => {
		expect(() => validateTransition("in_progress", "cancelled")).not.toThrow();
	});

	test("allows dismissed from cancelled", () => {
		expect(() => validateTransition("cancelled", "dismissed")).not.toThrow();
	});

	test("rejects cancelled from ready", () => {
		expect(() => validateTransition("ready", "cancelled")).toThrow();
	});

	test("rejects cancelled from submitted", () => {
		expect(() => validateTransition("submitted", "cancelled")).toThrow();
	});

	test("rejects in_progress from cancelled", () => {
		expect(() => validateTransition("cancelled", "in_progress")).toThrow();
	});

	// Existing transitions still work
	test("preserves existing valid transitions", () => {
		expect(() => validateTransition("queued", "in_progress")).not.toThrow();
		expect(() => validateTransition("in_progress", "ready")).not.toThrow();
		expect(() => validateTransition("ready", "submitted")).not.toThrow();
		expect(() => validateTransition("failed", "queued")).not.toThrow();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd apps/desktop && bun test tests/review-state-machine.test.ts
```

Expected: Tests for `cancelled` transitions FAIL (cancelled not in VALID_TRANSITIONS).

- [ ] **Step 3: Update the state machine in orchestrator.ts**

In `apps/desktop/src/main/ai-review/orchestrator.ts`, replace the `VALID_TRANSITIONS` object:

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
	queued: ["in_progress", "failed", "dismissed", "cancelled"],
	in_progress: ["ready", "failed", "dismissed", "cancelled"],
	ready: ["submitted", "failed", "dismissed"],
	submitted: ["dismissed"],
	failed: ["queued", "dismissed"],
	cancelled: ["dismissed"],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/desktop && bun test tests/review-state-machine.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Add PID tracking to startReview**

In `apps/desktop/src/main/ai-review/orchestrator.ts`, in the `startReview` function, after writing the launch script and before the `return` statement, add PID file logic. Find the line that writes `launchScript` content and add a PID echo to the script:

Replace the script content construction (around line 367-374) so the launch script writes its PID:

```typescript
const pidFilePath = join(reviewDir, "reviewer.pid");
const scriptContent = [
	"#!/bin/bash",
	`echo $$ > '${pidFilePath}'`,
	`cd '${worktreePath}'`,
	...envLines,
	"",
	...hintLines,
	cliCommand,
].join("\n");
writeFileSync(launchScript, scriptContent, "utf-8");
chmodSync(launchScript, 0o755);

// Read PID file after script has had time to write it
setTimeout(() => {
	try {
		const pidContent = readFileSync(pidFilePath, "utf-8").trim();
		const pid = Number.parseInt(pidContent, 10);
		if (!Number.isNaN(pid)) {
			getDb()
				.update(schema.reviewDrafts)
				.set({ pid, updatedAt: new Date() })
				.where(eq(schema.reviewDrafts.id, draft.id))
				.run();
		}
	} catch {}
}, 2000);
```

Add `readFileSync` to the import from `node:fs` at the top of the file if not already there.

Do the same in `startFollowUpReview` — same PID file pattern in the launch script and the setTimeout reader.

- [ ] **Step 6: Add cancelReview function to orchestrator**

Add this exported function to `apps/desktop/src/main/ai-review/orchestrator.ts`:

```typescript
/** Cancel a running review — kill process, keep partial comments, transition to cancelled */
export function cancelReview(draftId: string): void {
	const db = getDb();
	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, draftId))
		.get();

	if (!draft) throw new Error(`Review draft ${draftId} not found`);

	validateTransition(draft.status, "cancelled");

	// Kill the agent process if PID is available
	if (draft.pid !== null) {
		try {
			process.kill(draft.pid, "SIGTERM");
		} catch (err: unknown) {
			if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ESRCH") {
				console.error(`[ai-review] Failed to kill process ${draft.pid}:`, err);
			}
		}
	}

	db.update(schema.reviewDrafts)
		.set({ status: "cancelled", updatedAt: new Date() })
		.where(eq(schema.reviewDrafts.id, draftId))
		.run();

	cleanupReview(draftId);
}
```

- [ ] **Step 7: Run type-check**

Run:
```bash
cd apps/desktop && bun run type-check
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts apps/desktop/tests/review-state-machine.test.ts
git commit -m "feat: add cancelled status and cancel logic to review orchestrator"
```

---

### Task 3: Backend — Batch Mutations, Chain History, Verdict Param

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/ai-review.ts`
- Modify: `apps/desktop/src/main/ai-review/review-publisher.ts:63,160-167`
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts` (add `getReviewChainHistory`)
- Test: `apps/desktop/tests/review-chain-history.test.ts`

- [ ] **Step 1: Write failing test for resolution delta computation**

Create `apps/desktop/tests/review-chain-history.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

/** Compute resolution deltas between two rounds of review comments */
export function computeResolutionDeltas(
	currentComments: Array<{ filePath: string; lineNumber: number | null }>,
	previousComments: Array<{ filePath: string; lineNumber: number | null; resolution?: string | null }>
): Map<number, "new" | "resolved" | "still_open" | "regressed"> {
	// Stub — will be implemented in step 3
	throw new Error("Not implemented");
}

describe("computeResolutionDeltas", () => {
	test("marks comments with no previous match as NEW", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const previous: typeof current = [];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("new");
	});

	test("marks previous comments not in current as RESOLVED", () => {
		const current: Array<{ filePath: string; lineNumber: number | null }> = [];
		const previous = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const deltas = computeResolutionDeltas(current, previous);
		// No current comments, so no deltas to set — resolved is about previous comments
		expect(deltas.size).toBe(0);
	});

	test("marks same file+line in both rounds as STILL_OPEN", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const previous = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("still_open");
	});

	test("marks comment at previously resolved location as REGRESSED", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const previous = [{ filePath: "src/a.ts", lineNumber: 10, resolution: "resolved-on-platform" }];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("regressed");
	});

	test("handles file-level comments (null lineNumber)", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: null }];
		const previous = [{ filePath: "src/a.ts", lineNumber: null }];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("still_open");
	});

	test("handles mixed — some new, some still_open", () => {
		const current = [
			{ filePath: "src/a.ts", lineNumber: 10 },
			{ filePath: "src/b.ts", lineNumber: 20 },
		];
		const previous = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("still_open");
		expect(deltas.get(1)).toBe("new");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/desktop && bun test tests/review-chain-history.test.ts
```

Expected: FAIL with "Not implemented".

- [ ] **Step 3: Implement computeResolutionDeltas**

Replace the stub function in the test file with the real implementation, then also create a shared helper. Add this to `apps/desktop/src/main/ai-review/orchestrator.ts`:

```typescript
/**
 * Compute resolution deltas for current-round comments against previous-round comments.
 * Returns a Map from current-comment index to its delta annotation.
 */
export function computeResolutionDeltas(
	currentComments: Array<{ filePath: string; lineNumber: number | null }>,
	previousComments: Array<{ filePath: string; lineNumber: number | null; resolution?: string | null }>
): Map<number, "new" | "resolved" | "still_open" | "regressed"> {
	const deltas = new Map<number, "new" | "resolved" | "still_open" | "regressed">();

	// Build a lookup of previous comments by file:line key
	const previousByKey = new Map<string, { resolution?: string | null }>();
	for (const prev of previousComments) {
		const key = `${prev.filePath}:${prev.lineNumber ?? "file"}`;
		previousByKey.set(key, { resolution: prev.resolution });
	}

	for (let i = 0; i < currentComments.length; i++) {
		const curr = currentComments[i]!;
		const key = `${curr.filePath}:${curr.lineNumber ?? "file"}`;
		const prev = previousByKey.get(key);

		if (!prev) {
			deltas.set(i, "new");
		} else if (prev.resolution === "resolved-on-platform" || prev.resolution === "resolved-by-code") {
			deltas.set(i, "regressed");
		} else {
			deltas.set(i, "still_open");
		}
	}

	return deltas;
}
```

Update the test file to import from orchestrator instead of defining inline:

```typescript
import { describe, expect, test } from "bun:test";
import { computeResolutionDeltas } from "../src/main/ai-review/orchestrator";
```

Remove the stub function from the test file.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/desktop && bun test tests/review-chain-history.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Add batchUpdateDraftComments mutation to tRPC router**

In `apps/desktop/src/main/trpc/routers/ai-review.ts`, add after the existing `updateDraftComment` mutation:

```typescript
batchUpdateDraftComments: publicProcedure
	.input(
		z.object({
			commentIds: z.array(z.string()),
			status: z.enum(["approved", "rejected"]),
		})
	)
	.mutation(({ input }) => {
		const db = getDb();
		for (const id of input.commentIds) {
			db.update(schema.draftComments)
				.set({ status: input.status })
				.where(eq(schema.draftComments.id, id))
				.run();
		}
		return { success: true, count: input.commentIds.length };
	}),
```

- [ ] **Step 6: Replace cancelReview in tRPC router**

In `apps/desktop/src/main/trpc/routers/ai-review.ts`, replace the existing `cancelReview` mutation (which currently transitions to `"failed"`) with one that uses the new `cancelReview` function:

```typescript
cancelReview: publicProcedure.input(z.object({ draftId: z.string() })).mutation(({ input }) => {
	cancelReview(input.draftId);
	return { success: true };
}),
```

Add `cancelReview` to the import from `../../ai-review/orchestrator`.

- [ ] **Step 7: Add getReviewChainHistory query to tRPC router**

In `apps/desktop/src/main/trpc/routers/ai-review.ts`, add:

```typescript
getReviewChainHistory: publicProcedure
	.input(z.object({ reviewChainId: z.string() }))
	.query(({ input }) => {
		const db = getDb();
		const drafts = db
			.select()
			.from(schema.reviewDrafts)
			.where(eq(schema.reviewDrafts.reviewChainId, input.reviewChainId))
			.all()
			.sort((a, b) => a.roundNumber - b.roundNumber);

		return drafts.map((draft) => {
			const comments = db
				.select()
				.from(schema.draftComments)
				.where(eq(schema.draftComments.reviewDraftId, draft.id))
				.all();

			return {
				id: draft.id,
				roundNumber: draft.roundNumber,
				status: draft.status,
				commentCount: comments.length,
				approvedCount: comments.filter((c) => c.status === "approved" || c.status === "submitted").length,
				rejectedCount: comments.filter((c) => c.status === "rejected").length,
				createdAt: draft.createdAt.toISOString(),
			};
		});
	}),
```

- [ ] **Step 8: Parameterize verdict in review-publisher**

In `apps/desktop/src/main/ai-review/review-publisher.ts`, change the `publishReview` function signature to accept an optional verdict:

```typescript
export async function publishReview(
	draftId: string,
	verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" = "COMMENT"
): Promise<PublishResult> {
```

Then replace the hardcoded `verdict: "COMMENT"` on line 166:

```typescript
await git.submitReview({
	owner,
	repo,
	prNumber,
	verdict,
	body: draft.summaryMarkdown,
});
```

- [ ] **Step 9: Update submitReview mutation in tRPC router to accept verdict**

In `apps/desktop/src/main/trpc/routers/ai-review.ts`, update the `submitReview` mutation:

```typescript
submitReview: publicProcedure
	.input(
		z.object({
			draftId: z.string(),
			verdict: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]).default("COMMENT"),
			body: z.string().optional(),
		})
	)
	.mutation(async ({ input }) => {
		// If user provided a body, update the draft's summary before publishing
		if (input.body?.trim()) {
			const db = getDb();
			db.update(schema.reviewDrafts)
				.set({ summaryMarkdown: input.body.trim(), updatedAt: new Date() })
				.where(eq(schema.reviewDrafts.id, input.draftId))
				.run();
		}
		const result = await publishReview(input.draftId, input.verdict);
		startPolling();
		return result;
	}),
```

- [ ] **Step 10: Run type-check**

Run:
```bash
cd apps/desktop && bun run type-check
```

Expected: No errors.

- [ ] **Step 11: Run all tests**

Run:
```bash
cd apps/desktop && bun test
```

Expected: All tests pass (existing + new).

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/ai-review.ts apps/desktop/src/main/ai-review/review-publisher.ts apps/desktop/src/main/ai-review/orchestrator.ts apps/desktop/tests/review-chain-history.test.ts
git commit -m "feat: add batch mutations, chain history, verdict param, and cancel support"
```

---

### Task 4: Tab Store — Add `review-workspace` Tab Kind

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts:9-80`

- [ ] **Step 1: Add the new tab kind to the TabItem union**

In `apps/desktop/src/renderer/stores/tab-store.ts`, add a new variant to the `TabItem` union type (after the `"solve-review"` variant):

```typescript
| {
		kind: "review-workspace";
		id: string;
		workspaceId: string;
		draftId: string;
		title: string;
  }
```

- [ ] **Step 2: Add helper method to create review workspace tabs**

In the same file, find the zustand store definition and add a method for creating review workspace tabs. Look at how `addSolveReviewTab` is implemented and follow the same pattern. The method should:

```typescript
addReviewWorkspaceTab: (workspaceId: string, draftId: string) => void;
```

Implementation: check if a tab with `kind === "review-workspace"` and matching `draftId` already exists in any pane. If not, create one with `id: \`review-workspace-\${draftId}\``, `title: "AI Review"` and add it to the active pane.

- [ ] **Step 3: Add review-workspace to layout deserialization filter**

Check how `"solve-review"` is handled during layout deserialization (the `deserializeLayout` or equivalent function). The `"review-workspace"` kind needs the same treatment — filter it out on app restart so stale review tabs don't persist, same as solve-review tabs are filtered.

- [ ] **Step 4: Run type-check**

Run:
```bash
cd apps/desktop && bun run type-check
```

Expected: May show errors in `PaneContent.tsx` since the new kind isn't handled there yet — that's fine, Task 6 will fix it.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts
git commit -m "feat: add review-workspace tab kind to tab store"
```

---

### Task 5: ReviewWorkspaceTab Component

**Files:**
- Create: `apps/desktop/src/renderer/components/ReviewWorkspaceTab.tsx`
- Create: `apps/desktop/src/renderer/components/ReviewFileGroupCard.tsx`
- Create: `apps/desktop/src/renderer/components/ReviewVerdictConfirmation.tsx`

**IMPORTANT:** Use the `frontend-design` skill when implementing these components.

- [ ] **Step 1: Create ReviewFileGroupCard component**

Create `apps/desktop/src/renderer/components/ReviewFileGroupCard.tsx`.

This component renders a single file group — a collapsible card showing all AI draft comments for one file.

**Props:**
```typescript
interface ReviewFileGroupCardProps {
	filePath: string;
	comments: Array<{
		id: string;
		lineNumber: number | null;
		body: string;
		status: string;
		userEdit: string | null;
		roundDelta: "new" | "resolved" | "still_open" | "regressed" | null;
	}>;
	defaultExpanded: boolean;
	onApprove: (commentId: string) => void;
	onReject: (commentId: string) => void;
	onEdit: (commentId: string, newBody: string) => void;
	onApproveAll: (commentIds: string[]) => void;
	onOpenInDiff: (filePath: string) => void;
}
```

**Behavior:**
- Header: chevron toggle, file path (monospace, clickable → calls `onOpenInDiff`), comment count, approval summary badges, "Approve All" button (only shown when pending comments exist)
- Body: one row per comment with line number, markdown-rendered body (use existing `MarkdownRenderer`), resolution delta badge (colored: green=RESOLVED, yellow=NEW, orange=STILL_OPEN, red=REGRESSED), action buttons (Approve/Edit/Reject/View in Diff)
- Edit mode: clicking Edit shows a textarea with the comment body, Save/Cancel buttons
- Approved comments show dimmed with green checkmark. Rejected comments are filtered out.
- File groups where all comments are approved are collapsed by default and dimmed.

Follow the visual patterns from `SolveCommitGroupCard.tsx` for expand/collapse and card structure. Match existing CSS var usage.

- [ ] **Step 2: Create ReviewVerdictConfirmation component**

Create `apps/desktop/src/renderer/components/ReviewVerdictConfirmation.tsx`.

**Props:**
```typescript
interface ReviewVerdictConfirmationProps {
	onSubmit: (verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES", body: string) => void;
	onCancel: () => void;
	isSubmitting: boolean;
}
```

**Behavior:**
- Renders inline (no overlay). Expands from the bottom bar area.
- Three verdict buttons with equal visual weight: Comment (neutral), Approve (green-tinted), Request Changes (red-tinted)
- Optional body textarea
- Submit and Cancel buttons
- Match the style conventions of the existing codebase (CSS vars, font sizes, border radius patterns).

- [ ] **Step 3: Create ReviewWorkspaceTab component**

Create `apps/desktop/src/renderer/components/ReviewWorkspaceTab.tsx`.

**Props:**
```typescript
interface Props {
	workspaceId: string;
	draftId: string;
}
```

**Data queries:**
```typescript
const { data: draft, isLoading } = trpc.aiReview.getReviewDraft.useQuery(
	{ draftId },
	{
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			return status === "queued" || status === "in_progress" ? 3000 : false;
		},
	}
);

const { data: chainHistory } = trpc.aiReview.getReviewChainHistory.useQuery(
	{ reviewChainId: draft?.reviewChainId ?? "" },
	{ enabled: !!draft?.reviewChainId }
);
```

**Mutations:**
```typescript
const cancelMutation = trpc.aiReview.cancelReview.useMutation({ onSuccess: () => utils.aiReview.invalidate() });
const updateComment = trpc.aiReview.updateDraftComment.useMutation({ onSuccess: () => utils.aiReview.invalidate() });
const batchUpdate = trpc.aiReview.batchUpdateDraftComments.useMutation({ onSuccess: () => utils.aiReview.invalidate() });
const submitReview = trpc.aiReview.submitReview.useMutation({ onSuccess: () => utils.aiReview.invalidate() });
const dismissMutation = trpc.aiReview.dismissReview.useMutation({ onSuccess: () => utils.aiReview.invalidate() });
```

**Sections (top to bottom):**

1. **PR Header** — PR identifier, branch pill, title, Cancel button (visible when queued/in_progress). Follow the pattern from `SolveReviewTab`'s `PRHeader` sub-component.

2. **Status Strip** — Approval count pills (approved/rejected/pending), progress bar, round indicator, AI verdict suggestion. The verdict suggestion is derived: if >0 rejected comments → "Suggesting: Request Changes". If all approved → "Suggesting: Approve". Otherwise → "Suggesting: Comment". Follow `SolveReviewTab`'s `ProgressStrip` pattern.

3. **AI Summary** — Collapsible section. Shows `draft.summaryMarkdown` rendered via `MarkdownRenderer`. Only visible when summary exists.

4. **File Groups** — Group `draft.comments` by `filePath`. Sort groups alphabetically. Render each as a `ReviewFileGroupCard`. First group with pending comments gets `defaultExpanded={true}`. Compute resolution deltas on the fly using `computeResolutionDeltas` (import from a shared utility or compute client-side with the same logic — previous draft comments are available via `chainHistory`).

5. **Review History** — Collapsible section. Show `chainHistory` as a compact timeline. Each entry: "Round N · date · M comments · status". Current round highlighted.

6. **Bottom Bar** — Status message ("N comments pending"), Dismiss button, Submit Review button (disabled when pending comments > 0). Clicking Submit toggles `ReviewVerdictConfirmation` inline.

**Auto-focus on completion:**
```typescript
const prevStatusRef = useRef<string | undefined>(undefined);
useEffect(() => {
	if (prevStatusRef.current === "in_progress" && draft?.status === "ready") {
		useTabStore.getState().setActiveTab(`review-workspace-${draftId}`);
	}
	prevStatusRef.current = draft?.status;
}, [draft?.status, draftId]);
```

- [ ] **Step 4: Run type-check**

Run:
```bash
cd apps/desktop && bun run type-check
```

Expected: No errors (or only PaneContent-related errors that Task 6 fixes).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/ReviewWorkspaceTab.tsx apps/desktop/src/renderer/components/ReviewFileGroupCard.tsx apps/desktop/src/renderer/components/ReviewVerdictConfirmation.tsx
git commit -m "feat: add ReviewWorkspaceTab, ReviewFileGroupCard, and ReviewVerdictConfirmation components"
```

---

### Task 6: PaneContent Wiring + Auto-Open Tab

**Files:**
- Modify: `apps/desktop/src/renderer/components/panes/PaneContent.tsx:86-93`
- Modify: `apps/desktop/src/main/trpc/routers/ai-review.ts` (triggerReview mutation — auto-open tab)

- [ ] **Step 1: Wire up review-workspace in PaneContent**

In `apps/desktop/src/renderer/components/panes/PaneContent.tsx`, add the import:

```typescript
import { ReviewWorkspaceTab } from "../ReviewWorkspaceTab";
```

Add a new rendering block after the `pr-overview` block (around line 93):

```typescript
{activeTab?.kind === "review-workspace" && (
	<div className="absolute inset-0">
		<ReviewWorkspaceTab
			workspaceId={activeTab.workspaceId}
			draftId={activeTab.draftId}
		/>
	</div>
)}
```

- [ ] **Step 2: Auto-open ReviewWorkspaceTab when review is triggered**

The triggerReview mutation in the tRPC router returns `ReviewLaunchInfo` which the renderer uses to create a terminal tab. The renderer code that calls `triggerReview` also needs to create a `review-workspace` tab. This happens in the renderer — find where `triggerReview` is called (likely in a PR list component or the PRControlRail) and add:

```typescript
// After triggerReview succeeds:
useTabStore.getState().addReviewWorkspaceTab(workspaceId, result.draftId);
```

Search for existing calls to `triggerReview` in the renderer to find the exact location.

- [ ] **Step 3: Run type-check**

Run:
```bash
cd apps/desktop && bun run type-check
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/panes/PaneContent.tsx
git commit -m "feat: wire ReviewWorkspaceTab into PaneContent and auto-open on review trigger"
```

---

### Task 7: PRControlRail Simplification

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRControlRail.tsx`

- [ ] **Step 1: Add draft-aware rendering to Comments tab**

In `apps/desktop/src/renderer/components/PRControlRail.tsx`, the Comments tab currently renders full comment thread cards with triage actions. When a non-dismissed review draft exists for the current workspace, simplify the Comments tab to a compact jump-list.

Query the workspace's `reviewDraftId`:
```typescript
const { data: workspace } = trpc.workspaces.getById.useQuery(
	{ id: workspaceId },
	{ staleTime: 60_000 }
);
const hasActiveDraft = workspace?.reviewDraftId != null;
```

When `hasActiveDraft` is true, replace the full comment thread rendering with a compact file list:
- Show each file path that has AI draft comments
- Show comment count per file
- Click opens the diff tab for that file (existing `openPRReviewFile` behavior)
- Show a small "Open in Review Tab" link that focuses the review-workspace tab

When `hasActiveDraft` is false, render the existing comment thread UI unchanged.

- [ ] **Step 2: Run type-check**

Run:
```bash
cd apps/desktop && bun run type-check
```

Expected: No errors.

- [ ] **Step 3: Test manually**

Run:
```bash
bun run dev
```

- Open a PR workspace with an active review draft. Verify:
  - ReviewWorkspaceTab renders instead of showing triage in the sidebar
  - PRControlRail Comments tab shows the compact jump-list
  - Clicking a file in the jump-list opens the diff tab
  - Dismissing the review switches back to PROverviewTab behavior

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/PRControlRail.tsx
git commit -m "feat: simplify PRControlRail comments tab when review draft is active"
```

---

### Task 8: Integration Testing and Polish

**Files:**
- Modify: `apps/desktop/tests/workspace-review.test.ts`

- [ ] **Step 1: Update existing workspace-review tests for cancelled status**

In `apps/desktop/tests/workspace-review.test.ts`, add tests for the new cancelled state:

```typescript
test("allows cancelled from queued and in_progress", () => {
	expect(() => validateTransition("queued", "cancelled")).not.toThrow();
	expect(() => validateTransition("in_progress", "cancelled")).not.toThrow();
});

test("allows dismissed from cancelled", () => {
	expect(() => validateTransition("cancelled", "dismissed")).not.toThrow();
});
```

- [ ] **Step 2: Run all tests**

Run:
```bash
cd apps/desktop && bun test
```

Expected: All tests pass.

- [ ] **Step 3: Run lint and format**

Run:
```bash
bun run check
```

Fix any issues reported by Biome.

- [ ] **Step 4: Run type-check**

Run:
```bash
bun run type-check
```

Expected: No errors.

- [ ] **Step 5: Manual E2E verification**

Run:
```bash
bun run dev
```

Test the full lifecycle:
1. Open a PR where you're a reviewer
2. Trigger AI review → verify terminal tab opens + ReviewWorkspaceTab auto-opens
3. Watch comments appear live as agent runs
4. Cancel the review mid-run → verify partial comments preserved, status shows "Cancelled"
5. Re-trigger review → verify fresh review starts
6. When review completes: approve some comments, reject one, edit one
7. Use "Approve All" on a file group
8. Click "View in Diff" → verify PRReviewFileTab opens
9. Click "Submit Review" → verify verdict confirmation expands inline
10. Choose verdict and submit → verify comments posted to GitHub
11. Dismiss review → verify cleanup

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "fix: integration testing polish"
```

---

### Task 9: PR List Badges (Awareness)

**Files:**
- Modify: The component that renders PR list items in the sidebar (find via searching for tracked PR rendering)

- [ ] **Step 1: Find the PR list component**

Search for where tracked PRs are rendered in the sidebar. Look for components that use `trpc.prPoller` or render `CachedPR` items. The component likely renders PR title, state, and branch info.

- [ ] **Step 2: Add review status badge**

Query the review drafts for each PR's identifier and show a status badge:

```typescript
const { data: drafts } = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
	staleTime: 30_000,
});

// For each PR, find the most recent non-dismissed draft
const draftForPR = drafts?.find((d) => d.prIdentifier === pr.identifier && d.status !== "dismissed");
```

Render a badge based on `draftForPR?.status`:
- `queued` / `in_progress` → subtle animated dot + "Reviewing..."
- `ready` → "N comments ready" (query comment count)
- `submitted` → "Submitted" + round number if > 1
- `cancelled` → "Cancelled"
- `failed` → "Failed"
- No draft → no badge

- [ ] **Step 3: Run type-check and lint**

Run:
```bash
bun run type-check && bun run check
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add review status badges to PR list"
```
