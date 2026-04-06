# PR Review UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken summary/retrigger buttons, add an always-visible unified review button, add commit-based auto re-review, and relax auto-trigger to re-review previously reviewed PRs.

**Architecture:** The unified review button lives in `PRControlRail`'s persistent header (visible across all tabs). Backend changes add a new settings column and extend the PR poller to track head commit SHAs. The auto-trigger logic is relaxed to only skip active (`queued`/`in_progress`) drafts.

**Tech Stack:** React 19, tRPC, Drizzle ORM/SQLite, Zustand, Bun test runner

---

### Task 1: Add `autoReReviewOnCommit` Column to Settings Schema

**Files:**
- Modify: `apps/desktop/src/main/db/schema-ai-review.ts:8`
- Create: `apps/desktop/src/main/db/migrations/0023_auto_rereview_setting.sql`

- [ ] **Step 1: Add column to schema**

In `apps/desktop/src/main/db/schema-ai-review.ts`, add after line 8 (`autoReviewEnabled`):

```typescript
autoReReviewOnCommit: integer("auto_re_review_on_commit").notNull().default(0),
```

- [ ] **Step 2: Generate migration**

Run: `cd apps/desktop && bun run db:generate`

This creates a new migration file in `migrations/`. Verify it contains an `ALTER TABLE ai_review_settings ADD COLUMN auto_re_review_on_commit integer NOT NULL DEFAULT 0` statement.

- [ ] **Step 3: Add setting to tRPC `updateSettings` input**

In `apps/desktop/src/main/trpc/routers/ai-review.ts`, add to the `updateSettings` input schema (around line 37):

```typescript
autoReReviewOnCommit: z.boolean().optional(),
```

And in the mutation handler (after line 47):

```typescript
if (input.autoReReviewOnCommit !== undefined)
	updates.autoReReviewOnCommit = input.autoReReviewOnCommit ? 1 : 0;
```

- [ ] **Step 4: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/db/schema-ai-review.ts apps/desktop/src/main/db/migrations/ apps/desktop/src/main/trpc/routers/ai-review.ts
git commit -m "feat: add autoReReviewOnCommit setting column"
```

---

### Task 2: Add `headCommitSha` to `CachedPR` and PR Poller

**Files:**
- Modify: `apps/desktop/src/shared/review-types.ts:1-21`
- Modify: `apps/desktop/src/main/ai-review/pr-poller.ts:58-81`
- Modify: `apps/desktop/src/main/providers/types.ts:5-16`

- [ ] **Step 1: Write failing test for headCommitSha in CachedPR**

In `apps/desktop/tests/ai-review-auto-trigger.test.ts`, update the `basePr` fixture (around line 9) to include:

```typescript
const basePr: CachedPR = {
	provider: "github",
	identifier: "acme/widgets#42",
	number: 42,
	title: "Add widgets",
	state: "open",
	sourceBranch: "feature/widgets",
	targetBranch: "main",
	author: { login: "alice", avatarUrl: "" },
	reviewers: [],
	ciStatus: null,
	commentCount: 0,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	updatedAt: new Date().toISOString(),
	repoOwner: "acme",
	repoName: "widgets",
	projectId: "project-1",
	role: "reviewer",
	headCommitSha: "abc123",
};
```

Add a test:

```typescript
test("CachedPR includes headCommitSha", () => {
	expect(basePr.headCommitSha).toBe("abc123");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/ai-review-auto-trigger.test.ts`
Expected: FAIL — `headCommitSha` does not exist on type `CachedPR`

- [ ] **Step 3: Add `headCommitSha` to `CachedPR`**

In `apps/desktop/src/shared/review-types.ts`, add after line 20 (`role`):

```typescript
headCommitSha: string;
```

- [ ] **Step 4: Add `headCommitSha` to `NormalizedPR`**

In `apps/desktop/src/main/providers/types.ts`, add after line 14 (`repoName`) inside the `NormalizedPR` interface:

```typescript
headCommitSha: string;
```

- [ ] **Step 5: Update GitHub adapter's `getMyPRs` mapping**

In `apps/desktop/src/main/providers/github-adapter.ts`, find the `getMyPRs` method's `return prs.map(...)` call. The underlying `getMyPRs()` from `github.ts` returns PRs with `headRefOid` or similar. Check the shape — it likely lacks headSha in the list endpoint. Set a placeholder:

```typescript
headCommitSha: "",
```

This is acceptable because the poller will separately call `getPRState` to get the real SHA (see step 7).

- [ ] **Step 6: Update Bitbucket adapter's `getMyPRs` mapping**

In `apps/desktop/src/main/providers/bitbucket-adapter.ts`, find the `getMyPRs` return mapping. Add:

```typescript
headCommitSha: "",
```

Same rationale — the poller fills this in.

- [ ] **Step 7: Update `toCachedPR` in pr-poller to include `headCommitSha`**

In `apps/desktop/src/main/ai-review/pr-poller.ts`, update the `toCachedPR` function (line 58-81) to accept and pass through headCommitSha:

```typescript
function toCachedPR(pr: NormalizedPR, provider: string): CachedPR {
	const identifier = `${pr.repoOwner}/${pr.repoName}#${pr.id}`;
	return {
		provider: provider as CachedPR["provider"],
		identifier,
		number: pr.id,
		title: pr.title,
		state: pr.state === "declined" ? "declined" : pr.state,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		author: { login: pr.author, avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: 0,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: new Date().toISOString(),
		repoOwner: pr.repoOwner,
		repoName: pr.repoName,
		projectId: getProjectIdByRepo(pr.repoOwner, pr.repoName),
		role: pr.role,
		headCommitSha: pr.headCommitSha,
	};
}
```

- [ ] **Step 8: Run tests**

Run: `cd apps/desktop && bun test tests/ai-review-auto-trigger.test.ts`
Expected: PASS

- [ ] **Step 9: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/shared/review-types.ts apps/desktop/src/main/providers/types.ts apps/desktop/src/main/providers/github-adapter.ts apps/desktop/src/main/providers/bitbucket-adapter.ts apps/desktop/src/main/ai-review/pr-poller.ts apps/desktop/tests/ai-review-auto-trigger.test.ts
git commit -m "feat: add headCommitSha to CachedPR and NormalizedPR"
```

---

### Task 3: Detect Commit Changes in PR Poller

**Files:**
- Modify: `apps/desktop/src/main/ai-review/pr-poller.ts:13-14, 106-149`

- [ ] **Step 1: Add `onPRCommitChanged` event handler registration**

In `apps/desktop/src/main/ai-review/pr-poller.ts`, add after line 14 (`let onPRClosedHandler`):

```typescript
let onPRCommitChangedHandler: ((pr: CachedPR, previousSha: string) => void) | null = null;
```

Add the public registration function after `onPRClosedDetected` (after line 24):

```typescript
export function onPRCommitChanged(handler: (pr: CachedPR, previousSha: string) => void): void {
	onPRCommitChangedHandler = handler;
}
```

- [ ] **Step 2: Emit commit change events in `doPoll`**

In the `doPoll` function, after the "Detect closed/merged PRs" block (around line 137), add:

```typescript
// Detect head commit changes on open PRs
for (const pr of fetched) {
	if (pr.state !== "open") continue;
	const cached = prCache.get(pr.identifier);
	if (
		cached &&
		cached.headCommitSha &&
		pr.headCommitSha &&
		cached.headCommitSha !== pr.headCommitSha
	) {
		console.log(
			`[pr-poller] New commits on ${pr.identifier}: ${cached.headCommitSha} → ${pr.headCommitSha}`
		);
		onPRCommitChangedHandler?.(pr, cached.headCommitSha);
	}
}
```

- [ ] **Step 3: Enrich PRs with headCommitSha via `getPRState`**

The `getMyPRs` endpoint doesn't return headSha. Add a post-fetch enrichment step in `fetchAllPRs`. After the existing loop that builds `results` (around line 103), add:

```typescript
// Enrich with head commit SHA (needed for commit change detection)
for (const cachedPr of results) {
	if (cachedPr.state !== "open") continue;
	try {
		const provider = getConnectedGitProviders().find((p) => p.name === cachedPr.provider);
		if (!provider) continue;
		const prState = await provider.getPRState(
			cachedPr.repoOwner,
			cachedPr.repoName,
			cachedPr.number
		);
		cachedPr.headCommitSha = prState.headSha;
	} catch (err) {
		console.error(`[pr-poller] Failed to get head SHA for ${cachedPr.identifier}:`, err);
	}
}
```

Note: This adds N API calls per poll cycle (one per open PR). This is acceptable because the poll interval is 60 seconds and the number of PRs is typically small. If performance becomes an issue, this can be batched or made conditional later.

- [ ] **Step 4: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai-review/pr-poller.ts
git commit -m "feat: detect head commit changes in PR poller"
```

---

### Task 4: Relax Auto-Trigger to Allow Re-review of Previously Reviewed PRs

**Files:**
- Modify: `apps/desktop/src/main/ai-review/auto-trigger.ts:10-26`
- Modify: `apps/desktop/tests/ai-review-auto-trigger.test.ts`

- [ ] **Step 1: Write failing tests for relaxed logic**

In `apps/desktop/tests/ai-review-auto-trigger.test.ts`, add these tests after the existing ones (before the closing `});`):

```typescript
test("triggers when existing draft is submitted", () => {
	const shouldTrigger = shouldAutoTriggerReview({
		pr: basePr,
		autoReviewEnabled: true,
		existingDrafts: new Map([[basePr.identifier, "submitted"]]),
		alreadyTriggered: new Set(),
	});
	expect(shouldTrigger).toBe(true);
});

test("triggers when existing draft is failed", () => {
	const shouldTrigger = shouldAutoTriggerReview({
		pr: basePr,
		autoReviewEnabled: true,
		existingDrafts: new Map([[basePr.identifier, "failed"]]),
		alreadyTriggered: new Set(),
	});
	expect(shouldTrigger).toBe(true);
});

test("triggers when existing draft is dismissed", () => {
	const shouldTrigger = shouldAutoTriggerReview({
		pr: basePr,
		autoReviewEnabled: true,
		existingDrafts: new Map([[basePr.identifier, "dismissed"]]),
		alreadyTriggered: new Set(),
	});
	expect(shouldTrigger).toBe(true);
});

test("does not trigger when draft is queued", () => {
	const shouldTrigger = shouldAutoTriggerReview({
		pr: basePr,
		autoReviewEnabled: true,
		existingDrafts: new Map([[basePr.identifier, "queued"]]),
		alreadyTriggered: new Set(),
	});
	expect(shouldTrigger).toBe(false);
});

test("does not trigger when draft is in_progress", () => {
	const shouldTrigger = shouldAutoTriggerReview({
		pr: basePr,
		autoReviewEnabled: true,
		existingDrafts: new Map([[basePr.identifier, "in_progress"]]),
		alreadyTriggered: new Set(),
	});
	expect(shouldTrigger).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && bun test tests/ai-review-auto-trigger.test.ts`
Expected: FAIL — `existingDrafts` is `Set<string>` but tests pass `Map<string, string>`

- [ ] **Step 3: Update `shouldAutoTriggerReview` signature and logic**

In `apps/desktop/src/main/ai-review/auto-trigger.ts`, change the function signature and body (lines 10-26):

```typescript
export function shouldAutoTriggerReview(args: {
	pr: CachedPR;
	autoReviewEnabled: boolean;
	existingDrafts: Map<string, string>;
	alreadyTriggered: Set<string>;
}): boolean {
	const { pr, autoReviewEnabled, existingDrafts, alreadyTriggered } = args;

	if (!autoReviewEnabled) return false;
	if (pr.state !== "open") return false;
	if (pr.role !== "reviewer") return false;
	if (!pr.projectId) return false;
	if (alreadyTriggered.has(pr.identifier)) return false;

	// Only block if there's an active draft (queued or in_progress)
	const draftStatus = existingDrafts.get(pr.identifier);
	if (draftStatus === "queued" || draftStatus === "in_progress") return false;

	return true;
}
```

- [ ] **Step 4: Update `maybeAutoTriggerReview` to pass Map instead of Set**

In the same file, update the `maybeAutoTriggerReview` function (around line 96):

Change:
```typescript
const existingDrafts = new Set(deps.getReviewDrafts().map((draft) => draft.prIdentifier));
```

To:
```typescript
const draftsByIdentifier = new Map<string, string>();
for (const draft of deps.getReviewDrafts()) {
	const existing = draftsByIdentifier.get(draft.prIdentifier);
	// Keep the most "active" status for each identifier
	if (!existing || isMoreActive(draft.status, existing)) {
		draftsByIdentifier.set(draft.prIdentifier, draft.status);
	}
}
```

Add this helper above `maybeAutoTriggerReview`:

```typescript
function isMoreActive(a: string, b: string): boolean {
	const priority: Record<string, number> = {
		in_progress: 0,
		queued: 1,
		ready: 2,
		failed: 3,
		submitted: 4,
		dismissed: 5,
	};
	return (priority[a] ?? 6) < (priority[b] ?? 6);
}
```

And update the `shouldAutoTriggerReview` call:

```typescript
if (
	!shouldAutoTriggerReview({
		pr,
		autoReviewEnabled,
		existingDrafts: draftsByIdentifier,
		alreadyTriggered: deps.alreadyTriggered,
	})
) {
	return null;
}
```

- [ ] **Step 5: Update existing tests that pass `Set` to use `Map`**

In the test file, update all existing calls to `shouldAutoTriggerReview` that use `existingDrafts: new Set()` to `existingDrafts: new Map()`, and `existingDrafts: new Set([basePr.identifier])` to `existingDrafts: new Map([[basePr.identifier, "queued"]])` (the "does not trigger when a draft already exists" test).

Also update the `maybeAutoTriggerReview` test deps:
- `getReviewDrafts: () => []` stays as-is (empty array works for both Set and Map construction).

- [ ] **Step 6: Run tests**

Run: `cd apps/desktop && bun test tests/ai-review-auto-trigger.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/ai-review/auto-trigger.ts apps/desktop/tests/ai-review-auto-trigger.test.ts
git commit -m "feat: relax auto-trigger to allow re-review of previously reviewed PRs"
```

---

### Task 5: Wire Commit Change Handler and Auto Re-review

**Files:**
- Modify: `apps/desktop/src/main/ai-review/auto-trigger.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Add `maybeAutoReReview` function**

In `apps/desktop/src/main/ai-review/auto-trigger.ts`, add at the bottom of the file:

```typescript
export async function maybeAutoReReview(args: {
	pr: CachedPR;
	deps?: Partial<AutoTriggerDeps>;
}): Promise<ReviewLaunchInfo | null> {
	const deps = { ...defaultDeps, ...args.deps };
	const settings = deps.getSettings();

	if (!settings.autoReReviewOnCommit) return null;
	if (args.pr.state !== "open") return null;
	if (args.pr.role !== "reviewer") return null;

	const projectId = deps.getProjectIdByRepo(args.pr.repoOwner, args.pr.repoName);
	if (!projectId) return null;

	// Check that there's no active review running
	const drafts = deps.getReviewDrafts();
	const activeDraft = drafts.find(
		(d) =>
			d.prIdentifier === args.pr.identifier &&
			(d.status === "queued" || d.status === "in_progress")
	);
	if (activeDraft) return null;

	const { workspaceId, worktreePath } = await deps.ensureReviewWorkspace({
		projectId,
		prProvider: args.pr.provider,
		prIdentifier: args.pr.identifier,
		prTitle: args.pr.title,
		sourceBranch: args.pr.sourceBranch,
		targetBranch: args.pr.targetBranch,
	});

	return deps.queueReview({
		prProvider: args.pr.provider,
		prIdentifier: args.pr.identifier,
		prTitle: args.pr.title,
		prAuthor: args.pr.author.login,
		sourceBranch: args.pr.sourceBranch,
		targetBranch: args.pr.targetBranch,
		workspaceId,
		worktreePath,
	});
}
```

Note: The `AutoTriggerDeps` type needs `autoReReviewOnCommit` in the settings return type. Update the type (around line 29):

```typescript
type AutoTriggerDeps = {
	getSettings: () => { autoReviewEnabled: number | boolean; autoReReviewOnCommit?: number | boolean };
	// ... rest unchanged
};
```

- [ ] **Step 2: Wire `onPRCommitChanged` in `index.ts`**

In `apps/desktop/src/main/index.ts`, find where `onNewPRDetected` is registered. Add nearby:

```typescript
import { onPRCommitChanged } from "./ai-review/pr-poller";
import { maybeAutoReReview } from "./ai-review/auto-trigger";

onPRCommitChanged((pr, _previousSha) => {
	maybeAutoReReview({ pr }).catch((err) =>
		console.error("[auto-review] Re-review on commit change failed:", err)
	);
});
```

- [ ] **Step 3: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/auto-trigger.ts apps/desktop/src/main/index.ts
git commit -m "feat: wire commit-based auto re-review"
```

---

### Task 6: Add Auto Re-review Toggle to Settings UI

**Files:**
- Modify: `apps/desktop/src/renderer/components/settings/AIReviewSettings.tsx:124-131`

- [ ] **Step 1: Add the toggle**

In `apps/desktop/src/renderer/components/settings/AIReviewSettings.tsx`, add after the existing "Automatic Review" `ToggleRow` (after line 131):

```tsx
<ToggleRow
	label="Auto Re-review on New Commits"
	description="Automatically re-review when new commits are pushed to a PR"
	checked={aiSettings?.autoReReviewOnCommit ?? false}
	onChange={() =>
		updateAiSettings.mutate({
			autoReReviewOnCommit: !aiSettings?.autoReReviewOnCommit,
		})
	}
/>
```

- [ ] **Step 2: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/settings/AIReviewSettings.tsx
git commit -m "feat: add auto re-review on commit toggle to settings"
```

---

### Task 7: Unified Review Button in PRControlRail

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRControlRail.tsx:28-95, 609-690, 881-918`

This is the core UI change. The retrigger button moves from inside `CommentsTab` to the persistent `PRTabHeader`, and becomes a unified button that adapts its label and behavior based on draft state.

- [ ] **Step 1: Add `triggerReview` and `cancelReview` mutations to `PRControlRail`**

In the `PRControlRail` component (around line 754), after the `aiDraftQuery` block (around line 808), add:

```tsx
const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
const triggerReview = trpc.aiReview.triggerReview.useMutation({
	onSuccess: (launchInfo) => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();

		if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;

		const tabStore = useTabStore.getState();
		const tabId = tabStore.addTerminalTab(
			launchInfo.reviewWorkspaceId,
			launchInfo.worktreePath,
			"AI Review"
		);
		attachTerminal.mutate({
			workspaceId: launchInfo.reviewWorkspaceId,
			terminalId: tabId,
		});

		setTimeout(() => {
			window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
		}, 500);
	},
});

const cancelReview = trpc.aiReview.cancelReview.useMutation({
	onSuccess: () => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
	},
});

const triggerFollowUp = trpc.aiReview.triggerFollowUp.useMutation({
	onSuccess: (launchInfo) => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();

		if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;

		const tabStore = useTabStore.getState();
		const tabId = tabStore.addTerminalTab(
			launchInfo.reviewWorkspaceId,
			launchInfo.worktreePath,
			"AI Re-review"
		);
		attachTerminal.mutate({
			workspaceId: launchInfo.reviewWorkspaceId,
			terminalId: tabId,
		});

		setTimeout(() => {
			window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\r`);
		}, 1000);
	},
});
```

- [ ] **Step 2: Compute unified button state**

After the mutations, add:

```tsx
// Unified review button state
const draftStatus = matchingDraft?.status ?? null;
const isReviewActive = draftStatus === "queued" || draftStatus === "in_progress";
const hasExistingReview = !!matchingDraft;

const reviewButtonLabel = !hasExistingReview
	? "Start Review"
	: isReviewActive
		? "Restart Review"
		: "Re-review";

const reviewButtonPending =
	triggerReview.isPending || cancelReview.isPending || triggerFollowUp.isPending;

// Find project for triggerReview
const projectsQuery = trpc.projects.getByRepo.useQuery(
	{ owner: prCtx.owner, repo: prCtx.repo },
	{ staleTime: 60_000 }
);

const handleUnifiedReview = async () => {
	if (isReviewActive && matchingDraft) {
		// Cancel then restart
		await cancelReview.mutateAsync({ draftId: matchingDraft.id });
	}

	if (hasExistingReview && draftReviewChainId && !isReviewActive) {
		// Follow-up review
		triggerFollowUp.mutate({ reviewChainId: draftReviewChainId });
	} else {
		// First review or restart
		const project = projectsQuery.data?.[0];
		if (!project) return;
		triggerReview.mutate({
			provider: prCtx.provider,
			identifier: prIdentifier,
			title: prCtx.title,
			author: "",
			sourceBranch: prCtx.sourceBranch,
			targetBranch: prCtx.targetBranch,
			repoPath: project.repoPath,
			projectId: project.id,
		});
	}
};
```

- [ ] **Step 3: Add the unified button to `PRTabHeader`**

Modify the `PRTabHeader` component (around line 29) to accept and render the review button. Add props:

```tsx
function PRTabHeader({
	tab,
	onSetTab,
	commentCount,
	onClose,
	reviewButton,
}: {
	tab: PRTab;
	onSetTab: (t: PRTab) => void;
	commentCount: number;
	onClose?: () => void;
	reviewButton?: React.ReactNode;
}) {
```

In the JSX, add the review button between `<div className="flex-1" />` and the close button:

```tsx
<div className="flex-1" />
{reviewButton}
{onClose && (
```

- [ ] **Step 4: Render the unified button in the `PRTabHeader` call**

In the `PRControlRail` return JSX (around line 883), update the `PRTabHeader` usage:

```tsx
<PRTabHeader
	tab={tab}
	onSetTab={setTab}
	commentCount={totalComments}
	onClose={closeDiffPanel}
	reviewButton={
		<Tooltip label={reviewButtonLabel}>
			<button
				type="button"
				onClick={handleUnifiedReview}
				disabled={reviewButtonPending}
				className={[
					"flex h-6 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 transition-colors",
					reviewButtonPending
						? "text-[var(--text-quaternary)]"
						: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]",
				].join(" ")}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M2 8a6 6 0 0 1 10.3-4.2M14 8a6 6 0 0 1-10.3 4.2" />
					<path d="M14 2v4h-4M2 14v-4h4" />
				</svg>
				<span className="text-[10px] font-medium">
					{reviewButtonPending ? "Starting..." : reviewButtonLabel}
				</span>
			</button>
		</Tooltip>
	}
/>
```

- [ ] **Step 5: Remove retrigger button from `CommentsTab`**

In the `CommentsTab` component (around line 461), remove the `reviewChainId` prop, the `triggerFollowUp` mutation, and the retrigger button JSX (lines 613-649). Also remove the `attachTerminal` mutation since it was only used by triggerFollowUp in CommentsTab.

The `CommentsTab` props become:

```tsx
function CommentsTab({
	details,
	prCtx,
	aiThreads,
	summaryMarkdown,
	onShowSummary,
}: {
	details: GitHubPRDetails;
	prCtx: PRContext;
	aiThreads: AIDraftThread[];
	summaryMarkdown: string | null;
	onShowSummary: () => void;
}) {
```

Update the `CommentsTab` toolbar (around line 610) to only show the summary button and sort control:

```tsx
<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
	{summaryMarkdown && (
		<Tooltip label="Summary">
			<button
				type="button"
				onClick={onShowSummary}
				className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
			>
				{sparkleIcon}
			</button>
		</Tooltip>
	)}
	<div className="flex-1" />
	<select
		value={sortMode}
		onChange={(e) => setSortMode(e.target.value as SortMode)}
		className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none"
	>
		<option value="by-file">By file</option>
		<option value="by-reviewer">By reviewer</option>
		<option value="latest-first">Latest first</option>
	</select>
</div>
```

- [ ] **Step 6: Update `CommentsTab` usage in parent**

In the `PRControlRail` return JSX (around line 910), remove the `reviewChainId` prop:

```tsx
{tab === "comments" && (
	<CommentsTab
		details={details}
		prCtx={prCtx}
		aiThreads={[...aiThreads, ...userPendingThreads]}
		summaryMarkdown={aiDraftQuery.data?.summaryMarkdown ?? null}
		onShowSummary={() => activeWorkspaceId && openPROverview(activeWorkspaceId, prCtx)}
	/>
)}
```

- [ ] **Step 7: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/PRControlRail.tsx
git commit -m "feat: add unified review button to PRControlRail header"
```

---

### Task 8: Update Frontend Auto-Trigger to Use Relaxed Logic

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx:481-552`

- [ ] **Step 1: Update the auto-trigger `useEffect`**

In `apps/desktop/src/renderer/components/PullRequestsTab.tsx`, update the auto-trigger effect (around line 481). Change the `existingIdentifiers` construction from a simple Set to check draft statuses:

Replace:
```typescript
const existingIdentifiers = new Set(reviewDrafts.data.map((d) => d.prIdentifier));
```

With:
```typescript
// Only block auto-trigger for PRs with active reviews (queued/in_progress)
const activeIdentifiers = new Set(
	reviewDrafts.data
		.filter((d) => d.status === "queued" || d.status === "in_progress")
		.map((d) => d.prIdentifier)
);
```

Then update all references from `existingIdentifiers.has(identifier)` to `activeIdentifiers.has(identifier)` in both the GitHub and Bitbucket trigger loops.

- [ ] **Step 2: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat: relax frontend auto-trigger to allow re-review of non-active PRs"
```

---

### Task 9: Fix Stale `getPRDetails` Invalidation in SubmitReviewModal

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRControlRail.tsx:947`

- [ ] **Step 1: Fix the invalidation call**

In `PRControlRail.tsx`, the `SubmitReviewModal`'s `onSubmitted` callback (around line 947) still uses `utils.github.getPRDetails.invalidate(...)`. Update to use the provider-aware endpoint:

Replace:
```typescript
onSubmitted={() => {
	setShowSubmitModal(false);
	utils.github.getPRDetails.invalidate({
		owner: prCtx.owner,
		repo: prCtx.repo,
		number: prCtx.number,
	});
	utils.github.getMyPRs.invalidate();
	aiDraftQuery.refetch();
}}
```

With:
```typescript
onSubmitted={() => {
	setShowSubmitModal(false);
	utils.projects.getPRDetails.invalidate({
		provider: prCtx.provider,
		owner: prCtx.owner,
		repo: prCtx.repo,
		number: prCtx.number,
	});
	utils.github.getMyPRs.invalidate();
	aiDraftQuery.refetch();
}}
```

- [ ] **Step 2: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/PRControlRail.tsx
git commit -m "fix: update SubmitReviewModal invalidation to provider-aware endpoint"
```

---

### Task 10: Run Full Test Suite and Lint

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `bun run check`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 3: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 4: Fix any issues found and commit**

If any issues are found, fix them and commit with an appropriate message.
