# Author-Side PR Comment Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable AI agents to automatically resolve review comments on the user's own PRs by making code changes, with commit-group-centric undo and platform reply support.

**Architecture:** The feature runs in the user's existing branch workspace (repo section). An AI agent reads review comments from GitHub/Bitbucket, makes file changes grouped into commits, and the user reviews/reverts/pushes from a new right-panel mode. The MCP standalone server is extended with resolution-specific tools.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), tRPC, React 19, Zustand, MCP (Model Context Protocol), GitHub GraphQL + REST API, Bitbucket REST API

**Spec:** `docs/superpowers/specs/2026-03-22-author-comment-resolution-design.md`

---

## File Structure

### New Files
- `apps/desktop/src/main/db/schema-resolution.ts` — Drizzle schema for resolution tables
- `apps/desktop/src/main/ai-review/resolution-orchestrator.ts` — Resolution session lifecycle, prompt building, agent launch
- `apps/desktop/src/main/ai-review/resolution-publisher.ts` — Platform reply posting on push
- `apps/desktop/src/main/trpc/routers/resolution.ts` — tRPC router for resolution operations
- `apps/desktop/src/renderer/components/PRCommentsRail.tsx` — Right panel for author-side comment resolution
- `apps/desktop/src/shared/resolution-types.ts` — Shared types for resolution feature
- `apps/desktop/tests/resolution-orchestrator.test.ts` — Tests for orchestrator
- `apps/desktop/tests/resolution-publisher.test.ts` — Tests for publisher

### Modified Files
- `apps/desktop/src/main/db/schema.ts` — Re-export resolution tables
- `apps/desktop/src/shared/review-types.ts` — Add `role` field to `CachedPR`
- `apps/desktop/src/main/ai-review/pr-poller.ts` — Preserve role, auto-link workspaces, track comment count changes, Bitbucket comment count
- `apps/desktop/src/main/atlassian/bitbucket.ts` — Add `getBitbucketPRComments()`
- `apps/desktop/src/main/db/schema-ai-review.ts` — Add settings columns
- `apps/desktop/mcp-standalone/server.mjs` — Add 4 resolution MCP tools
- `apps/desktop/src/main/trpc/routers/index.ts` — Register resolution router
- `apps/desktop/src/main/index.ts` — Initialize resolution cleanup on startup
- `apps/desktop/src/renderer/stores/tab-store.ts` — Add `"pr-comments"` panel mode
- `apps/desktop/src/renderer/components/DiffPanel.tsx` — Route to PRCommentsRail
- `apps/desktop/src/renderer/components/Sidebar.tsx` — Author PR comment badges
- `apps/desktop/src/main/ai-review/cli-presets.ts` — Add `buildResolutionPrompt()`

---

## Task 1: Prerequisites — CachedPR Role & Bitbucket Comments

**Files:**
- Modify: `apps/desktop/src/shared/review-types.ts:1-20`
- Modify: `apps/desktop/src/main/ai-review/pr-poller.ts:65-167`
- Modify: `apps/desktop/src/main/atlassian/bitbucket.ts:139-196`
- Test: `apps/desktop/tests/pr-poller.test.ts`

### Add `role` to CachedPR

- [ ] **Step 1: Add `role` field to `CachedPR` type**

In `apps/desktop/src/shared/review-types.ts`, add to the `CachedPR` interface:

```typescript
role: "author" | "reviewer";
```

- [ ] **Step 2: Preserve role in `mapGitHubPR`**

In `apps/desktop/src/main/ai-review/pr-poller.ts`, the `mapGitHubPR` function (line ~65) receives a GitHub PR object that already has a `role` field. Map it through:

```typescript
function mapGitHubPR(
	pr: Awaited<ReturnType<typeof getMyPRs>>[number],
): CachedPR {
	return {
		// ... existing fields ...
		role: pr.role, // Already present on GitHubPR type
	};
}
```

No call site changes needed — `pr.role` is already on the input object.

- [ ] **Step 3: Add role to `mapBitbucketPR`**

In `mapBitbucketPR` (~line 93), add a `role` parameter:

```typescript
function mapBitbucketPR(
	pr: Awaited<ReturnType<typeof getMyPullRequests>>[number],
	role: "author" | "reviewer",
): CachedPR {
	return {
		// ... existing fields ...
		role,
	};
}
```

Update call sites in `fetchAllPRs`: `getMyPullRequests()` results get `"author"`, `getReviewRequests()` results get `"reviewer"`.

- [ ] **Step 4: Run type-check to verify no breakage**

Run: `bun run type-check`
Expected: PASS (CachedPR consumers should handle the new optional-looking field)

### Add `getBitbucketPRComments`

- [ ] **Step 5: Add `getBitbucketPRComments` to `bitbucket.ts`**

In `apps/desktop/src/main/atlassian/bitbucket.ts`, add after `replyToPRComment`:

```typescript
export async function getBitbucketPRComments(
	workspace: string,
	repoSlug: string,
	prId: number,
): Promise<
	Array<{
		id: number;
		author: string;
		body: string;
		filePath: string | null;
		lineNumber: number | null;
		createdAt: string;
		parentId: number | null;
	}>
> {
	const auth = getAuth("bitbucket");
	if (!auth) throw new Error("Bitbucket not authenticated");

	const resp = await atlassianFetch(
		"bitbucket",
		`https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments?pagelen=100`,
	);
	if (!resp.ok) throw new Error(`Bitbucket comments fetch failed: ${resp.status}`);
	const data = await resp.json();

	return (data.values ?? []).map((c: any) => ({
		id: c.id,
		author: c.user?.display_name ?? c.user?.nickname ?? "unknown",
		body: c.content?.raw ?? "",
		filePath: c.inline?.path ?? null,
		lineNumber: c.inline?.to ?? c.inline?.from ?? null,
		createdAt: c.created_on ?? "",
		parentId: c.parent?.id ?? null,
	}));
}
```

**Note:** Uses `getAuth("bitbucket")` and `atlassianFetch("bitbucket", url)` — matching the existing patterns in `bitbucket.ts`.

- [ ] **Step 6: Fix Bitbucket `commentCount` in PR poller**

In `apps/desktop/src/main/ai-review/pr-poller.ts`, the `mapBitbucketPR` function (~line 113) hardcodes `commentCount: 0`. The Bitbucket PR API response includes `comment_count` but the `BitbucketPullRequest` type doesn't expose it yet.

First, in `apps/desktop/src/main/atlassian/bitbucket.ts`, add `commentCount` to the `BitbucketPullRequest` interface and map `comment_count` from the raw API response in the `mapPR` helper.

Then in `mapBitbucketPR` in the poller:

```typescript
commentCount: pr.commentCount ?? 0,
```

- [ ] **Step 7: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/review-types.ts apps/desktop/src/main/ai-review/pr-poller.ts apps/desktop/src/main/atlassian/bitbucket.ts
git commit -m "feat: add CachedPR role tracking and Bitbucket comment fetching"
```

---

## Task 2: PR Poller — Auto-Link Workspaces & Comment Notifications

**Files:**
- Modify: `apps/desktop/src/main/ai-review/pr-poller.ts`
- Modify: `apps/desktop/src/main/index.ts:61-97`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Add workspace auto-linking to PR poller**

In `apps/desktop/src/main/ai-review/pr-poller.ts`, add the following imports at the top of the file:

```typescript
import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
```

After the cache update logic in the polling function, add workspace linking. When a new author PR is detected:

```typescript
const db = getDb();
// After updating prCache, check for workspace linking
for (const pr of fetchedPRs) {
	if (pr.role !== "author" || !pr.projectId) continue;

	// Find workspace with matching branch in this project
	const workspace = db
		.select()
		.from(schema.workspaces)
		.where(
			and(
				eq(schema.workspaces.projectId, pr.projectId),
				eq(schema.workspaces.type, "branch"),
				isNull(schema.workspaces.prProvider),
			),
		)
		.all()
		.find((ws) => {
			// Match workspace branch to PR source branch
			const worktree = ws.worktreeId
				? db.select().from(schema.worktrees).where(eq(schema.worktrees.id, ws.worktreeId)).get()
				: null;
			return worktree?.branch === pr.sourceBranch || ws.name === pr.sourceBranch;
		});

	if (workspace) {
		db.update(schema.workspaces)
			.set({
				prProvider: pr.provider,
				prIdentifier: pr.identifier,
			})
			.where(eq(schema.workspaces.id, workspace.id))
			.run();
	}
}
```

- [ ] **Step 2: Add comment count change tracking**

Add a `previousCommentCounts: Map<string, number>` alongside the existing `prCache`. During each poll cycle, compare current `commentCount` with previous for author PRs:

```typescript
const previousCommentCounts = new Map<string, number>();

// Inside poll loop, after fetching:
for (const pr of fetchedPRs) {
	if (pr.role !== "author") continue;
	const prevCount = previousCommentCounts.get(pr.identifier) ?? 0;
	if (pr.commentCount > prevCount && prevCount > 0) {
		onNewReviewCommentsHandler?.(pr.identifier, pr.commentCount - prevCount);
	}
	previousCommentCounts.set(pr.identifier, pr.commentCount);
}
```

- [ ] **Step 3: Export the `onNewReviewComments` handler registration**

```typescript
let onNewReviewCommentsHandler: ((prIdentifier: string, newCount: number) => void) | null = null;

export function onNewReviewComments(
	handler: (prIdentifier: string, newCount: number) => void,
): void {
	onNewReviewCommentsHandler = handler;
}
```

- [ ] **Step 4: Wire up IPC notification in `index.ts`**

In `apps/desktop/src/main/index.ts`, alongside the existing `onNewPRDetected` handler (~line 83), add:

```typescript
import { onNewReviewComments } from "./ai-review/pr-poller";

onNewReviewComments((prIdentifier, newCount) => {
	mainWindow?.webContents.send("new-review-comments", { prIdentifier, newCount });
});
```

- [ ] **Step 5: Expose IPC channel in preload**

In `apps/desktop/src/preload/index.ts`, add a listener for the new event under an appropriate namespace:

```typescript
onNewReviewComments: (callback: (data: { prIdentifier: string; newCount: number }) => void) => {
	ipcRenderer.on("new-review-comments", (_event, data) => callback(data));
},
```

- [ ] **Step 6: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/ai-review/pr-poller.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts
git commit -m "feat: auto-link workspaces to author PRs and notify on new review comments"
```

---

## Task 3: Database Schema — Resolution Tables

**Files:**
- Create: `apps/desktop/src/main/db/schema-resolution.ts`
- Modify: `apps/desktop/src/main/db/schema.ts`
- Modify: `apps/desktop/src/main/db/schema-ai-review.ts:4-15`
- Create: migration via `bun run db:generate`

- [ ] **Step 1: Create resolution schema file**

Create `apps/desktop/src/main/db/schema-resolution.ts`.

**Important:** Use `integer` timestamps with `{ mode: "timestamp" }` to match the existing schema pattern used across `schema.ts` and `schema-ai-review.ts`. Do NOT use text-based timestamps.

```typescript
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { workspaces } from "./schema";

export const resolutionSessions = sqliteTable("resolution_sessions", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id),
	prProvider: text("pr_provider").notNull(),
	prIdentifier: text("pr_identifier").notNull(),
	commitShaBefore: text("commit_sha_before").notNull(),
	status: text("status").notNull().default("running"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const resolutionGroups = sqliteTable("resolution_groups", {
	id: text("id").primaryKey(),
	sessionId: text("session_id")
		.notNull()
		.references(() => resolutionSessions.id),
	commitSha: text("commit_sha").notNull(),
	commitMessage: text("commit_message").notNull(),
	status: text("status").notNull().default("applied"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const resolutionComments = sqliteTable("resolution_comments", {
	id: text("id").primaryKey(),
	groupId: text("group_id").references(() => resolutionGroups.id),
	sessionId: text("session_id")
		.notNull()
		.references(() => resolutionSessions.id),
	platformCommentId: text("platform_comment_id").notNull(),
	platformThreadId: text("platform_thread_id"),
	filePath: text("file_path"),
	lineNumber: integer("line_number"),
	author: text("author").notNull(),
	body: text("body").notNull(),
	status: text("status").notNull().default("pending"),
	skipReason: text("skip_reason"),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

All inserts must provide `new Date()` for timestamp fields — no SQL defaults.

- [ ] **Step 2: Re-export from schema.ts**

In `apps/desktop/src/main/db/schema.ts`, add at the bottom:

```typescript
export { resolutionSessions, resolutionGroups, resolutionComments } from "./schema-resolution";
```

- [ ] **Step 3: Add settings columns to `aiReviewSettings`**

In `apps/desktop/src/main/db/schema-ai-review.ts`, add to the `aiReviewSettings` table definition:

```typescript
autoResolveThreads: integer("auto_resolve_threads", { mode: "boolean" }).default(false),
postReplyOnPush: integer("post_reply_on_push", { mode: "boolean" }).default(true),
```

- [ ] **Step 4: Generate migration**

Run: `cd apps/desktop && bun run db:generate`
Expected: New migration file created in `src/main/db/migrations/`

- [ ] **Step 5: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/db/schema-resolution.ts apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/schema-ai-review.ts apps/desktop/src/main/db/migrations/
git commit -m "feat: add resolution tables and settings columns for author-side comment resolution"
```

---

## Task 4: Shared Types

**Files:**
- Create: `apps/desktop/src/shared/resolution-types.ts`

- [ ] **Step 1: Create shared resolution types**

Create `apps/desktop/src/shared/resolution-types.ts`:

```typescript
export interface ResolutionSession {
	id: string;
	workspaceId: string;
	prProvider: "github" | "bitbucket";
	prIdentifier: string;
	commitShaBefore: string;
	status: "running" | "done" | "failed";
	createdAt: string;
	updatedAt: string;
	groups: ResolutionGroup[];
	comments: ResolutionComment[];
}

export interface ResolutionGroup {
	id: string;
	sessionId: string;
	commitSha: string;
	commitMessage: string;
	status: "applied" | "reverted";
	createdAt: string;
	comments: ResolutionComment[];
}

export interface ResolutionComment {
	id: string;
	groupId: string | null;
	sessionId: string;
	platformCommentId: string;
	platformThreadId: string | null;
	filePath: string | null;
	lineNumber: number | null;
	author: string;
	body: string;
	status: "resolved" | "skipped" | "pending";
	skipReason: string | null;
}

export interface ReviewCommentFromPlatform {
	platformCommentId: string;
	platformThreadId: string | null;
	author: string;
	body: string;
	filePath: string | null;
	lineNumber: number | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/shared/resolution-types.ts
git commit -m "feat: add shared types for resolution feature"
```

---

## Task 5: Resolution Orchestrator — Session Lifecycle & Prompt Building

**Files:**
- Create: `apps/desktop/src/main/ai-review/resolution-orchestrator.ts`
- Modify: `apps/desktop/src/main/ai-review/cli-presets.ts`
- Test: `apps/desktop/tests/resolution-orchestrator.test.ts`

- [ ] **Step 1: Write test for `buildResolutionPrompt`**

Create `apps/desktop/tests/resolution-orchestrator.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildResolutionPrompt } from "../src/main/ai-review/resolution-orchestrator";

describe("buildResolutionPrompt", () => {
	test("includes all comments in the prompt", () => {
		const prompt = buildResolutionPrompt({
			prNumber: 42,
			prTitle: "Add auth middleware",
			sourceBranch: "feat/auth",
			targetBranch: "main",
			comments: [
				{
					id: "c1",
					author: "reviewer1",
					filePath: "auth.ts",
					lineNumber: 10,
					body: "Add null check",
				},
				{
					id: "c2",
					author: "reviewer2",
					filePath: null,
					lineNumber: null,
					body: "Consider rate limiting",
				},
			],
		});

		expect(prompt).toContain("PR #42");
		expect(prompt).toContain("Add auth middleware");
		expect(prompt).toContain("reviewer1 on auth.ts:10");
		expect(prompt).toContain("Add null check");
		expect(prompt).toContain("reviewer2 (general)");
		expect(prompt).toContain("resolve_and_commit");
		expect(prompt).toContain("skip_comment");
		expect(prompt).toContain("finish_resolution");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/resolution-orchestrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `resolution-orchestrator.ts`**

Create `apps/desktop/src/main/ai-review/resolution-orchestrator.ts`:

**Important:** Use `getDb()` (not `db`) for database access — matching the codebase pattern. Filter out resolved GitHub threads. Provide `new Date()` for all timestamp inserts.

```typescript
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getSettings } from "./orchestrator";
import { getPRDetails } from "../github/github";
import { getBitbucketPRComments } from "../atlassian/bitbucket";
import type { ReviewCommentFromPlatform } from "../../shared/resolution-types";

export interface ResolutionPromptMetadata {
	prNumber: number;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	comments: Array<{
		id: string;
		author: string;
		filePath: string | null;
		lineNumber: number | null;
		body: string;
	}>;
}

export function buildResolutionPrompt(metadata: ResolutionPromptMetadata): string {
	const lines: string[] = [
		`You are resolving review comments on PR #${metadata.prNumber}: "${metadata.prTitle}"`,
		`Branch: ${metadata.sourceBranch} → ${metadata.targetBranch}`,
		"",
		"## Review comments to resolve:",
	];

	metadata.comments.forEach((c, i) => {
		const location = c.filePath
			? `${c.author} on ${c.filePath}${c.lineNumber ? `:${c.lineNumber}` : ""}`
			: `${c.author} (general)`;
		lines.push(`${i + 1}. [${c.id}] ${location}`);
		lines.push(`   "${c.body}"`);
		lines.push("");
	});

	lines.push("## Instructions:");
	lines.push("- Read the code and understand each comment in context");
	lines.push("- Make the requested code changes");
	lines.push(
		"- Group related comments into a single commit (e.g., similar fixes across a file)",
	);
	lines.push(
		"- Call resolve_and_commit() after each logical group with the comment IDs and a clear commit message",
	);
	lines.push(
		"- Call skip_comment() for discussion questions, opinions, or comments that don't require code changes — include a brief reason",
	);
	lines.push(
		"- Only modify files directly related to the comments you are resolving — do not touch unrelated files",
	);
	lines.push(
		"- Write commit messages that describe what was fixed, not which comment asked for it",
	);
	lines.push("- Call finish_resolution() when all comments have been resolved or skipped");
	lines.push(
		"- Do NOT reply to comments on the platform — that happens after the user reviews and pushes",
	);

	return lines.join("\n");
}

export async function fetchReviewComments(
	provider: "github" | "bitbucket",
	prIdentifier: string,
): Promise<ReviewCommentFromPlatform[]> {
	if (provider === "github") {
		const [ownerRepo, numStr] = prIdentifier.split("#");
		const [owner, repo] = ownerRepo!.split("/");
		const prNumber = parseInt(numStr!, 10);
		const details = await getPRDetails(owner!, repo!, prNumber);

		// Build rename map from PR files (same pattern as review-publisher.ts buildPathMaps)
		const renameMap = new Map<string, string>();
		for (const file of details.files ?? []) {
			if (file.status === "renamed" && file.previousFilename) {
				renameMap.set(file.previousFilename, file.filename);
			}
		}

		// IMPORTANT: Only include unresolved threads — resolved ones are already handled
		return details.reviewThreads
			.filter((thread) => !thread.isResolved)
			.flatMap((thread) => {
				// Remap file path if the file was renamed
				const filePath = thread.path
					? renameMap.get(thread.path) ?? thread.path
					: thread.path;

				return thread.comments
					.filter((_, idx) => idx === 0) // Only first comment in thread
					.map((comment) => ({
						platformCommentId: comment.id,
						platformThreadId: thread.id,
						author: comment.author,
						body: comment.body,
						filePath,
						lineNumber: thread.line,
					}));
			});
	} else {
		const [ownerRepo, numStr] = prIdentifier.split("#");
		const [workspace, repoSlug] = ownerRepo!.split("/");
		const prId = parseInt(numStr!, 10);
		const comments = await getBitbucketPRComments(workspace!, repoSlug!, prId);

		// Filter to top-level comments only (not replies)
		return comments
			.filter((c) => c.parentId === null)
			.map((c) => ({
				platformCommentId: String(c.id),
				platformThreadId: null,
				author: c.author,
				body: c.body,
				filePath: c.filePath,
				lineNumber: c.lineNumber,
			}));
	}
}

export async function startResolutionSession(params: {
	workspaceId: string;
	prProvider: "github" | "bitbucket";
	prIdentifier: string;
	prNumber: number;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	worktreePath: string;
}): Promise<{
	sessionId: string;
	launchScript: string;
	promptPath: string;
}> {
	const db = getDb();

	// Check for running session
	const running = db
		.select()
		.from(schema.resolutionSessions)
		.where(
			and(
				eq(schema.resolutionSessions.workspaceId, params.workspaceId),
				eq(schema.resolutionSessions.status, "running"),
			),
		)
		.get();

	if (running) {
		throw new Error("A resolution session is already running.");
	}

	// Get current HEAD
	const commitShaBefore = execSync("git rev-parse HEAD", {
		cwd: params.worktreePath,
		encoding: "utf-8",
	}).trim();

	// Fetch review comments from platform
	const platformComments = await fetchReviewComments(params.prProvider, params.prIdentifier);

	// Create session
	const sessionId = randomUUID();
	const now = new Date();
	db.insert(schema.resolutionSessions)
		.values({
			id: sessionId,
			workspaceId: params.workspaceId,
			prProvider: params.prProvider,
			prIdentifier: params.prIdentifier,
			commitShaBefore,
			status: "running",
			createdAt: now,
			updatedAt: now,
		})
		.run();

	// Insert comments as pending
	for (const c of platformComments) {
		db.insert(schema.resolutionComments)
			.values({
				id: randomUUID(),
				sessionId,
				platformCommentId: c.platformCommentId,
				platformThreadId: c.platformThreadId,
				filePath: c.filePath,
				lineNumber: c.lineNumber,
				author: c.author,
				body: c.body,
				status: "pending",
				updatedAt: now,
			})
			.run();
	}

	// Build prompt
	const commentRows = db
		.select()
		.from(schema.resolutionComments)
		.where(eq(schema.resolutionComments.sessionId, sessionId))
		.all();

	const prompt = buildResolutionPrompt({
		prNumber: params.prNumber,
		prTitle: params.prTitle,
		sourceBranch: params.sourceBranch,
		targetBranch: params.targetBranch,
		comments: commentRows.map((c) => ({
			id: c.id,
			author: c.author,
			filePath: c.filePath,
			lineNumber: c.lineNumber,
			body: c.body,
		})),
	});

	// Write prompt file
	const reviewDir = path.join(params.worktreePath, ".ai-resolution");
	execSync(`mkdir -p "${reviewDir}"`, { encoding: "utf-8" });
	const promptPath = path.join(reviewDir, "resolution-prompt.txt");
	writeFileSync(promptPath, prompt, "utf-8");

	// Build launch script (reuses CLI presets pattern from orchestrator)
	const settings = getSettings();
	const dbPath = db.$client.name; // SQLite database file path
	const mcpServerPath = path.join(__dirname, "../../mcp-standalone/server.mjs");

	const prMetadata = JSON.stringify({
		provider: params.prProvider,
		identifier: params.prIdentifier,
		number: params.prNumber,
		title: params.prTitle,
		sourceBranch: params.sourceBranch,
		targetBranch: params.targetBranch,
	});

	const launchScript = [
		`cd "${params.worktreePath}"`,
		`export RESOLUTION_SESSION_ID="${sessionId}"`,
		`export PR_METADATA='${prMetadata}'`,
		`export DB_PATH="${dbPath}"`,
		`cat "${promptPath}"`,
	].join(" && ");

	return { sessionId, launchScript, promptPath };
}

export function markSessionFailed(sessionId: string): void {
	const db = getDb();
	db.update(schema.resolutionSessions)
		.set({ status: "failed", updatedAt: new Date() })
		.where(eq(schema.resolutionSessions.id, sessionId))
		.run();
}

export function cleanupStaleResolutionSessions(): void {
	const db = getDb();
	db.update(schema.resolutionSessions)
		.set({ status: "failed", updatedAt: new Date() })
		.where(eq(schema.resolutionSessions.status, "running"))
		.run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/resolution-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Add `buildResolutionMcpInstructions` to `cli-presets.ts`**

In `apps/desktop/src/main/ai-review/cli-presets.ts`, add a new function for resolution MCP instructions:

```typescript
export function buildResolutionMcpInstructions(): string {
	return [
		"## MCP Tools Available:",
		"- get_review_comments() — returns all review comments to resolve",
		"- resolve_and_commit(comment_ids, message) — stage changed files, commit, and record resolution",
		"- skip_comment(comment_id, reason) — mark a comment as skipped",
		"- finish_resolution() — signal you are done resolving comments",
		"",
		"You MUST call finish_resolution() when you are done.",
	].join("\n");
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ai-review/resolution-orchestrator.ts apps/desktop/src/main/ai-review/cli-presets.ts apps/desktop/tests/resolution-orchestrator.test.ts
git commit -m "feat: add resolution orchestrator with session lifecycle and prompt building"
```

---

## Task 6: MCP Server — Resolution Tools

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs`

- [ ] **Step 1: Add `get_review_comments` tool**

In `apps/desktop/mcp-standalone/server.mjs`, add a new tool after the existing tools. Use the `RESOLUTION_SESSION_ID` env var to scope queries:

```javascript
server.tool("get_review_comments", "Get all review comments to resolve", {}, async () => {
	const sessionId = process.env.RESOLUTION_SESSION_ID;
	if (!sessionId) return { content: [{ type: "text", text: JSON.stringify({ error: "No resolution session" }) }] };

	const comments = db
		.prepare(
			`SELECT id, platform_comment_id, author, file_path, line_number, body, status
			 FROM resolution_comments WHERE session_id = ? AND status = 'pending'`,
		)
		.all(sessionId);

	return {
		content: [{
			type: "text",
			text: JSON.stringify(
				comments.map((c) => ({
					id: c.id,
					author: c.author,
					filePath: c.file_path,
					lineNumber: c.line_number,
					body: c.body,
				})),
			),
		}],
	};
});
```

- [ ] **Step 2: Add `resolve_and_commit` tool**

```javascript
server.tool(
	"resolve_and_commit",
	"Stage changed files, commit, and record which comments are resolved",
	{
		comment_ids: z.array(z.string()).describe("IDs of comments resolved by this commit"),
		message: z.string().describe("Commit message"),
	},
	async ({ comment_ids, message }) => {
		const sessionId = process.env.RESOLUTION_SESSION_ID;
		if (!sessionId) return { content: [{ type: "text", text: JSON.stringify({ error: "No resolution session" }) }] };

		const { execSync } = await import("node:child_process");
		const { randomUUID } = await import("node:crypto");

		// Detect modified files
		const diffOutput = execSync("git diff --name-only", { encoding: "utf-8" }).trim();
		const stagedOutput = execSync("git diff --cached --name-only", { encoding: "utf-8" }).trim();
		const files = [...new Set([...diffOutput.split("\n"), ...stagedOutput.split("\n")].filter(Boolean))];

		if (files.length === 0) {
			return { content: [{ type: "text", text: JSON.stringify({ error: "No files changed" }) }] };
		}

		// Stage only changed files
		for (const file of files) {
			execSync(`git add "${file}"`, { encoding: "utf-8" });
		}

		// Commit
		execSync(`git commit -m ${JSON.stringify(message)}`, { encoding: "utf-8" });

		// Get commit SHA
		const commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();

		// Record group
		const groupId = randomUUID();
		db.prepare(
			`INSERT INTO resolution_groups (id, session_id, commit_sha, commit_message, status)
			 VALUES (?, ?, ?, ?, 'applied')`,
		).run(groupId, sessionId, commitSha, message);

		// Update comments
		for (const commentId of comment_ids) {
			db.prepare(
				`UPDATE resolution_comments SET group_id = ?, status = 'resolved', updated_at = datetime('now')
				 WHERE id = ? AND session_id = ?`,
			).run(groupId, commentId, sessionId);
		}

		return {
			content: [{ type: "text", text: JSON.stringify({ groupId, commitSha, filesChanged: files.length }) }],
		};
	},
);
```

- [ ] **Step 3: Add `skip_comment` tool**

```javascript
server.tool(
	"skip_comment",
	"Mark a comment as skipped (not actionable)",
	{
		comment_id: z.string().describe("ID of the comment to skip"),
		reason: z.string().describe("Why this comment was skipped"),
	},
	async ({ comment_id, reason }) => {
		const sessionId = process.env.RESOLUTION_SESSION_ID;
		if (!sessionId) return { content: [{ type: "text", text: JSON.stringify({ error: "No resolution session" }) }] };

		db.prepare(
			`UPDATE resolution_comments SET status = 'skipped', skip_reason = ?, updated_at = datetime('now')
			 WHERE id = ? AND session_id = ?`,
		).run(reason, comment_id, sessionId);

		return { content: [{ type: "text", text: JSON.stringify({ status: "skipped" }) }] };
	},
);
```

- [ ] **Step 4: Add `finish_resolution` tool**

```javascript
server.tool("finish_resolution", "Signal that all comments have been resolved or skipped", {}, async () => {
	const sessionId = process.env.RESOLUTION_SESSION_ID;
	if (!sessionId) return { content: [{ type: "text", text: JSON.stringify({ error: "No resolution session" }) }] };

	const resolved = db
		.prepare("SELECT COUNT(*) as count FROM resolution_comments WHERE session_id = ? AND status = 'resolved'")
		.get(sessionId).count;
	const skipped = db
		.prepare("SELECT COUNT(*) as count FROM resolution_comments WHERE session_id = ? AND status = 'skipped'")
		.get(sessionId).count;
	const groups = db
		.prepare("SELECT COUNT(*) as count FROM resolution_groups WHERE session_id = ?")
		.get(sessionId).count;

	db.prepare("UPDATE resolution_sessions SET status = 'done', updated_at = datetime('now') WHERE id = ?").run(
		sessionId,
	);

	return { content: [{ type: "text", text: JSON.stringify({ resolved, skipped, groups }) }] };
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs
git commit -m "feat: add resolution MCP tools (get_review_comments, resolve_and_commit, skip_comment, finish_resolution)"
```

---

## Task 7: Resolution Publisher — Platform Replies on Push

**Files:**
- Create: `apps/desktop/src/main/ai-review/resolution-publisher.ts`
- Test: `apps/desktop/tests/resolution-publisher.test.ts`

- [ ] **Step 1: Write test for reply grouping logic**

Create `apps/desktop/tests/resolution-publisher.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { groupRepliesByThread } from "../src/main/ai-review/resolution-publisher";

describe("groupRepliesByThread", () => {
	test("groups GitHub comments by thread ID", () => {
		const comments = [
			{ platformThreadId: "thread-1", platformCommentId: "c1", groupId: "g1" },
			{ platformThreadId: "thread-1", platformCommentId: "c2", groupId: "g1" },
			{ platformThreadId: "thread-2", platformCommentId: "c3", groupId: "g2" },
		];
		const groups = groupRepliesByThread(comments as any);
		expect(Object.keys(groups)).toHaveLength(2);
		expect(groups["thread-1"]).toHaveLength(2);
		expect(groups["thread-2"]).toHaveLength(1);
	});

	test("falls back to platformCommentId for Bitbucket (no thread)", () => {
		const comments = [
			{ platformThreadId: null, platformCommentId: "bb-1", groupId: "g1" },
			{ platformThreadId: null, platformCommentId: "bb-2", groupId: "g1" },
		];
		const groups = groupRepliesByThread(comments as any);
		expect(Object.keys(groups)).toHaveLength(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/resolution-publisher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `resolution-publisher.ts`**

Create `apps/desktop/src/main/ai-review/resolution-publisher.ts`:

**Important:** Use `getDb()` for database access. `addReviewThreadReply` takes an object `{ threadId, body }`, not positional args.

```typescript
import { execSync } from "node:child_process";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { addReviewThreadReply, resolveThread } from "../github/github";
import { replyToPRComment } from "../atlassian/bitbucket";
import { getSettings } from "./orchestrator";

type ResolvedComment = typeof schema.resolutionComments.$inferSelect;

export function groupRepliesByThread(
	comments: Pick<ResolvedComment, "platformThreadId" | "platformCommentId" | "groupId">[],
): Record<string, typeof comments> {
	const groups: Record<string, typeof comments> = {};
	for (const c of comments) {
		const key = c.platformThreadId ?? c.platformCommentId;
		if (!groups[key]) groups[key] = [];
		groups[key]!.push(c);
	}
	return groups;
}

export async function pushAndReply(params: {
	sessionId: string;
	worktreePath: string;
}): Promise<{
	pushed: boolean;
	repliesPosted: number;
	threadsResolved: number;
	errors: string[];
}> {
	const db = getDb();
	const session = db
		.select()
		.from(schema.resolutionSessions)
		.where(eq(schema.resolutionSessions.id, params.sessionId))
		.get();

	if (!session) throw new Error("Session not found");

	// Push
	try {
		execSync("git push", { cwd: params.worktreePath, encoding: "utf-8" });
	} catch (e: any) {
		return { pushed: false, repliesPosted: 0, threadsResolved: 0, errors: [e.message] };
	}

	const settings = getSettings();
	if (!settings.postReplyOnPush) {
		return { pushed: true, repliesPosted: 0, threadsResolved: 0, errors: [] };
	}

	// Get resolved comments with their groups
	const resolvedComments = db
		.select()
		.from(schema.resolutionComments)
		.where(
			and(
				eq(schema.resolutionComments.sessionId, params.sessionId),
				eq(schema.resolutionComments.status, "resolved"),
			),
		)
		.all();

	const groups = db
		.select()
		.from(schema.resolutionGroups)
		.where(
			and(
				eq(schema.resolutionGroups.sessionId, params.sessionId),
				eq(schema.resolutionGroups.status, "applied"),
			),
		)
		.all();

	const groupMap = new Map(groups.map((g) => [g.id, g]));
	const threadGroups = groupRepliesByThread(resolvedComments);

	let repliesPosted = 0;
	let threadsResolved = 0;
	const errors: string[] = [];

	const [ownerRepo, numStr] = session.prIdentifier.split("#");
	const prNumber = parseInt(numStr!, 10);

	for (const [threadKey, comments] of Object.entries(threadGroups)) {
		// Find the group for this thread's comments to get commit info
		const group = comments[0]?.groupId ? groupMap.get(comments[0].groupId) : null;
		if (!group) continue;

		const replyBody = `Addressed in ${group.commitSha.slice(0, 7)} — ${group.commitMessage}`;

		try {
			if (session.prProvider === "github") {
				await addReviewThreadReply({ threadId: threadKey, body: replyBody });
				repliesPosted++;

				if (settings.autoResolveThreads) {
					await resolveThread(threadKey);
					threadsResolved++;
				}
			} else {
				const [workspace, repoSlug] = ownerRepo!.split("/");
				await replyToPRComment(
					workspace!,
					repoSlug!,
					prNumber,
					parseInt(threadKey, 10),
					replyBody,
				);
				repliesPosted++;
			}
		} catch (e: any) {
			errors.push(`Reply to ${threadKey}: ${e.message}`);
		}
	}

	return { pushed: true, repliesPosted, threadsResolved, errors };
}

export function revertGroup(groupId: string, worktreePath: string): void {
	const db = getDb();
	const group = db
		.select()
		.from(schema.resolutionGroups)
		.where(eq(schema.resolutionGroups.id, groupId))
		.get();

	if (!group || group.status === "reverted") return;

	execSync(`git revert --no-edit ${group.commitSha}`, {
		cwd: worktreePath,
		encoding: "utf-8",
	});

	const now = new Date();
	// Update group status
	db.update(schema.resolutionGroups)
		.set({ status: "reverted", updatedAt: now })
		.where(eq(schema.resolutionGroups.id, groupId))
		.run();

	// Move comments back to pending
	db.update(schema.resolutionComments)
		.set({ status: "pending", groupId: null, updatedAt: now })
		.where(eq(schema.resolutionComments.groupId, groupId))
		.run();
}

export function revertAll(sessionId: string, worktreePath: string): void {
	const db = getDb();
	const groups = db
		.select()
		.from(schema.resolutionGroups)
		.where(
			and(
				eq(schema.resolutionGroups.sessionId, sessionId),
				eq(schema.resolutionGroups.status, "applied"),
			),
		)
		.all()
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Reverse chronological

	for (const group of groups) {
		revertGroup(group.id, worktreePath);
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/resolution-publisher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai-review/resolution-publisher.ts apps/desktop/tests/resolution-publisher.test.ts
git commit -m "feat: add resolution publisher with platform replies, revert group, and revert all"
```

---

## Task 8: tRPC Router — Resolution Endpoints

**Files:**
- Create: `apps/desktop/src/main/trpc/routers/resolution.ts`
- Modify: `apps/desktop/src/main/trpc/routers/index.ts:15-28`

- [ ] **Step 1: Create the resolution tRPC router**

Create `apps/desktop/src/main/trpc/routers/resolution.ts`:

```typescript
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { publicProcedure, router } from "../index";
import { getDb } from "../../db";
import * as schema from "../../db/schema";
import {
	startResolutionSession,
	markSessionFailed,
	fetchReviewComments,
} from "../../ai-review/resolution-orchestrator";
import { pushAndReply, revertGroup, revertAll } from "../../ai-review/resolution-publisher";

export const resolutionRouter = router({
	getSession: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			const session = db
				.select()
				.from(schema.resolutionSessions)
				.where(eq(schema.resolutionSessions.workspaceId, input.workspaceId))
				.orderBy(desc(schema.resolutionSessions.createdAt))
				.limit(1)
				.get();

			if (!session) return null;

			const groups = db  // db is already bound above
				.select()
				.from(schema.resolutionGroups)
				.where(eq(schema.resolutionGroups.sessionId, session.id))
				.all();

			const comments = db
				.select()
				.from(schema.resolutionComments)
				.where(eq(schema.resolutionComments.sessionId, session.id))
				.all();

			return { ...session, groups, comments };
		}),

	startResolution: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				prProvider: z.enum(["github", "bitbucket"]),
				prIdentifier: z.string(),
				prNumber: z.number(),
				prTitle: z.string(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
				worktreePath: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			return startResolutionSession(input);
		}),

	fetchComments: publicProcedure
		.input(
			z.object({
				provider: z.enum(["github", "bitbucket"]),
				prIdentifier: z.string(),
			}),
		)
		.query(async ({ input }) => {
			return fetchReviewComments(input.provider, input.prIdentifier);
		}),

	revertGroup: publicProcedure
		.input(z.object({ groupId: z.string(), worktreePath: z.string() }))
		.mutation(({ input }) => {
			revertGroup(input.groupId, input.worktreePath);
		}),

	revertAll: publicProcedure
		.input(z.object({ sessionId: z.string(), worktreePath: z.string() }))
		.mutation(({ input }) => {
			revertAll(input.sessionId, input.worktreePath);
		}),

	pushChanges: publicProcedure
		.input(z.object({ sessionId: z.string(), worktreePath: z.string() }))
		.mutation(async ({ input }) => {
			return pushAndReply(input);
		}),

	cancelSession: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(({ input }) => {
			markSessionFailed(input.sessionId);
		}),
});
```

- [ ] **Step 2: Register in router index**

In `apps/desktop/src/main/trpc/routers/index.ts`, add the import and include in `appRouter`:

```typescript
import { resolutionRouter } from "./resolution";

// In appRouter:
resolution: resolutionRouter,
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/resolution.ts apps/desktop/src/main/trpc/routers/index.ts
git commit -m "feat: add resolution tRPC router with session, revert, and push endpoints"
```

---

## Task 9: Tab Store & Panel Routing — `pr-comments` Mode

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts:48-55`
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx`

- [ ] **Step 1: Add `pr-comments` panel mode to tab store**

In `apps/desktop/src/renderer/stores/tab-store.ts`, update the `PanelMode` type (~line 48) to include `"pr-comments"`:

```typescript
type PanelMode = "diff" | "explorer" | "pr-review" | "pr-comments";
```

- [ ] **Step 2: Add `openPRCommentsPanel` method**

Add a new method to the store (near `openPRReviewPanel` ~line 410). **Important:** This store does NOT use immer — use the same `set()` pattern as `openPRReviewPanel`:

```typescript
openPRCommentsPanel: (workspaceId: string, prCtx: PRContext) => {
	set({ rightPanel: { open: true, mode: "pr-comments", diffCtx: null, prCtx } });
},
```

This matches the exact pattern of `openPRReviewPanel` at line ~411, which sets `rightPanel` as a flat top-level property.

- [ ] **Step 3: Add routing in DiffPanel**

In `apps/desktop/src/renderer/components/DiffPanel.tsx`, add a condition for the new mode alongside the existing `pr-review` check:

```typescript
if (rightPanel.mode === "pr-comments" && rightPanel.prCtx) {
	return <PRCommentsRail prCtx={rightPanel.prCtx} />;
}
```

Add a lazy import to avoid breaking the build before Task 10 creates the component:

```typescript
// Use React.lazy to defer — PRCommentsRail is created in Task 10
const PRCommentsRail = React.lazy(() =>
	import("./PRCommentsRail").then((m) => ({ default: m.PRCommentsRail })),
);
```

Wrap the rendered component in `<React.Suspense fallback={null}>`.

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`
Expected: PASS — lazy import doesn't require the module to exist at compile time

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts apps/desktop/src/renderer/components/DiffPanel.tsx
git commit -m "feat: add pr-comments panel mode and routing"
```

---

## Task 10: PRCommentsRail — Author-Side Right Panel UI

**Files:**
- Create: `apps/desktop/src/renderer/components/PRCommentsRail.tsx`
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`

This is the largest UI task. Build incrementally — start with the Comments tab, then Resolved tab, then Changes tab.

- [ ] **Step 1: Create PRCommentsRail with Comments tab skeleton**

Create `apps/desktop/src/renderer/components/PRCommentsRail.tsx`:

```tsx
import { useState } from "react";
import type { PRContext } from "../../shared/github-types";
import { MarkdownRenderer } from "./MarkdownRenderer";

type Tab = "comments" | "resolved" | "changes";

export function PRCommentsRail({ prCtx }: { prCtx: PRContext }) {
	const [activeTab, setActiveTab] = useState<Tab>("comments");

	const trpcUtils = window.electron.trpc;
	const commentsQuery = trpcUtils.resolution.fetchComments.useQuery({
		provider: prCtx.provider,
		prIdentifier: `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`,
	});

	const sessionQuery = trpcUtils.resolution.getSession.useQuery({
		workspaceId: useTabStore.getState().activeWorkspaceId ?? "",
	});

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
			{/* Tab bar */}
			<div style={{ display: "flex", gap: 2, background: "var(--bg-raised)", borderRadius: 8, padding: 3, margin: "8px 8px 0" }}>
				{(["comments", "resolved", "changes"] as Tab[]).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						style={{
							flex: 1,
							padding: "6px 8px",
							borderRadius: 6,
							border: "none",
							cursor: "pointer",
							fontSize: 11,
							fontWeight: activeTab === tab ? 600 : 400,
							background: activeTab === tab ? "var(--accent)" : "transparent",
							color: activeTab === tab ? "white" : "var(--text-tertiary)",
						}}
					>
						{tab.charAt(0).toUpperCase() + tab.slice(1)}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div style={{ flex: 1, overflow: "auto", padding: 8 }}>
				{activeTab === "comments" && <CommentsTab comments={commentsQuery.data ?? []} prCtx={prCtx} session={sessionQuery.data} />}
				{activeTab === "resolved" && <ResolvedTab session={sessionQuery.data} prCtx={prCtx} />}
				{activeTab === "changes" && <ChangesTab session={sessionQuery.data} prCtx={prCtx} />}
			</div>
		</div>
	);
}
```

This is a skeleton. The `CommentsTab`, `ResolvedTab`, and `ChangesTab` are internal components within the same file. Build each one out following the mockup from the brainstorming session — comment cards with author/file/body, resolve button, status badges.

Refer to `PRControlRail.tsx` for styling patterns (card backgrounds, badge styles, bottom sticky bars).

- [ ] **Step 2: Implement CommentsTab with "Resolve with AI" button**

The CommentsTab renders review comment cards and a bottom action bar. The "Resolve with AI" button calls `resolution.startResolution` via tRPC. Use the exact card styling from the brainstorm mockup:

- Cards with colored left border (red for unresolved, green for resolved)
- Author avatar placeholder, username, file:line reference
- Comment body text
- Bottom bar: "N comments can be resolved" + "Resolve with AI" button

- [ ] **Step 3: Implement ResolvedTab with commit groups**

The ResolvedTab shows commit groups from `sessionQuery.data.groups`. Each group card shows:
- Commit message + SHA
- "View Diff" button (opens PRReviewFileTab for that commit)
- "Revert" button (calls `resolution.revertGroup`)
- List of resolved comments under each group
- Skipped section at bottom with skip reasons
- Bottom bar: progress + "Push Changes" button (calls `resolution.pushChanges`)

- [ ] **Step 4: Implement ChangesTab with file list**

The ChangesTab lists files touched by resolution commits. Derive from session groups — for each group with status "applied", get the commit SHA and compute changed files. Each file is clickable to open in the diff editor.

- [ ] **Step 5: Add sidebar badge for author PR comments**

In `apps/desktop/src/renderer/components/Sidebar.tsx`, extend the workspace item rendering in the repo section to show a comment count badge when:
- The workspace has `prProvider` and `prIdentifier` set
- The linked PR has unresolved comments (from the `commentsQuery` or via the IPC notification)

Use the existing badge pattern (green dot with count) but style differently — e.g., a pill badge showing "3 comments".

- [ ] **Step 6: Run type-check and fix any issues**

Run: `bun run type-check`
Expected: PASS after resolving any import issues

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/PRCommentsRail.tsx apps/desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat: add PRCommentsRail UI with comments, resolved, and changes tabs"
```

---

## Task 11: Startup Integration & Agent Exit Monitoring

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Add resolution cleanup on startup**

In `apps/desktop/src/main/index.ts`, alongside the existing `cleanupStaleReviews()` call (~line 79), add:

```typescript
import { cleanupStaleResolutionSessions } from "./ai-review/resolution-orchestrator";

// In the initialization block:
cleanupStaleResolutionSessions();
```

- [ ] **Step 2: Wire agent exit monitoring for resolution sessions**

When a resolution session's terminal exits, the main process should mark the session as failed if it's still running. This uses the terminal daemon's `onExit` callback pattern. In the resolution tRPC router's `startResolution` mutation, after launching the agent, register an exit handler:

Add to `resolution-orchestrator.ts`:

```typescript
export function monitorAgentExit(sessionId: string, terminalId: string): void {
	// The terminal daemon client's onExit callback fires when PTY exits
	// This is wired in the tRPC router after creating the terminal session
	// If session is still "running" when terminal exits, mark as failed
	const db = getDb();
	const session = db
		.select()
		.from(schema.resolutionSessions)
		.where(eq(schema.resolutionSessions.id, sessionId))
		.get();

	if (session?.status === "running") {
		markSessionFailed(sessionId);
	}
}
```

The actual wiring happens in the tRPC router or wherever the terminal session is created for the resolution — the existing pattern in `terminal-sessions.ts` router shows how `onExit` callbacks are registered for terminal sessions.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/main/ai-review/resolution-orchestrator.ts
git commit -m "feat: add resolution session cleanup on startup and agent exit monitoring"
```

---

## Task 12: Integration Testing & Final Wiring

**Files:**
- Test: `apps/desktop/tests/resolution-integration.test.ts`
- Various files for final wiring

- [ ] **Step 1: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: All tests PASS

- [ ] **Step 2: Run full type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Run lint and format**

Run: `bun run check`
Expected: PASS (or fix any issues found by biome)

- [ ] **Step 4: Commit any lint/format fixes**

Run `git status` to see what changed, then stage only those specific files:

```bash
git status
# Stage only the files that biome actually modified
git add <specific-files-from-status>
git commit -m "chore: lint and format fixes for resolution feature"
```
