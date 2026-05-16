# Agent Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add status publication, peer messaging, orchestrator designation, and Claude session resume to the MCP control plane so coordination agents can monitor and follow up on child agents running in worktrees.

**Architecture:** Agents publish `phase + status_text + needs` to their `workspaces` row via a new `set_status` MCP tool. A new `agent_messages` table holds durable peer notes, questions, answers, and a log of orchestrator resume calls. The control plane exposes 4 new HTTP routes plus a Server-Sent Events feed (`/workspaces.watch`). One workspace per project is designated `is_orchestrator` and is the only entity authorized to call `resume_agent`, which `daemon.write`s `claude --resume <session_id> "<message>"` into the workspace's existing terminal. Identity is environmental: every `.mcp.json` carries `WORKSPACE_ID`, the MCP server attaches `X-Workspace-Id` to every HTTP call, and the control plane derives caller identity from headers.

**Tech Stack:** Electron 30, Bun (test runner + package manager), TypeScript (strict), Drizzle ORM + better-sqlite3, simple-git, zod, native Node `http` + `crypto`. No new dependencies. Tests use `bun:test`.

---

## Spec reference

Spec: `docs/superpowers/specs/2026-05-12-agent-coordination-design.md`. Read it first.

## File structure

**New files:**
- `apps/desktop/src/main/control-plane/event-bus.ts` — per-project subscriber registry for SSE.
- `apps/desktop/tests/agent-coordination.test.ts` — integration tests for set_status, messages, SSE, resume.

**Modified files:**
- `apps/desktop/src/main/db/schema.ts` — add columns to `workspaces`, add `agent_messages` table.
- `apps/desktop/src/main/db/migrations/*` — auto-generated migration (one file).
- `apps/desktop/src/shared/control-plane.ts` — zod schemas + DTOs for the 4 new operations.
- `apps/desktop/src/main/services/workspace-service.ts` — add `setStatus`, `sendMessage`, `readMessages`, `resumeAgent`, `setOrchestrator`; modify `createWorkspace` and `dispatchAgent` for session id minting.
- `apps/desktop/src/main/services/mcp-config.ts` — `WorkspaceMcpEnv` gains `workspaceId`; entry includes `WORKSPACE_ID` env.
- `apps/desktop/src/main/control-plane/server.ts` — extract `X-Workspace-Id` header into a request context, add 4 new routes + SSE route, wire event-bus emits.
- `apps/desktop/src/main/control-plane/index.ts` — pass event bus into server.
- `apps/desktop/src/main/index.ts` — boot rewrite passes workspaceId per row; (no changes to control-plane start otherwise).
- `apps/desktop/src/main/trpc/routers/workspaces.ts` — `setOrchestrator` mutation, extend `listByProject` / `getById` DTOs.
- `apps/desktop/mcp-standalone/server.mjs` — WORKSPACE_AGENT mode reads `WORKSPACE_ID`, sends as header, registers 4 new tools.
- `apps/desktop/src/renderer/components/WorkspaceItem.tsx` (or sibling sidebar component) — phase badge, status_text, needs line, orchestrator pill, context-menu entry.

---

## Conventions used in this plan

- Run a single test file: `cd apps/desktop && bun test tests/<name>.test.ts`
- Run all tests for the app: `cd apps/desktop && bun test`
- Type-check: `bun run type-check` (from repo root)
- Format + lint: `bun run check` (Biome) — runs as a pre-commit hook
- Generate migrations: `cd apps/desktop && bun run db:generate --name <descriptive_name>`
- Commit after each task. Use Conventional Commits. Never `--no-verify`. Never add `Co-Authored-By` trailers.
- The plan stages files explicitly per task — do NOT use `git add -A`.
- Existing patterns to follow:
  - `WORKSPACE_SELECT` constant for workspace projections.
  - `WorkspaceRow` style local types when joining tables.
  - Service functions throw `Error("forbidden")` / `Error("not_found: ...")`; control plane maps to status codes via the existing anchored-regex pattern.

---

## Task 1: Verify `claude --session-id` flag

**Files:**
- (none — verification only, may add a note to spec if needed)

This gates everything else. The plan assumes Claude Code accepts `--session-id <uuid>` to set the new session's id. If it doesn't, the fallback is `claude -p --output-format json '<prompt>'` and parsing `session_id` from the first JSON line — significantly messier. Verify before proceeding.

- [ ] **Step 1: Run a smoke test**

```bash
TEST_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
mkdir -p /tmp/ss-claude-check && cd /tmp/ss-claude-check
claude --session-id "$TEST_UUID" --print 'reply with the literal string OK'
```

Expected: claude prints `OK` (or similar). Process exits cleanly.

Verify the session is recoverable:
```bash
claude --resume "$TEST_UUID" --print 'reply with the literal string OK2'
```
Expected: claude prints `OK2`. The session id from above worked.

- [ ] **Step 2: If it worked, proceed to Task 2. If it didn't, STOP and report back**

If the `--session-id` flag is rejected ("unknown option" or similar), report to the user with the exact error. We need to decide between:
- Fallback A: parse `session_id` from `claude -p --output-format json` output and store it. Add ~30 LOC to `defaultSpawnFn`.
- Fallback B: skip `dispatchAgent` session-id capture entirely. `resume_agent` only works for workspaces where the user manually configured a session id via the renderer. Lose most of the value.

Do not write any code until this decision is made.

- [ ] **Step 3: Commit a marker**

No code, but record the verification:
```bash
git commit --allow-empty -m "chore(plan): verified claude --session-id works"
```

---

## Task 2: DB migration — workspace columns + agent_messages table

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts`
- Create: `apps/desktop/src/main/db/migrations/<timestamp>_add_agent_coordination_fields.sql` (auto-generated)

- [ ] **Step 1: Extend `workspaces` table definition in `schema.ts`**

Find the existing `workspaces` table block. Add these columns:

```ts
export const workspaces = sqliteTable("workspaces", {
	// ... existing columns ...
	currentPhase: text("current_phase", {
		enum: ["idle", "working", "blocked", "done"],
	})
		.notNull()
		.default("idle"),
	statusText: text("status_text"),
	needs: text("needs"),
	statusUpdatedAt: integer("status_updated_at", { mode: "timestamp" }),
	cliSessionId: text("cli_session_id"),
	cliPreset: text("cli_preset"),
	isOrchestrator: integer("is_orchestrator", { mode: "boolean" })
		.notNull()
		.default(false),
});
```

- [ ] **Step 2: Add the `agent_messages` table to `schema.ts`**

Append after the `workspaces` block:

```ts
export const agentMessages = sqliteTable(
	"agent_messages",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		fromWorkspaceId: text("from_workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		toWorkspaceId: text("to_workspace_id").references(() => workspaces.id, {
			onDelete: "cascade",
		}),
		kind: text("kind", {
			enum: ["resume", "note", "question", "answer", "broadcast"],
		}).notNull(),
		content: text("content").notNull(),
		inReplyTo: text("in_reply_to"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(t) => ({
		toIdx: index("agent_messages_to_idx").on(t.toWorkspaceId, t.createdAt),
		projectIdx: index("agent_messages_project_idx").on(t.projectId, t.createdAt),
	})
);

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
```

Make sure `index` is imported from `drizzle-orm/sqlite-core` at the top of the file (it may already be).

- [ ] **Step 3: Generate the migration**

```bash
cd apps/desktop && bun run db:generate --name add_agent_coordination_fields
```

Expected: one new SQL file in `src/main/db/migrations/` plus an updated `meta/_journal.json`.

- [ ] **Step 4: Inspect the generated SQL**

Open the new migration file. Confirm:
- `ALTER TABLE workspaces ADD COLUMN current_phase ...` etc. for the 7 new columns.
- `CREATE TABLE agent_messages (...)` with the 2 indexes.
- No destructive operations on existing columns.

- [ ] **Step 5: Run all existing tests to confirm migration applies cleanly**

```bash
cd apps/desktop && bun test tests/workspace-service.test.ts tests/control-plane.test.ts tests/mcp-config.test.ts tests/control-plane-auth.test.ts
```
Expected: all 33 pre-existing tests still PASS (migrate runs in `beforeAll`).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/migrations/
git commit -m "feat(db): add agent coordination columns + agent_messages table"
```

---

## Task 3: Shared request/response schemas

**Files:**
- Modify: `apps/desktop/src/shared/control-plane.ts`

- [ ] **Step 1: Append new zod schemas + DTOs**

Add after the existing schemas:

```ts
// ---- Status ----

export const phaseSchema = z.enum(["idle", "working", "blocked", "done"]);
export type WorkspacePhase = z.infer<typeof phaseSchema>;

export const setStatusRequestSchema = z.object({
	phase: phaseSchema,
	statusText: z.string().max(2000).optional(),
	needs: z.string().max(2000).optional(),
});
export type SetStatusRequest = z.infer<typeof setStatusRequestSchema>;

export interface SetStatusResponse {
	ok: true;
}

// ---- Messages ----

export const messageKindSchema = z.enum(["note", "question", "answer"]);
export type MessageKindInput = z.infer<typeof messageKindSchema>;

export const sendMessageRequestSchema = z.object({
	toWorkspaceId: z.string().min(1).optional(),
	kind: messageKindSchema,
	content: z.string().min(1).max(8192),
	inReplyTo: z.string().min(1).optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export interface SendMessageResponse {
	messageId: string;
}

export const readMessagesRequestSchema = z.object({
	since: z.string().datetime().optional(),
	includeBroadcasts: z.boolean().optional(),
});
export type ReadMessagesRequest = z.infer<typeof readMessagesRequestSchema>;

export interface AgentMessageDto {
	id: string;
	fromWorkspaceId: string;
	toWorkspaceId: string | null;
	kind: "resume" | "note" | "question" | "answer" | "broadcast";
	content: string;
	inReplyTo: string | null;
	createdAt: string; // ISO
}

export interface ReadMessagesResponse {
	messages: AgentMessageDto[];
}

// ---- Resume ----

export const resumeAgentRequestSchema = z.object({
	workspaceId: z.string().min(1),
	message: z.string().min(1).max(8192),
});
export type ResumeAgentRequest = z.infer<typeof resumeAgentRequestSchema>;

export interface ResumeAgentResponse {
	ok: true;
	messageId: string;
}

// ---- Workspace DTO extension ----

// Add fields to the existing WorkspaceDto interface. Update the definition
// in this file so all consumers see the extension.

// (Extend the existing WorkspaceDto interface body to add:)
//   currentPhase: WorkspacePhase;
//   statusText: string | null;
//   needs: string | null;
//   statusUpdatedAt: string | null;
//   isOrchestrator: boolean;
//   cliPreset: string | null;
```

For the existing `WorkspaceDto` interface body, find it and add these properties:

```ts
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
	// ---- NEW ----
	currentPhase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
	statusUpdatedAt: string | null;
	isOrchestrator: boolean;
	cliPreset: string | null;
}
```

- [ ] **Step 2: Type-check**

```bash
bun run type-check
```
Expected: PASS. There will be compile errors in `workspace-service.ts` because `WORKSPACE_SELECT` returns rows that don't yet include the new fields. Resolve them in Task 6.

Wait — re-order: if `WorkspaceDto` widens but the select hasn't been updated, the existing `rowToDto` in `workspace-service.ts` will fail to compile. So either widen DTO AND select in one task, or add the DTO fields as optional now and tighten later.

For simplicity, keep them required in DTO but update `WORKSPACE_SELECT` + `rowToDto` in this task too:

- [ ] **Step 2.1: Update `WORKSPACE_SELECT` in `workspace-service.ts`**

Add the new column projections:

```ts
const WORKSPACE_SELECT = {
	// ... existing fields ...
	currentPhase: workspaces.currentPhase,
	statusText: workspaces.statusText,
	needs: workspaces.needs,
	statusUpdatedAt: workspaces.statusUpdatedAt,
	isOrchestrator: workspaces.isOrchestrator,
	cliPreset: workspaces.cliPreset,
} as const;
```

- [ ] **Step 2.2: Update `rowToDto`**

```ts
function rowToDto(row: WorkspaceRow): WorkspaceDto {
	return {
		// ... existing fields ...
		currentPhase: row.currentPhase,
		statusText: row.statusText,
		needs: row.needs,
		statusUpdatedAt: row.statusUpdatedAt
			? row.statusUpdatedAt.toISOString()
			: null,
		isOrchestrator: row.isOrchestrator,
		cliPreset: row.cliPreset,
	};
}
```

Update the `WorkspaceRow` local type to include the new fields (mirror the SELECT shape).

- [ ] **Step 3: Run existing tests**

```bash
cd apps/desktop && bun test tests/workspace-service.test.ts tests/control-plane.test.ts
```
Expected: PASS. The DTO change is additive and existing tests check by-key, not by-shape.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/shared/control-plane.ts apps/desktop/src/main/services/workspace-service.ts
git commit -m "feat(mcp): add coordination schemas + extend WorkspaceDto"
```

---

## Task 4: WORKSPACE_ID env in .mcp.json

**Files:**
- Modify: `apps/desktop/src/main/services/mcp-config.ts`
- Modify: `apps/desktop/src/main/services/workspace-service.ts` (callsite)
- Modify: `apps/desktop/src/main/index.ts` (boot rewrite callsite)
- Modify: `apps/desktop/tests/mcp-config.test.ts`

- [ ] **Step 1: Extend `WorkspaceMcpEnv`**

In `apps/desktop/src/main/services/mcp-config.ts`:

```ts
export interface WorkspaceMcpEnv {
	mcpServerPath: string;
	execPath: string;
	projectId: string;
	workspaceId: string; // ← NEW
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
			WORKSPACE_ID: env.workspaceId, // ← NEW
			SUPERIORSWARM_CONTROL_PORT: String(env.port),
			SUPERIORSWARM_CONTROL_TOKEN: env.token,
		},
	};
}
```

- [ ] **Step 2: Update the mcp-config test to assert the new env var**

In `apps/desktop/tests/mcp-config.test.ts`, update the `ENV` constant and the "writes a fresh .mcp.json" test:

```ts
const ENV = {
	mcpServerPath: "/app/server.mjs",
	execPath: "/app/electron",
	projectId: "proj-1",
	workspaceId: "ws-1", // ← NEW
	port: 51234,
	token: "t".repeat(64),
};
```

Add an assertion in the existing "writes a fresh .mcp.json" test:

```ts
expect(raw.mcpServers.superiorswarm.env.WORKSPACE_ID).toBe("ws-1");
```

- [ ] **Step 3: Run mcp-config tests, expect fail (assertion against missing field)**

```bash
cd apps/desktop && bun test tests/mcp-config.test.ts
```
Expected: the assertion `WORKSPACE_ID === "ws-1"` fails because the impl hasn't been changed yet to include it. After Step 1 it should pass — re-run.

```bash
cd apps/desktop && bun test tests/mcp-config.test.ts
```
Expected: 3/3 PASS now.

- [ ] **Step 4: Update `setMcpEnvProvider` callers and signature**

In `apps/desktop/src/main/services/workspace-service.ts`, find `setMcpEnvProvider` and change the provider signature:

```ts
let mcpEnvProvider: (workspaceId: string, projectId: string) => WorkspaceMcpEnv | null =
	() => null;
export function setMcpEnvProvider(
	fn: (workspaceId: string, projectId: string) => WorkspaceMcpEnv | null
): void {
	mcpEnvProvider = fn;
}
```

And in `createWorkspace`, change the call from `mcpEnvProvider(input.projectId)` to `mcpEnvProvider(workspaceId, input.projectId)`. (`workspaceId` is the local variable already minted earlier in the function.)

- [ ] **Step 5: Update `main/index.ts` boot wiring**

Find the existing `setMcpEnvProvider` callsite and the rewrite loop. Change:

```ts
setMcpEnvProvider((workspaceId, projectId) => ({
	...baseEnv,
	workspaceId,
	projectId,
}));
```

And in the rewrite loop, pass `r.workspaceId` (you'll need to add it to the query). Add `workspaceId` to the SELECT:

```ts
const rows = getDb()
	.select({
		path: schema.worktrees.path,
		projectId: schema.worktrees.projectId,
		workspaceId: schema.workspaces.id,
	})
	.from(schema.worktrees)
	.leftJoin(schema.workspaces, eq(schema.workspaces.worktreeId, schema.worktrees.id))
	.all();

for (const r of rows) {
	if (r.path && r.projectId && r.workspaceId && existsSync(r.path)) {
		try {
			writeWorkspaceMcpJson(r.path, {
				...baseEnv,
				workspaceId: r.workspaceId,
				projectId: r.projectId,
			});
		} catch (err) {
			log.warn("[mcp-config] rewrite failed:", err);
		}
	}
}
```

The `eq` import already exists in `main/index.ts` for the existing rewrite, and `schema.workspaces` is already imported.

- [ ] **Step 6: Type-check and run existing tests**

```bash
bun run type-check
cd apps/desktop && bun test
```
Expected: type-check PASS. Pre-existing tests (workspace-service, control-plane, mcp-config) still PASS. Other pre-existing test failures (LSP, branch-ops timeouts) are unrelated — ignore.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/services/mcp-config.ts apps/desktop/src/main/services/workspace-service.ts apps/desktop/src/main/index.ts apps/desktop/tests/mcp-config.test.ts
git commit -m "feat(mcp): inject WORKSPACE_ID into .mcp.json"
```

---

## Task 5: server.mjs sends X-Workspace-Id header

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs`

- [ ] **Step 1: Read WORKSPACE_ID + send as header**

In `mcp-standalone/server.mjs`, find the env-reads block at top (PROJECT_ID, SUPERIORSWARM_CONTROL_PORT, SUPERIORSWARM_CONTROL_TOKEN). Add:

```js
const WORKSPACE_ID = process.env.WORKSPACE_ID;
```

In the WORKSPACE_AGENT mode validation guard, add `WORKSPACE_ID` to the required-vars list:

```js
if (
	isWorkspaceAgentMode &&
	(!PROJECT_ID || !WORKSPACE_ID || !SUPERIORSWARM_CONTROL_PORT || !SUPERIORSWARM_CONTROL_TOKEN)
) {
	console.error(
		"WORKSPACE_AGENT mode requires PROJECT_ID, WORKSPACE_ID, SUPERIORSWARM_CONTROL_PORT, SUPERIORSWARM_CONTROL_TOKEN"
	);
	process.exit(1);
}
```

In the `call(method, path, body)` helper inside the `if (isWorkspaceAgentMode)` block, add the header:

```js
const res = await fetch(`${baseUrl}${path}`, {
	method,
	headers: {
		Authorization: authHeader,
		"X-Workspace-Id": WORKSPACE_ID,
		...(body ? { "Content-Type": "application/json" } : {}),
	},
	body: body ? JSON.stringify(body) : undefined,
});
```

- [ ] **Step 2: Syntax + run regression tests**

```bash
node --check apps/desktop/mcp-standalone/server.mjs
cd apps/desktop && bun test tests/control-plane.test.ts
```
Expected: syntax OK. Control-plane tests pass — they don't go through `server.mjs`, so the new header is invisible to them.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs
git commit -m "feat(mcp): server.mjs sends X-Workspace-Id header"
```

---

## Task 6: Control plane extracts X-Workspace-Id into request context

**Files:**
- Modify: `apps/desktop/src/main/control-plane/server.ts`

The new tools need to know who's calling. Existing tools don't, but they shouldn't break if the header is absent.

- [ ] **Step 1: Add context extraction helper**

In `apps/desktop/src/main/control-plane/server.ts`, near the top after imports, add:

```ts
export interface CallerContext {
	workspaceId: string;
	projectId: string;
}

async function resolveCaller(
	req: IncomingMessage,
	projectIdHint: string | null
): Promise<CallerContext | { error: string }> {
	const wsId = req.headers["x-workspace-id"];
	if (typeof wsId !== "string" || wsId.length === 0) {
		return { error: "missing X-Workspace-Id header" };
	}
	const { getDb } = await import("../db");
	const { workspaces } = await import("../db/schema");
	const { eq } = await import("drizzle-orm");
	const row = getDb()
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, wsId))
		.get();
	if (!row) return { error: "unknown workspace" };
	if (projectIdHint && row.projectId !== projectIdHint) {
		return { error: "workspace/project mismatch" };
	}
	return { workspaceId: wsId, projectId: row.projectId };
}
```

We use dynamic imports to avoid a top-level cycle with the db module; alternatively, hoist these imports if no cycle exists. (Read the file — if `getDb` is already imported at the top, use that directly without dynamic.)

- [ ] **Step 2: Run regression tests**

No new routes yet — just the helper exists. Pre-existing tests must still pass.

```bash
cd apps/desktop && bun test tests/control-plane.test.ts
```
Expected: 9/9 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/control-plane/server.ts
git commit -m "feat(mcp): add X-Workspace-Id caller-context resolver"
```

---

## Task 7: workspace-service — setStatus + setOrchestrator

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Create: `apps/desktop/tests/agent-coordination.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/desktop/tests/agent-coordination.test.ts`:

```ts
import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import {
	createWorkspace,
	setOrchestrator,
	setStatus,
} from "../src/main/services/workspace-service";

let TMP: string;
let REPO: string;
let PROJECT_ID: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "coord-"));
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);

	PROJECT_ID = `proj-${nanoid(8)}`;
	const db = getDb();
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			repoPath: REPO,
			name: "repo",
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
});

afterEach(() => {
	const db = getDb();
	db.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

describe("setStatus", () => {
	test("updates phase + status_text + needs", async () => {
		const ws = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/a" });
		await setStatus(
			{ workspaceId: ws.workspaceId, projectId: PROJECT_ID },
			{ phase: "blocked", statusText: "waiting", needs: "decision X" }
		);
		const db = getDb();
		const row = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, ws.workspaceId))
			.get();
		expect(row?.currentPhase).toBe("blocked");
		expect(row?.statusText).toBe("waiting");
		expect(row?.needs).toBe("decision X");
		expect(row?.statusUpdatedAt).toBeTruthy();
	});
});

describe("setOrchestrator", () => {
	test("flips the bit on chosen workspace, clears others in same project", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-b" });
		await setOrchestrator({ workspaceId: a.workspaceId });
		await setOrchestrator({ workspaceId: b.workspaceId });

		const db = getDb();
		const rowA = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, a.workspaceId))
			.get();
		const rowB = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, b.workspaceId))
			.get();
		expect(rowA?.isOrchestrator).toBe(false);
		expect(rowB?.isOrchestrator).toBe(true);
	});
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd apps/desktop && bun test tests/agent-coordination.test.ts
```
Expected: FAIL — `setStatus` / `setOrchestrator` undefined.

- [ ] **Step 3: Implement**

Append to `apps/desktop/src/main/services/workspace-service.ts`:

```ts
import type {
	SetStatusRequest,
	SetStatusResponse,
} from "../../shared/control-plane";

export interface CallerContext {
	workspaceId: string;
	projectId: string;
}

export async function setStatus(
	ctx: CallerContext,
	input: SetStatusRequest
): Promise<SetStatusResponse> {
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, ctx.workspaceId))
		.get();
	if (!ws) throw new Error(`not_found: ${ctx.workspaceId}`);
	if (ws.projectId !== ctx.projectId) throw new Error("forbidden");

	db.update(workspaces)
		.set({
			currentPhase: input.phase,
			statusText: input.statusText ?? null,
			needs: input.needs ?? null,
			statusUpdatedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(workspaces.id, ctx.workspaceId))
		.run();

	return { ok: true };
}

export async function setOrchestrator(input: { workspaceId: string }): Promise<{ ok: true }> {
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new Error(`not_found: ${input.workspaceId}`);

	db.transaction((tx) => {
		tx.update(workspaces)
			.set({ isOrchestrator: false, updatedAt: new Date() })
			.where(eq(workspaces.projectId, ws.projectId))
			.run();
		tx.update(workspaces)
			.set({ isOrchestrator: true, updatedAt: new Date() })
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	});

	return { ok: true };
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
cd apps/desktop && bun test tests/agent-coordination.test.ts
```
Expected: 2/2 PASS for the new tests. Pre-existing tests untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/agent-coordination.test.ts
git commit -m "feat(mcp): add setStatus + setOrchestrator service functions"
```

---

## Task 8: workspace-service — sendMessage + readMessages

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/tests/agent-coordination.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `apps/desktop/tests/agent-coordination.test.ts`:

```ts
import {
	readMessages,
	sendMessage,
} from "../src/main/services/workspace-service";

describe("sendMessage / readMessages", () => {
	test("DM lands in target's inbox", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/msg-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/msg-b" });

		const sent = await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ toWorkspaceId: b.workspaceId, kind: "note", content: "hello B" }
		);
		expect(sent.messageId).toBeTruthy();

		const inbox = await readMessages(
			{ workspaceId: b.workspaceId, projectId: PROJECT_ID },
			{}
		);
		expect(inbox.messages.map((m) => m.content)).toContain("hello B");
		expect(inbox.messages[0]?.kind).toBe("note");
		expect(inbox.messages[0]?.fromWorkspaceId).toBe(a.workspaceId);
	});

	test("broadcast lands in everyone's inbox", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/bcast-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/bcast-b" });

		await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ kind: "note", content: "everyone heads up" }
		);

		const inboxB = await readMessages(
			{ workspaceId: b.workspaceId, projectId: PROJECT_ID },
			{ includeBroadcasts: true }
		);
		expect(inboxB.messages.map((m) => m.content)).toContain("everyone heads up");
		expect(inboxB.messages[0]?.toWorkspaceId).toBeNull();
	});

	test("readMessages filters by since", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/since-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/since-b" });

		await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ toWorkspaceId: b.workspaceId, kind: "note", content: "old" }
		);
		const cutoff = new Date().toISOString();
		await new Promise((r) => setTimeout(r, 10));
		await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ toWorkspaceId: b.workspaceId, kind: "note", content: "new" }
		);

		const inbox = await readMessages(
			{ workspaceId: b.workspaceId, projectId: PROJECT_ID },
			{ since: cutoff }
		);
		const contents = inbox.messages.map((m) => m.content);
		expect(contents).toContain("new");
		expect(contents).not.toContain("old");
	});

	test("sendMessage rejects cross-project target", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/cross-a" });
		await expect(
			sendMessage(
				{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
				{ toWorkspaceId: "ws-in-other-project", kind: "note", content: "x" }
			)
		).rejects.toThrow(/forbidden|not_found/i);
	});
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd apps/desktop && bun test tests/agent-coordination.test.ts
```
Expected: FAIL — `sendMessage` / `readMessages` undefined.

- [ ] **Step 3: Implement**

Append to `apps/desktop/src/main/services/workspace-service.ts`:

```ts
import type {
	AgentMessageDto,
	ReadMessagesRequest,
	ReadMessagesResponse,
	SendMessageRequest,
	SendMessageResponse,
} from "../../shared/control-plane";
import { agentMessages } from "../db/schema";
import { and, desc, gt, isNull, or } from "drizzle-orm";

function messageRowToDto(row: typeof agentMessages.$inferSelect): AgentMessageDto {
	return {
		id: row.id,
		fromWorkspaceId: row.fromWorkspaceId,
		toWorkspaceId: row.toWorkspaceId,
		kind: row.kind,
		content: row.content,
		inReplyTo: row.inReplyTo,
		createdAt: row.createdAt.toISOString(),
	};
}

export async function sendMessage(
	ctx: CallerContext,
	input: SendMessageRequest
): Promise<SendMessageResponse> {
	const db = getDb();

	if (input.toWorkspaceId) {
		const target = db
			.select({ projectId: workspaces.projectId })
			.from(workspaces)
			.where(eq(workspaces.id, input.toWorkspaceId))
			.get();
		if (!target) throw new Error(`not_found: ${input.toWorkspaceId}`);
		if (target.projectId !== ctx.projectId) {
			throw new Error("forbidden: cross-project message");
		}
	}

	const messageId = nanoid();
	db.insert(agentMessages)
		.values({
			id: messageId,
			projectId: ctx.projectId,
			fromWorkspaceId: ctx.workspaceId,
			toWorkspaceId: input.toWorkspaceId ?? null,
			kind: input.kind,
			content: input.content,
			inReplyTo: input.inReplyTo ?? null,
			createdAt: new Date(),
		})
		.run();

	return { messageId };
}

export async function readMessages(
	ctx: CallerContext,
	input: ReadMessagesRequest
): Promise<ReadMessagesResponse> {
	const db = getDb();
	const includeBroadcasts = input.includeBroadcasts ?? true;
	const sinceDate = input.since
		? new Date(input.since)
		: new Date(Date.now() - 60 * 60 * 1000);

	const targetFilter = includeBroadcasts
		? or(
				eq(agentMessages.toWorkspaceId, ctx.workspaceId),
				isNull(agentMessages.toWorkspaceId)
			)
		: eq(agentMessages.toWorkspaceId, ctx.workspaceId);

	const rows = db
		.select()
		.from(agentMessages)
		.where(
			and(
				eq(agentMessages.projectId, ctx.projectId),
				gt(agentMessages.createdAt, sinceDate),
				targetFilter
			)
		)
		.orderBy(desc(agentMessages.createdAt))
		.limit(200)
		.all();

	return { messages: rows.map(messageRowToDto) };
}
```

(`and`, `desc`, `gt`, `isNull`, `or` are added to the existing `drizzle-orm` import line — adjust accordingly.)

- [ ] **Step 4: Run tests, expect PASS**

```bash
cd apps/desktop && bun test tests/agent-coordination.test.ts
```
Expected: PASS (4 new tests + the 2 from Task 7 = 6 total).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/agent-coordination.test.ts
git commit -m "feat(mcp): add sendMessage + readMessages service functions"
```

---

## Task 9: Event bus + SSE-feed plumbing

**Files:**
- Create: `apps/desktop/src/main/control-plane/event-bus.ts`
- Modify: `apps/desktop/src/main/services/workspace-service.ts` (emit after setStatus / sendMessage)
- Modify: `apps/desktop/src/main/control-plane/index.ts` (instantiate bus)
- Modify: `apps/desktop/src/main/control-plane/server.ts` (route `/workspaces.watch`, accept bus dep)

- [ ] **Step 1: Create the event bus**

```ts
// apps/desktop/src/main/control-plane/event-bus.ts
export interface StatusEvent {
	event: "status";
	workspaceId: string;
	phase: string;
	statusText: string | null;
	needs: string | null;
	ts: string;
}

export interface MessageEvent {
	event: "message";
	messageId: string;
	from: string;
	to: string | null;
	kind: string;
	content: string;
	ts: string;
}

export type CoordinationEvent = StatusEvent | MessageEvent;

type Subscriber = (ev: CoordinationEvent) => void;

export class EventBus {
	private subs = new Map<string, Set<Subscriber>>();

	subscribe(projectId: string, fn: Subscriber): () => void {
		let set = this.subs.get(projectId);
		if (!set) {
			set = new Set();
			this.subs.set(projectId, set);
		}
		set.add(fn);
		return () => {
			set?.delete(fn);
			if (set && set.size === 0) this.subs.delete(projectId);
		};
	}

	emit(projectId: string, ev: CoordinationEvent): void {
		const set = this.subs.get(projectId);
		if (!set) return;
		for (const fn of set) {
			try {
				fn(ev);
			} catch {
				// best-effort
			}
		}
	}
}
```

- [ ] **Step 2: Wire bus into control-plane startup**

In `apps/desktop/src/main/control-plane/index.ts`, instantiate the bus and pass it through to `createControlPlaneServer`:

```ts
import { EventBus } from "./event-bus";

export interface StartOpts {
	confirm: ConfirmFn;
	spawnFn: SpawnFn;
	token?: string;
	eventBus?: EventBus;
}

export async function startControlPlane(opts: StartOpts): Promise<RunningControlPlane> {
	const token = opts.token ?? generateToken();
	const eventBus = opts.eventBus ?? new EventBus();
	const server: Server = createControlPlaneServer({
		token,
		confirm: opts.confirm,
		spawnFn: opts.spawnFn,
		eventBus,
	});
	// ... unchanged ...
	return {
		port,
		token,
		eventBus,
		async stop() {
			/* ... */
		},
	};
}
```

Add `eventBus: EventBus` to `ControlPlaneDeps` in `server.ts` and `RunningControlPlane` in `index.ts`.

- [ ] **Step 3: Expose bus to the service layer via a setter (mirror `setMcpEnvProvider`)**

In `apps/desktop/src/main/services/workspace-service.ts`, near the existing `mcpEnvProvider` block:

```ts
import type { EventBus } from "../control-plane/event-bus";

let eventBus: EventBus | null = null;
export function setEventBus(bus: EventBus | null): void {
	eventBus = bus;
}
```

In `setStatus`, after the update succeeds, emit:

```ts
eventBus?.emit(ctx.projectId, {
	event: "status",
	workspaceId: ctx.workspaceId,
	phase: input.phase,
	statusText: input.statusText ?? null,
	needs: input.needs ?? null,
	ts: new Date().toISOString(),
});
```

In `sendMessage`, after the insert succeeds, emit:

```ts
eventBus?.emit(ctx.projectId, {
	event: "message",
	messageId,
	from: ctx.workspaceId,
	to: input.toWorkspaceId ?? null,
	kind: input.kind,
	content: input.content,
	ts: new Date().toISOString(),
});
```

- [ ] **Step 4: Wire bus in main/index.ts boot**

In `apps/desktop/src/main/index.ts`, after `startControlPlane(...)` returns, call:

```ts
setEventBus(controlPlane.eventBus);
```

(Import `setEventBus` from `./services/workspace-service`.)

- [ ] **Step 5: Add SSE route in `server.ts`**

In the route switch, add:

```ts
case "GET /workspaces.watch": {
	const caller = await resolveCaller(req, url.searchParams.get("projectId"));
	if ("error" in caller) {
		respond(res, 401, requestId, { error: "unauthorized" });
		return;
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const unsubscribe = deps.eventBus.subscribe(caller.projectId, (ev) => {
		res.write(`data: ${JSON.stringify(ev)}\n\n`);
	});

	const heartbeat = setInterval(() => {
		res.write(`data: ${JSON.stringify({ event: "heartbeat", ts: new Date().toISOString() })}\n\n`);
	}, 30_000);

	req.on("close", () => {
		clearInterval(heartbeat);
		unsubscribe();
	});

	return; // do NOT call respond — connection stays open
}
```

- [ ] **Step 6: Type-check + run all existing tests**

```bash
bun run type-check
cd apps/desktop && bun test tests/control-plane.test.ts tests/agent-coordination.test.ts
```
Expected: PASS. The new SSE route exists but isn't tested yet — that's Task 11 / smoke.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/control-plane/event-bus.ts apps/desktop/src/main/control-plane/index.ts apps/desktop/src/main/control-plane/server.ts apps/desktop/src/main/services/workspace-service.ts apps/desktop/src/main/index.ts
git commit -m "feat(mcp): event bus + SSE /workspaces.watch route"
```

---

## Task 10: workspace-service — resumeAgent

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/tests/agent-coordination.test.ts`

`resumeAgent` does three things: orchestrator authorization, log an `agent_messages` row of kind `"resume"`, and (in real life) `daemon.write` into the workspace's terminal. The test stubs the terminal-write via DI, same pattern as `dispatchAgent`'s `spawnFn`.

- [ ] **Step 1: Add failing tests**

Append to `apps/desktop/tests/agent-coordination.test.ts`:

```ts
import { resumeAgent } from "../src/main/services/workspace-service";

describe("resumeAgent", () => {
	test("rejects non-orchestrator caller with forbidden", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r-b" });
		// Neither is orchestrator
		await expect(
			resumeAgent(
				{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
				{ workspaceId: b.workspaceId, message: "hi" },
				{ writeToTerminal: async () => undefined }
			)
		).rejects.toThrow(/forbidden/i);
	});

	test("orchestrator can resume — writes message row + calls writeToTerminal", async () => {
		const orch = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-main" });
		const target = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-tgt" });
		await setOrchestrator({ workspaceId: orch.workspaceId });
		// Give target a session id (only claude is resumable in v1)
		const db = getDb();
		db.update(schema.workspaces)
			.set({ cliSessionId: "uuid-target", cliPreset: "claude" })
			.where(eq(schema.workspaces.id, target.workspaceId))
			.run();

		const calls: string[] = [];
		const result = await resumeAgent(
			{ workspaceId: orch.workspaceId, projectId: PROJECT_ID },
			{ workspaceId: target.workspaceId, message: "next task" },
			{
				writeToTerminal: async (cmd) => {
					calls.push(cmd);
				},
			}
		);
		expect(result.ok).toBe(true);
		expect(result.messageId).toBeTruthy();
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("claude --resume 'uuid-target'");
		expect(calls[0]).toContain("'next task'");

		const messageRows = db
			.select()
			.from(schema.agentMessages)
			.where(eq(schema.agentMessages.toWorkspaceId, target.workspaceId))
			.all();
		expect(messageRows).toHaveLength(1);
		expect(messageRows[0]?.kind).toBe("resume");
		expect(messageRows[0]?.content).toBe("next task");
	});

	test("orchestrator resuming non-claude target returns resume_not_supported", async () => {
		const orch = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r-no-claude-o" });
		const target = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r-no-claude-t" });
		await setOrchestrator({ workspaceId: orch.workspaceId });

		await expect(
			resumeAgent(
				{ workspaceId: orch.workspaceId, projectId: PROJECT_ID },
				{ workspaceId: target.workspaceId, message: "x" },
				{ writeToTerminal: async () => undefined }
			)
		).rejects.toThrow(/resume_not_supported/);
	});
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd apps/desktop && bun test tests/agent-coordination.test.ts
```
Expected: FAIL — `resumeAgent` undefined.

- [ ] **Step 3: Implement**

Append to `apps/desktop/src/main/services/workspace-service.ts`:

```ts
import type {
	ResumeAgentRequest,
	ResumeAgentResponse,
} from "../../shared/control-plane";

export interface WriteToTerminalArgs {
	workspaceId: string;
	command: string;
	cwd: string;
}
export type WriteToTerminalFn = (args: WriteToTerminalArgs) => Promise<void>;

export interface ResumeAgentDeps {
	writeToTerminal?: WriteToTerminalFn;
}

function escapeShellSingleQuoteMsg(s: string): string {
	return s.replace(/'/g, "'\\''");
}

export async function resumeAgent(
	ctx: CallerContext,
	input: ResumeAgentRequest,
	deps: ResumeAgentDeps = {}
): Promise<ResumeAgentResponse> {
	const db = getDb();

	// 1. Authorize: caller must be project orchestrator
	const callerWs = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, ctx.workspaceId))
		.get();
	if (!callerWs) throw new Error(`not_found: ${ctx.workspaceId}`);
	if (callerWs.projectId !== ctx.projectId) throw new Error("forbidden");
	if (!callerWs.isOrchestrator) throw new Error("forbidden: caller is not the project orchestrator");

	// 2. Look up target
	const target = db
		.select({
			projectId: workspaces.projectId,
			worktreeId: workspaces.worktreeId,
			cliSessionId: workspaces.cliSessionId,
			cliPreset: workspaces.cliPreset,
		})
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!target) throw new Error(`not_found: ${input.workspaceId}`);
	if (target.projectId !== ctx.projectId) throw new Error("forbidden");
	if (target.cliPreset !== "claude" || !target.cliSessionId) {
		throw new Error("resume_not_supported: workspace has no claude session");
	}

	// 3. Resolve worktree path (cwd) — required for the spawn fallback
	const wt = target.worktreeId
		? db
				.select({ path: worktrees.path })
				.from(worktrees)
				.where(eq(worktrees.id, target.worktreeId))
				.get()
		: null;
	if (!wt?.path) throw new Error(`not_found: worktree path for ${input.workspaceId}`);

	// 4. Compose the resume command
	const escSession = escapeShellSingleQuoteMsg(target.cliSessionId);
	const escMsg = escapeShellSingleQuoteMsg(input.message);
	const command = `claude --resume '${escSession}' --print '${escMsg}'\n`;

	// 5. Insert the agent_messages row (audit log)
	const messageId = nanoid();
	db.insert(agentMessages)
		.values({
			id: messageId,
			projectId: ctx.projectId,
			fromWorkspaceId: ctx.workspaceId,
			toWorkspaceId: input.workspaceId,
			kind: "resume",
			content: input.message,
			inReplyTo: null,
			createdAt: new Date(),
		})
		.run();

	// 6. Write to terminal
	const writeFn = deps.writeToTerminal ?? defaultWriteToTerminal;
	await writeFn({
		workspaceId: input.workspaceId,
		command,
		cwd: wt.path,
	});

	// 7. Emit on bus
	eventBus?.emit(ctx.projectId, {
		event: "message",
		messageId,
		from: ctx.workspaceId,
		to: input.workspaceId,
		kind: "resume",
		content: input.message,
		ts: new Date().toISOString(),
	});

	return { ok: true, messageId };
}

export async function defaultWriteToTerminal(args: WriteToTerminalArgs): Promise<void> {
	const daemon = getDaemonClient();
	if (!daemon) throw new Error("Terminal daemon not available");

	const db = getDb();
	const existing = db
		.select({ id: terminalSessions.id })
		.from(terminalSessions)
		.where(eq(terminalSessions.workspaceId, args.workspaceId))
		.orderBy(desc(terminalSessions.updatedAt))
		.limit(1)
		.get();

	if (existing) {
		daemon.write(existing.id, args.command);
		return;
	}

	// No existing terminal — fall back to broadcasting a new dispatch
	// payload so the renderer opens a tab in this workspace.
	const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const dir = mkdtempSync(joinPath(tmpdir(), "ss-resume-"));
	const scriptPath = joinPath(dir, "resume.sh");
	writeFileSync(
		scriptPath,
		["#!/bin/bash", `cd '${args.cwd.replace(/'/g, "'\\''")}'`, "", args.command, ""].join("\n"),
		"utf-8"
	);
	chmodSync(scriptPath, 0o755);
	dispatchBroadcaster({
		workspaceId: args.workspaceId,
		cwd: args.cwd,
		scriptPath,
		title: "Agent session",
	});
}
```

(`desc` should already be imported from Task 8.)

- [ ] **Step 4: Run tests, expect PASS**

```bash
cd apps/desktop && bun test tests/agent-coordination.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/agent-coordination.test.ts
git commit -m "feat(mcp): add resumeAgent service function (orchestrator-only)"
```

---

## Task 11: Control plane HTTP routes for the 4 new operations

**Files:**
- Modify: `apps/desktop/src/main/control-plane/server.ts`
- Modify: `apps/desktop/tests/control-plane.test.ts` (add integration tests)

- [ ] **Step 1: Add failing integration tests**

In `apps/desktop/tests/control-plane.test.ts`, add the auth-header helper plus a new describe block at the end. First, add a helper to make a request as a specific workspace:

```ts
const authWs = (wsId: string) => ({
	Authorization: `Bearer ${server.token}`,
	"X-Workspace-Id": wsId,
});
```

Then append:

```ts
describe("control-plane coordination routes", () => {
	test("set_status updates the row", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-s1" }),
		});
		const { workspaceId } = (await create.json()) as { workspaceId: string };

		const res = await fetch(url("/workspaces.set_status"), {
			method: "POST",
			headers: { ...authWs(workspaceId), "Content-Type": "application/json" },
			body: JSON.stringify({
				phase: "blocked",
				statusText: "waiting on review",
				needs: "approval",
			}),
		});
		expect(res.status).toBe(200);

		const get = await fetch(
			url(`/workspaces.get?projectId=${PROJECT_ID}&workspaceId=${workspaceId}`),
			{ headers: auth() }
		);
		const body = (await get.json()) as {
			currentPhase: string;
			statusText: string;
			needs: string;
		};
		expect(body.currentPhase).toBe("blocked");
		expect(body.statusText).toBe("waiting on review");
		expect(body.needs).toBe("approval");
	});

	test("set_status without X-Workspace-Id returns 401", async () => {
		const res = await fetch(url("/workspaces.set_status"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ phase: "working" }),
		});
		expect(res.status).toBe(401);
	});

	test("send_message + read_messages round-trip", async () => {
		const a = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-m-a" }),
		});
		const wsA = ((await a.json()) as { workspaceId: string }).workspaceId;
		const b = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-m-b" }),
		});
		const wsB = ((await b.json()) as { workspaceId: string }).workspaceId;

		const send = await fetch(url("/workspaces.send_message"), {
			method: "POST",
			headers: { ...authWs(wsA), "Content-Type": "application/json" },
			body: JSON.stringify({
				toWorkspaceId: wsB,
				kind: "note",
				content: "hello from A",
			}),
		});
		expect(send.status).toBe(200);

		const read = await fetch(
			url(`/workspaces.read_messages?projectId=${PROJECT_ID}`),
			{ headers: authWs(wsB) }
		);
		const body = (await read.json()) as { messages: Array<{ content: string }> };
		expect(body.messages.map((m) => m.content)).toContain("hello from A");
	});

	test("resume_agent returns 403 for non-orchestrator caller", async () => {
		const a = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-r-403" }),
		});
		const wsA = ((await a.json()) as { workspaceId: string }).workspaceId;
		const b = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-r-403b" }),
		});
		const wsB = ((await b.json()) as { workspaceId: string }).workspaceId;

		const res = await fetch(url("/workspaces.resume_agent"), {
			method: "POST",
			headers: { ...authWs(wsA), "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: wsB, message: "go" }),
		});
		expect(res.status).toBe(403);
	});
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd apps/desktop && bun test tests/control-plane.test.ts
```
Expected: FAIL — 404s on the new routes.

- [ ] **Step 3: Implement the 4 routes**

In `apps/desktop/src/main/control-plane/server.ts`, add to the `switch (route)` block (alongside `case "POST /workspaces.create": ...`):

```ts
case "POST /workspaces.set_status": {
	const body = await readJson(req);
	const parsed = setStatusRequestSchema.safeParse(body);
	if (!parsed.success) {
		respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
		return;
	}
	const caller = await resolveCaller(req, null);
	if ("error" in caller) {
		respond(res, 401, requestId, { error: "unauthorized" });
		return;
	}
	const result = await setStatus(caller, parsed.data);
	respond(res, 200, requestId, result);
	return;
}

case "POST /workspaces.send_message": {
	const body = await readJson(req);
	const parsed = sendMessageRequestSchema.safeParse(body);
	if (!parsed.success) {
		respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
		return;
	}
	const caller = await resolveCaller(req, null);
	if ("error" in caller) {
		respond(res, 401, requestId, { error: "unauthorized" });
		return;
	}
	const result = await sendMessage(caller, parsed.data);
	respond(res, 200, requestId, result);
	return;
}

case "GET /workspaces.read_messages": {
	const caller = await resolveCaller(req, url.searchParams.get("projectId"));
	if ("error" in caller) {
		respond(res, 401, requestId, { error: "unauthorized" });
		return;
	}
	const parsed = readMessagesRequestSchema.safeParse({
		since: url.searchParams.get("since") ?? undefined,
		includeBroadcasts: url.searchParams.get("includeBroadcasts") === "false" ? false : true,
	});
	if (!parsed.success) {
		respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
		return;
	}
	const result = await readMessages(caller, parsed.data);
	respond(res, 200, requestId, result);
	return;
}

case "POST /workspaces.resume_agent": {
	const body = await readJson(req);
	const parsed = resumeAgentRequestSchema.safeParse(body);
	if (!parsed.success) {
		respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
		return;
	}
	const caller = await resolveCaller(req, null);
	if ("error" in caller) {
		respond(res, 401, requestId, { error: "unauthorized" });
		return;
	}
	try {
		const result = await resumeAgent(caller, parsed.data);
		respond(res, 200, requestId, result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/^resume_not_supported/.test(msg)) {
			respond(res, 409, requestId, { error: "resume_not_supported", message: msg });
			return;
		}
		throw err; // fall through to generic catch
	}
	return;
}
```

Imports at the top:
```ts
import {
	readMessagesRequestSchema,
	resumeAgentRequestSchema,
	sendMessageRequestSchema,
	setStatusRequestSchema,
} from "../../shared/control-plane";
import {
	readMessages,
	resumeAgent,
	sendMessage,
	setStatus,
} from "../services/workspace-service";
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
cd apps/desktop && bun test tests/control-plane.test.ts
```
Expected: all PASS (9 existing + 4 new = 13).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/control-plane/server.ts apps/desktop/tests/control-plane.test.ts
git commit -m "feat(mcp): control-plane routes for status, messages, resume"
```

---

## Task 12: dispatchAgent — mint session id for claude

**Files:**
- Modify: `apps/desktop/src/main/services/workspace-service.ts`
- Modify: `apps/desktop/tests/workspace-service.test.ts`

- [ ] **Step 1: Update existing dispatchAgent test to assert session id minting**

In `apps/desktop/tests/workspace-service.test.ts`, find the `describe("dispatchAgent", ...)` block. Add a new assertion to the first test:

```ts
test("calls spawnFn with workspace cwd + cli command", async () => {
	const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/d1" });
	const calls: Array<{ cwd: string; script: string }> = [];

	const result = await dispatchAgent(
		{
			projectId: PROJECT_ID,
			workspaceId: created.workspaceId,
			prompt: "Refactor the foo module",
			cliPreset: "claude",
		},
		{
			spawnFn: async ({ cwd, launchScriptContent }) => {
				calls.push({ cwd, script: launchScriptContent });
				return { sessionId: "sess-1", terminalId: "term-1" };
			},
		}
	);

	expect(result.sessionId).toBe("sess-1");
	// ... existing assertions ...

	// NEW: workspace row should now have a cli_session_id and cli_preset=claude
	const db = getDb();
	const row = db
		.select({
			cliSessionId: schema.workspaces.cliSessionId,
			cliPreset: schema.workspaces.cliPreset,
		})
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, created.workspaceId))
		.get();
	expect(row?.cliPreset).toBe("claude");
	expect(row?.cliSessionId).toBeTruthy();
	expect(row?.cliSessionId).toMatch(/^[0-9a-f-]{36}$/);

	// AND the launch script should embed --session-id
	expect(calls[0]?.script).toContain("--session-id");
	expect(calls[0]?.script).toContain(row?.cliSessionId ?? "");
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd apps/desktop && bun test tests/workspace-service.test.ts
```
Expected: FAIL — `cli_session_id` is null on the row.

- [ ] **Step 3: Implement session-id minting in dispatchAgent**

In `apps/desktop/src/main/services/workspace-service.ts`, modify `dispatchAgent`. After resolving `ws` and `wt`, before composing the launch script, add:

```ts
let cliSessionId: string | null = null;
const cliPreset = input.cliPreset ?? "claude";
if (cliPreset === "claude") {
	const existing = db
		.select({ cliSessionId: workspaces.cliSessionId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	cliSessionId = existing?.cliSessionId ?? randomUUID();
	db.update(workspaces)
		.set({
			cliSessionId,
			cliPreset: "claude",
			updatedAt: new Date(),
		})
		.where(eq(workspaces.id, input.workspaceId))
		.run();
}
```

Add `import { randomUUID } from "node:crypto";` at the top.

Modify `buildLaunchScript` to accept and embed the session id:

```ts
function buildLaunchScript(opts: {
	cwd: string;
	cliPreset: "claude" | "codex" | "gemini" | "opencode";
	prompt: string;
	skipPermissions: boolean;
	cliSessionId: string | null;
}): string {
	const presetFlag = opts.skipPermissions
		? CLI_PRESETS[opts.cliPreset]?.permissionFlag
		: undefined;
	const flag = presetFlag ? `${presetFlag} ` : "";
	const sessionFlag =
		opts.cliPreset === "claude" && opts.cliSessionId
			? `--session-id '${opts.cliSessionId}' --print `
			: "";
	const cmd = `${opts.cliPreset} ${sessionFlag}${flag}'${escapeShellSingleQuote(opts.prompt)}'`;
	return ["#!/bin/bash", `cd '${escapeShellSingleQuote(opts.cwd)}'`, "", cmd, ""].join("\n");
}
```

Update the `buildLaunchScript` callsite in `dispatchAgent` to pass `cliSessionId`.

- [ ] **Step 4: Run tests, expect PASS**

```bash
cd apps/desktop && bun test tests/workspace-service.test.ts
```
Expected: PASS (15/15).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/workspace-service.ts apps/desktop/tests/workspace-service.test.ts
git commit -m "feat(mcp): mint claude session id at dispatch + embed --session-id"
```

---

## Task 13: server.mjs — register 4 new MCP tools

**Files:**
- Modify: `apps/desktop/mcp-standalone/server.mjs`

- [ ] **Step 1: Add the four tools**

Inside the `if (isWorkspaceAgentMode)` block in `server.mjs`, append after the existing 5 tools:

```js
server.tool(
	"set_status",
	"Publish this workspace's current phase + optional status text and needs. Other agents and the user can see this. Phase is one of: idle, working, blocked, done.",
	{
		phase: z.enum(["idle", "working", "blocked", "done"]),
		status_text: z.string().max(2000).optional(),
		needs: z.string().max(2000).optional(),
	},
	async ({ phase, status_text, needs }) =>
		call("POST", "/workspaces.set_status", {
			phase,
			statusText: status_text,
			needs,
		})
);

server.tool(
	"send_message",
	"Send a durable message to another workspace in this project, or broadcast to all. The recipient sees it via read_messages. The orchestrator agent also sees broadcasts and direct messages via its watch stream.",
	{
		to_workspace_id: z.string().optional().describe("Omit for broadcast"),
		kind: z.enum(["note", "question", "answer"]),
		content: z.string().min(1).max(8192),
		in_reply_to: z.string().optional(),
	},
	async ({ to_workspace_id, kind, content, in_reply_to }) =>
		call("POST", "/workspaces.send_message", {
			toWorkspaceId: to_workspace_id,
			kind,
			content,
			inReplyTo: in_reply_to,
		})
);

server.tool(
	"read_messages",
	"Read messages directed at this workspace (and project-wide broadcasts unless excluded). Returns the most recent up to 200 messages.",
	{
		since: z.string().optional().describe("ISO timestamp; default = last 1 hour"),
		include_broadcasts: z.boolean().optional(),
	},
	async ({ since, include_broadcasts }) => {
		const params = new URLSearchParams({ projectId: PROJECT_ID });
		if (since) params.set("since", since);
		if (include_broadcasts === false) params.set("includeBroadcasts", "false");
		return call("GET", `/workspaces.read_messages?${params.toString()}`);
	}
);

server.tool(
	"resume_agent",
	"(Orchestrator-only) Wake another agent in this project by sending it a follow-up message. The control plane runs `claude --resume` in the target workspace's terminal.",
	{
		workspace_id: z.string(),
		message: z.string().min(1).max(8192),
	},
	async ({ workspace_id, message }) =>
		call("POST", "/workspaces.resume_agent", {
			workspaceId: workspace_id,
			message,
		})
);
```

- [ ] **Step 2: Syntax check + regression tests**

```bash
node --check apps/desktop/mcp-standalone/server.mjs
cd apps/desktop && bun test tests/control-plane.test.ts tests/agent-coordination.test.ts tests/workspace-service.test.ts
```
Expected: syntax OK, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/mcp-standalone/server.mjs
git commit -m "feat(mcp): add set_status, send_message, read_messages, resume_agent tools"
```

---

## Task 14: tRPC mutation + UI surface

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/workspaces.ts`
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx` (and/or the sibling component that renders workspace rows in the sidebar)

- [ ] **Step 1: Add `setOrchestrator` tRPC mutation**

In `apps/desktop/src/main/trpc/routers/workspaces.ts`, add inside the router object:

```ts
setOrchestrator: publicProcedure
	.input(z.object({ workspaceId: z.string().min(1) }))
	.mutation(async ({ input }) => {
		const { setOrchestrator } = await import("../../services/workspace-service");
		await setOrchestrator(input);
	}),
```

- [ ] **Step 2: Extend `listByProject` return shape to include the new fields**

Find the existing `listByProject` query. Add the new columns to its select shape:

```ts
const rows = db
	.select({
		// ... existing fields ...
		currentPhase: schema.workspaces.currentPhase,
		statusText: schema.workspaces.statusText,
		needs: schema.workspaces.needs,
		isOrchestrator: schema.workspaces.isOrchestrator,
		cliPreset: schema.workspaces.cliPreset,
	})
	.from(schema.workspaces)
	// ... existing joins ...
```

Same for `getById` if the UI uses that path to render the workspace item details.

- [ ] **Step 3: Render phase badge + status_text + orchestrator pill in the sidebar**

Locate the sidebar component that renders each workspace row. Search:
```bash
grep -rn "workspaceId" apps/desktop/src/renderer/components/Sidebar* apps/desktop/src/renderer/components/Workspace* | head
```

In the workspace row component, after the workspace title, add:

```tsx
{workspace.isOrchestrator && (
	<span className="ml-2 inline-flex items-center rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-fg)]">
		Orchestrator
	</span>
)}
{workspace.currentPhase && workspace.currentPhase !== "idle" && (
	<span
		className={`ml-2 inline-block h-2 w-2 rounded-full ${
			workspace.currentPhase === "working"
				? "bg-blue-500"
				: workspace.currentPhase === "blocked"
					? "bg-orange-500"
					: "bg-emerald-500"
		}`}
		title={workspace.currentPhase}
	/>
)}
{workspace.statusText && (
	<div className="truncate text-xs text-[var(--text-secondary)]">
		{workspace.statusText}
	</div>
)}
{workspace.currentPhase === "blocked" && workspace.needs && (
	<div className="truncate text-xs italic text-[var(--text-tertiary)]">
		needs: {workspace.needs}
	</div>
)}
```

Color tokens may need adapting to the codebase's design system — check `WhatsNewModal` and other existing components for the right CSS-variable names.

- [ ] **Step 4: Add "Set as orchestrator" context-menu entry**

Find the existing workspace context menu (right-click) component. Add:

```tsx
const setOrchestratorMutation = trpc.workspaces.setOrchestrator.useMutation({
	onSuccess: () => utils.workspaces.listByProject.invalidate(),
});

// ... inside the menu ...
{!workspace.isOrchestrator && (
	<button
		type="button"
		onClick={() => setOrchestratorMutation.mutate({ workspaceId: workspace.id })}
	>
		Set as orchestrator
	</button>
)}
```

- [ ] **Step 5: Type-check**

```bash
bun run type-check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/workspaces.ts apps/desktop/src/renderer/components/
git commit -m "feat(mcp): UI for phase badge + orchestrator designation"
```

---

## Task 15: Manual smoke test (handoff to user)

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

- [ ] **Step 3: Smoke flow**

1. Create a new worktree (e.g. `feature/orch-test`) via the UI. Right-click it → **Set as orchestrator**. Verify the **Orchestrator** pill appears in the sidebar.
2. Create two more worktrees: `feature/child-a` and `feature/child-b`.
3. Dispatch a claude session into `feature/child-a` via MCP `create_worktree` from another agent, or via the renderer's create-and-launch flow. Verify a row in `workspaces` has a `cli_session_id` filled in. (Use the Devtools console or a one-off SQL query.)
4. From the orchestrator worktree, run claude with a prompt like:
   ```
   You are the orchestrator. Use the SuperiorSwarm MCP tools.
   1. Call list_workspaces and tell me what's in flight.
   2. Start a Monitor on:
      curl -N -H "Authorization: Bearer $SUPERIORSWARM_CONTROL_TOKEN" \
        "http://127.0.0.1:$SUPERIORSWARM_CONTROL_PORT/workspaces.watch?projectId=$PROJECT_ID"
   3. When a child reports phase=blocked, call resume_agent with a helpful follow-up.
   ```
5. In `feature/child-a`'s terminal, have the agent call `set_status({ phase: "blocked", status_text: "stuck", needs: "permission model decision" })`. Verify:
   - Sidebar updates show the orange badge + needs line.
   - Orchestrator's Monitor receives a `status` event line.
   - Orchestrator (when it processes the next turn) can call `resume_agent({ workspace_id: <child-a-id>, message: "Use the new permission model" })`.
   - Child A's terminal shows `claude --resume '<uuid>' --print 'Use the new permission model'` and runs.
6. From child A, send `send_message({ to_workspace_id: <child-b-id>, kind: "note", content: "I refactored auth, see commit X" })`. Have child B call `read_messages` later and verify it appears.
7. Restart the app. Verify:
   - Orchestrator pill persists on the same workspace.
   - `cli_session_id` is unchanged.
   - `.mcp.json` files in worktrees have a fresh port + token AND the same `WORKSPACE_ID`.
   - The next `resume_agent` call still succeeds.

- [ ] **Step 4: Report findings**

If anything breaks, file follow-up issues. Do not amend prior commits.

---

## Out of scope / follow-ups

- Codex/Gemini/OpenCode session resume parity (likely possible per-CLI; v1 silently 409s).
- Periodic pruning of `agent_messages` (>30 days).
- A global message-feed UI panel (read-only audit log).
- Push notifications to the user when an agent goes `blocked`.
- Banner: "orchestrator lost SSE connection — restart it" after token rotation.

## Self-review notes

- **Spec coverage:**
  - § Data model → T2 covers all 7 workspace columns + agent_messages.
  - § MCP tool surface → T13 registers all 4 tools; underlying services in T7-T10.
  - § Control plane endpoints → T11 covers POSTs; T9 covers SSE.
  - § Identity & authorization → T4 (env) + T5 (server.mjs sends header) + T6 (control-plane extracts) + T10 (orchestrator check).
  - § Resume mechanism → T12 (mint at dispatch) + T10 (resume via daemon.write).
  - § Orchestrator workflow → T7 (`setOrchestrator` service) + T14 (UI/tRPC).
  - § UI surface → T14.
- **No placeholders.** Every code block is concrete. Where details are conditional (e.g. CSS-variable names for badges in T14), the plan says read the existing component.
- **Type consistency:** `CallerContext` introduced in T6 and used identically through T7-T11. `WriteToTerminalFn` introduced in T10 and used by `defaultWriteToTerminal` and by tests via DI. `cliSessionId` / `cli_session_id` column naming matches between T2, T10, T12. `WorkspaceDto` widened in T3 and consumed by tRPC in T14.
- **Test gating:** T1 is a manual verification. If `--session-id` doesn't work, the plan must adjust before T12 (the only task that depends on it). T2-T11 are independent and can be implemented even if T12 needs rework.
