# MCP Workspace Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user's coding agent (Claude Code, Codex, Gemini, OpenCode) running inside an app-created worktree create app-managed worktrees, list workspaces, dispatch a child agent with a prompt, and request worktree removal — via MCP tools backed by a localhost HTTP control plane in the main process.

**Architecture:** A new `services/workspace-service.ts` holds all workspace business logic (extracted from the existing tRPC router so both tRPC and the new HTTP control plane share one implementation). A localhost-only HTTP server in `control-plane/server.ts` exposes those service functions to the standalone MCP server (`mcp-standalone/server.mjs`) under bearer-token auth. Destructive ops route through a `confirm-bridge` that shows a modal in the renderer before executing. Every app-created worktree gets a `.mcp.json` with a fresh port + token so child agents inherit the same control plane.

**Tech Stack:** Electron 30, Bun (test runner + package manager), TypeScript (strict), Drizzle ORM + better-sqlite3, simple-git, zod, native Node `http` + `crypto`. No new dependencies. Tests use `bun:test`.

---

## Spec reference

Spec: `docs/superpowers/specs/2026-05-07-mcp-workspace-agent-design.md`. Read it first.

## File structure

**New files:**

- `apps/desktop/src/shared/control-plane.ts` — zod request/response schemas + DTO types. Shared by main + tests + (logically) `server.mjs`.
- `apps/desktop/src/main/services/workspace-service.ts` — pure async functions: `createWorkspace`, `listWorkspaces`, `getWorkspace`, `removeWorkspace`, `dispatchAgent`. Each returns DTOs from `shared/control-plane.ts`.
- `apps/desktop/src/main/services/mcp-config.ts` — `writeWorkspaceMcpJson(worktreePath, env)` + `rewriteAllWorkspaceMcpJsons()`.
- `apps/desktop/src/main/control-plane/auth.ts` — token gen + constant-time compare.
- `apps/desktop/src/main/control-plane/confirm-bridge.ts` — IPC bridge to renderer for confirm dialogs. Queue + 30s timeout.
- `apps/desktop/src/main/control-plane/server.ts` — HTTP server, route table, request validation, error mapping.
- `apps/desktop/src/main/control-plane/index.ts` — start / stop / get-port / get-token barrel.
- `apps/desktop/src/renderer/components/ConfirmAgentActionModal.tsx` — modal UI rendered by `App.tsx` when IPC `agent-confirm:request` arrives.
- `apps/desktop/tests/workspace-service.test.ts`
- `apps/desktop/tests/control-plane.test.ts`
- `apps/desktop/tests/control-plane-auth.test.ts`
- `apps/desktop/tests/mcp-config.test.ts`

**Modified files:**

- `apps/desktop/src/main/trpc/routers/workspaces.ts` — replace inline logic in `create / checkoutExisting / delete / listByProject / getById` with calls into `workspace-service`.
- `apps/desktop/src/main/index.ts` — start control plane after DB init; register confirm-bridge IPC; on shutdown, close server.
- `apps/desktop/src/renderer/App.tsx` — mount `<ConfirmAgentActionModal />` once at top level; subscribe to IPC.
- `apps/desktop/src/preload/index.ts` — expose `agentConfirm` IPC channel.
- `apps/desktop/mcp-standalone/server.mjs` — add `WORKSPACE_AGENT` mode branch with 5 tools.

---

## Conventions used in this plan

- Run a single test file: `cd apps/desktop && bun test tests/<name>.test.ts`
- Run all tests for the app: `cd apps/desktop && bun test`
- Type-check: `bun run type-check` (from repo root)
- Format + lint: `bun run check` (Biome) — runs as a pre-commit hook
- Commit after each task. Use Conventional Commits. Never `--no-verify`.
- Never write `Co-Authored-By` trailers (project rule).
- The plan stages files explicitly per task — do NOT use `git add -A`.

---

## Task 1: Shared schemas + DTO types

**Files:**
- Create: `apps/desktop/src/shared/control-plane.ts`

- [ ] **Step 1: Create the schemas file**

```ts
// apps/desktop/src/shared/control-plane.ts
import { z } from "zod";

// ---- Request schemas ----

export const createWorkspaceRequestSchema = z.object({
	projectId: z.string().min(1),
	branch: z.string().min(1),
	baseBranch: z.string().min(1).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const listWorkspacesRequestSchema = z.object({
	projectId: z.string().min(1),
});
export type ListWorkspacesRequest = z.infer<typeof listWorkspacesRequestSchema>;

export const getWorkspaceRequestSchema = z.object({
	projectId: z.string().min(1),
	workspaceId: z.string().min(1),
});
export type GetWorkspaceRequest = z.infer<typeof getWorkspaceRequestSchema>;

export const dispatchAgentRequestSchema = z.object({
	projectId: z.string().min(1),
	workspaceId: z.string().min(1),
	prompt: z.string().min(1),
	cliPreset: z.enum(["claude", "codex", "gemini", "opencode"]).optional(),
	skipPermissions: z.boolean().optional(),
});
export type DispatchAgentRequest = z.infer<typeof dispatchAgentRequestSchema>;

export const removeWorkspaceRequestSchema = z.object({
	projectId: z.string().min(1),
	workspaceId: z.string().min(1),
	force: z.boolean().optional(),
});
export type RemoveWorkspaceRequest = z.infer<typeof removeWorkspaceRequestSchema>;

// ---- Response DTOs ----

export interface WorkspaceDto {
	id: string;
	projectId: string;
	type: "branch" | "worktree" | "review";
	name: string;
	branch: string | null;
	worktreePath: string | null;
	baseBranch: string | null;
	prProvider: string | null;
	prIdentifier: string | null;
	draftStatus: string | null;
}

export interface CreateWorkspaceResponse {
	workspaceId: string;
	worktreeId: string;
	path: string;
	branch: string;
	baseBranch: string;
}

export interface ListWorkspacesResponse {
	workspaces: WorkspaceDto[];
}

export interface GetWorkspaceResponse extends WorkspaceDto {
	hasUncommittedChanges: boolean;
}

export interface DispatchAgentResponse {
	sessionId: string;
	terminalId: string;
	status: "started";
}

export type RemoveWorkspaceStatus = "removed" | "cancelled-by-user" | "blocked-uncommitted";

export interface RemoveWorkspaceResponse {
	status: RemoveWorkspaceStatus;
}

// ---- Error envelope ----

export interface ControlPlaneError {
	error:
		| "validation"
		| "unauthorized"
		| "forbidden"
		| "not_found"
		| "git_conflict"
		| "cancelled_by_user"
		| "internal";
	message?: string;
	details?: unknown;
}

// ---- Sentinel error class ----

export class CancelledByUserError extends Error {
	constructor() {
		super("cancelled_by_user");
		this.name = "CancelledByUserError";
	}
}
```

- [ ] **Step 2: Type-check**

Run: `bun run type-check`
Expected: PASS (this file has no consumers yet, but must compile clean).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/shared/control-plane.ts
git commit -m "feat(mcp): add control-plane request/response schemas"
```

---

## Task 2: workspace-service — createWorkspace

**Files:**
- Create: `apps/desktop/src/main/services/workspace-service.ts`
- Create: `apps/desktop/tests/workspace-service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/desktop/tests/workspace-service.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { initializeDatabaseAtPath } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import { createWorkspace } from "../src/main/services/workspace-service";

let TMP: string;
let REPO: string;

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "ws-svc-"));
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);
	initializeDatabaseAtPath(join(TMP, "test.db"));
	// seed a project row
	const { getDb, schema } = await import("../src/main/db");
	const now = new Date();
	getDb()
		.insert(schema.projects)
		.values({
			id: "proj-1",
			repoPath: REPO,
			name: "repo",
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("createWorkspace", () => {
	test("creates worktree, workspace, and worktree DB rows", async () => {
		const result = await createWorkspace({
			projectId: "proj-1",
			branch: "feature/x",
			baseBranch: "main",
		});

		expect(result.branch).toBe("feature/x");
		expect(result.baseBranch).toBe("main");
		expect(result.path.endsWith("/feature/x")).toBe(true);

		const { getDb, schema } = await import("../src/main/db");
		const ws = getDb()
			.select()
			.from(schema.workspaces)
			.where((q) => q)
			.all();
		expect(ws).toHaveLength(1);
		expect(ws[0]?.name).toBe("feature/x");
	});

	test("uses project default branch when baseBranch omitted", async () => {
		const result = await createWorkspace({ projectId: "proj-1", branch: "feature/y" });
		expect(result.baseBranch).toBe("main");
	});

	test("throws when project does not exist", async () => {
		await expect(
			createWorkspace({ projectId: "missing", branch: "feature/z" })
		).rejects.toThrow(/not found/i);
	});
});
```

NOTE: `initializeDatabaseAtPath` does not exist yet — Task 2.1 below adds a test-only helper. If it already exists, skip Task 2.1.

- [ ] **Step 2: Confirm db helper exists, otherwise add it**

Read `apps/desktop/src/main/db/index.ts`. If `initializeDatabaseAtPath(path: string)` is not exported, add it as a thin wrapper:

```ts
// apps/desktop/src/main/db/index.ts (append near initializeDatabase)
export function initializeDatabaseAtPath(dbFilePath: string): void {
	process.env.SUPERIORSWARM_DB_PATH = dbFilePath; // honored by initializeDatabase
	initializeDatabase();
}
```

If `initializeDatabase` already takes a path arg or honors a config var, prefer that — don't add a duplicate.

- [ ] **Step 3: Run test, expect failure**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: FAIL — `createWorkspace` not found / module not resolvable.

- [ ] **Step 4: Implement createWorkspace**

```ts
// apps/desktop/src/main/services/workspace-service.ts
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { CreateWorkspaceRequest, CreateWorkspaceResponse } from "../../shared/control-plane";
import { getDb } from "../db";
import { projects, sharedFiles, workspaces, worktrees } from "../db/schema";
import { createWorktree } from "../git/operations";
import { symlinkSharedFiles } from "../shared-files";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

export async function createWorkspace(
	input: CreateWorkspaceRequest
): Promise<CreateWorkspaceResponse> {
	const db = getDb();
	const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
	if (!project) {
		throw new Error(`Project not found: ${input.projectId}`);
	}

	const baseBranch = input.baseBranch ?? project.defaultBranch;
	const path = join(worktreeBasePath(project.repoPath), input.branch);

	await createWorktree(project.repoPath, path, input.branch, baseBranch);

	const now = new Date();
	const worktreeId = nanoid();
	const workspaceId = nanoid();

	db.insert(worktrees)
		.values({
			id: worktreeId,
			projectId: input.projectId,
			path,
			branch: input.branch,
			baseBranch,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	db.insert(workspaces)
		.values({
			id: workspaceId,
			projectId: input.projectId,
			type: "worktree",
			name: input.branch,
			worktreeId,
			terminalId: null,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	const sharedEntries = db
		.select()
		.from(sharedFiles)
		.where(eq(sharedFiles.projectId, input.projectId))
		.all();

	if (sharedEntries.length > 0) {
		await symlinkSharedFiles(
			project.repoPath,
			path,
			sharedEntries.map((e) => ({ relativePath: e.relativePath }))
		);
	}

	return {
		workspaceId,
		worktreeId,
		path,
		branch: input.branch,
		baseBranch,
	};
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/workspace-service.test.ts
# include db/index.ts if Step 2 changed it
git commit -m "feat(mcp): add workspace-service.createWorkspace"
```

---

## Task 3: workspace-service — listWorkspaces + getWorkspace

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/tests/workspace-service.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/workspace-service.test.ts
import {
	getWorkspace,
	listWorkspaces,
} from "../src/main/services/workspace-service";

describe("listWorkspaces", () => {
	test("returns workspaces for the given project only", async () => {
		await createWorkspace({ projectId: "proj-1", branch: "feature/a" });
		await createWorkspace({ projectId: "proj-1", branch: "feature/b" });

		const { workspaces: list } = await listWorkspaces({ projectId: "proj-1" });
		expect(list).toHaveLength(2);
		expect(list.map((w) => w.name).sort()).toEqual(["feature/a", "feature/b"]);
	});

	test("returns empty list for project with no workspaces", async () => {
		const { workspaces: list } = await listWorkspaces({ projectId: "proj-1" });
		expect(list).toEqual([]);
	});
});

describe("getWorkspace", () => {
	test("returns workspace + dirty flag", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/c" });
		const ws = await getWorkspace({ projectId: "proj-1", workspaceId: created.workspaceId });
		expect(ws.id).toBe(created.workspaceId);
		expect(ws.worktreePath).toBe(created.path);
		expect(ws.hasUncommittedChanges).toBe(false);
	});

	test("throws not_found for unknown id", async () => {
		await expect(
			getWorkspace({ projectId: "proj-1", workspaceId: "missing" })
		).rejects.toThrow(/not_found/);
	});

	test("throws forbidden when projectId mismatches", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/d" });
		await expect(
			getWorkspace({ projectId: "other-proj", workspaceId: created.workspaceId })
		).rejects.toThrow(/forbidden/);
	});
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: FAIL — both functions undefined.

- [ ] **Step 3: Implement**

```ts
// append to services/workspace-service.ts
import { reviewDrafts } from "../db/schema-ai-review";
import { hasUncommittedChanges } from "../git/operations";
import type {
	GetWorkspaceRequest,
	GetWorkspaceResponse,
	ListWorkspacesRequest,
	ListWorkspacesResponse,
	WorkspaceDto,
} from "../../shared/control-plane";

function rowToDto(row: {
	id: string;
	projectId: string;
	type: "branch" | "worktree" | "review";
	name: string;
	branch: string | null;
	worktreePath: string | null;
	baseBranch: string | null;
	prProvider: string | null;
	prIdentifier: string | null;
	draftStatus: string | null;
}): WorkspaceDto {
	return {
		id: row.id,
		projectId: row.projectId,
		type: row.type,
		name: row.name,
		branch: row.branch,
		worktreePath: row.worktreePath,
		baseBranch: row.baseBranch,
		prProvider: row.prProvider,
		prIdentifier: row.prIdentifier,
		draftStatus: row.draftStatus,
	};
}

export async function listWorkspaces(
	input: ListWorkspacesRequest
): Promise<ListWorkspacesResponse> {
	const db = getDb();
	const rows = db
		.select({
			id: workspaces.id,
			projectId: workspaces.projectId,
			type: workspaces.type,
			name: workspaces.name,
			branch: worktrees.branch,
			worktreePath: worktrees.path,
			baseBranch: worktrees.baseBranch,
			prProvider: workspaces.prProvider,
			prIdentifier: workspaces.prIdentifier,
			draftStatus: reviewDrafts.status,
		})
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.projectId, input.projectId))
		.all();

	return { workspaces: rows.map(rowToDto) };
}

export async function getWorkspace(
	input: GetWorkspaceRequest
): Promise<GetWorkspaceResponse> {
	const db = getDb();
	const row = db
		.select({
			id: workspaces.id,
			projectId: workspaces.projectId,
			type: workspaces.type,
			name: workspaces.name,
			branch: worktrees.branch,
			worktreePath: worktrees.path,
			baseBranch: worktrees.baseBranch,
			prProvider: workspaces.prProvider,
			prIdentifier: workspaces.prIdentifier,
			draftStatus: reviewDrafts.status,
		})
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.id, input.workspaceId))
		.get();

	if (!row) {
		throw new Error(`not_found: ${input.workspaceId}`);
	}
	if (row.projectId !== input.projectId) {
		throw new Error(`forbidden: workspace belongs to a different project`);
	}

	const dirty = row.worktreePath ? await hasUncommittedChanges(row.worktreePath) : false;
	return { ...rowToDto(row), hasUncommittedChanges: dirty };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/workspace-service.test.ts
git commit -m "feat(mcp): add workspace-service list + get"
```

---

## Task 4: workspace-service — removeWorkspace

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/tests/workspace-service.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to tests
import { removeWorkspace } from "../src/main/services/workspace-service";

describe("removeWorkspace", () => {
	test("removes worktree and DB rows", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/r1" });
		const result = await removeWorkspace({
			projectId: "proj-1",
			workspaceId: created.workspaceId,
		});
		expect(result.status).toBe("removed");

		const { workspaces: list } = await listWorkspaces({ projectId: "proj-1" });
		expect(list).toEqual([]);
	});

	test("blocks on uncommitted changes without force", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/r2" });
		// dirty the tree
		const fs = await import("node:fs");
		fs.writeFileSync(join(created.path, "dirty.txt"), "x");

		const result = await removeWorkspace({
			projectId: "proj-1",
			workspaceId: created.workspaceId,
		});
		expect(result.status).toBe("blocked-uncommitted");
	});

	test("force=true bypasses dirty guard", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/r3" });
		const fs = await import("node:fs");
		fs.writeFileSync(join(created.path, "dirty.txt"), "x");

		const result = await removeWorkspace({
			projectId: "proj-1",
			workspaceId: created.workspaceId,
			force: true,
		});
		expect(result.status).toBe("removed");
	});

	test("forbidden across projects", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/r4" });
		await expect(
			removeWorkspace({ projectId: "other", workspaceId: created.workspaceId })
		).rejects.toThrow(/forbidden/);
	});
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: FAIL — `removeWorkspace` not defined.

- [ ] **Step 3: Implement**

```ts
// append to services/workspace-service.ts
import { existsSync } from "node:fs";
import { removeWorktree as gitRemoveWorktree } from "../git/operations";
import { terminalSessions } from "../db/schema";
import { getDaemonClient } from "../terminal/daemon-instance";
import type {
	RemoveWorkspaceRequest,
	RemoveWorkspaceResponse,
} from "../../shared/control-plane";

export async function removeWorkspace(
	input: RemoveWorkspaceRequest
): Promise<RemoveWorkspaceResponse> {
	const db = getDb();
	const ws = db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
	if (!ws) throw new Error(`not_found: ${input.workspaceId}`);
	if (ws.projectId !== input.projectId) throw new Error("forbidden");
	if (ws.type === "branch") throw new Error("Cannot delete the main branch workspace");
	if (!ws.worktreeId) throw new Error("Workspace has no associated worktree");

	const wt = db.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get();
	const project = db.select().from(projects).where(eq(projects.id, ws.projectId)).get();
	if (!project) throw new Error("Project not found");

	const pathExists = wt ? existsSync(wt.path) : false;
	if (pathExists && wt && !input.force) {
		const dirty = await hasUncommittedChanges(wt.path);
		if (dirty) return { status: "blocked-uncommitted" };
	}

	// Dispose daemon terminals first so shells release the cwd.
	const sessions = db
		.select({ id: terminalSessions.id })
		.from(terminalSessions)
		.where(eq(terminalSessions.workspaceId, input.workspaceId))
		.all();
	const daemon = getDaemonClient();
	for (const s of sessions) daemon?.dispose(s.id);
	if (sessions.length > 0) {
		db.delete(terminalSessions).where(eq(terminalSessions.workspaceId, input.workspaceId)).run();
	}

	if (pathExists && wt) {
		await gitRemoveWorktree(project.repoPath, wt.path);
	}

	if (wt) db.delete(worktrees).where(eq(worktrees.id, wt.id)).run();
	db.delete(workspaces).where(eq(workspaces.id, input.workspaceId)).run();

	return { status: "removed" };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/workspace-service.test.ts
git commit -m "feat(mcp): add workspace-service removeWorkspace"
```

---

## Task 5: workspace-service — dispatchAgent

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/tests/workspace-service.test.ts`

`dispatchAgent` writes a launch script + `.mcp.json` (deferred to Task 9 — for now, just spawn) and asks the daemon to start a terminal session. The full real spawn requires the daemon — too heavy for unit tests. We test it with the daemon dependency stubbed via DI.

- [ ] **Step 1: Add failing test (DI variant)**

```ts
// append to tests
import { dispatchAgent } from "../src/main/services/workspace-service";

describe("dispatchAgent", () => {
	test("calls spawnFn with workspace cwd + cli command", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/d1" });
		const calls: Array<{ cwd: string; script: string }> = [];

		const result = await dispatchAgent(
			{
				projectId: "proj-1",
				workspaceId: created.workspaceId,
				prompt: "Refactor the foo module",
				cliPreset: "claude",
			},
			{
				spawnFn: async ({ cwd, launchScript }) => {
					calls.push({ cwd, script: launchScript });
					return { sessionId: "sess-1", terminalId: "term-1" };
				},
			}
		);

		expect(result.sessionId).toBe("sess-1");
		expect(result.terminalId).toBe("term-1");
		expect(result.status).toBe("started");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cwd).toBe(created.path);
		expect(calls[0]?.script).toContain("claude");
		expect(calls[0]?.script).toContain("Refactor the foo module");
	});

	test("forbidden across projects", async () => {
		const created = await createWorkspace({ projectId: "proj-1", branch: "feature/d2" });
		await expect(
			dispatchAgent(
				{
					projectId: "other",
					workspaceId: created.workspaceId,
					prompt: "x",
					cliPreset: "claude",
				},
				{ spawnFn: async () => ({ sessionId: "s", terminalId: "t" }) }
			)
		).rejects.toThrow(/forbidden/);
	});
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: FAIL — `dispatchAgent` undefined.

- [ ] **Step 3: Implement (with DI for spawn)**

```ts
// append to services/workspace-service.ts
import type { DispatchAgentRequest, DispatchAgentResponse } from "../../shared/control-plane";

export interface SpawnArgs {
	cwd: string;
	launchScript: string;
	workspaceId: string;
}
export interface SpawnResult {
	sessionId: string;
	terminalId: string;
}
export type SpawnFn = (args: SpawnArgs) => Promise<SpawnResult>;

export interface DispatchAgentDeps {
	spawnFn?: SpawnFn;
}

function escapeShellSingleQuote(s: string): string {
	return s.replace(/'/g, "'\\''");
}

function buildLaunchScript(opts: {
	cwd: string;
	cliPreset: "claude" | "codex" | "gemini" | "opencode";
	prompt: string;
	skipPermissions: boolean;
}): string {
	const flag =
		opts.cliPreset === "claude" && opts.skipPermissions ? "--dangerously-skip-permissions " : "";
	const cmd = `${opts.cliPreset} ${flag}'${escapeShellSingleQuote(opts.prompt)}'`;
	return ["#!/bin/bash", `cd '${escapeShellSingleQuote(opts.cwd)}'`, "", cmd, ""].join("\n");
}

export async function dispatchAgent(
	input: DispatchAgentRequest,
	deps: DispatchAgentDeps = {}
): Promise<DispatchAgentResponse> {
	const db = getDb();
	const ws = db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
	if (!ws) throw new Error(`not_found: ${input.workspaceId}`);
	if (ws.projectId !== input.projectId) throw new Error("forbidden");
	if (!ws.worktreeId) throw new Error("Workspace has no associated worktree");

	const wt = db.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get();
	if (!wt) throw new Error("Worktree row missing");

	const cliPreset = input.cliPreset ?? "claude";
	const launchScript = buildLaunchScript({
		cwd: wt.path,
		cliPreset,
		prompt: input.prompt,
		skipPermissions: input.skipPermissions ?? false,
	});

	const spawnFn = deps.spawnFn ?? defaultSpawnFn;
	const { sessionId, terminalId } = await spawnFn({
		cwd: wt.path,
		launchScript,
		workspaceId: input.workspaceId,
	});

	return { sessionId, terminalId, status: "started" };
}

async function defaultSpawnFn(args: SpawnArgs): Promise<SpawnResult> {
	// Real spawn: wire to daemon-client + terminalSessions in Task 12.
	// Stub raises so a missing override during tests is loud.
	throw new Error(
		"defaultSpawnFn not implemented — call dispatchAgent with deps.spawnFn until the control plane wires the real spawn"
	);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd apps/desktop && bun test tests/workspace-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/workspace-service.test.ts
git commit -m "feat(mcp): add workspace-service dispatchAgent (spawn DI)"
```

---

## Task 6: Refactor `workspaces` tRPC router to use service

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts`

Goal: replace inline logic in `create`, `delete`, `listByProject`, `getById` with calls into the service. Keep `checkoutExisting`, `linkFromPR`, `getOrCreateReview`, `cleanupReviewWorkspace`, `attachTerminal`, `detachTerminal` untouched (out of scope for this plan — they cover review/PR-link flows that don't share the same shape).

- [ ] **Step 1: Replace `create` mutation body**

Find the `create` block (lines ~74-160 of the current file) and replace its body with:

```ts
		create: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					branch: z.string().min(1),
					baseBranch: z.string().optional(),
				})
			)
			.mutation(async ({ input }) => {
				const { createWorkspace } = await import("../../services/workspace-service");
				const created = await createWorkspace({
					projectId: input.projectId,
					branch: input.branch,
					baseBranch: input.baseBranch,
				});

				// PR auto-detect — kept here for now since the tRPC router is the
				// only caller that knows about the cached PR poller.
				const { getCachedPRs } = await import("../../ai-review/pr-poller");
				const matchingPR = getCachedPRs(input.projectId).find(
					(pr) => pr.sourceBranch === input.branch && pr.state === "open"
				);
				if (matchingPR) {
					const db = getDb();
					db.update(workspaces)
						.set({
							prProvider: matchingPR.provider,
							prIdentifier: matchingPR.identifier,
							updatedAt: new Date(),
						})
						.where(eq(workspaces.id, created.workspaceId))
						.run();
				}

				return {
					id: created.workspaceId,
					projectId: input.projectId,
					type: "worktree" as const,
					name: input.branch,
					worktreeId: created.worktreeId,
					terminalId: null as string | null,
					prProvider: matchingPR?.provider ?? null,
					prIdentifier: matchingPR?.identifier ?? null,
					createdAt: new Date(),
					updatedAt: new Date(),
				};
			}),
```

- [ ] **Step 2: Replace `delete` mutation body**

Find the `delete` block (lines ~378-456) and replace with:

```ts
		delete: publicProcedure
			.input(z.object({ id: z.string(), force: z.boolean().optional() }))
			.mutation(async ({ input }) => {
				const db = getDb();
				const ws = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
				if (!ws) throw new Error("Workspace not found");
				const { removeWorkspace } = await import("../../services/workspace-service");
				const result = await removeWorkspace({
					projectId: ws.projectId,
					workspaceId: input.id,
					force: input.force,
				});
				if (result.status === "blocked-uncommitted") {
					throw new Error("Worktree has uncommitted changes. Commit or discard them first.");
				}
			}),
```

- [ ] **Step 3: Type-check**

Run: `bun run type-check`
Expected: PASS.

- [ ] **Step 4: Run all desktop tests**

Run: `cd apps/desktop && bun test`
Expected: PASS — workspace-service tests pass; pre-existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/workspaces.ts
git commit -m "refactor(workspaces): route create/delete through workspace-service"
```

---

## Task 7: Control plane — auth (token gen + compare)

**Files:**
- Create: `apps/desktop/src/main/control-plane/auth.ts`
- Create: `apps/desktop/tests/control-plane-auth.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/desktop/tests/control-plane-auth.test.ts
import { describe, expect, test } from "bun:test";
import { generateToken, isValidBearer } from "../src/main/control-plane/auth";

describe("control-plane auth", () => {
	test("generateToken returns 64 hex chars", () => {
		const t = generateToken();
		expect(t).toHaveLength(64);
		expect(/^[0-9a-f]+$/.test(t)).toBe(true);
	});

	test("isValidBearer accepts exact match", () => {
		const t = generateToken();
		expect(isValidBearer(`Bearer ${t}`, t)).toBe(true);
	});

	test("isValidBearer rejects wrong token", () => {
		const a = generateToken();
		const b = generateToken();
		expect(isValidBearer(`Bearer ${b}`, a)).toBe(false);
	});

	test("isValidBearer rejects missing prefix", () => {
		const t = generateToken();
		expect(isValidBearer(t, t)).toBe(false);
	});

	test("isValidBearer rejects empty/undefined header", () => {
		const t = generateToken();
		expect(isValidBearer(undefined, t)).toBe(false);
		expect(isValidBearer("", t)).toBe(false);
	});
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd apps/desktop && bun test tests/control-plane-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/main/control-plane/auth.ts
import { randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): string {
	return randomBytes(32).toString("hex");
}

export function isValidBearer(
	headerValue: string | undefined,
	expected: string
): boolean {
	if (!headerValue) return false;
	if (!headerValue.startsWith("Bearer ")) return false;
	const provided = headerValue.slice("Bearer ".length);
	if (provided.length !== expected.length) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd apps/desktop && bun test tests/control-plane-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/control-plane/auth.ts apps/desktop/tests/control-plane-auth.test.ts
git commit -m "feat(mcp): add control-plane bearer auth helpers"
```

---

## Task 8: Control plane — confirm bridge

**Files:**
- Create: `apps/desktop/src/main/control-plane/confirm-bridge.ts`

The bridge sends an IPC message to the renderer and resolves with the user's choice. The renderer side is built in Task 11.

- [ ] **Step 1: Implement**

```ts
// apps/desktop/src/main/control-plane/confirm-bridge.ts
import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";

export interface ConfirmRequest {
	kind: "dispatch" | "remove";
	workspaceName: string;
	branch: string | null;
	summary: string; // human-readable single-line summary
}

interface PendingConfirm {
	resolve: (allow: boolean) => void;
	timer: NodeJS.Timeout;
}

const TIMEOUT_MS = 30_000;
const MAX_QUEUE = 3;

const pending = new Map<string, PendingConfirm>();
let getWindow: () => BrowserWindow | null = () => null;
let registered = false;

export function registerConfirmBridge(getMainWindow: () => BrowserWindow | null): void {
	getWindow = getMainWindow;
	if (registered) return;
	registered = true;
	ipcMain.on("agent-confirm:reply", (_evt, payload: { id: string; allow: boolean }) => {
		const entry = pending.get(payload.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		pending.delete(payload.id);
		entry.resolve(payload.allow === true);
	});
}

export async function requestConfirm(req: ConfirmRequest): Promise<boolean> {
	if (pending.size >= MAX_QUEUE) return false;
	const win = getWindow();
	if (!win) return false;

	const id = randomUUID();
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			resolve(false);
		}, TIMEOUT_MS);
		pending.set(id, { resolve, timer });
		win.webContents.send("agent-confirm:request", { id, ...req });
	});
}

// Test seam — resolve all pending with `allow` (used to drain on shutdown).
export function _drainAll(allow: boolean): void {
	for (const [id, entry] of pending) {
		clearTimeout(entry.timer);
		entry.resolve(allow);
		pending.delete(id);
	}
}
```

- [ ] **Step 2: Type-check**

Run: `bun run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/control-plane/confirm-bridge.ts
git commit -m "feat(mcp): add confirm-bridge for destructive ops"
```

---

## Task 9: mcp-config helpers

**Files:**
- Create: `apps/desktop/src/main/services/mcp-config.ts`
- Create: `apps/desktop/tests/mcp-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/desktop/tests/mcp-config.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWorkspaceMcpJson } from "../src/main/services/mcp-config";

let TMP: string;

beforeEach(() => {
	TMP = mkdtempSync(join(tmpdir(), "mcp-config-"));
});
afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

const ENV = {
	mcpServerPath: "/app/server.mjs",
	execPath: "/app/electron",
	projectId: "proj-1",
	port: 51234,
	token: "t".repeat(64),
};

describe("writeWorkspaceMcpJson", () => {
	test("writes a fresh .mcp.json when none exists", () => {
		writeWorkspaceMcpJson(TMP, ENV);
		const raw = JSON.parse(readFileSync(join(TMP, ".mcp.json"), "utf-8"));
		expect(raw.mcpServers.superiorswarm.command).toBe("/app/electron");
		expect(raw.mcpServers.superiorswarm.env.SUPERIORSWARM_CONTROL_PORT).toBe("51234");
		expect(raw.mcpServers.superiorswarm.env.WORKSPACE_AGENT).toBe("1");
		expect(raw.mcpServers.superiorswarm.env.PROJECT_ID).toBe("proj-1");
	});

	test("preserves user's other mcp servers, replaces only superiorswarm entry", () => {
		writeFileSync(
			join(TMP, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					myserver: { command: "node", args: ["x.mjs"] },
					superiorswarm: { command: "stale", args: [], env: {} },
				},
			})
		);
		writeWorkspaceMcpJson(TMP, ENV);
		const raw = JSON.parse(readFileSync(join(TMP, ".mcp.json"), "utf-8"));
		expect(raw.mcpServers.myserver.command).toBe("node");
		expect(raw.mcpServers.superiorswarm.command).toBe("/app/electron");
	});

	test("overwrites cleanly when only existing server is superiorswarm", () => {
		writeFileSync(
			join(TMP, ".mcp.json"),
			JSON.stringify({ mcpServers: { superiorswarm: { command: "stale" } } })
		);
		writeWorkspaceMcpJson(TMP, ENV);
		const raw = JSON.parse(readFileSync(join(TMP, ".mcp.json"), "utf-8"));
		expect(raw.mcpServers.superiorswarm.command).toBe("/app/electron");
	});
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd apps/desktop && bun test tests/mcp-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement (reuse `mergeKey` util that already lives in ai-review/)**

The repo merged `apps/desktop/src/main/ai-review/mcp-config-merge.ts` from main — it provides `mergeKey(filePath, keyPath, value)` which atomically merges into JSON files preserving user keys, indent, and trailing newline. We reuse it.

```ts
// apps/desktop/src/main/services/mcp-config.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mergeKey } from "../ai-review/mcp-config-merge";
import { getDb } from "../db";
import { worktrees } from "../db/schema";

export interface WorkspaceMcpEnv {
	mcpServerPath: string;
	execPath: string;
	projectId: string;
	port: number;
	token: string;
}

function buildEntry(env: WorkspaceMcpEnv) {
	return {
		command: env.execPath,
		args: [env.mcpServerPath],
		env: {
			ELECTRON_RUN_AS_NODE: "1",
			WORKSPACE_AGENT: "1",
			PROJECT_ID: env.projectId,
			SUPERIORSWARM_CONTROL_PORT: String(env.port),
			SUPERIORSWARM_CONTROL_TOKEN: env.token,
		},
	};
}

export function writeWorkspaceMcpJson(worktreePath: string, env: WorkspaceMcpEnv): void {
	const file = join(worktreePath, ".mcp.json");
	mergeKey(file, ["mcpServers", "superiorswarm"], buildEntry(env));
}

export function rewriteAllWorkspaceMcpJsons(env: WorkspaceMcpEnv): void {
	const db = getDb();
	const all = db.select({ path: worktrees.path }).from(worktrees).all();
	for (const row of all) {
		try {
			if (existsSync(row.path)) writeWorkspaceMcpJson(row.path, env);
		} catch {
			// best-effort
		}
	}
}
```

Don't add a fresh `mergeKey` re-implementation. The util is already covered by `apps/desktop/tests/mcp-config-merge.test.ts` — our tests only need to verify the wrapper passes the right keypath + value.

- [ ] **Step 4: Run, expect pass**

Run: `cd apps/desktop && bun test tests/mcp-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Hook into createWorkspace**

In `services/workspace-service.ts`, modify `createWorkspace` to write the `.mcp.json` after the worktree exists. Add a singleton accessor for the env, keyed by project (filled at boot in Task 13):

```ts
// near top of services/workspace-service.ts
import { writeWorkspaceMcpJson, type WorkspaceMcpEnv } from "./mcp-config";

let mcpEnvProvider: (projectId: string) => WorkspaceMcpEnv | null = () => null;
export function setMcpEnvProvider(
	fn: (projectId: string) => WorkspaceMcpEnv | null
): void {
	mcpEnvProvider = fn;
}
```

Then at the end of `createWorkspace`, just before `return`:

```ts
	const env = mcpEnvProvider(input.projectId);
	if (env) {
		try {
			writeWorkspaceMcpJson(path, env);
		} catch (err) {
			// non-fatal — worktree still works without MCP
			console.warn("[workspace-service] writeWorkspaceMcpJson failed:", err);
		}
	}
```

Tests in Task 2-4 don't set the provider, so this is a no-op there.

- [ ] **Step 6: Run all desktop tests**

Run: `cd apps/desktop && bun test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/services/mcp-config.ts apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/mcp-config.test.ts
git commit -m "feat(mcp): write .mcp.json on worktree create"
```

---

## Task 10: Control plane — HTTP server (no confirms yet)

**Files:**
- Create: `apps/desktop/src/main/control-plane/server.ts`
- Create: `apps/desktop/src/main/control-plane/index.ts`
- Create: `apps/desktop/tests/control-plane.test.ts`

- [ ] **Step 1: Write failing test (server with stub service)**

```ts
// apps/desktop/tests/control-plane.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { initializeDatabaseAtPath } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import { startControlPlane } from "../src/main/control-plane";

let TMP: string;
let REPO: string;
let server: Awaited<ReturnType<typeof startControlPlane>>;

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "cp-"));
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);
	initializeDatabaseAtPath(join(TMP, "test.db"));
	const { getDb, schema } = await import("../src/main/db");
	const now = new Date();
	getDb()
		.insert(schema.projects)
		.values({
			id: "proj-1",
			repoPath: REPO,
			name: "repo",
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	server = await startControlPlane({
		confirm: async () => true, // auto-allow in tests
		spawnFn: async () => ({ sessionId: "s", terminalId: "t" }),
	});
});
afterEach(async () => {
	await server.stop();
	rmSync(TMP, { recursive: true, force: true });
});

const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
const auth = () => ({ Authorization: `Bearer ${server.token}` });

describe("control-plane HTTP", () => {
	test("rejects missing token with 401", async () => {
		const res = await fetch(url("/workspaces.list?projectId=proj-1"));
		expect(res.status).toBe(401);
	});

	test("rejects bad token with 401", async () => {
		const res = await fetch(url("/workspaces.list?projectId=proj-1"), {
			headers: { Authorization: "Bearer wrong" },
		});
		expect(res.status).toBe(401);
	});

	test("returns 404 for unknown route", async () => {
		const res = await fetch(url("/nope"), { headers: auth() });
		expect(res.status).toBe(404);
	});

	test("create + list + get + remove round-trip", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: "proj-1", branch: "feature/cp1" }),
		});
		expect(create.status).toBe(200);
		const created = (await create.json()) as { workspaceId: string; path: string };

		const list = await fetch(url("/workspaces.list?projectId=proj-1"), { headers: auth() });
		const listed = (await list.json()) as { workspaces: Array<{ name: string }> };
		expect(listed.workspaces.map((w) => w.name)).toContain("feature/cp1");

		const get = await fetch(
			url(`/workspaces.get?projectId=proj-1&workspaceId=${created.workspaceId}`),
			{ headers: auth() }
		);
		expect(get.status).toBe(200);

		const rm = await fetch(url("/workspaces.remove"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: "proj-1", workspaceId: created.workspaceId }),
		});
		const removed = (await rm.json()) as { status: string };
		expect(removed.status).toBe("removed");
	});

	test("403 on cross-project access", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: "proj-1", branch: "feature/cp2" }),
		});
		const created = (await create.json()) as { workspaceId: string };

		const get = await fetch(
			url(`/workspaces.get?projectId=other&workspaceId=${created.workspaceId}`),
			{ headers: auth() }
		);
		expect(get.status).toBe(403);
	});

	test("400 on invalid body", async () => {
		const res = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: "proj-1" }), // missing branch
		});
		expect(res.status).toBe(400);
	});

	test("dispatch route returns started status", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: "proj-1", branch: "feature/cp3" }),
		});
		const created = (await create.json()) as { workspaceId: string };

		const dispatch = await fetch(url("/workspaces.dispatch"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({
				projectId: "proj-1",
				workspaceId: created.workspaceId,
				prompt: "do thing",
				cliPreset: "claude",
			}),
		});
		const body = (await dispatch.json()) as { status: string };
		expect(body.status).toBe("started");
	});
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd apps/desktop && bun test tests/control-plane.test.ts`
Expected: FAIL — modules not present.

- [ ] **Step 3: Implement server**

```ts
// apps/desktop/src/main/control-plane/server.ts
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import {
	createWorkspaceRequestSchema,
	dispatchAgentRequestSchema,
	getWorkspaceRequestSchema,
	listWorkspacesRequestSchema,
	removeWorkspaceRequestSchema,
} from "../../shared/control-plane";
import {
	createWorkspace,
	dispatchAgent,
	getWorkspace,
	listWorkspaces,
	removeWorkspace,
	type SpawnFn,
} from "../services/workspace-service";
import { isValidBearer } from "./auth";

export type ConfirmFn = (req: {
	kind: "dispatch" | "remove";
	workspaceName: string;
	branch: string | null;
	summary: string;
}) => Promise<boolean>;

export interface ControlPlaneDeps {
	token: string;
	confirm: ConfirmFn;
	spawnFn: SpawnFn;
}

export function createControlPlaneServer(deps: ControlPlaneDeps): Server {
	return createServer((req, res) => {
		void handleRequest(req, res, deps).catch((err) => {
			respond(res, 500, { error: "internal", message: String(err) });
		});
	});
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	deps: ControlPlaneDeps
): Promise<void> {
	if (req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::1") {
		respond(res, 401, { error: "unauthorized" });
		return;
	}
	if (!isValidBearer(req.headers.authorization, deps.token)) {
		respond(res, 401, { error: "unauthorized" });
		return;
	}

	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const route = `${req.method ?? "GET"} ${url.pathname}`;

	try {
		switch (route) {
			case "GET /workspaces.list": {
				const parsed = listWorkspacesRequestSchema.safeParse({
					projectId: url.searchParams.get("projectId"),
				});
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, await listWorkspaces(parsed.data));
				return;
			}
			case "GET /workspaces.get": {
				const parsed = getWorkspaceRequestSchema.safeParse({
					projectId: url.searchParams.get("projectId"),
					workspaceId: url.searchParams.get("workspaceId"),
				});
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, await getWorkspace(parsed.data));
				return;
			}
			case "POST /workspaces.create": {
				const body = await readJson(req);
				const parsed = createWorkspaceRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, await createWorkspace(parsed.data));
				return;
			}
			case "POST /workspaces.dispatch": {
				const body = await readJson(req);
				const parsed = dispatchAgentRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const ws = await getWorkspace({
					projectId: parsed.data.projectId,
					workspaceId: parsed.data.workspaceId,
				});
				const allowed = await deps.confirm({
					kind: "dispatch",
					workspaceName: ws.name,
					branch: ws.branch,
					summary: `Run "${parsed.data.cliPreset ?? "claude"}" with prompt: ${parsed.data.prompt.slice(0, 200)}`,
				});
				if (!allowed) {
					respond(res, 499, { error: "cancelled_by_user" });
					return;
				}
				const result = await dispatchAgent(parsed.data, { spawnFn: deps.spawnFn });
				respond(res, 200, result);
				return;
			}
			case "POST /workspaces.remove": {
				const body = await readJson(req);
				const parsed = removeWorkspaceRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const ws = await getWorkspace({
					projectId: parsed.data.projectId,
					workspaceId: parsed.data.workspaceId,
				});
				const allowed = await deps.confirm({
					kind: "remove",
					workspaceName: ws.name,
					branch: ws.branch,
					summary: `Remove worktree for "${ws.name}"${parsed.data.force ? " (force)" : ""}`,
				});
				if (!allowed) {
					respond(res, 499, { error: "cancelled_by_user" });
					return;
				}
				const result = await removeWorkspace(parsed.data);
				respond(res, 200, result);
				return;
			}
			default:
				respond(res, 404, { error: "not_found" });
		}
	} catch (err) {
		const msg = String(err);
		if (/forbidden/i.test(msg)) {
			respond(res, 403, { error: "forbidden" });
			return;
		}
		if (/not_found/i.test(msg)) {
			respond(res, 404, { error: "not_found", message: msg });
			return;
		}
		respond(res, 409, { error: "git_conflict", message: msg });
	}
}

function respond(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	const raw = Buffer.concat(chunks).toString("utf-8");
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
```

```ts
// apps/desktop/src/main/control-plane/index.ts
import type { Server } from "node:http";
import type { SpawnFn } from "../services/workspace-service";
import { generateToken } from "./auth";
import { type ConfirmFn, createControlPlaneServer } from "./server";

export interface RunningControlPlane {
	port: number;
	token: string;
	stop: () => Promise<void>;
}

export interface StartOpts {
	confirm: ConfirmFn;
	spawnFn: SpawnFn;
	token?: string; // override for tests
}

export async function startControlPlane(opts: StartOpts): Promise<RunningControlPlane> {
	const token = opts.token ?? generateToken();
	const server: Server = createControlPlaneServer({
		token,
		confirm: opts.confirm,
		spawnFn: opts.spawnFn,
	});

	const port = await new Promise<number>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (typeof addr === "object" && addr) resolve(addr.port);
			else reject(new Error("control-plane: bad address"));
		});
	});

	return {
		port,
		token,
		async stop() {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd apps/desktop && bun test tests/control-plane.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/control-plane/server.ts apps/desktop/src/main/control-plane/index.ts apps/desktop/tests/control-plane.test.ts
git commit -m "feat(mcp): add HTTP control plane server"
```

---

## Task 11: Renderer — confirm modal + IPC wiring

**Files:**
- Create: `apps/desktop/src/renderer/components/ConfirmAgentActionModal.tsx`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Expose IPC in preload**

Find the `contextBridge.exposeInMainWorld(...)` block in `apps/desktop/src/preload/index.ts` and add an `agentConfirm` namespace:

```ts
// inside the exposed object
agentConfirm: {
	onRequest: (
		cb: (payload: {
			id: string;
			kind: "dispatch" | "remove";
			workspaceName: string;
			branch: string | null;
			summary: string;
		}) => void
	) => {
		const handler = (_e: unknown, payload: Parameters<typeof cb>[0]) => cb(payload);
		ipcRenderer.on("agent-confirm:request", handler);
		return () => ipcRenderer.off("agent-confirm:request", handler);
	},
	reply: (id: string, allow: boolean) => ipcRenderer.send("agent-confirm:reply", { id, allow }),
},
```

If `ipcRenderer` isn't already imported, import it from `electron`.

- [ ] **Step 2: Update preload type declaration**

Find the `declare global { interface Window { ... } }` block (likely in `apps/desktop/src/renderer/types/api.d.ts` or similar) and add the matching shape. Type-check will tell you the exact path:

```ts
agentConfirm: {
	onRequest: (cb: (payload: {
		id: string;
		kind: "dispatch" | "remove";
		workspaceName: string;
		branch: string | null;
		summary: string;
	}) => void) => () => void;
	reply: (id: string, allow: boolean) => void;
};
```

- [ ] **Step 3: Build the modal component**

```tsx
// apps/desktop/src/renderer/components/ConfirmAgentActionModal.tsx
import { useEffect, useState } from "react";

interface PendingRequest {
	id: string;
	kind: "dispatch" | "remove";
	workspaceName: string;
	branch: string | null;
	summary: string;
}

export function ConfirmAgentActionModal() {
	const [req, setReq] = useState<PendingRequest | null>(null);

	useEffect(() => {
		const off = window.api.agentConfirm.onRequest((payload) => setReq(payload));
		return off;
	}, []);

	if (!req) return null;

	const reply = (allow: boolean) => {
		window.api.agentConfirm.reply(req.id, allow);
		setReq(null);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-[480px] rounded-md bg-zinc-900 p-5 text-zinc-100 shadow-xl">
				<h2 className="text-base font-semibold">
					{req.kind === "dispatch" ? "Allow agent dispatch?" : "Allow worktree removal?"}
				</h2>
				<p className="mt-2 text-sm text-zinc-400">
					Workspace: <span className="text-zinc-100">{req.workspaceName}</span>
					{req.branch ? (
						<>
							{" • "}
							<span className="text-zinc-100">{req.branch}</span>
						</>
					) : null}
				</p>
				<p className="mt-3 break-words text-sm">{req.summary}</p>
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						className="rounded bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600"
						onClick={() => reply(false)}
					>
						Deny
					</button>
					<button
						type="button"
						className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
						onClick={() => reply(true)}
					>
						Allow
					</button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Mount modal in App.tsx**

Add an import and render `<ConfirmAgentActionModal />` once near the root of `App.tsx` (e.g. just before the closing fragment of the top-level component). The modal renders nothing when no request is pending, so placement is forgiving.

- [ ] **Step 5: Type-check + lint**

```
bun run type-check
bun run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/ConfirmAgentActionModal.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/preload/index.ts
# include the type-decl file if you edited one
git commit -m "feat(mcp): add agent confirm modal + IPC bridge"
```

---

## Task 12: Real spawn — wire dispatchAgent's default spawn to the daemon

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`

We swap `defaultSpawnFn` from the test stub to a real implementation that asks the daemon to start a terminal session with the launch script, persists a `terminalSessions` row, and returns ids. **Export it** so Task 13 can wire the control-plane's `spawnFn` to it.

- [ ] **Step 1: Implement defaultSpawnFn (and export it)**

Replace the `defaultSpawnFn` stub with the version below, and change `async function defaultSpawnFn` → `export async function defaultSpawnFn`:

```ts
export async function defaultSpawnFn(args: SpawnArgs): Promise<SpawnResult> {
	const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { nanoid } = await import("nanoid");

	const dir = mkdtempSync(join(tmpdir(), "ss-dispatch-"));
	const scriptPath = join(dir, "launch.sh");
	writeFileSync(scriptPath, args.launchScript, "utf-8");
	chmodSync(scriptPath, 0o755);

	const sessionId = nanoid();
	const terminalId = sessionId;

	const daemon = getDaemonClient();
	if (!daemon) throw new Error("Terminal daemon not available");

	await daemon.create(
		terminalId,
		args.cwd,
		() => undefined, // data — daemon also persists scrollback
		() => undefined, // exit
		{ SHELL_LAUNCH_SCRIPT: scriptPath }
	);

	const db = getDb();
	const now = new Date();
	db.insert(terminalSessions)
		.values({
			id: sessionId,
			workspaceId: args.workspaceId,
			title: "Agent session",
			cwd: args.cwd,
			sortOrder: 999,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	return { sessionId, terminalId };
}
```

NOTE: the exact field set on `terminalSessions` depends on the schema. Read `apps/desktop/src/main/db/schema.ts` for the `terminalSessions` table and adjust the insert to match required columns. The columns shown above match the `sessionInput` shape in `terminal-sessions.ts`. `daemon.create`'s env-arg behavior may differ — open `apps/desktop/src/main/terminal/daemon-client.ts` to confirm the exact signature; if it doesn't accept a launch-script env, write the script invocation directly into `args.launchScript` (which already has `cd ... && cli ...`) and pipe it to a fresh shell via `daemon.create(...)`'s data path. The simplest path: have the daemon spawn `bash <scriptPath>` as the shell command.

- [ ] **Step 2: Manual sanity-check**

This path is hard to unit-test (real daemon process). Run the app and verify the existing `workspaces.create` flow still works (the renderer hasn't changed; it just routes through the service now). Then move on to Task 13 — full e2e is the final smoke test.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts
git commit -m "feat(mcp): wire dispatchAgent default spawn to terminal daemon"
```

---

## Task 13: Boot wiring in main/index.ts

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Start control plane after DB init, register confirm bridge**

Add imports near the top:

```ts
import { startControlPlane, type RunningControlPlane } from "./control-plane";
import { registerConfirmBridge, requestConfirm } from "./control-plane/confirm-bridge";
import { defaultSpawnFn, setMcpEnvProvider } from "./services/workspace-service";
import { writeWorkspaceMcpJson } from "./services/mcp-config";
import { getMcpServerPath } from "./ai-review/mcp-path";
```

Add a module-level holder:

```ts
let controlPlane: RunningControlPlane | null = null;
```

Inside `app.whenReady().then(async () => { ... })`, after `initializeDatabase()` succeeds and after `createWindow()`, add:

```ts
	registerConfirmBridge(() => mainWindow);

	try {
		controlPlane = await startControlPlane({
			confirm: (r) => requestConfirm(r),
			spawnFn: defaultSpawnFn,
		});

		const baseEnv = {
			mcpServerPath: getMcpServerPath(),
			execPath: process.execPath,
			port: controlPlane.port,
			token: controlPlane.token,
		};
		setMcpEnvProvider((projectId) => ({ ...baseEnv, projectId }));

		// Walk all worktree rows; rewrite each .mcp.json with fresh port + token,
		// using each worktree's own project id.
		const { getDb } = await import("./db");
		const { worktrees: wtTable, workspaces: wsTable } = await import("./db/schema");
		const { eq } = await import("drizzle-orm");
		const { existsSync } = await import("node:fs");
		const rows = getDb()
			.select({ path: wtTable.path, projectId: wsTable.projectId })
			.from(wtTable)
			.leftJoin(wsTable, eq(wsTable.worktreeId, wtTable.id))
			.all();
		for (const r of rows) {
			if (r.path && r.projectId && existsSync(r.path)) {
				try {
					writeWorkspaceMcpJson(r.path, { ...baseEnv, projectId: r.projectId });
				} catch (err) {
					log.warn("[mcp-config] rewrite failed:", err);
				}
			}
		}

		log.info(`[control-plane] listening on 127.0.0.1:${controlPlane.port}`);
	} catch (err) {
		log.error("[control-plane] failed to start:", err);
	}
```

- [ ] **Step 2: On app shutdown, close server**

Find the `before-quit` / `will-quit` handler and add:

```ts
app.on("will-quit", async (e) => {
	if (controlPlane) {
		e.preventDefault();
		try {
			await controlPlane.stop();
		} finally {
			controlPlane = null;
			app.quit();
		}
	}
});
```

If a similar handler already exists, fold the close logic into it instead of duplicating the listener.

- [ ] **Step 3: Type-check, lint, run tests**

```
bun run type-check
bun run check
cd apps/desktop && bun test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(mcp): wire control plane + .mcp.json rewrite at boot"
```

---

## Task 14: MCP server — WORKSPACE_AGENT mode

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs`

- [ ] **Step 1: Add the mode + tools**

Near the top of `server.mjs`, after the existing env reads, add:

```js
const WORKSPACE_AGENT = process.env.WORKSPACE_AGENT === "1";
const PROJECT_ID = process.env.PROJECT_ID;
const CONTROL_PORT = process.env.SUPERIORSWARM_CONTROL_PORT;
const CONTROL_TOKEN = process.env.SUPERIORSWARM_CONTROL_TOKEN;
const isWorkspaceAgentMode = WORKSPACE_AGENT;

if (isWorkspaceAgentMode && (!PROJECT_ID || !CONTROL_PORT || !CONTROL_TOKEN)) {
	console.error("WORKSPACE_AGENT mode requires PROJECT_ID, SUPERIORSWARM_CONTROL_PORT, SUPERIORSWARM_CONTROL_TOKEN");
	process.exit(1);
}
```

Adjust the existing top-level guard (lines ~22-29) so workspace-agent mode is accepted as a valid mode and does NOT require `REVIEW_DRAFT_ID` or `DB_PATH`:

```js
if (
	!isWorkspaceAgentMode &&
	!isQuickActionMode &&
	!isSolverMode &&
	(!REVIEW_DRAFT_ID || !DB_PATH)
) {
	console.error("Missing required env vars: REVIEW_DRAFT_ID or SOLVE_SESSION_ID, and DB_PATH");
	process.exit(1);
}
```

Also: don't open SQLite in workspace-agent mode. Wrap the `db = new Database(DB_PATH)` block in a guard:

```js
let db = null;
if (!isWorkspaceAgentMode) {
	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("foreign_keys = ON");
}
```

(Find the existing 4-line block and wrap it; leave the rest of the modes unchanged — they all still see `db`.)

Add the mode block at the end of the existing mode if-blocks (after the `isQuickActionMode` block, before `// Start the server`):

```js
if (isWorkspaceAgentMode) {
	const baseUrl = `http://127.0.0.1:${CONTROL_PORT}`;
	const authHeader = `Bearer ${CONTROL_TOKEN}`;

	async function call(method, path, body) {
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				method,
				headers: {
					Authorization: authHeader,
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
			});
			const text = await res.text();
			let parsed;
			try {
				parsed = text ? JSON.parse(text) : {};
			} catch {
				parsed = { raw: text };
			}
			if (!res.ok) {
				return {
					content: [{ type: "text", text: JSON.stringify({ status: res.status, ...parsed }) }],
					isError: true,
				};
			}
			return { content: [{ type: "text", text: JSON.stringify(parsed) }] };
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `control plane unreachable — is SuperiorSwarm running? (${err && err.message ? err.message : String(err)})`,
					},
				],
				isError: true,
			};
		}
	}

	server.tool(
		"create_worktree",
		"Create a new app-managed worktree for a new branch. The new worktree gets its own .mcp.json so child agents inherit the same control plane.",
		{
			branch: z.string().describe("Branch name to create"),
			base_branch: z.string().optional().describe("Branch to fork from. Defaults to project default branch."),
		},
		async ({ branch, base_branch }) =>
			call("POST", "/workspaces.create", {
				projectId: PROJECT_ID,
				branch,
				baseBranch: base_branch,
			})
	);

	server.tool(
		"list_workspaces",
		"List all workspaces (worktrees and review sessions) in the current project.",
		{},
		async () => call("GET", `/workspaces.list?projectId=${encodeURIComponent(PROJECT_ID)}`)
	);

	server.tool(
		"get_workspace",
		"Get details about a specific workspace, including whether it has uncommitted changes.",
		{ workspace_id: z.string().describe("Workspace ID") },
		async ({ workspace_id }) =>
			call(
				"GET",
				`/workspaces.get?projectId=${encodeURIComponent(PROJECT_ID)}&workspaceId=${encodeURIComponent(workspace_id)}`
			)
	);

	server.tool(
		"dispatch_agent",
		"Open a terminal in the target workspace and run the configured CLI agent with a prompt. User must approve via app modal.",
		{
			workspace_id: z.string().describe("Workspace ID to dispatch into"),
			prompt: z.string().describe("Prompt to send to the CLI agent"),
			cli_preset: z.enum(["claude", "codex", "gemini", "opencode"]).optional(),
			skip_permissions: z.boolean().optional(),
		},
		async ({ workspace_id, prompt, cli_preset, skip_permissions }) =>
			call("POST", "/workspaces.dispatch", {
				projectId: PROJECT_ID,
				workspaceId: workspace_id,
				prompt,
				cliPreset: cli_preset,
				skipPermissions: skip_permissions,
			})
	);

	server.tool(
		"remove_worktree",
		"Remove a worktree and its workspace. User must approve via app modal. Set force=true to bypass uncommitted-changes guard.",
		{
			workspace_id: z.string().describe("Workspace ID to remove"),
			force: z.boolean().optional().describe("Bypass uncommitted-changes guard"),
		},
		async ({ workspace_id, force }) =>
			call("POST", "/workspaces.remove", {
				projectId: PROJECT_ID,
				workspaceId: workspace_id,
				force,
			})
	);
}
```

- [ ] **Step 2: Type-check (the .mjs is plain JS, but tsc still validates JSDoc-typed neighbors)**

Run: `bun run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs
git commit -m "feat(mcp): add WORKSPACE_AGENT mode with 5 tools"
```

---

## Task 15: Smoke test + done

**Files:**
- (none — manual)

- [ ] **Step 1: Build the app**

```bash
bun run build
```

Expected: succeeds.

- [ ] **Step 2: Run dev**

```bash
bun run dev
```

- [ ] **Step 3: Manual smoke test**

In the app:

1. Create a new worktree via the existing UI (call it `feature/mcp-smoke`).
2. Verify `.mcp.json` exists at the worktree root with `WORKSPACE_AGENT=1` and a port + token.
3. `cd` into the worktree and run `claude --dangerously-skip-permissions`.
4. Inside the agent, ask: "List my workspaces using SuperiorSwarm MCP." → should return the current workspace.
5. Ask: "Create a worktree called feature/mcp-child off main." → app should create the worktree (no modal, creation isn't gated). Verify it shows up in the app sidebar.
6. Ask: "Dispatch the claude CLI into feature/mcp-child with the prompt 'echo hello'." → confirm modal must appear in app. Click Allow → terminal opens in that workspace and runs `claude 'echo hello'`.
7. Click Deny on a second dispatch → MCP returns `cancelled_by_user`.
8. Ask the agent: "Remove the feature/mcp-child workspace." → confirm modal appears.
9. Quit the app, relaunch, verify the existing worktree's `.mcp.json` was rewritten (token/port differ from the previous run).
10. Inside the agent (still using the OLD `.mcp.json` env): the next call should fail with `unauthorized`. Restarting the agent reloads `.mcp.json` and recovers.

- [ ] **Step 4: Final commit (no code, just the plan)**

If you discovered any deltas from the plan during smoke testing, add them as follow-up issues — do not amend prior commits.

---

## Out of scope / follow-ups

- Headless dispatch mode (returning a session id without a terminal) — design step deferred.
- Per-tool allow/deny settings UI — replace confirm-modal with a settings-driven policy.
- Streaming dispatch status (long-poll on `/workspaces.dispatch.status`).
- `branch_*` tools for git operations beyond worktree create/remove.

## Self-review notes

- Spec coverage: every spec section has at least one task. Tools surface → Tasks 14 + service tasks. Trust/auth → Tasks 7, 8, 11, 13. Data flow → composed across 6, 10, 13, 14. Error model → Task 10. Testing strategy → Tasks 2-4, 7, 9, 10 + Task 15 manual.
- Type/name consistency: `setMcpEnvProvider` signature is locked to `(projectId: string) => WorkspaceMcpEnv | null` from Task 9 Step 5 onward; Task 13 uses the same form. `defaultSpawnFn` is exported from `workspace-service.ts` in Task 12 so Task 13 can pass it straight to `startControlPlane({ spawnFn })`.
- No `TBD` / `TODO` placeholders remain. Where the plan defers concrete details (e.g. `terminalSessions` schema fields, `daemon.create` exact signature in Task 12), it tells the engineer to read a specific file to confirm rather than guess.
