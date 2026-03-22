# AI Comment Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable PR authors to automatically fix review comments using AI, with grouped commits, local review, and push-when-ready workflow.

**Architecture:** Extends the existing AI review system with a parallel "solve" flow. New MCP solver tools are added to the existing MCP server (mode selected by env var). A comment poller watches authored PRs for new comments. The right panel in the Repo tab gets a "comment-solve" mode reusing existing diff/comment components.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), tRPC, MCP SDK, React 19, Zustand, TanStack Query, simpleGit, node-pty daemon

**Spec:** `docs/superpowers/specs/2026-03-23-ai-comment-solver-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/main/db/schema-comment-solver.ts` | Drizzle schema for `commentSolveSessions`, `commentGroups`, `prComments`, `commentReplies` |
| `src/main/db/migrations/0016_*.sql` | Migration: new tables + alter `ai_review_settings` + update unique index on `workspaces` |
| `src/main/ai-review/comment-solver-orchestrator.ts` | Solve session lifecycle: queue, launch, state machine |
| `src/main/ai-review/comment-poller.ts` | Polls for new comments on authored PRs |
| `src/main/ai-review/solve-publisher.ts` | Pushes commits, posts replies, resolves threads |
| `src/main/ai-review/solve-prompt.ts` | Prompt template builder for solve sessions |
| `src/main/trpc/routers/comment-solver.ts` | tRPC router: triggerSolve, approveGroup, revertGroup, pushAndPost, etc. |
| `src/renderer/components/CommentSolvePanel.tsx` | Right panel container for comment-solve mode |
| `src/renderer/components/CommentGroupItem.tsx` | Group row in the solve panel sidebar |
| `src/renderer/components/CommentGroupDetail.tsx` | Detail view: diff + comments + reply editor for selected group |
| `src/renderer/components/SolveActionBar.tsx` | Bottom bar: push button + status summary |
| `src/shared/solve-types.ts` | Shared TypeScript types for solve sessions, groups, comments |

### Modified Files

| File | Changes |
|---|---|
| `mcp-standalone/server.mjs` | Add solver mode (env: `SOLVE_SESSION_ID`) with 7 new tools |
| `src/main/db/schema.ts` | Re-export new schema tables; update unique index on workspaces |
| `src/main/db/schema-ai-review.ts` | Add `autoSolveEnabled` and `solvePrompt` to `aiReviewSettings` |
| `src/main/ai-review/cli-presets.ts` | Add `solveSessionId` to `LaunchOptions`; extend each preset's `setupMcp` for solver env vars |
| `src/main/trpc/routers/index.ts` | Register `commentSolverRouter` |
| `src/main/trpc/routers/workspaces.ts` | Auto-detect authored PR on workspace creation |
| `src/renderer/components/CreateWorktreeModal.tsx` | Add "Existing branch" checkout mode |
| `src/renderer/components/PullRequestsTab.tsx` | Filter out authored PRs |
| `src/renderer/components/WorkspaceItem.tsx` | Add comment notification badge |
| `src/renderer/components/SettingsView.tsx` | Add auto-solve toggle + solve prompt editor |
| `src/renderer/stores/tab-store.ts` | Add `"comment-solve"` panel mode to `PanelMode` type |
| `src/renderer/components/DiffPanel.tsx` | Route `"comment-solve"` mode to `CommentSolvePanel` (line ~300, alongside `"pr-review"` routing) |

---

## Task 1: Database Schema & Migration

**Files:**
- Create: `apps/desktop/src/main/db/schema-comment-solver.ts`
- Modify: `apps/desktop/src/main/db/schema-ai-review.ts:4-14`
- Modify: `apps/desktop/src/main/db/schema.ts:58-60` (unique index), `243-253` (re-exports)
- Run: `bun run db:generate` to create migration

- [ ] **Step 1: Create schema-comment-solver.ts**

```typescript
// apps/desktop/src/main/db/schema-comment-solver.ts
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./schema";

export const commentSolveSessions = sqliteTable("comment_solve_sessions", {
	id: text("id").primaryKey(),
	prProvider: text("pr_provider").notNull(),
	prIdentifier: text("pr_identifier").notNull(),
	prTitle: text("pr_title").notNull(),
	sourceBranch: text("source_branch").notNull(),
	targetBranch: text("target_branch").notNull(),
	status: text("status").notNull().default("queued"),
	commitSha: text("commit_sha"),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type CommentSolveSession = typeof commentSolveSessions.$inferSelect;
export type NewCommentSolveSession = typeof commentSolveSessions.$inferInsert;

export const commentGroups = sqliteTable("comment_groups", {
	id: text("id").primaryKey(),
	solveSessionId: text("solve_session_id")
		.notNull()
		.references(() => commentSolveSessions.id, { onDelete: "cascade" }),
	label: text("label").notNull(),
	status: text("status").notNull().default("pending"),
	commitHash: text("commit_hash"),
	order: integer("order").notNull(),
});

export type CommentGroup = typeof commentGroups.$inferSelect;
export type NewCommentGroup = typeof commentGroups.$inferInsert;

export const prComments = sqliteTable(
	"pr_comments",
	{
		id: text("id").primaryKey(),
		solveSessionId: text("solve_session_id")
			.notNull()
			.references(() => commentSolveSessions.id, { onDelete: "cascade" }),
		groupId: text("group_id").references(() => commentGroups.id),
		platformCommentId: text("platform_comment_id").notNull(),
		author: text("author").notNull(),
		body: text("body").notNull(),
		filePath: text("file_path").notNull(),
		lineNumber: integer("line_number"),
		side: text("side"),
		threadId: text("thread_id"),
		status: text("status").notNull().default("open"),
		commitSha: text("commit_sha"),
	},
	(table) => [
		uniqueIndex("pr_comments_session_platform_unique").on(
			table.solveSessionId,
			table.platformCommentId
		),
	]
);

export type PrComment = typeof prComments.$inferSelect;
export type NewPrComment = typeof prComments.$inferInsert;

export const commentReplies = sqliteTable("comment_replies", {
	id: text("id").primaryKey(),
	prCommentId: text("pr_comment_id")
		.notNull()
		.references(() => prComments.id, { onDelete: "cascade" }),
	body: text("body").notNull(),
	status: text("status").notNull().default("draft"),
});

export type CommentReply = typeof commentReplies.$inferSelect;
export type NewCommentReply = typeof commentReplies.$inferInsert;
```

- [ ] **Step 2: Add autoSolveEnabled and solvePrompt to aiReviewSettings**

In `apps/desktop/src/main/db/schema-ai-review.ts`, add after line 13 (`autoPublishResolutions`):

```typescript
autoSolveEnabled: integer("auto_solve_enabled").notNull().default(0),
solvePrompt: text("solve_prompt"),
```

- [ ] **Step 3: Update workspaces unique index to include type**

In `apps/desktop/src/main/db/schema.ts`, change line 59 from:

```typescript
uniqueIndex("workspaces_pr_unique").on(table.projectId, table.prProvider, table.prIdentifier),
```

to:

```typescript
uniqueIndex("workspaces_pr_unique").on(table.projectId, table.prProvider, table.prIdentifier, table.type),
```

- [ ] **Step 4: Add re-exports for new schema tables**

In `apps/desktop/src/main/db/schema.ts`, add after the existing re-exports at the end:

```typescript
export {
	commentSolveSessions,
	type CommentSolveSession,
	type NewCommentSolveSession,
	commentGroups,
	type CommentGroup,
	type NewCommentGroup,
	prComments,
	type PrComment,
	type NewPrComment,
	commentReplies,
	type CommentReply,
	type NewCommentReply,
} from "./schema-comment-solver";
```

- [ ] **Step 5: Generate migration**

Run: `cd apps/desktop && bun run db:generate`

Expected: New migration file `0016_*.sql` created in `src/main/db/migrations/`

- [ ] **Step 6: Verify migration SQL**

Read the generated migration file and verify it contains:
- `CREATE TABLE comment_solve_sessions`
- `CREATE TABLE comment_groups`
- `CREATE TABLE pr_comments` with unique index
- `CREATE TABLE comment_replies`
- `ALTER TABLE ai_review_settings ADD COLUMN auto_solve_enabled`
- `ALTER TABLE ai_review_settings ADD COLUMN solve_prompt`
- Drop + recreate `workspaces_pr_unique` index with `type` column

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/db/schema-comment-solver.ts \
       apps/desktop/src/main/db/schema-ai-review.ts \
       apps/desktop/src/main/db/schema.ts \
       apps/desktop/src/main/db/migrations/
git commit -m "feat: add comment solver database schema and migration"
```

---

## Task 2: Shared Types

**Files:**
- Create: `apps/desktop/src/shared/solve-types.ts`

- [ ] **Step 1: Create shared types file**

```typescript
// apps/desktop/src/shared/solve-types.ts

export type SolveSessionStatus =
	| "queued"
	| "in_progress"
	| "ready"
	| "submitted"
	| "failed"
	| "dismissed";

export type SolveGroupStatus = "pending" | "fixed" | "approved" | "reverted";

export type SolveCommentStatus = "open" | "fixed" | "unclear" | "wont_fix";

export type SolveReplyStatus = "draft" | "approved" | "posted";

export interface SolveSessionInfo {
	id: string;
	prProvider: string;
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	status: SolveSessionStatus;
	commitSha: string | null;
	workspaceId: string;
	createdAt: Date;
	updatedAt: Date;
	groups: SolveGroupInfo[];
}

export interface SolveGroupInfo {
	id: string;
	label: string;
	status: SolveGroupStatus;
	commitHash: string | null;
	order: number;
	comments: SolveCommentInfo[];
}

export interface SolveCommentInfo {
	id: string;
	platformCommentId: string;
	author: string;
	body: string;
	filePath: string;
	lineNumber: number | null;
	side: string | null;
	threadId: string | null;
	status: SolveCommentStatus;
	commitSha: string | null;
	groupId: string | null;
	reply: SolveReplyInfo | null;
}

export interface SolveReplyInfo {
	id: string;
	body: string;
	status: SolveReplyStatus;
}

export interface SolveLaunchInfo {
	sessionId: string;
	workspaceId: string;
	worktreePath: string;
	launchScript: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/shared/solve-types.ts
git commit -m "feat: add shared types for comment solver"
```

---

## Task 3: MCP Server — Solver Tools

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs`

This is the core: adding 7 solver tools to the existing MCP server, activated when `SOLVE_SESSION_ID` is set.

- [ ] **Step 1: Add solver mode detection at the top of server.mjs**

After the existing env var declarations (line 11-13), add:

```javascript
const SOLVE_SESSION_ID = process.env.SOLVE_SESSION_ID;
const WORKTREE_PATH = process.env.WORKTREE_PATH; // explicit path for git operations
const isSolverMode = !!SOLVE_SESSION_ID;

// In solver mode, REVIEW_DRAFT_ID is not required
if (!isSolverMode && (!REVIEW_DRAFT_ID || !DB_PATH)) {
	console.error("Missing required env vars: REVIEW_DRAFT_ID or SOLVE_SESSION_ID, and DB_PATH");
	process.exit(1);
}
if (isSolverMode && !DB_PATH) {
	console.error("Missing required env var: DB_PATH");
	process.exit(1);
}
```

Remove the existing validation block (lines 15-18).

- [ ] **Step 2: Add solver tools after existing review tools**

Add after the `finish_review` tool definition, wrapped in `if (isSolverMode)`:

```javascript
if (isSolverMode) {
	// ─── Solver Tools ─────────────────────────────────────────────

	server.tool(
		"get_pr_comments",
		"Get all unresolved PR review comments that need to be fixed",
		{},
		async () => {
			const rows = db
				.prepare(
					`SELECT id, platform_comment_id, author, body, file_path, line_number, side, thread_id, commit_sha
					 FROM pr_comments WHERE solve_session_id = ? AND status = 'open'`
				)
				.all(SOLVE_SESSION_ID);

			const comments = rows.map((r) => ({
				id: r.id,
				platformCommentId: r.platform_comment_id,
				author: r.author,
				body: r.body,
				filePath: r.file_path,
				lineNumber: r.line_number,
				side: r.side,
				threadId: r.thread_id,
				commitSha: r.commit_sha,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(comments, null, 2) }],
			};
		}
	);

	server.tool(
		"submit_grouping",
		"Submit your chosen grouping of comments. Each group gets one commit.",
		{
			groups: z
				.array(
					z.object({
						label: z.string().describe("Short description of what this group fixes"),
						comment_ids: z
							.array(z.string())
							.describe("IDs of comments in this group"),
					})
				)
				.describe("Array of comment groups"),
		},
		async ({ groups }) => {
			const insertGroup = db.prepare(
				`INSERT INTO comment_groups (id, solve_session_id, label, status, "order")
				 VALUES (?, ?, ?, 'pending', ?)`
			);
			const updateComment = db.prepare(
				`UPDATE pr_comments SET group_id = ? WHERE id = ? AND solve_session_id = ?`
			);

			const transaction = db.transaction(() => {
				for (let i = 0; i < groups.length; i++) {
					const group = groups[i];
					const groupId = randomUUID();
					insertGroup.run(groupId, SOLVE_SESSION_ID, group.label, i);
					for (const commentId of group.comment_ids) {
						updateComment.run(groupId, commentId, SOLVE_SESSION_ID);
					}
				}
			});
			transaction();

			return {
				content: [{ type: "text", text: `Created ${groups.length} groups successfully.` }],
			};
		}
	);

	server.tool(
		"start_fix_group",
		"Start working on a specific comment group. Returns full comment details for the group.",
		{
			group_id: z.string().describe("ID of the group to start fixing"),
		},
		async ({ group_id }) => {
			const comments = db
				.prepare(
					`SELECT id, author, body, file_path, line_number, side, thread_id
					 FROM pr_comments WHERE group_id = ? AND solve_session_id = ?`
				)
				.all(group_id, SOLVE_SESSION_ID);

			const group = db
				.prepare(`SELECT label FROM comment_groups WHERE id = ?`)
				.get(group_id);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								groupId: group_id,
								label: group?.label,
								comments: comments.map((c) => ({
									id: c.id,
									author: c.author,
									body: c.body,
									filePath: c.file_path,
									lineNumber: c.line_number,
									side: c.side,
									threadId: c.thread_id,
								})),
							},
							null,
							2
						),
					},
				],
			};
		}
	);

	server.tool(
		"mark_comment_fixed",
		"Mark a comment as addressed after making the code changes",
		{
			comment_id: z.string().describe("ID of the comment that was fixed"),
		},
		async ({ comment_id }) => {
			db.prepare(
				`UPDATE pr_comments SET status = 'fixed' WHERE id = ? AND solve_session_id = ?`
			).run(comment_id, SOLVE_SESSION_ID);

			return {
				content: [{ type: "text", text: `Comment ${comment_id} marked as fixed.` }],
			};
		}
	);

	server.tool(
		"mark_comment_unclear",
		"Flag a comment as unclear and draft a reply asking for clarification. Still make a best-effort fix.",
		{
			comment_id: z.string().describe("ID of the unclear comment"),
			reply_body: z
				.string()
				.describe(
					"Draft reply explaining your interpretation and asking for clarification"
				),
		},
		async ({ comment_id, reply_body }) => {
			const replyId = randomUUID();

			const transaction = db.transaction(() => {
				db.prepare(
					`UPDATE pr_comments SET status = 'unclear' WHERE id = ? AND solve_session_id = ?`
				).run(comment_id, SOLVE_SESSION_ID);

				db.prepare(
					`INSERT INTO comment_replies (id, pr_comment_id, body, status) VALUES (?, ?, ?, 'draft')`
				).run(replyId, comment_id, reply_body);
			});
			transaction();

			return {
				content: [
					{
						type: "text",
						text: `Comment ${comment_id} marked as unclear. Draft reply saved.`,
					},
				],
			};
		}
	);

	server.tool(
		"finish_fix_group",
		"Finish fixing a group: stages all changes and creates a commit. Call this after making all code changes for the group.",
		{
			group_id: z.string().describe("ID of the group to commit"),
		},
		async ({ group_id }) => {
			const { execSync } = await import("node:child_process");
			const session = db
				.prepare(
					`SELECT cs.id FROM comment_solve_sessions cs
					 JOIN comment_groups cg ON cg.solve_session_id = cs.id
					 WHERE cg.id = ?`
				)
				.get(group_id);

			if (!session) {
				return {
					content: [{ type: "text", text: `Error: group ${group_id} not found.` }],
					isError: true,
				};
			}

			const group = db
				.prepare(`SELECT label FROM comment_groups WHERE id = ?`)
				.get(group_id);

			const cwd = WORKTREE_PATH || process.cwd();
			try {
				// Stage all changes
				execSync("git add -A", { cwd, stdio: "pipe" });

				// Unstage MCP config files (no-op if they don't exist)
				const mcpFiles = [".mcp.json", ".gemini/", "opencode.json", ".codex/"];
				for (const f of mcpFiles) {
					try {
						execSync(`git reset HEAD ${f}`, { cwd, stdio: "pipe" });
					} catch {
						// File doesn't exist or isn't staged — that's fine
					}
				}

				// Commit
				const commitMsg = `fix: ${group.label}`;
				execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
					cwd,
					stdio: "pipe",
				});

				// Get commit hash
				const hash = execSync("git rev-parse HEAD", { cwd, stdio: "pipe" })
					.toString()
					.trim();

				// Update group in DB
				db.prepare(
					`UPDATE comment_groups SET status = 'fixed', commit_hash = ? WHERE id = ?`
				).run(hash, group_id);

				return {
					content: [
						{
							type: "text",
							text: `Group committed: ${hash.substring(0, 7)} — ${commitMsg}`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Error committing group: ${err.message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.tool(
		"finish_solving",
		"Mark the solve session as ready for user review. Call this when all groups are done.",
		{},
		async () => {
			db.prepare(
				`UPDATE comment_solve_sessions SET status = 'ready', updated_at = ? WHERE id = ?`
			).run(Math.floor(Date.now() / 1000), SOLVE_SESSION_ID);

			return {
				content: [
					{
						type: "text",
						text: "Solve session marked as ready. The user can now review your changes.",
					},
				],
			};
		}
	);
}
```

- [ ] **Step 3: Wrap existing review tools in a `!isSolverMode` guard**

The existing review tools (`get_pr_metadata`, `add_draft_comment`, `set_review_summary`, `finish_review`, etc.) should only be registered when NOT in solver mode. Wrap them in `if (!isSolverMode) { ... }`.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs
git commit -m "feat: add solver tools to MCP server"
```

---

## Task 4: Solve Prompt & CLI Preset Extension

**Files:**
- Create: `apps/desktop/src/main/ai-review/solve-prompt.ts`
- Modify: `apps/desktop/src/main/ai-review/cli-presets.ts:19-27`

- [ ] **Step 1: Create solve-prompt.ts**

```typescript
// apps/desktop/src/main/ai-review/solve-prompt.ts

export const DEFAULT_SOLVE_GUIDELINES =
	"Fix the review comments by making the requested code changes. Focus on understanding the reviewer's intent and making precise, minimal changes.";

export interface SolvePromptOptions {
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	commentCount: number;
	customPrompt: string | null;
}

export function buildSolvePrompt(opts: SolvePromptOptions): string {
	const guidelines = opts.customPrompt || DEFAULT_SOLVE_GUIDELINES;

	return `PR Context:
- Title: ${opts.prTitle}
- Branch: ${opts.sourceBranch} → ${opts.targetBranch}
- Unresolved comments: ${opts.commentCount}

You are helping the PR author fix review comments. Reviewers have left feedback
that needs to be addressed through code changes.

Guidelines:
${guidelines}

Instructions:
1. Call get_pr_comments to fetch all unresolved comments
2. Analyze comments and group related ones using submit_grouping
   - Group by semantic similarity (comments about the same concern)
   - A file may have comments in different groups
   - You determine the optimal grouping
3. For each group (in order):
   a. Call start_fix_group(groupId) to get the full comment details
   b. Read the relevant files and understand the codebase context
   c. Make code changes that address the comments
   d. For each comment in the group:
      - If you can fix it: call mark_comment_fixed(commentId)
      - If unclear: make a best-effort fix AND call mark_comment_unclear(commentId, replyBody)
        explaining your interpretation and asking for clarification
   e. Call finish_fix_group(groupId) to commit your changes
4. Call finish_solving when all groups are done

IMPORTANT: Do NOT call git add or git commit yourself. The finish_fix_group tool handles committing.
`;
}
```

- [ ] **Step 2: Extend LaunchOptions in cli-presets.ts**

In `apps/desktop/src/main/ai-review/cli-presets.ts`, add `solveSessionId` to the existing `LaunchOptions` interface (line 19-27):

```typescript
export interface LaunchOptions {
	mcpServerPath: string;
	worktreePath: string;
	reviewDir: string;
	promptFilePath: string;
	dbPath: string;
	reviewDraftId: string;
	prMetadata: string;
	solveSessionId?: string; // When set, MCP uses solve mode instead of review mode
}
```

- [ ] **Step 3: Extend CliPreset interface and setupMcp to support solver mode**

Rather than creating a separate `setupSolveMcp` function, extend the existing `LaunchOptions` and each preset's `setupMcp` to accept either review or solve env vars. This avoids reimplementing each preset's config format.

In `cli-presets.ts`, modify `LaunchOptions` to add an optional `solveSessionId` field:

```typescript
export interface LaunchOptions {
	mcpServerPath: string;
	worktreePath: string;
	reviewDir: string;
	promptFilePath: string;
	dbPath: string;
	reviewDraftId: string;
	prMetadata: string;
	solveSessionId?: string; // When set, MCP uses solve mode instead of review mode
}
```

Then modify each preset's `setupMcp` closure to pass the correct env vars based on whether `solveSessionId` is set. For example, in the `claude` preset's `setupMcp` (line ~53-80), change the `env` block:

```typescript
env: opts.solveSessionId
	? {
		SOLVE_SESSION_ID: opts.solveSessionId,
		PR_METADATA: opts.prMetadata,
		DB_PATH: opts.dbPath,
		WORKTREE_PATH: opts.worktreePath,
	  }
	: {
		REVIEW_DRAFT_ID: opts.reviewDraftId,
		PR_METADATA: opts.prMetadata,
		DB_PATH: opts.dbPath,
	  },
```

Apply the same pattern to the `gemini`, `codex`, and `opencode` presets — each one already has its own `setupMcp` that writes the correct config format. Just modify the env vars section in each.

Also add `WORKTREE_PATH` to the env so the MCP server knows the worktree path for git operations (safer than relying on `process.cwd()`).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/solve-prompt.ts \
       apps/desktop/src/main/ai-review/cli-presets.ts
git commit -m "feat: add solve prompt builder and MCP setup for solver mode"
```

---

## Task 5: Solve Orchestrator

**Files:**
- Create: `apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts`

This mirrors `orchestrator.ts` but for solve sessions.

- [ ] **Step 1: Create the orchestrator**

```typescript
// apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { app } from "electron";
import { execSync } from "node:child_process";
import { getDb } from "../db";
import * as schema from "../db/schema";
import {
	CLI_PRESETS,
	type LaunchOptions,
	isCliInstalled,
	resolveCliPath,
} from "./cli-presets";
import { buildSolvePrompt } from "./solve-prompt";
import type { SolveLaunchInfo } from "../../shared/solve-types";

// ─── State machine ────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
	queued: ["in_progress", "failed", "dismissed"],
	in_progress: ["ready", "failed", "dismissed"],
	ready: ["submitted", "failed", "dismissed"],
	submitted: ["dismissed"],
	failed: ["dismissed"],
};

export function validateSolveTransition(current: string, next: string): void {
	const allowed = VALID_TRANSITIONS[current];
	if (!allowed?.includes(next)) {
		throw new Error(`Invalid solve session transition: ${current} → ${next}`);
	}
}

// ─── Queue & Launch ───────────────────────────────────────────────────────────

export async function queueSolve(sessionId: string): Promise<SolveLaunchInfo> {
	const db = getDb();

	// Fetch session
	const session = db
		.select()
		.from(schema.commentSolveSessions)
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.get();

	if (!session) throw new Error(`Solve session ${sessionId} not found`);

	// Fetch workspace + worktree
	const workspace = db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, session.workspaceId))
		.get();

	if (!workspace?.worktreeId) throw new Error("Workspace has no worktree");

	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();

	if (!worktree) throw new Error("Worktree not found");

	// Validate: clean worktree
	try {
		const status = execSync("git status --porcelain", {
			cwd: worktree.path,
			encoding: "utf-8",
		}).trim();
		if (status) {
			throw new Error(
				"Worktree has uncommitted changes. Please commit or stash before solving."
			);
		}
	} catch (err: any) {
		if (err.message.includes("uncommitted")) throw err;
		throw new Error(`Failed to check worktree status: ${err.message}`);
	}

	// Validate: no active sessions for this workspace
	const active = db
		.select()
		.from(schema.commentSolveSessions)
		.where(
			and(
				eq(schema.commentSolveSessions.workspaceId, session.workspaceId),
				inArray(schema.commentSolveSessions.status, ["queued", "in_progress"])
			)
		)
		.all();

	if (active.some((s) => s.id !== sessionId)) {
		throw new Error("Another solve session is already active for this workspace");
	}

	// Get settings
	const settings = db
		.select()
		.from(schema.aiReviewSettings)
		.where(eq(schema.aiReviewSettings.id, "default"))
		.get();

	const presetName = settings?.cliPreset ?? "claude";
	const preset = CLI_PRESETS[presetName];
	if (!preset) throw new Error(`Unknown CLI preset: ${presetName}`);

	// Count comments
	const commentCount = db
		.select()
		.from(schema.prComments)
		.where(
			and(
				eq(schema.prComments.solveSessionId, sessionId),
				eq(schema.prComments.status, "open")
			)
		)
		.all().length;

	// Transition to in_progress
	const now = new Date();
	db.update(schema.commentSolveSessions)
		.set({ status: "in_progress", updatedAt: now })
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.run();

	// Capture commit SHA
	const commitSha = execSync("git rev-parse HEAD", {
		cwd: worktree.path,
		encoding: "utf-8",
	}).trim();

	db.update(schema.commentSolveSessions)
		.set({ commitSha })
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.run();

	// Build prompt
	const promptContent = buildSolvePrompt({
		prTitle: session.prTitle,
		sourceBranch: session.sourceBranch,
		targetBranch: session.targetBranch,
		commentCount,
		customPrompt: settings?.solvePrompt ?? null,
	});

	// Write files
	const solveDir = join(app.getPath("userData"), "solves", sessionId);
	mkdirSync(solveDir, { recursive: true });

	const promptFilePath = join(solveDir, "solve-prompt.txt");
	writeFileSync(promptFilePath, promptContent, "utf-8");

	// Database path for MCP
	const dbPath = join(app.getPath("userData"), "branchflux.db");

	// Setup MCP config — use the preset's own setupMcp with solveSessionId
	// which triggers solve-mode env vars (see cli-presets.ts changes in Task 4)
	const prMetadata = JSON.stringify({
		title: session.prTitle,
		sourceBranch: session.sourceBranch,
		targetBranch: session.targetBranch,
		provider: session.prProvider,
		identifier: session.prIdentifier,
	});

	const launchOpts: LaunchOptions = {
		mcpServerPath: resolve(__dirname, "..", "mcp-standalone", "server.mjs"),
		worktreePath: worktree.path,
		reviewDir: solveDir,
		promptFilePath,
		dbPath,
		reviewDraftId: "", // Not used in solve mode
		prMetadata,
		solveSessionId: sessionId, // This triggers solve-mode env vars
	};

	const cleanup = preset.setupMcp?.(launchOpts) ?? null;

	// Build launch script
	const cliPath = resolveCliPath(preset.command);
	const skipPerms = settings?.skipPermissions ? preset.permissionFlag : "";
	const args = preset.buildArgs(launchOpts);

	const launchScript = join(solveDir, "start-solve.sh");
	const scriptContent = `#!/bin/bash
cd "${worktree.path}"
${cliPath} ${skipPerms ? skipPerms + " " : ""}${args.join(" ")}
`;
	writeFileSync(launchScript, scriptContent, "utf-8");
	chmodSync(launchScript, 0o755);

	return {
		sessionId,
		workspaceId: session.workspaceId,
		worktreePath: worktree.path,
		launchScript,
	};
}

// ─── Revert group ─────────────────────────────────────────────────────────────

export function revertGroup(groupId: string, worktreePath: string): void {
	const db = getDb();

	const group = db
		.select()
		.from(schema.commentGroups)
		.where(eq(schema.commentGroups.id, groupId))
		.get();

	if (!group?.commitHash) throw new Error("Group has no commit to revert");
	if (group.status === "reverted") throw new Error("Group already reverted");

	// Check reverse order: no non-reverted groups with higher order
	const laterGroups = db
		.select()
		.from(schema.commentGroups)
		.where(
			and(
				eq(schema.commentGroups.solveSessionId, group.solveSessionId),
				// order > group.order and status != reverted
			)
		)
		.all()
		.filter((g) => g.order > group.order && g.status !== "reverted");

	if (laterGroups.length > 0) {
		throw new Error("Must revert groups in reverse order. Revert later groups first.");
	}

	// Git revert
	execSync(`git revert ${group.commitHash} --no-edit`, {
		cwd: worktreePath,
		encoding: "utf-8",
	});

	// Update group status
	db.update(schema.commentGroups)
		.set({ status: "reverted" })
		.where(eq(schema.commentGroups.id, groupId))
		.run();

	// Reset associated comments to open
	db.update(schema.prComments)
		.set({ status: "open" })
		.where(eq(schema.prComments.groupId, groupId))
		.run();

	// Delete draft replies for this group's comments
	const groupComments = db
		.select()
		.from(schema.prComments)
		.where(eq(schema.prComments.groupId, groupId))
		.all();

	for (const c of groupComments) {
		db.delete(schema.commentReplies)
			.where(
				and(
					eq(schema.commentReplies.prCommentId, c.id),
					eq(schema.commentReplies.status, "draft")
				)
			)
			.run();
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts
git commit -m "feat: add comment solver orchestrator with state machine and revert logic"
```

---

## Task 6: Solve Publisher (Push + Post Replies)

**Files:**
- Create: `apps/desktop/src/main/ai-review/solve-publisher.ts`

- [ ] **Step 1: Create solve-publisher.ts**

This handles `git push`, posting replies to GitHub/Bitbucket, and resolving threads. Pattern follows existing `review-publisher.ts`.

```typescript
// apps/desktop/src/main/ai-review/solve-publisher.ts
import { execSync } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { addReviewComment, resolveThread } from "../github/github";
import { replyToPRComment as bitbucketReply } from "../atlassian/bitbucket";
// NOTE: addReviewComment takes (threadId, body) — uses the GraphQL mutation
// to reply to an existing review thread. The threadId must be stored in
// prComments.threadId when comments are fetched from the platform.

export interface PublishSolveResult {
	pushed: boolean;
	repliesPosted: number;
	threadsResolved: number;
	errors: string[];
}

export async function publishSolve(sessionId: string): Promise<PublishSolveResult> {
	const db = getDb();
	const errors: string[] = [];

	const session = db
		.select()
		.from(schema.commentSolveSessions)
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.get();

	if (!session) throw new Error("Session not found");

	const workspace = db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, session.workspaceId))
		.get();

	if (!workspace?.worktreeId) throw new Error("Workspace has no worktree");

	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();

	if (!worktree) throw new Error("Worktree not found");

	// 1. Git push
	try {
		execSync("git push", { cwd: worktree.path, encoding: "utf-8", stdio: "pipe" });
	} catch (err: any) {
		throw new Error(`Push failed: ${err.message}`);
	}

	// 2. Post approved replies
	let repliesPosted = 0;
	const replies = db
		.select({
			reply: schema.commentReplies,
			comment: schema.prComments,
		})
		.from(schema.commentReplies)
		.innerJoin(schema.prComments, eq(schema.commentReplies.prCommentId, schema.prComments.id))
		.where(
			and(
				eq(schema.prComments.solveSessionId, sessionId),
				eq(schema.commentReplies.status, "approved")
			)
		)
		.all();

	for (const { reply, comment } of replies) {
		try {
			if (session.prProvider === "github") {
				// Use the thread ID stored when comments were fetched
				if (comment.threadId) {
					await addReviewComment(comment.threadId, reply.body);
				}
			} else if (session.prProvider === "bitbucket") {
				const match = session.prIdentifier.match(/^(.+?)\/(.+?)#(\d+)$/);
				if (match) {
					const [, bbWorkspace, repoSlug, prId] = match;
					await bitbucketReply(
						bbWorkspace!,
						repoSlug!,
						parseInt(prId!, 10),
						parseInt(comment.platformCommentId, 10),
						reply.body
					);
				}
			}

			db.update(schema.commentReplies)
				.set({ status: "posted" })
				.where(eq(schema.commentReplies.id, reply.id))
				.run();

			repliesPosted++;
		} catch (err: any) {
			errors.push(`Failed to post reply for comment ${comment.id}: ${err.message}`);
		}
	}

	// 3. Resolve threads for fixed comments
	let threadsResolved = 0;
	const fixedComments = db
		.select()
		.from(schema.prComments)
		.where(
			and(
				eq(schema.prComments.solveSessionId, sessionId),
				eq(schema.prComments.status, "fixed")
			)
		)
		.all();

	if (session.prProvider === "github") {
		for (const comment of fixedComments) {
			if (comment.threadId) {
				try {
					await resolveThread(comment.threadId);
					threadsResolved++;
				} catch (err: any) {
					errors.push(`Failed to resolve thread ${comment.threadId}: ${err.message}`);
				}
			}
		}
	}
	// Bitbucket thread resolution can be added here if API supports it

	// 4. Update session status
	db.update(schema.commentSolveSessions)
		.set({ status: "submitted", updatedAt: new Date() })
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.run();

	return { pushed: true, repliesPosted, threadsResolved, errors };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/ai-review/solve-publisher.ts
git commit -m "feat: add solve publisher for pushing and posting replies"
```

---

## Task 7: tRPC Comment Solver Router

**Files:**
- Create: `apps/desktop/src/main/trpc/routers/comment-solver.ts`
- Modify: `apps/desktop/src/main/trpc/routers/index.ts`

- [ ] **Step 1: Create the router**

Create `apps/desktop/src/main/trpc/routers/comment-solver.ts` with all procedures from the spec:
- Queries: `getSolveSessions`, `getSolveSession`, `getUnresolvedComments`
- Mutations: `triggerSolve`, `approveGroup`, `revertGroup`, `updateReply`, `deleteReply`, `pushAndPost`, `dismissSolve`

Follow the exact patterns from `ai-review.ts` (imports, z schemas, getDb usage).

The `triggerSolve` mutation:
1. Fetches workspace + PR info
2. Fetches comments from GitHub/Bitbucket API
3. Inserts them into `prComments` table
4. Creates `commentSolveSessions` record
5. Calls `queueSolve()` from orchestrator
6. Returns `SolveLaunchInfo`

The `pushAndPost` mutation:
1. Validates all non-reverted groups are `"approved"`
2. Validates all replies are `"approved"` or deleted
3. Calls `publishSolve()` from solve-publisher
4. Returns result

- [ ] **Step 2: Register in router index**

In `apps/desktop/src/main/trpc/routers/index.ts`, add:

```typescript
import { commentSolverRouter } from "./comment-solver";
```

And add to the router composition:

```typescript
commentSolver: commentSolverRouter,
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/comment-solver.ts \
       apps/desktop/src/main/trpc/routers/index.ts
git commit -m "feat: add comment solver tRPC router"
```

---

## Task 8: Comment Poller

**Files:**
- Create: `apps/desktop/src/main/ai-review/comment-poller.ts`

- [ ] **Step 1: Create the comment poller**

Follow the pattern of `commit-poller.ts` and `pr-poller.ts`. The poller:
1. Runs every 60 seconds
2. Queries workspaces with `type="worktree"` and `prProvider`/`prIdentifier` set
3. Fetches comments from GitHub/Bitbucket API for each
4. Compares against known `platformCommentId` values across all sessions
5. If new comments detected: emits event (manual mode) or auto-queues solve (auto mode)

Export `startCommentPoller()` and `stopCommentPoller()` functions.

- [ ] **Step 2: Wire into app startup**

The comment poller should be started alongside the existing pollers in the main process initialization. Check where `startPRPoller` / `startCommitPoller` are called and add `startCommentPoller` alongside them.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/ai-review/comment-poller.ts
git commit -m "feat: add comment poller for watching authored PRs"
```

---

## Task 9: Checkout Existing Branch — Backend

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts`

- [ ] **Step 1: Add checkoutExisting mutation**

Add a new mutation to the workspaces router that:
1. Takes `projectId` and `branch` (existing remote branch name)
2. Calls `checkoutBranchWorktree()` from `operations.ts`
3. Creates worktree + workspace records
4. Auto-detects authored PR (checks PR poller cache for matching branch)
5. If PR found: sets `prProvider`/`prIdentifier` on workspace
6. Returns the workspace

- [ ] **Step 2: Add PR auto-detection to existing create mutation**

In the existing `create` mutation, after workspace creation, add PR auto-detection logic:
- Check PR poller cache for PRs where user is author and branch matches
- If found, update workspace with `prProvider`/`prIdentifier`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/workspaces.ts
git commit -m "feat: add checkout existing branch and auto-detect authored PRs"
```

---

## Task 10: Checkout Existing Branch — Frontend

**Files:**
- Modify: `apps/desktop/src/renderer/components/CreateWorktreeModal.tsx`

- [ ] **Step 1: Add mode toggle**

Add state for mode: `"new" | "existing"`. Add a segmented control / toggle at the top of the modal switching between "New branch" and "Existing branch".

- [ ] **Step 2: Add existing branch mode UI**

When mode is "existing":
- Show a searchable dropdown of remote branches (from `trpc.branches.list` or a new query that lists remote branches not yet checked out)
- Remove the branch name text input
- Remove the base branch picker
- Submit calls `trpc.workspaces.checkoutExisting` instead of `trpc.workspaces.create`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/CreateWorktreeModal.tsx
git commit -m "feat: add existing branch checkout to CreateWorktreeModal"
```

---

## Task 11: PR Tab Filtering

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx`

- [ ] **Step 1: Filter out authored PRs**

In `PullRequestsTab.tsx`, filter the PR lists to exclude PRs where the current user is the author:
- For GitHub PRs: compare against `githubAuth.accountId` or the authenticated user's login
- For Bitbucket PRs: the `getMyPullRequests()` query returns authored PRs — remove this call or filter its results out
- Keep only `getReviewRequests()` results for Bitbucket

The existing code likely fetches both authored and review PRs and combines them. Modify to only show review PRs.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat: filter authored PRs from PR tab"
```

---

## Task 12: Tab Store — Comment Solve Panel Mode

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`

- [ ] **Step 1: Add "comment-solve" panel mode**

In `panelForWorkspace()` function, add detection for comment-solve mode:
- If workspace has `prProvider`/`prIdentifier` set AND `type !== "review"`, and there's an active/ready solve session → return `"comment-solve"` panel mode

Add the panel mode to whatever type union defines the right panel states.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts
git commit -m "feat: add comment-solve panel mode to tab store"
```

---

## Task 13: CommentSolvePanel Component

**Files:**
- Create: `apps/desktop/src/renderer/components/CommentSolvePanel.tsx`
- Create: `apps/desktop/src/renderer/components/CommentGroupItem.tsx`
- Create: `apps/desktop/src/renderer/components/CommentGroupDetail.tsx`
- Create: `apps/desktop/src/renderer/components/SolveActionBar.tsx`

Use @frontend-design skill for these components.

- [ ] **Step 1: Create CommentGroupItem**

Simple row component showing: group label, status badge (fixed/unclear/reverted), comment count, commit hash. Click handler selects the group.

- [ ] **Step 2: Create CommentGroupDetail**

Detail view for a selected group:
- Reuse diff renderer from `PRReviewFileTab` to show the group's diff (via `git diff <commitHash>~1 <commitHash>`)
- Display original reviewer comments with file/line context
- For unclear groups: inline textarea for editing draft reply, with approve/delete buttons
- Revert button (disabled if later groups exist and aren't reverted)

- [ ] **Step 3: Create SolveActionBar**

Bottom bar with:
- Status summary: "X groups fixed, Y unclear, Z reverted"
- "Push Changes & Post Replies" button (disabled until all non-reverted groups approved and all replies approved/deleted)

- [ ] **Step 4: Create CommentSolvePanel**

Main container that composes the above:
- Header with PR title, comment count, session status
- Left sidebar: list of `CommentGroupItem`s
- Right content: `CommentGroupDetail` for selected group
- Bottom: `SolveActionBar`
- Fetches data via `trpc.commentSolver.getSolveSession`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentSolvePanel.tsx \
       apps/desktop/src/renderer/components/CommentGroupItem.tsx \
       apps/desktop/src/renderer/components/CommentGroupDetail.tsx \
       apps/desktop/src/renderer/components/SolveActionBar.tsx
git commit -m "feat: add CommentSolvePanel with group list, detail view, and action bar"
```

---

## Task 14: Wire CommentSolvePanel into DiffPanel (Right Panel Router)

**Files:**
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx:300-306`

The right panel is rendered by `DiffPanel.tsx` inside `App.tsx` (line ~367). `DiffPanel` already routes `mode === "pr-review"` to `PRControlRail` at line ~300-306.

- [ ] **Step 1: Add comment-solve mode routing**

In `DiffPanel.tsx`, around line 300 where it checks `rightPanel.mode === "pr-review"` and renders `<PRControlRail>`, add an additional case:

```typescript
if (rightPanel.mode === "comment-solve") {
	return <CommentSolvePanel workspaceId={activeWorkspaceId} />;
}
```

Import `CommentSolvePanel` at the top of the file.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/DiffPanel.tsx
git commit -m "feat: wire CommentSolvePanel into right panel routing"
```

---

## Task 15: Workspace Badge

**Files:**
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx`

- [ ] **Step 1: Add notification badge**

Query `trpc.commentSolver.getSolveSessions` for the workspace. Show a small badge/dot on the workspace item when:
- There are unresolved comments (new comments detected by poller)
- A solve session has reached "ready" status

Style the badge similarly to `AIReviewBadge` used in the PR tab.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat: add comment notification badge to workspace items"
```

---

## Task 16: Settings Extension

**Files:**
- Modify: `apps/desktop/src/renderer/components/SettingsView.tsx`

- [ ] **Step 1: Add auto-solve toggle and solve prompt editor**

In the AI settings section of `SettingsView.tsx`, add:
- Toggle for `autoSolveEnabled` (label: "Auto-solve PR comments")
- Text area for `solvePrompt` (label: "Custom solve instructions", placeholder with default guidelines)

Follow the same pattern as the existing `autoReviewEnabled` toggle and `customPrompt` editor.

Wire to `trpc.aiReview.updateSettings` (which already handles the `aiReviewSettings` table — the new columns will be included automatically since Drizzle infers them from the schema).

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/SettingsView.tsx
git commit -m "feat: add auto-solve settings to AI settings panel"
```

---

## Task 17: Integration Test — Full Solve Flow

**Files:**
- Create: `apps/desktop/tests/comment-solver.test.ts`

- [ ] **Step 1: Write integration test**

Test the core solve flow end-to-end (database level, no actual CLI):
1. Create test project, workspace, worktree records
2. Set workspace `prProvider`/`prIdentifier`
3. Insert a solve session with test comments
4. Verify MCP tool behavior:
   - `get_pr_comments` returns correct data
   - `submit_grouping` creates groups and links comments
   - `mark_comment_fixed` updates status
   - `mark_comment_unclear` creates reply
   - `finish_fix_group` would commit (mock git operations)
   - `finish_solving` sets session to ready
5. Test revert ordering enforcement
6. Test push validation (all groups approved, all replies approved)

- [ ] **Step 2: Run tests**

Run: `cd apps/desktop && bun test tests/comment-solver.test.ts`

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tests/comment-solver.test.ts
git commit -m "test: add integration tests for comment solver flow"
```

---

## Task 18: Type Check & Lint

- [ ] **Step 1: Run type check**

Run: `cd apps/desktop && bun run type-check`

Fix any TypeScript errors.

- [ ] **Step 2: Run lint and format**

Run: `cd apps/desktop && bun run check`

Fix any Biome issues.

- [ ] **Step 3: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve type and lint issues"
```
