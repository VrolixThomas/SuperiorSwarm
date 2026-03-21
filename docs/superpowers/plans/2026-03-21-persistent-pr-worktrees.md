# Persistent PR Review Worktrees Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR review worktrees persistent — created once on first need, reused thereafter, cleaned up only when PR lifecycle ends.

**Architecture:** Extract worktree resolution into a shared `ensureWorktree()` helper. Both `startReview()` and `queueFollowUpReview()` call it instead of managing worktrees themselves. A new `ensureWorktree` tRPC endpoint lets the renderer create worktrees on PR open. Cleanup moves to dismiss and poller-detected merge/close.

**Tech Stack:** SQLite/Drizzle ORM, tRPC, git worktrees, simple-git

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/ai-review/orchestrator.ts` | Modify | Extract worktree resolution to `ensureReviewWorktree()`, simplify `startReview()` and `queueFollowUpReview()` |
| `src/main/trpc/routers/review-workspaces.ts` | Modify | Add `ensureWorktree` mutation |
| `src/main/trpc/routers/ai-review.ts` | Modify | Update `dismissReview` to clean up worktree |
| `src/main/ai-review/commit-poller.ts` | Modify | Clean up worktree on PR merge/close |

---

### Task 1: Extract `ensureReviewWorktree()` helper in orchestrator

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts`

- [ ] **Step 1: Add the `ensureReviewWorktree` function**

Add a new exported function that either returns an existing worktree path or creates one. This replaces all the worktree creation/removal logic scattered across `startReview` and `queueFollowUpReview`.

```typescript
/**
 * Ensure a worktree exists for a PR review. Returns the worktree path.
 * If one already exists (DB record + directory on disk), reuses it and fetches latest.
 * If not, creates a new one.
 */
export async function ensureReviewWorktree(opts: {
	projectId: string;
	repoPath: string;
	prProvider: string;
	prIdentifier: string;
	sourceBranch: string;
	targetBranch: string;
}): Promise<{ worktreePath: string; reviewWorkspaceId: string }> {
	const db = getDb();

	// Get or create review workspace
	let workspace = db
		.select()
		.from(schema.reviewWorkspaces)
		.where(
			and(
				eq(schema.reviewWorkspaces.projectId, opts.projectId),
				eq(schema.reviewWorkspaces.prProvider, opts.prProvider),
				eq(schema.reviewWorkspaces.prIdentifier, opts.prIdentifier)
			)
		)
		.get();

	if (!workspace) {
		const now = new Date();
		const id = nanoid();
		db.insert(schema.reviewWorkspaces)
			.values({
				id,
				projectId: opts.projectId,
				prProvider: opts.prProvider,
				prIdentifier: opts.prIdentifier,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		workspace = db
			.select()
			.from(schema.reviewWorkspaces)
			.where(eq(schema.reviewWorkspaces.id, id))
			.get()!;
	}

	// Check if worktree already exists on disk
	const existingWorktree = workspace.worktreeId
		? db.select().from(schema.worktrees).where(eq(schema.worktrees.id, workspace.worktreeId)).get()
		: null;

	if (existingWorktree?.path && existsSync(existingWorktree.path)) {
		// Worktree exists — fetch latest
		const { execSync } = await import("node:child_process");
		try {
			execSync("git fetch origin", { cwd: existingWorktree.path, stdio: "pipe" });
			execSync(`git reset --hard origin/${opts.sourceBranch}`, {
				cwd: existingWorktree.path,
				stdio: "pipe",
			});
		} catch (err) {
			console.error("[ai-review] Failed to update worktree, continuing with current state:", err);
		}
		return { worktreePath: existingWorktree.path, reviewWorkspaceId: workspace.id };
	}

	// Worktree doesn't exist — create it
	const worktreeName = `pr-review-${opts.prIdentifier.replace(/[^a-zA-Z0-9]/g, "-")}`;
	const parentDir = join(dirname(opts.repoPath), `${opts.repoPath.split("/").pop()}-worktrees`);
	const worktreePath = join(parentDir, worktreeName);

	// Prune stale git worktree entries
	const { execSync } = await import("node:child_process");
	try {
		execSync("git worktree prune", { cwd: opts.repoPath, stdio: "pipe" });
	} catch {}

	// If directory exists on disk but isn't tracked in DB, clean it up
	if (existsSync(worktreePath)) {
		try {
			execSync(`git worktree remove --force '${worktreePath}'`, {
				cwd: opts.repoPath,
				stdio: "pipe",
			});
		} catch {
			rmSync(worktreePath, { recursive: true, force: true });
			try {
				execSync("git worktree prune", { cwd: opts.repoPath, stdio: "pipe" });
			} catch {}
		}
	}

	await checkoutBranchWorktree(opts.repoPath, worktreePath, opts.sourceBranch);

	// Create worktree DB record
	const worktreeId = nanoid();
	const now = new Date();

	// Clean up any stale DB record at same path
	const staleWt = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.path, worktreePath))
		.get();
	if (staleWt) {
		db.delete(schema.worktrees).where(eq(schema.worktrees.id, staleWt.id)).run();
	}

	db.insert(schema.worktrees)
		.values({
			id: worktreeId,
			projectId: opts.projectId,
			path: worktreePath,
			branch: opts.sourceBranch,
			baseBranch: opts.targetBranch,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	// Link worktree to review workspace
	db.update(schema.reviewWorkspaces)
		.set({ worktreeId, updatedAt: now })
		.where(eq(schema.reviewWorkspaces.id, workspace.id))
		.run();

	return { worktreePath, reviewWorkspaceId: workspace.id };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts
git commit -m "feat: add ensureReviewWorktree helper for persistent worktrees"
```

---

### Task 2: Simplify `startReview()` to use `ensureReviewWorktree()`

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts`

- [ ] **Step 1: Replace worktree creation block in `startReview()`**

Remove everything from `// Create worktree for the PR branch` (line 244) through the worktree DB record creation (through `// Link worktree and draft to review workspace`). Replace with a call to `ensureReviewWorktree()`.

The new `startReview()` should:

1. Mark draft as `in_progress`
2. Find the project
3. Call `ensureReviewWorktree()` to get `worktreePath` and `reviewWorkspaceId`
4. Capture commit SHA from the worktree
5. Link the draft to the review workspace: `db.update(schema.reviewWorkspaces).set({ reviewDraftId: draft.id, ... })`
6. Continue with MCP config, prompt, launch script (unchanged)

The key deletions:
- Remove the "Remove stale worktree" block (lines 249-268)
- Remove `checkoutBranchWorktree` call (line 270)
- Remove worktree DB record creation (lines 284-329)
- Remove stale worktree DB cleanup (lines 321-329)

Replace all of that with:
```typescript
const { worktreePath, reviewWorkspaceId } = await ensureReviewWorktree({
	projectId,
	repoPath,
	prProvider: draft.prProvider,
	prIdentifier: draft.prIdentifier,
	sourceBranch: draft.sourceBranch,
	targetBranch: draft.targetBranch,
});

// Capture commit SHA
const { execSync } = await import("node:child_process");
const commitSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();
const dbPath = join(app.getPath("userData"), "branchflux.db");

db.update(schema.reviewDrafts)
	.set({ commitSha, updatedAt: new Date() })
	.where(eq(schema.reviewDrafts.id, draft.id))
	.run();

// Link draft to review workspace
db.update(schema.reviewWorkspaces)
	.set({ reviewDraftId: draft.id, updatedAt: new Date() })
	.where(eq(schema.reviewWorkspaces.id, reviewWorkspaceId))
	.run();
```

Then continue with the existing MCP/prompt/launch script logic, using `worktreePath` and `reviewWorkspaceId`.

- [ ] **Step 2: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts
git commit -m "refactor: simplify startReview to use ensureReviewWorktree"
```

---

### Task 3: Simplify `queueFollowUpReview()` to use `ensureReviewWorktree()`

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts`

- [ ] **Step 1: Replace worktree logic in `queueFollowUpReview()`**

Remove the entire "Check if worktree exists, recreate if needed" block and all the worktree creation code. Replace with:

```typescript
const { worktreePath, reviewWorkspaceId } = await ensureReviewWorktree({
	projectId: workspace.projectId,
	repoPath: project.repoPath,
	prProvider: latestDraft.prProvider,
	prIdentifier: latestDraft.prIdentifier,
	sourceBranch: latestDraft.sourceBranch,
	targetBranch: latestDraft.targetBranch,
});
```

Then pass `worktreePath` to `startFollowUpReview()` instead of `worktree.path`.

- [ ] **Step 2: Simplify `startFollowUpReview()`**

Remove the `git fetch origin` + `git reset --hard` block at the start of `startFollowUpReview()` — the fetch+reset is now handled by `ensureReviewWorktree()`. Just capture the commit SHA directly.

Also remove the review workspace update (`db.update(schema.reviewWorkspaces).set({ reviewDraftId... })`) from `startFollowUpReview()` since `queueFollowUpReview()` should do this after calling `ensureReviewWorktree()`.

- [ ] **Step 3: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts
git commit -m "refactor: simplify queueFollowUpReview to use ensureReviewWorktree"
```

---

### Task 4: Add `ensureWorktree` tRPC endpoint for PR open

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/review-workspaces.ts`

- [ ] **Step 1: Add the endpoint**

Add a new mutation that the renderer calls when the user opens a PR:

```typescript
ensureWorktree: publicProcedure
	.input(
		z.object({
			projectId: z.string(),
			prProvider: z.enum(["github", "bitbucket"]),
			prIdentifier: z.string(),
			sourceBranch: z.string(),
			targetBranch: z.string(),
		})
	)
	.mutation(async ({ input }) => {
		const db = getDb();
		const project = db
			.select()
			.from(projects)
			.where(eq(projects.id, input.projectId))
			.get();

		if (!project) throw new Error("Project not found");

		const { ensureReviewWorktree } = await import("../../ai-review/orchestrator");
		const result = await ensureReviewWorktree({
			projectId: input.projectId,
			repoPath: project.repoPath,
			prProvider: input.prProvider,
			prIdentifier: input.prIdentifier,
			sourceBranch: input.sourceBranch,
			targetBranch: input.targetBranch,
		});

		return result;
	}),
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/review-workspaces.ts
git commit -m "feat: add ensureWorktree tRPC endpoint for lazy worktree creation"
```

---

### Task 5: Update `dismissReview` to clean up worktree

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/ai-review.ts`

- [ ] **Step 1: Add worktree cleanup to dismiss**

Update the `dismissReview` mutation to also remove the worktree and clean up DB records:

```typescript
dismissReview: publicProcedure.input(z.object({ draftId: z.string() })).mutation(async ({ input }) => {
	const db = getDb();
	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, input.draftId))
		.get();

	if (!draft) return { success: true };

	// Find review workspace for this PR
	const workspace = db
		.select()
		.from(schema.reviewWorkspaces)
		.where(eq(schema.reviewWorkspaces.prIdentifier, draft.prIdentifier))
		.get();

	// Remove worktree if it exists
	if (workspace?.worktreeId) {
		const worktree = db
			.select()
			.from(schema.worktrees)
			.where(eq(schema.worktrees.id, workspace.worktreeId))
			.get();

		if (worktree?.path) {
			const project = db
				.select()
				.from(schema.projects)
				.where(eq(schema.projects.id, workspace.projectId))
				.get();

			if (project) {
				try {
					const { removeWorktree } = await import("../../git/operations");
					await removeWorktree(project.repoPath, worktree.path);
				} catch {
					// Non-fatal — worktree may already be gone
				}
			}

			db.delete(schema.worktrees).where(eq(schema.worktrees.id, workspace.worktreeId)).run();
			db.update(schema.reviewWorkspaces)
				.set({ worktreeId: null, updatedAt: new Date() })
				.where(eq(schema.reviewWorkspaces.id, workspace.id))
				.run();
		}
	}

	db.update(schema.reviewDrafts)
		.set({ status: "dismissed", updatedAt: new Date() })
		.where(eq(schema.reviewDrafts.id, input.draftId))
		.run();

	return { success: true };
}),
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/ai-review.ts
git commit -m "feat: clean up worktree when dismissing review"
```

---

### Task 6: Clean up worktree on PR merge/close in poller

**Files:**
- Modify: `apps/desktop/src/main/ai-review/commit-poller.ts`

- [ ] **Step 1: Add cleanup logic when PR is merged/closed**

Currently when the poller detects a merged/closed PR, it just logs and returns. Update to also clean up the worktree:

```typescript
if (prState === "merged" || prState === "closed") {
	console.log(`[commit-poller] PR ${chain.prIdentifier} is ${prState}, cleaning up`);
	await cleanupChainWorktree(chain);
	return;
}
```

Add the cleanup function:

```typescript
import { removeWorktree } from "../git/operations";

async function cleanupChainWorktree(chain: WatchedChain): Promise<void> {
	const db = getDb();

	// Find review workspace
	const workspace = db
		.select()
		.from(schema.reviewWorkspaces)
		.where(eq(schema.reviewWorkspaces.prIdentifier, chain.prIdentifier))
		.get();

	if (!workspace?.worktreeId) return;

	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();

	if (worktree?.path) {
		const project = db
			.select()
			.from(schema.projects)
			.where(eq(schema.projects.id, workspace.projectId))
			.get();

		if (project) {
			try {
				await removeWorktree(project.repoPath, worktree.path);
			} catch (err) {
				console.error(`[commit-poller] Failed to remove worktree:`, err);
			}
		}

		db.delete(schema.worktrees).where(eq(schema.worktrees.id, workspace.worktreeId)).run();
	}

	db.update(schema.reviewWorkspaces)
		.set({ worktreeId: null, updatedAt: new Date() })
		.where(eq(schema.reviewWorkspaces.id, workspace.id))
		.run();
}
```

Note: add `eq` to the drizzle-orm imports if not already present.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/ai-review/commit-poller.ts
git commit -m "feat: clean up worktree when poller detects PR merged/closed"
```

---

### Task 7: Type-check & lint

- [ ] **Step 1: Run type-check**

Run: `cd apps/desktop && bun run type-check`

Fix any TypeScript errors.

- [ ] **Step 2: Run linter**

Run: `bun run check` (from repo root)

Fix any Biome issues.

- [ ] **Step 3: Commit if fixes needed**

```bash
git add -u
git commit -m "fix: resolve type-check and lint issues"
```
