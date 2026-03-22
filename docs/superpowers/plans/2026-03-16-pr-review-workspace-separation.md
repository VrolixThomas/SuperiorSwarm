# PR Review Workspace Separation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate PR review worktrees from the Repos tab into a dedicated `review_workspaces` model, giving each PR its own persistent workspace in the PRs tab.

**Architecture:** New `review_workspaces` table structurally isolates review data from the `workspaces` table. FK constraints on `pane_layouts` and `terminal_sessions` are dropped so both workspace types can persist tab/pane state. The orchestrator is refactored to write to `review_workspaces` instead of `workspaces`. A new tRPC router handles review workspace CRUD. The PR sidebar gets rich list items with background GraphQL enrichment.

**Tech Stack:** Drizzle ORM (SQLite), tRPC, Zustand, TanStack Query, React, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-16-pr-review-workspace-separation-design.md`

---

## Chunk 1: Database Schema & Migration

### Task 1: Create `review_workspaces` table in Drizzle schema

**Files:**
- Modify: `apps/desktop/src/main/db/schema-ai-review.ts:1-53`
- Modify: `apps/desktop/src/main/db/schema.ts:235-245` (re-exports)

- [ ] **Step 1: Add `reviewWorkspaces` table definition to `schema-ai-review.ts`**

Add after the `draftComments` table (after line 53):

Update the import at top of file (line 1) to include `uniqueIndex`:
```typescript
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
```

**Do NOT add any imports from `./schema`** — `schema.ts` re-exports from this file, so importing back would create a circular dependency. The `projectId` and `worktreeId` FKs will be enforced in the hand-written migration SQL (Task 3).

Add after the `draftComments` exports (after line 53):

```typescript
export const reviewWorkspaces = sqliteTable(
	"review_workspaces",
	{
		id: text("id").primaryKey(),
		reviewDraftId: text("review_draft_id").references(() => reviewDrafts.id, {
			onDelete: "set null",
		}),
		worktreeId: text("worktree_id"), // FK to worktrees.id enforced in migration SQL
		projectId: text("project_id").notNull(), // FK to projects.id enforced in migration SQL
		prProvider: text("pr_provider").notNull(), // "github" | "bitbucket"
		prIdentifier: text("pr_identifier").notNull(), // "owner/repo#123"
		terminalId: text("terminal_id"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("review_workspaces_project_pr_unique").on(
			table.projectId,
			table.prProvider,
			table.prIdentifier,
		),
	],
);

export type ReviewWorkspace = typeof reviewWorkspaces.$inferSelect;
export type NewReviewWorkspace = typeof reviewWorkspaces.$inferInsert;
```

- [ ] **Step 2: Remove `worktreePath` and `summaryFilePath` from `reviewDrafts`**

In `schema-ai-review.ts`, delete lines 28-29 (`summaryFilePath` and `worktreePath` columns) from the `reviewDrafts` table definition.

- [ ] **Step 3: Add re-exports to `schema.ts`**

In `apps/desktop/src/main/db/schema.ts`, update the re-export block (lines 235-245) to include the new table:

```typescript
export {
	aiReviewSettings,
	type AiReviewSettings,
	type NewAiReviewSettings,
	reviewDrafts,
	type ReviewDraft,
	type NewReviewDraft,
	draftComments,
	type DraftComment,
	type NewDraftComment,
	reviewWorkspaces,
	type ReviewWorkspace,
	type NewReviewWorkspace,
} from "./schema-ai-review";
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: No new errors (existing errors from orchestrator referencing removed columns are expected and will be fixed in Task 3)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/db/schema-ai-review.ts apps/desktop/src/main/db/schema.ts
git commit -m "feat(schema): add review_workspaces table, remove worktreePath/summaryFilePath from reviewDrafts"
```

### Task 2: Drop FK constraints on `pane_layouts` and `terminal_sessions`

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts:54-64,74-80`

- [ ] **Step 1: Remove FK reference from `terminalSessions.workspaceId`**

In `apps/desktop/src/main/db/schema.ts`, change lines 54-64. Replace:

```typescript
export const terminalSessions = sqliteTable("terminal_sessions", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	cwd: text("cwd").notNull(),
	scrollback: text("scrollback"),
	sortOrder: integer("sort_order").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

With:

```typescript
export const terminalSessions = sqliteTable("terminal_sessions", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id").notNull(),
	title: text("title").notNull(),
	cwd: text("cwd").notNull(),
	scrollback: text("scrollback"),
	sortOrder: integer("sort_order").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 2: Remove FK reference from `paneLayouts.workspaceId`**

In `apps/desktop/src/main/db/schema.ts`, change lines 74-80. Replace:

```typescript
export const paneLayouts = sqliteTable("pane_layouts", {
	workspaceId: text("workspace_id")
		.primaryKey()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	layout: text("layout").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

With:

```typescript
export const paneLayouts = sqliteTable("pane_layouts", {
	workspaceId: text("workspace_id").primaryKey(),
	layout: text("layout").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts
git commit -m "refactor(schema): drop FK constraints on pane_layouts and terminal_sessions"
```

### Task 3: Generate and apply Drizzle migration

**Files:**
- Create: `apps/desktop/src/main/db/migrations/0011_*.sql` (auto-generated)
- Modify: `apps/desktop/src/main/db/migrations/meta/` (auto-updated)

- [ ] **Step 1: Generate the migration**

Run: `cd apps/desktop && bun run db:generate`

This produces a new migration file like `0011_*.sql` that will:
- Create `review_workspaces` table with unique index
- Drop `worktree_path` and `summary_file_path` columns from `review_drafts` (SQLite does this via table recreation)
- Recreate `terminal_sessions` and `pane_layouts` without FK constraints

- [ ] **Step 2: Review the generated migration**

Read the generated SQL file and verify it contains:
- `CREATE TABLE review_workspaces` with all columns and unique index
- Table recreation for `review_drafts` without `worktree_path` and `summary_file_path`
- Table recreation for `terminal_sessions` without FK on `workspace_id`
- Table recreation for `pane_layouts` without FK on `workspace_id`

- [ ] **Step 3: Hand-edit the migration to add FKs and cleanup**

The Drizzle-generated `CREATE TABLE review_workspaces` will NOT have FKs on `project_id` and `worktree_id` (because we couldn't express them in the Drizzle schema due to circular imports). Hand-edit the `CREATE TABLE review_workspaces` statement in the generated SQL to add the FK constraints:

```sql
CREATE TABLE `review_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`review_draft_id` text REFERENCES `review_drafts`(`id`) ON DELETE set null,
	`worktree_id` text REFERENCES `worktrees`(`id`) ON DELETE set null,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`pr_provider` text NOT NULL,
	`pr_identifier` text NOT NULL,
	`terminal_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
```

Then append cleanup SQL at the end of the migration file:

```sql
--> statement-breakpoint
DELETE FROM worktrees WHERE id IN (SELECT worktree_id FROM workspaces WHERE name LIKE 'Review: %' AND worktree_id IS NOT NULL);
--> statement-breakpoint
DELETE FROM workspaces WHERE name LIKE 'Review: %';
--> statement-breakpoint
DELETE FROM review_drafts;
--> statement-breakpoint
DELETE FROM draft_comments;
```

Note: The worktree delete must happen BEFORE the workspace delete (to capture IDs). Disk cleanup of worktree directories is not included (pre-production, acceptable loss).

- [ ] **Step 4: Verify app starts and migration applies**

Run: `cd apps/desktop && bun run dev`
Expected: App starts without DB errors, Repos tab shows only non-review workspaces, PRs tab loads.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/db/migrations/
git commit -m "feat(db): add migration for review_workspaces table and schema cleanup"
```

---

## Chunk 2: Review Workspaces tRPC Router

### Task 4: Create the `review-workspaces` tRPC router

**Files:**
- Create: `apps/desktop/src/main/trpc/routers/review-workspaces.ts`
- Modify: `apps/desktop/src/main/trpc/routers/index.ts:1-28`

- [ ] **Step 1: Create the router file**

Create `apps/desktop/src/main/trpc/routers/review-workspaces.ts`:

```typescript
import { dirname, join } from "node:path";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import {
	projects,
	reviewWorkspaces,
	reviewDrafts,
	worktrees,
} from "../../db/schema";
import {
	checkoutBranchWorktree,
	removeWorktree,
	hasUncommittedChanges,
} from "../../git/operations";
import { publicProcedure, router } from "../index";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

export const reviewWorkspacesRouter = router({
	getOrCreate: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				prProvider: z.enum(["github", "bitbucket"]),
				prIdentifier: z.string(),
			}),
		)
		.mutation(({ input }) => {
			const db = getDb();
			const now = new Date();

			// Try to find existing
			const existing = db
				.select()
				.from(reviewWorkspaces)
				.where(
					and(
						eq(reviewWorkspaces.projectId, input.projectId),
						eq(reviewWorkspaces.prProvider, input.prProvider),
						eq(reviewWorkspaces.prIdentifier, input.prIdentifier),
					),
				)
				.get();

			if (existing) return existing;

			// Create new
			const id = nanoid();
			db.insert(reviewWorkspaces)
				.values({
					id,
					projectId: input.projectId,
					prProvider: input.prProvider,
					prIdentifier: input.prIdentifier,
					createdAt: now,
					updatedAt: now,
				})
				.run();

			return db
				.select()
				.from(reviewWorkspaces)
				.where(eq(reviewWorkspaces.id, id))
				.get()!;
		}),

	listByProject: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			return db
				.select({
					id: reviewWorkspaces.id,
					projectId: reviewWorkspaces.projectId,
					prProvider: reviewWorkspaces.prProvider,
					prIdentifier: reviewWorkspaces.prIdentifier,
					reviewDraftId: reviewWorkspaces.reviewDraftId,
					worktreeId: reviewWorkspaces.worktreeId,
					terminalId: reviewWorkspaces.terminalId,
					createdAt: reviewWorkspaces.createdAt,
					updatedAt: reviewWorkspaces.updatedAt,
					worktreePath: worktrees.path,
					draftStatus: reviewDrafts.status,
					draftCommitSha: reviewDrafts.commitSha,
				})
				.from(reviewWorkspaces)
				.leftJoin(worktrees, eq(reviewWorkspaces.worktreeId, worktrees.id))
				.leftJoin(
					reviewDrafts,
					eq(reviewWorkspaces.reviewDraftId, reviewDrafts.id),
				)
				.where(eq(reviewWorkspaces.projectId, input.projectId))
				.all();
		}),

	get: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			return db
				.select({
					id: reviewWorkspaces.id,
					projectId: reviewWorkspaces.projectId,
					prProvider: reviewWorkspaces.prProvider,
					prIdentifier: reviewWorkspaces.prIdentifier,
					reviewDraftId: reviewWorkspaces.reviewDraftId,
					worktreeId: reviewWorkspaces.worktreeId,
					terminalId: reviewWorkspaces.terminalId,
					createdAt: reviewWorkspaces.createdAt,
					updatedAt: reviewWorkspaces.updatedAt,
					worktreePath: worktrees.path,
					draftStatus: reviewDrafts.status,
				})
				.from(reviewWorkspaces)
				.leftJoin(worktrees, eq(reviewWorkspaces.worktreeId, worktrees.id))
				.leftJoin(
					reviewDrafts,
					eq(reviewWorkspaces.reviewDraftId, reviewDrafts.id),
				)
				.where(eq(reviewWorkspaces.id, input.id))
				.get();
		}),

	createWorktree: publicProcedure
		.input(
			z.object({
				reviewWorkspaceId: z.string(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const now = new Date();

			const rw = db
				.select()
				.from(reviewWorkspaces)
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.get();

			if (!rw) throw new Error("Review workspace not found");
			if (rw.worktreeId) throw new Error("Worktree already exists for this review workspace");

			const project = db
				.select()
				.from(projects)
				.where(eq(projects.id, rw.projectId))
				.get();

			if (!project) throw new Error("Project not found");

			const worktreeName = `pr-review-${rw.prIdentifier.replace(/[^a-zA-Z0-9]/g, "-")}`;
			const worktreePath = join(worktreeBasePath(project.repoPath), worktreeName);

			// Remove stale worktree if it exists
			const { existsSync, rmSync } = await import("node:fs");
			if (existsSync(worktreePath)) {
				const { execSync } = await import("node:child_process");
				try {
					execSync(`git worktree remove --force '${worktreePath}'`, {
						cwd: project.repoPath,
					});
				} catch {
					rmSync(worktreePath, { recursive: true, force: true });
					const { execSync: exec2 } = await import("node:child_process");
					exec2("git worktree prune", { cwd: project.repoPath });
				}
			}

			await checkoutBranchWorktree(
				project.repoPath,
				worktreePath,
				input.sourceBranch,
			);

			const worktreeId = nanoid();
			db.insert(worktrees)
				.values({
					id: worktreeId,
					projectId: project.id,
					path: worktreePath,
					branch: input.sourceBranch,
					baseBranch: input.targetBranch,
					createdAt: now,
					updatedAt: now,
				})
				.run();

			db.update(reviewWorkspaces)
				.set({ worktreeId, updatedAt: now })
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.run();

			return { worktreeId, worktreePath };
		}),

	removeWorktree: publicProcedure
		.input(z.object({ reviewWorkspaceId: z.string(), force: z.boolean().optional() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			const rw = db
				.select()
				.from(reviewWorkspaces)
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.get();

			if (!rw) throw new Error("Review workspace not found");
			if (!rw.worktreeId) return { success: true }; // No worktree to remove

			const wt = db
				.select()
				.from(worktrees)
				.where(eq(worktrees.id, rw.worktreeId))
				.get();

			if (!wt) {
				// DB record missing, just null out the reference
				db.update(reviewWorkspaces)
					.set({ worktreeId: null, updatedAt: new Date() })
					.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
					.run();
				return { success: true };
			}

			const { existsSync } = await import("node:fs");
			if (existsSync(wt.path)) {
				if (!input.force) {
					const dirty = await hasUncommittedChanges(wt.path);
					if (dirty) {
						throw new Error(
							"Review worktree has uncommitted changes. Use force to remove anyway.",
						);
					}
				}

				const project = db
					.select()
					.from(projects)
					.where(eq(projects.id, rw.projectId))
					.get();

				if (project) {
					await removeWorktree(project.repoPath, wt.path);
				}
			}

			db.delete(worktrees).where(eq(worktrees.id, wt.id)).run();
			// worktreeId is nulled automatically by ON DELETE SET NULL (if FK existed)
			// But since worktreeId is app-level, null it explicitly
			db.update(reviewWorkspaces)
				.set({ worktreeId: null, updatedAt: new Date() })
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.run();

			return { success: true };
		}),

	attachTerminal: publicProcedure
		.input(z.object({ reviewWorkspaceId: z.string(), terminalId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(reviewWorkspaces)
				.set({ terminalId: input.terminalId, updatedAt: new Date() })
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.run();
		}),
});
```

- [ ] **Step 2: Register the router in the app router**

In `apps/desktop/src/main/trpc/routers/index.ts`, add the import and registration:

```typescript
import { reviewWorkspacesRouter } from "./review-workspaces";

export const appRouter = router({
	aiReview: aiReviewRouter,
	projects: projectsRouter,
	workspaces: workspacesRouter,
	reviewWorkspaces: reviewWorkspacesRouter,
	branches: branchesRouter,
	terminalSessions: terminalSessionsRouter,
	atlassian: atlassianRouter,
	diff: diffRouter,
	sharedFiles: sharedFilesRouter,
	linear: linearRouter,
	github: githubRouter,
	tickets: ticketsRouter,
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/review-workspaces.ts apps/desktop/src/main/trpc/routers/index.ts
git commit -m "feat(trpc): add review-workspaces router with getOrCreate, CRUD, and worktree management"
```

---

## Chunk 3: Orchestrator Refactor

### Task 5: Refactor orchestrator to use `review_workspaces` instead of `workspaces`

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts:1-430`

- [ ] **Step 1: Update `ReviewLaunchInfo` interface**

In `orchestrator.ts`, change lines 12-17. Replace `workspaceId` with `reviewWorkspaceId`:

```typescript
export interface ReviewLaunchInfo {
	draftId: string;
	reviewWorkspaceId: string;
	worktreePath: string;
	launchScript: string;
}
```

Also update the `ActiveReview` interface (lines 19-22) to track the review workspace:

```typescript
interface ActiveReview {
	draftId: string;
	reviewWorkspaceId: string;
	cleanup: (() => void) | null;
}
```

- [ ] **Step 2: Update `queueReview` to accept and pass `projectId`**

The orchestrator needs the `projectId` to call `getOrCreate` on review workspaces. Update the `queueReview` input type (line 152) to include `projectId`:

```typescript
export async function queueReview(prData: {
	provider: "github" | "bitbucket";
	identifier: string;
	title: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	repoPath: string;
	projectId: string;
}): Promise<ReviewLaunchInfo> {
```

Pass `projectId` to `startReview`:

```typescript
	return startReview(id, prData.repoPath, prData.projectId);
```

- [ ] **Step 3: Refactor `startReview` to use `review_workspaces`**

Update `startReview` signature to accept `projectId`:

```typescript
async function startReview(
	draftId: string,
	repoPath: string,
	projectId: string,
): Promise<ReviewLaunchInfo> {
```

Replace the workspace insert block (lines 254-293) with review workspace logic. Remove:
```typescript
const workspaceId = nanoid();
// ... db.insert(schema.workspaces) block
```

Replace with:
```typescript
		// Get or create review workspace
		const now2 = new Date();
		const existing = db
			.select()
			.from(schema.reviewWorkspaces)
			.where(
				and(
					eq(schema.reviewWorkspaces.projectId, projectId),
					eq(schema.reviewWorkspaces.prProvider, draft.prProvider),
					eq(schema.reviewWorkspaces.prIdentifier, draft.prIdentifier),
				),
			)
			.get();

		let reviewWorkspaceId: string;
		if (existing) {
			reviewWorkspaceId = existing.id;
			// Clean up any stale worktree reference
			if (existing.worktreeId) {
				db.delete(schema.worktrees)
					.where(eq(schema.worktrees.id, existing.worktreeId))
					.run();
			}
		} else {
			reviewWorkspaceId = nanoid();
			db.insert(schema.reviewWorkspaces)
				.values({
					id: reviewWorkspaceId,
					projectId,
					prProvider: draft.prProvider,
					prIdentifier: draft.prIdentifier,
					createdAt: now2,
					updatedAt: now2,
				})
				.run();
		}

		// Clean up any stale worktree DB record at the same filesystem path
		// (prevents unique constraint violation on worktrees.path)
		const staleWt = db
			.select()
			.from(schema.worktrees)
			.where(eq(schema.worktrees.path, worktreePath))
			.get();
		if (staleWt) {
			db.delete(schema.worktrees).where(eq(schema.worktrees.id, staleWt.id)).run();
		}

		// Insert worktree record
		db.insert(schema.worktrees)
			.values({
				id: worktreeId,
				projectId,
				path: worktreePath,
				branch: draft.sourceBranch,
				baseBranch: draft.targetBranch,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		// Link worktree and draft to review workspace
		db.update(schema.reviewWorkspaces)
			.set({
				worktreeId,
				reviewDraftId: draft.id,
				updatedAt: now2,
			})
			.where(eq(schema.reviewWorkspaces.id, reviewWorkspaceId))
			.run();
```

Also update the `activeReviews.set` call to include `reviewWorkspaceId`:
```typescript
		activeReviews.set(draft.id, { draftId: draft.id, reviewWorkspaceId, cleanup: cleanupMcp });
```

Also remove the `db.update(schema.reviewDrafts).set({ worktreePath, ... })` call (line 249-252) since `worktreePath` no longer exists on the table. Keep the `commitSha` update:

```typescript
		db.update(schema.reviewDrafts)
			.set({ commitSha, updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draft.id))
			.run();
```

Update the return statement to use `reviewWorkspaceId`:

```typescript
		return {
			draftId: draft.id,
			reviewWorkspaceId,
			worktreePath,
			launchScript,
		};
```

- [ ] **Step 4: Refactor `cleanupStaleReviews` to use join-based path resolution**

Replace lines 385-430 with:

```typescript
export function cleanupStaleReviews(): void {
	const db = getDb();
	const stale = db
		.select({
			draftId: schema.reviewDrafts.id,
			worktreePath: schema.worktrees.path,
		})
		.from(schema.reviewDrafts)
		.leftJoin(
			schema.reviewWorkspaces,
			eq(schema.reviewWorkspaces.reviewDraftId, schema.reviewDrafts.id),
		)
		.leftJoin(
			schema.worktrees,
			eq(schema.reviewWorkspaces.worktreeId, schema.worktrees.id),
		)
		.where(eq(schema.reviewDrafts.status, "in_progress"))
		.all();

	for (const { draftId, worktreePath } of stale) {
		if (worktreePath) {
			const mcpPaths = [
				join(worktreePath, ".mcp.json"),
				join(worktreePath, ".codex", "config.json"),
				join(worktreePath, ".opencode", "config.json"),
			];
			for (const p of mcpPaths) {
				try { rmSync(p); } catch {}
			}
			for (const dir of [".codex", ".opencode"]) {
				try { rmSync(join(worktreePath, dir), { recursive: true }); } catch {}
			}
		}

		const reviewDir = join(app.getPath("userData"), "reviews", draftId);
		try { rmSync(reviewDir, { recursive: true, force: true }); } catch {}

		db.update(schema.reviewDrafts)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draftId))
			.run();
	}

	if (stale.length > 0) {
		console.log(`[ai-review] Cleaned up ${stale.length} stale review(s)`);
	}
}
```

Add `and` to the drizzle-orm import at top of file (line 4):
```typescript
import { and, eq, inArray } from "drizzle-orm";
```

Note: All table references use `schema.*` consistently (via the existing `import * as schema from "../db/schema"`).

- [ ] **Step 5: Update `triggerReview` in ai-review router to pass `projectId`**

In `apps/desktop/src/main/trpc/routers/ai-review.ts`, update the `triggerReview` input (lines 55-69) to include `projectId`:

```typescript
	triggerReview: publicProcedure
		.input(
			z.object({
				provider: z.enum(["github", "bitbucket"]),
				identifier: z.string(),
				title: z.string(),
				author: z.string(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
				repoPath: z.string(),
				projectId: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			return queueReview(input);
		}),
```

- [ ] **Step 6: Minimal fix for `PullRequestsTab.tsx` to prevent breakage**

The renderer references `launchInfo.workspaceId` in the `triggerReview` `onSuccess` handler (line ~114). Since we renamed this to `reviewWorkspaceId`, update the reference now to keep the app functional between chunks. In `apps/desktop/src/renderer/components/PullRequestsTab.tsx`, find the `onSuccess` callback of `triggerReview` and change `launchInfo.workspaceId` to `launchInfo.reviewWorkspaceId`. Also add `projectId` to the `triggerReview.mutate()` call by resolving it from `projectsList`:

```typescript
const project = projectsList?.find(
	(p) => p.githubOwner === pr.repoOwner && p.githubRepo === pr.repoName,
);
if (!project) return; // Can't review without a tracked project

triggerReview.mutate({
	...existingArgs,
	projectId: project.id,
});
```

Apply this pattern to ALL callsites of `triggerReview.mutate()` in the file (there are at least 2-3: auto-trigger and manual trigger buttons).

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: Compilation succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts apps/desktop/src/main/trpc/routers/ai-review.ts apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "refactor(orchestrator): use review_workspaces instead of workspaces for PR reviews"
```

---

## Chunk 4: Tab Store & Session Persistence

### Task 6: Extend `setActiveWorkspace` with optional right panel override

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts:306-322`

- [ ] **Step 1: Add optional `options` parameter to `setActiveWorkspace`**

In `tab-store.ts`, update the `setActiveWorkspace` action (lines 306-322). Replace:

```typescript
	setActiveWorkspace: (workspaceId, cwd) => {
		ps().ensureLayout(workspaceId);
		const focused = ps().getFocusedPane(workspaceId);
		if (!focused) {
			const root = ps().layouts[workspaceId];
			if (root) {
				const first = getAll(root)[0];
				if (first) ps().setFocusedPane(first.id);
			}
		}
		set({
			activeWorkspaceId: workspaceId,
			activeWorkspaceCwd: cwd,
			rightPanel: defaultPanelForCwd(cwd),
		});
	},
```

With:

```typescript
	setActiveWorkspace: (workspaceId, cwd, options) => {
		ps().ensureLayout(workspaceId);
		const focused = ps().getFocusedPane(workspaceId);
		if (!focused) {
			const root = ps().layouts[workspaceId];
			if (root) {
				const first = getAll(root)[0];
				if (first) ps().setFocusedPane(first.id);
			}
		}
		set({
			activeWorkspaceId: workspaceId,
			activeWorkspaceCwd: cwd,
			rightPanel: options?.rightPanel ?? defaultPanelForCwd(cwd),
		});
	},
```

- [ ] **Step 2: Update the store interface type**

Find the `setActiveWorkspace` type in the store interface (search for `setActiveWorkspace:` in the interface definition). Update the signature from:

```typescript
setActiveWorkspace: (workspaceId: string, cwd: string) => void;
```

To:

```typescript
setActiveWorkspace: (
	workspaceId: string,
	cwd: string,
	options?: { rightPanel?: RightPanelState },
) => void;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts
git commit -m "feat(tab-store): add optional rightPanel override to setActiveWorkspace"
```

### Task 7: Update session persistence to support review workspaces

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/terminal-sessions.ts:30-51`

- [ ] **Step 1: Extend the `restore` endpoint to include workspace metadata**

In `terminal-sessions.ts`, update the `restore` query (lines 30-51) to also query `review_workspaces` and return workspace type info:

```typescript
	restore: publicProcedure.query(async () => {
		const db = getDb();

		const sessions = db
			.select()
			.from(schema.terminalSessions)
			.orderBy(schema.terminalSessions.sortOrder)
			.all();

		const stateRows = db.select().from(schema.sessionState).all();
		const state: Record<string, string> = {};
		for (const row of stateRows) {
			state[row.key] = row.value;
		}

		const layoutRows = db.select().from(schema.paneLayouts).all();
		const paneLayouts: Record<string, string> = {};
		for (const row of layoutRows) {
			paneLayouts[row.workspaceId] = row.layout;
		}

		// Build workspace metadata for resolving cwd and type
		const repoWorkspaces = db
			.select({
				id: schema.workspaces.id,
				worktreePath: schema.worktrees.path,
				repoPath: schema.projects.repoPath,
			})
			.from(schema.workspaces)
			.leftJoin(schema.worktrees, eq(schema.workspaces.worktreeId, schema.worktrees.id))
			.leftJoin(schema.projects, eq(schema.workspaces.projectId, schema.projects.id))
			.all();

		const rvWorkspaces = db
			.select({
				id: schema.reviewWorkspaces.id,
				worktreePath: schema.worktrees.path,
				repoPath: schema.projects.repoPath,
				prProvider: schema.reviewWorkspaces.prProvider,
				prIdentifier: schema.reviewWorkspaces.prIdentifier,
			})
			.from(schema.reviewWorkspaces)
			.leftJoin(schema.worktrees, eq(schema.reviewWorkspaces.worktreeId, schema.worktrees.id))
			.leftJoin(schema.projects, eq(schema.reviewWorkspaces.projectId, schema.projects.id))
			.all();

		const workspaceMeta: Record<string, {
			type: "repo" | "review";
			cwd: string;
			prProvider?: string;
			prIdentifier?: string;
		}> = {};

		for (const ws of repoWorkspaces) {
			workspaceMeta[ws.id] = {
				type: "repo",
				cwd: ws.worktreePath ?? ws.repoPath ?? "",
			};
		}
		for (const rw of rvWorkspaces) {
			workspaceMeta[rw.id] = {
				type: "review",
				cwd: rw.worktreePath ?? rw.repoPath ?? "",
				prProvider: rw.prProvider,
				prIdentifier: rw.prIdentifier,
			};
		}

		return { sessions, state, paneLayouts, workspaceMeta };
	}),
```

- [ ] **Step 2: Add schema imports**

At the top of `terminal-sessions.ts`, ensure the import includes `eq`:

```typescript
import { eq } from "drizzle-orm";
```

If not already imported, add it.

- [ ] **Step 3: Clear `review_workspaces.terminal_id` at app startup**

Do NOT put this in the `restore` query (it runs on every invocation and could fire multiple times). Instead, add it to the app initialization sequence. Find where `cleanupStaleReviews()` is called at startup (likely in `apps/desktop/src/main/index.ts` or similar) and add immediately after it:

```typescript
// Clear ephemeral terminal IDs (reset across sessions)
const db = getDb();
db.update(schema.reviewWorkspaces)
	.set({ terminalId: null, updatedAt: new Date() })
	.run();
```

This is a one-time operation that runs once per app launch.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/terminal-sessions.ts
git commit -m "feat(session): extend restore endpoint with workspace metadata for review workspaces"
```

---

## Chunk 5: PR Sidebar — Rich List Items with Background Enrichment

### Task 8: Add `getPRListDetails` batch enrichment endpoint

**Files:**
- Modify: `apps/desktop/src/main/github/github.ts` (add new function)
- Modify: `apps/desktop/src/main/trpc/routers/github.ts` (add new procedure)
- Modify: `apps/desktop/src/shared/github-types.ts` (add enrichment type)

- [ ] **Step 1: Add `GitHubPREnriched` type**

In `apps/desktop/src/shared/github-types.ts`, add after line 92:

```typescript
/** Subset of GitHubPRDetails used for sidebar list enrichment */
export interface GitHubPREnriched {
	owner: string;
	repo: string;
	number: number;
	author: string;
	authorAvatarUrl: string;
	reviewers: GitHubReviewer[];
	ciState: "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | null;
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	unresolvedThreadCount: number;
	files: { additions: number; deletions: number; count: number };
	headCommitOid: string;
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	isDraft: boolean;
	updatedAt: string;
}
```

- [ ] **Step 2: Add `getPRListEnrichment` function to github.ts**

In `apps/desktop/src/main/github/github.ts`, add a function that reuses the existing `getPRDetails` function and transforms the result into the enriched shape. Find the existing `getPRDetails` function and add after it:

Note: `getPRDetails` does NOT take a `token` parameter — authentication is handled internally by `githubGraphQL` via `getValidToken()`. The enrichment function should also not take a token.

```typescript
import type { GitHubPREnriched } from "../../shared/github-types";

export async function getPRListEnrichment(
	prs: Array<{ owner: string; repo: string; number: number }>,
): Promise<GitHubPREnriched[]> {
	const results: GitHubPREnriched[] = [];
	// Fetch in parallel, max 5 concurrent
	const batches: Array<Array<typeof prs[number]>> = [];
	for (let i = 0; i < prs.length; i += 5) {
		batches.push(prs.slice(i, i + 5));
	}

	for (const batch of batches) {
		const settled = await Promise.allSettled(
			batch.map(async (pr) => {
				const details = await getPRDetails(pr.owner, pr.repo, pr.number);
				if (!details) return null;

				const unresolvedThreadCount = details.reviewThreads.filter(
					(t) => !t.isResolved,
				).length;
				const fileStats = details.files.reduce(
					(acc, f) => ({
						additions: acc.additions + f.additions,
						deletions: acc.deletions + f.deletions,
						count: acc.count + 1,
					}),
					{ additions: 0, deletions: 0, count: 0 },
				);

				return {
					owner: pr.owner,
					repo: pr.repo,
					number: pr.number,
					author: details.author,
					authorAvatarUrl: details.authorAvatarUrl,
					reviewers: details.reviewers,
					ciState: details.ciState,
					reviewDecision: details.reviewDecision,
					unresolvedThreadCount,
					files: fileStats,
					headCommitOid: details.headCommitOid,
					mergeable: "UNKNOWN" as const, // TODO: add mergeable to GraphQL query
					isDraft: details.isDraft,
					updatedAt: new Date().toISOString(), // TODO: add updatedAt to GraphQL query
				} satisfies GitHubPREnriched;
			}),
		);

		for (const result of settled) {
			if (result.status === "fulfilled" && result.value) {
				results.push(result.value);
			}
		}
	}

	return results;
}
```

- [ ] **Step 3: Add tRPC endpoint for batch enrichment**

In `apps/desktop/src/main/trpc/routers/github.ts`, add a new procedure:

```typescript
	getPRListEnrichment: publicProcedure
		.input(
			z.object({
				prs: z.array(
					z.object({
						owner: z.string(),
						repo: z.string(),
						number: z.number(),
					}),
				),
			}),
		)
		.query(async ({ input }) => {
			const auth = getAuth(); // from ../../github/auth
			if (!auth) return [];
			return getPRListEnrichment(input.prs);
		}),
```

Add imports at the top of the file:
```typescript
import { getAuth } from "../../github/auth";
import { getPRListEnrichment } from "../../github/github";
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/github-types.ts apps/desktop/src/main/github/github.ts apps/desktop/src/main/trpc/routers/github.ts
git commit -m "feat(github): add batch PR list enrichment endpoint for sidebar details"
```

### Task 9: Rewrite `PullRequestsTab` sidebar with rich list items

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx:51-634`

This is a large component rewrite. The key changes are:

1. Replace `triggerReview` mutation call to include `projectId`
2. Add background enrichment query using `getPRListEnrichment`
3. Replace PR list item rendering with rich cards showing all metadata
4. Wire up click handler to call `reviewWorkspaces.getOrCreate` then `setActiveWorkspace`

- [ ] **Step 1: Add enrichment query hook**

At the top of the `PullRequestsTab` component, after existing queries, add:

```typescript
// Collect reviewer PRs for background enrichment
const reviewerPRsForEnrichment = useMemo(() => {
	// Extract GitHub PRs where user is reviewer
	const prs: Array<{ owner: string; repo: string; number: number }> = [];
	// ... collect from githubPRs where role === "reviewer"
	return prs;
}, [/* github PR queries */]);

const enrichmentQuery = trpc.github.getPRListEnrichment.useQuery(
	{ prs: reviewerPRsForEnrichment },
	{
		enabled: reviewerPRsForEnrichment.length > 0,
		staleTime: 30_000,
		refetchInterval: 60_000,
	},
);

// Build enrichment lookup map
const enrichmentMap = useMemo(() => {
	const map = new Map<string, GitHubPREnriched>();
	for (const pr of enrichmentQuery.data ?? []) {
		map.set(`${pr.owner}/${pr.repo}#${pr.number}`, pr);
	}
	return map;
}, [enrichmentQuery.data]);
```

- [ ] **Step 2: Update `triggerReview` mutation call to include `projectId`**

In the `triggerReview.mutate()` call (around line 108-138), add `projectId` to the input. The project ID should be resolved from the repo grouping context. This requires passing project info down to where `triggerReview` is called.

- [ ] **Step 3: Add mutation hooks and click handler for opening PR workspace**

At the top of the `PullRequestsTab` component, add the mutation hook:

```typescript
const getOrCreateMutation = trpc.reviewWorkspaces.getOrCreate.useMutation();
```

Also add the type import at the top of the file:
```typescript
import type { GitHubPREnriched } from "../../shared/github-types";
```

Then add the click handler:

```typescript
const openPRWorkspace = useCallback(async (
	projectId: string,
	prProvider: "github" | "bitbucket",
	prIdentifier: string,
	repoPath: string,
	worktreePath: string | null,
	prCtx: GitHubPRContext,
) => {
	const rw = await getOrCreateMutation.mutateAsync({
		projectId,
		prProvider,
		prIdentifier,
	});

	const cwd = worktreePath ?? repoPath;
	store.setActiveWorkspace(rw.id, cwd, {
		rightPanel: { open: true, mode: "pr-review", diffCtx: null, prCtx },
	});

	// Create initial PR overview tab if no tabs exist for this workspace
	const existingTabs = store.getTabsByWorkspace(rw.id);
	if (existingTabs.length === 0) {
		store.openPROverview(rw.id, prCtx);
	}
}, [getOrCreateMutation]);
```

- [ ] **Step 4: Build rich PR list item component**

Create a `ReviewPRListItem` component within the file (or extract to a separate file if it's large). This component renders:
- Title + PR number (row 1)
- Source branch → target branch (row 2)
- Author avatar + name, reviewer avatars with status borders (row 3)
- Activity row: new commits indicator, unresolved comment count, CI status, AI review status (row 4)
- Additional indicators: draft badge, merge conflict warning, time since update

The enrichment data may not be available yet (loading state), so each enriched field should have a skeleton/placeholder state.

- [ ] **Step 5: Test the full flow manually**

Run: `cd apps/desktop && bun run dev`
Expected:
- PRs tab shows PRs grouped by repo
- Each PR shows rich metadata (or loading placeholders)
- Clicking a reviewer PR opens a persistent workspace in the main area
- PR overview tab appears
- Switching back to Repos tab and back to PRs tab preserves state

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat(pr-tab): rewrite PR sidebar with rich list items and review workspace integration"
```

---

## Chunk 6: Worktree Lifecycle & Cleanup

### Task 10: Add PR merge/close detection and auto-cleanup

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx` (add cleanup effect)
- Modify: `apps/desktop/src/main/trpc/routers/review-workspaces.ts` (add cleanup-related query)

- [ ] **Step 1: Add a `cleanupMergedPRs` effect in PullRequestsTab**

Add the mutation hook at component top:
```typescript
const removeWorktreeMutation = trpc.reviewWorkspaces.removeWorktree.useMutation();
const reviewWorkspacesQuery = trpc.reviewWorkspaces.listByProject.useQuery(
	{ projectId: activeProject?.id ?? "" },
	{ enabled: !!activeProject },
);
```

Add the cleanup effect. When the PR list refreshes and a previously-open PR transitions to merged/closed, trigger worktree cleanup:

```typescript
const prevPRStates = useRef<Map<string, string>>(new Map());

useEffect(() => {
	if (!allPRs || !reviewWorkspacesQuery.data) return;

	const currentStates = new Map<string, string>();
	for (const pr of allPRs) {
		currentStates.set(pr.identifier, pr.state); // "open" | "merged" | "closed"
	}

	for (const [identifier, prevState] of prevPRStates.current) {
		const newState = currentStates.get(identifier);
		if (prevState === "open" && (newState === "merged" || newState === "closed" || !newState)) {
			// Find the review workspace for this PR
			const rw = reviewWorkspacesQuery.data.find(
				(w) => w.prIdentifier === identifier,
			);
			if (rw?.worktreeId) {
				removeWorktreeMutation.mutate(
					{ reviewWorkspaceId: rw.id, force: true },
					{
						onSuccess: () => {
							console.log(`[pr-cleanup] Cleaned up worktree for ${identifier}`);
							reviewWorkspacesQuery.refetch();
						},
					},
				);
			}
		}
	}

	prevPRStates.current = currentStates;
}, [allPRs, reviewWorkspacesQuery.data]);
```

Note: `allPRs` is the merged array of GitHub + Bitbucket PRs already computed in the component. Each PR object needs an `identifier` field (e.g., `owner/repo#123`) and a `state` field. Map these from the existing PR data structures.

- [ ] **Step 2: Add right-click context menu for "Remove Worktree"**

Add a context menu handler to the PR list item that shows "Remove Worktree" option when a worktree exists:

```typescript
const handleContextMenu = (e: React.MouseEvent, reviewWorkspaceId: string, hasWorktree: boolean) => {
	e.preventDefault();
	if (!hasWorktree) return;
	// Show context menu with "Remove Worktree" option
	// On click: confirm dialog, then call removeWorktree mutation
};
```

- [ ] **Step 3: Test cleanup manually**

Run: `cd apps/desktop && bun run dev`
- Create a review worktree for a PR
- Merge the PR externally (in GitHub)
- Wait for next PR list refresh (~30-60s)
Expected: Worktree is auto-cleaned, notification shown

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat(lifecycle): add PR merge/close detection and auto-cleanup of review worktrees"
```

### Task 11: Update App.tsx hydration to handle review workspace sessions

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx:153-225`

- [ ] **Step 1: Use `workspaceMeta` from restore endpoint**

**Important note:** `collectSnapshot()` (lines 107-138) calls `store.getAllTabs()` which traverses ALL pane-store layouts regardless of workspace type. Since review workspace tabs are stored in the same pane-store (just keyed by `review_workspace.id`), they are already included in the save payload. No changes to `collectSnapshot()` are needed.

In the hydration `useEffect` (lines 153-225), the `restoreQuery.data` now includes `workspaceMeta`. Use it to filter out layouts for deleted workspaces:

```typescript
	const { sessions, state, paneLayouts, workspaceMeta } = restoreQuery.data;

	// ... existing hydration code ...

	// When hydrating pane layouts, skip workspace IDs not in workspaceMeta
	if (hasLayouts) {
		for (const [wsId, layoutJson] of Object.entries(paneLayouts)) {
			if (!workspaceMeta?.[wsId]) {
				// Orphaned layout (workspace no longer exists) — skip
				continue;
			}
			// ... existing deserialization and hydration ...
		}
	}
```

- [ ] **Step 2: Verify TypeScript compiles and app starts**

Run: `cd apps/desktop && bun run type-check && bun run dev`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx
git commit -m "feat(hydration): filter orphaned layouts and support review workspace session restore"
```

---

## Chunk 7: Lint, Format & Final Verification

### Task 12: Run biome and type-check on the full project

**Files:** All modified files

- [ ] **Step 1: Run biome check**

Run: `bun run check` (from repo root)
Fix any formatting or lint issues.

- [ ] **Step 2: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Fix any remaining TypeScript errors.

- [ ] **Step 3: Run tests**

Run: `cd apps/desktop && bun test`
Fix any failing tests.

- [ ] **Step 4: Manual smoke test**

Run: `cd apps/desktop && bun run dev`

Verify:
1. Repos tab shows only regular workspaces (no "Review: ..." items)
2. PRs tab shows PRs grouped by repo with rich list items
3. Clicking a reviewer PR opens a persistent workspace with PR Overview
4. Switching between PRs and back preserves tab state
5. "Review with AI" creates a worktree and terminal within the PR workspace
6. Right-click → "Remove Worktree" cleans up the worktree
7. App restart restores PR workspace sessions correctly

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "style: biome formatting and lint fixes"
```
