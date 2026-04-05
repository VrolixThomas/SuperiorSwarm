# Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add customizable command buttons to the top bar that run shell commands in new terminal tabs, with per-repo and global scoping, and optional agent-assisted setup.

**Architecture:** New `quickActions` DB table stores commands with optional `projectId` for scoping. A `QuickActionBar` component renders inline in the top bar. Execution piggybacks on the existing terminal infrastructure. Agent-assisted setup reuses the MCP + launch script pattern from AI review.

**Tech Stack:** Drizzle ORM (SQLite), tRPC, React 19, Zustand, Electron globalShortcut, xterm.js (existing), MCP standalone server (existing pattern)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/db/schema.ts` | Modify | Add `quickActions` table definition |
| `src/main/db/migrations/0018_quick_actions.sql` | Create | SQL migration for the new table |
| `src/main/db/migrations/meta/_journal.json` | Modify | Register migration entry |
| `src/main/db/migrations/meta/0018_snapshot.json` | Create | Drizzle migration snapshot |
| `src/main/trpc/routers/quick-actions.ts` | Create | tRPC router: list, create, update, delete, reorder |
| `src/main/trpc/routers/index.ts` | Modify | Register `quickActionsRouter` |
| `src/renderer/components/QuickActionBar.tsx` | Create | Inline button strip + "+" trigger |
| `src/renderer/components/QuickActionPopover.tsx` | Create | Add/edit popover form |
| `src/renderer/components/QuickActionContextMenu.tsx` | Create | Right-click menu for edit/delete/reorder |
| `src/renderer/components/MainContentArea.tsx` | Modify | Add `QuickActionBar` next to `BranchChip` |
| `src/main/quick-actions/shortcuts.ts` | Create | Register/unregister Electron globalShortcuts |
| `src/main/quick-actions/agent-setup.ts` | Create | Launch script + MCP config for agent-assisted setup |
| `src/main/mcp-standalone/quick-actions-tools.ts` | Create | MCP tools for agent to add/list/remove actions |
| `tests/quick-actions.test.ts` | Create | DB operations + scope filtering tests |
| `tests/quick-actions-shortcuts.test.ts` | Create | Shortcut registration logic tests |

---

### Task 1: Database Schema & Migration

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts:247` (before the re-exports)
- Create: `apps/desktop/src/main/db/migrations/0018_quick_actions.sql`
- Modify: `apps/desktop/src/main/db/migrations/meta/_journal.json:130` (add entry)

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/quick-actions.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

describe("quickActions schema", () => {
	test("quickActions table has the expected columns", async () => {
		// Use drizzle-kit introspection-style check: import the table and verify columns
		const { quickActions } = await import("../src/main/db/schema");
		const columns = Object.keys(quickActions);
		expect(columns).toContain("id");
		expect(columns).toContain("projectId");
		expect(columns).toContain("label");
		expect(columns).toContain("command");
		expect(columns).toContain("cwd");
		expect(columns).toContain("shortcut");
		expect(columns).toContain("sortOrder");
		expect(columns).toContain("createdAt");
		expect(columns).toContain("updatedAt");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/quick-actions.test.ts`
Expected: FAIL — `quickActions` is not exported from schema

- [ ] **Step 3: Add the table definition to schema.ts**

Add before the re-exports block (line 258) in `apps/desktop/src/main/db/schema.ts`:

```typescript
export const quickActions = sqliteTable("quick_actions", {
	id: text("id").primaryKey(),
	projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
	label: text("label").notNull(),
	command: text("command").notNull(),
	cwd: text("cwd"),
	shortcut: text("shortcut"),
	sortOrder: integer("sort_order").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type QuickAction = typeof quickActions.$inferSelect;
export type NewQuickAction = typeof quickActions.$inferInsert;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/quick-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Generate the Drizzle migration**

Run: `cd apps/desktop && bun run db:generate`

This creates the migration SQL file and updates `meta/_journal.json` and the snapshot. Verify the generated SQL looks like:

```sql
CREATE TABLE `quick_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text REFERENCES `projects`(`id`) ON DELETE cascade,
	`label` text NOT NULL,
	`command` text NOT NULL,
	`cwd` text,
	`shortcut` text,
	`sort_order` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/migrations/ apps/desktop/tests/quick-actions.test.ts
git commit -m "feat(db): add quickActions table schema and migration"
```

---

### Task 2: tRPC Router — CRUD Operations

**Files:**
- Create: `apps/desktop/src/main/trpc/routers/quick-actions.ts`
- Modify: `apps/desktop/src/main/trpc/routers/index.ts:21-40`
- Test: `apps/desktop/tests/quick-actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/tests/quick-actions.test.ts`. These tests call the router procedures directly (same pattern as other routers in this codebase — no HTTP, just direct calls):

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { eq, or, isNull } from "drizzle-orm";
import { quickActions, projects } from "../src/main/db/schema";

function createTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	return db;
}

function seedProject(db: ReturnType<typeof createTestDb>, id = "proj-1") {
	db.insert(projects)
		.values({
			id,
			name: "Test Project",
			repoPath: "/tmp/test-repo",
			defaultBranch: "main",
			status: "ready",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.run();
	return id;
}

describe("quickActions CRUD", () => {
	test("create and list actions for a project (includes globals)", () => {
		const db = createTestDb();
		const projectId = seedProject(db);

		// Insert a global action
		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId: null,
				label: "Global Build",
				command: "make build",
				sortOrder: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		// Insert a repo-specific action
		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId,
				label: "Test",
				command: "bun test",
				sortOrder: 1,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		// Query: should return both global and repo-specific
		const result = db
			.select()
			.from(quickActions)
			.where(or(eq(quickActions.projectId, projectId), isNull(quickActions.projectId)))
			.all();

		expect(result).toHaveLength(2);
		expect(result.map((r) => r.label).sort()).toEqual(["Global Build", "Test"]);
	});

	test("delete cascades when project is deleted", () => {
		const db = createTestDb();
		const projectId = seedProject(db);

		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId,
				label: "Build",
				command: "bun run build",
				sortOrder: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		// Delete the project
		db.delete(projects).where(eq(projects.id, projectId)).run();

		// Action should be gone
		const result = db.select().from(quickActions).all();
		expect(result).toHaveLength(0);
	});

	test("global actions survive project deletion", () => {
		const db = createTestDb();
		const projectId = seedProject(db);

		db.insert(quickActions)
			.values({
				id: nanoid(),
				projectId: null,
				label: "Global",
				command: "echo hello",
				sortOrder: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();

		db.delete(projects).where(eq(projects.id, projectId)).run();

		const result = db.select().from(quickActions).all();
		expect(result).toHaveLength(1);
		expect(result[0]!.label).toBe("Global");
	});

	test("reorder updates sortOrder values", () => {
		const db = createTestDb();
		const projectId = seedProject(db);
		const ids = [nanoid(), nanoid(), nanoid()];

		for (let i = 0; i < ids.length; i++) {
			db.insert(quickActions)
				.values({
					id: ids[i]!,
					projectId,
					label: `Action ${i}`,
					command: `cmd ${i}`,
					sortOrder: i,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.run();
		}

		// Reverse the order
		const newOrder = [ids[2]!, ids[1]!, ids[0]!];
		for (let i = 0; i < newOrder.length; i++) {
			db.update(quickActions)
				.set({ sortOrder: i, updatedAt: new Date() })
				.where(eq(quickActions.id, newOrder[i]!))
				.run();
		}

		const result = db
			.select()
			.from(quickActions)
			.where(eq(quickActions.projectId, projectId))
			.orderBy(quickActions.sortOrder)
			.all();

		expect(result.map((r) => r.label)).toEqual(["Action 2", "Action 1", "Action 0"]);
	});
});
```

- [ ] **Step 2: Run tests to verify they pass** (these are pure DB tests, they should pass with the schema from Task 1)

Run: `cd apps/desktop && bun test tests/quick-actions.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 3: Create the tRPC router**

Create `apps/desktop/src/main/trpc/routers/quick-actions.ts`:

```typescript
import { eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { quickActions } from "../../db/schema";
import { publicProcedure, router } from "../index";

export const quickActionsRouter = router({
	list: publicProcedure
		.input(z.object({ projectId: z.string().nullable() }))
		.query(({ input }) => {
			const db = getDb();
			if (input.projectId) {
				return db
					.select()
					.from(quickActions)
					.where(or(eq(quickActions.projectId, input.projectId), isNull(quickActions.projectId)))
					.orderBy(quickActions.sortOrder)
					.all();
			}
			// No project context — return only globals
			return db
				.select()
				.from(quickActions)
				.where(isNull(quickActions.projectId))
				.orderBy(quickActions.sortOrder)
				.all();
		}),

	create: publicProcedure
		.input(
			z.object({
				projectId: z.string().nullable(),
				label: z.string().min(1),
				command: z.string().min(1),
				cwd: z.string().nullable().optional(),
				shortcut: z.string().nullable().optional(),
				sortOrder: z.number().int().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();

			// Default sortOrder: append to end
			const maxOrder = input.sortOrder ?? (() => {
				const rows = input.projectId
					? db
							.select()
							.from(quickActions)
							.where(
								or(
									eq(quickActions.projectId, input.projectId),
									isNull(quickActions.projectId)
								)
							)
							.all()
					: db.select().from(quickActions).where(isNull(quickActions.projectId)).all();
				return rows.length;
			})();

			const id = nanoid();
			db.insert(quickActions)
				.values({
					id,
					projectId: input.projectId,
					label: input.label,
					command: input.command,
					cwd: input.cwd ?? null,
					shortcut: input.shortcut ?? null,
					sortOrder: maxOrder,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.run();

			return { id };
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.string(),
				label: z.string().min(1).optional(),
				command: z.string().min(1).optional(),
				cwd: z.string().nullable().optional(),
				shortcut: z.string().nullable().optional(),
				projectId: z.string().nullable().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const { id, ...fields } = input;
			db.update(quickActions)
				.set({ ...fields, updatedAt: new Date() })
				.where(eq(quickActions.id, id))
				.run();
		}),

	delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
		const db = getDb();
		db.delete(quickActions).where(eq(quickActions.id, input.id)).run();
	}),

	reorder: publicProcedure
		.input(z.object({ orderedIds: z.array(z.string()) }))
		.mutation(({ input }) => {
			const db = getDb();
			for (let i = 0; i < input.orderedIds.length; i++) {
				db.update(quickActions)
					.set({ sortOrder: i, updatedAt: new Date() })
					.where(eq(quickActions.id, input.orderedIds[i]!))
					.run();
			}
		}),
});
```

- [ ] **Step 4: Register the router**

In `apps/desktop/src/main/trpc/routers/index.ts`, add the import and register it:

```typescript
import { quickActionsRouter } from "./quick-actions";
```

Add to the `appRouter` object:

```typescript
quickActions: quickActionsRouter,
```

- [ ] **Step 5: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/quick-actions.ts apps/desktop/src/main/trpc/routers/index.ts apps/desktop/tests/quick-actions.test.ts
git commit -m "feat: add quickActions tRPC router with CRUD and reorder"
```

---

### Task 3: QuickActionBar Component

**Files:**
- Create: `apps/desktop/src/renderer/components/QuickActionBar.tsx`
- Modify: `apps/desktop/src/renderer/components/MainContentArea.tsx:38-40`

- [ ] **Step 1: Create the QuickActionBar component**

Create `apps/desktop/src/renderer/components/QuickActionBar.tsx`:

```tsx
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface QuickActionBarProps {
	projectId: string;
	repoPath: string;
	workspaceId: string;
	onAddClick: () => void;
}

export function QuickActionBar({
	projectId,
	repoPath,
	workspaceId,
	onAddClick,
}: QuickActionBarProps) {
	const actionsQuery = trpc.quickActions.list.useQuery({ projectId });
	const addTerminalTab = useTabStore((s) => s.addTerminalTab);

	function handleRun(command: string, label: string, cwd: string | null) {
		const resolvedCwd = cwd ? `${repoPath}/${cwd}` : repoPath;
		const tabId = addTerminalTab(workspaceId, resolvedCwd, label);
		// Write the command to the terminal after a short delay to let the PTY initialize
		setTimeout(() => {
			window.electron.terminal.write(tabId, `${command}\n`);
		}, 300);
	}

	const actions = actionsQuery.data ?? [];

	if (actions.length === 0) {
		return (
			<button
				type="button"
				onClick={onAddClick}
				className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		);
	}

	return (
		<>
			<span className="text-[var(--text-quaternary)]">|</span>
			{actions.map((action) => (
				<button
					key={action.id}
					type="button"
					onClick={() => handleRun(action.command, action.label, action.cwd)}
					onContextMenu={(e) => {
						e.preventDefault();
						// Context menu handled by parent — dispatch custom event
						window.dispatchEvent(
							new CustomEvent("quick-action-context", {
								detail: { action, x: e.clientX, y: e.clientY },
							})
						);
					}}
					className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-tertiary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text)]"
				>
					{action.label}
				</button>
			))}
			<button
				type="button"
				onClick={onAddClick}
				className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		</>
	);
}
```

- [ ] **Step 2: Integrate into MainContentArea**

Modify `apps/desktop/src/renderer/components/MainContentArea.tsx`. Replace the branch indicator bar section (lines 37-41):

```tsx
{projectId && (
	<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1">
		<BranchChip projectId={projectId} />
		<QuickActionBar
			projectId={projectId}
			repoPath={cwd}
			workspaceId={activeWorkspaceId}
			onAddClick={() => setShowQuickActionPopover(true)}
		/>
	</div>
)}
```

This requires adding imports and state:

```tsx
import { useState } from "react";
import { QuickActionBar } from "./QuickActionBar";
import { QuickActionPopover } from "./QuickActionPopover";
```

Add inside the component, before the early returns:

```tsx
const cwd = useTabStore((s) => s.activeWorkspaceCwd);
const [showQuickActionPopover, setShowQuickActionPopover] = useState(false);
```

And render the popover after the closing `</main>` tag (wrap in a fragment or put inside main):

```tsx
{showQuickActionPopover && projectId && (
	<QuickActionPopover
		projectId={projectId}
		repoPath={cwd}
		onClose={() => setShowQuickActionPopover(false)}
	/>
)}
```

- [ ] **Step 3: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: Will fail because `QuickActionPopover` doesn't exist yet. Create a placeholder:

Create `apps/desktop/src/renderer/components/QuickActionPopover.tsx`:

```tsx
interface QuickActionPopoverProps {
	projectId: string;
	repoPath: string;
	onClose: () => void;
	editAction?: { id: string; label: string; command: string; cwd: string | null; shortcut: string | null; projectId: string | null };
}

export function QuickActionPopover({ onClose }: QuickActionPopoverProps) {
	return (
		<div className="fixed inset-0 z-50" onClick={onClose}>
			<div className="absolute right-4 top-12 w-[280px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
				<p className="text-[12px] text-[var(--text-secondary)]">Quick Action form — placeholder</p>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Run type-check again**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/QuickActionBar.tsx apps/desktop/src/renderer/components/QuickActionPopover.tsx apps/desktop/src/renderer/components/MainContentArea.tsx
git commit -m "feat: add QuickActionBar inline in top bar with placeholder popover"
```

---

### Task 4: QuickActionPopover — Full Form

**Files:**
- Modify: `apps/desktop/src/renderer/components/QuickActionPopover.tsx`

- [ ] **Step 1: Implement the full popover form**

Replace the placeholder in `apps/desktop/src/renderer/components/QuickActionPopover.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";

interface QuickActionPopoverProps {
	projectId: string;
	repoPath: string;
	onClose: () => void;
	editAction?: {
		id: string;
		label: string;
		command: string;
		cwd: string | null;
		shortcut: string | null;
		projectId: string | null;
	};
}

export function QuickActionPopover({
	projectId,
	repoPath,
	onClose,
	editAction,
}: QuickActionPopoverProps) {
	const [label, setLabel] = useState(editAction?.label ?? "");
	const [command, setCommand] = useState(editAction?.command ?? "");
	const [cwd, setCwd] = useState(editAction?.cwd ?? "");
	const [shortcut, setShortcut] = useState(editAction?.shortcut ?? "");
	const [scope, setScope] = useState<"global" | "repo">(
		editAction ? (editAction.projectId === null ? "global" : "repo") : "repo"
	);
	const labelRef = useRef<HTMLInputElement>(null);

	const utils = trpc.useUtils();
	const createMutation = trpc.quickActions.create.useMutation({
		onSuccess: () => {
			utils.quickActions.list.invalidate();
			onClose();
		},
	});
	const updateMutation = trpc.quickActions.update.useMutation({
		onSuccess: () => {
			utils.quickActions.list.invalidate();
			onClose();
		},
	});

	useEffect(() => {
		labelRef.current?.focus();
	}, []);

	const handleShortcutCapture = useCallback((e: React.KeyboardEvent) => {
		e.preventDefault();
		const parts: string[] = [];
		if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
		if (e.shiftKey) parts.push("Shift");
		if (e.altKey) parts.push("Alt");
		const key = e.key;
		if (!["Meta", "Control", "Shift", "Alt"].includes(key)) {
			parts.push(key.length === 1 ? key.toUpperCase() : key);
			setShortcut(parts.join("+"));
		}
	}, []);

	function handleSave() {
		if (!label.trim() || !command.trim()) return;

		const scopedProjectId = scope === "global" ? null : projectId;

		if (editAction) {
			updateMutation.mutate({
				id: editAction.id,
				label: label.trim(),
				command: command.trim(),
				cwd: cwd.trim() || null,
				shortcut: shortcut.trim() || null,
				projectId: scopedProjectId,
			});
		} else {
			createMutation.mutate({
				projectId: scopedProjectId,
				label: label.trim(),
				command: command.trim(),
				cwd: cwd.trim() || null,
				shortcut: shortcut.trim() || null,
			});
		}
	}

	return (
		<div className="fixed inset-0 z-50" onClick={onClose}>
			<div
				className="absolute right-4 top-12 w-[280px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-3 text-[13px] font-medium text-[var(--text)]">
					{editAction ? "Edit Quick Action" : "New Quick Action"}
				</div>

				<div className="flex flex-col gap-2">
					{/* Label */}
					<div>
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">Label</div>
						<input
							ref={labelRef}
							type="text"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Build"
							className="w-full rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</div>

					{/* Command */}
					<div>
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
							Command
						</div>
						<input
							type="text"
							value={command}
							onChange={(e) => setCommand(e.target.value)}
							placeholder="bun run build"
							className="w-full rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</div>

					{/* Working Directory */}
					<div>
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
							Directory <span className="normal-case text-[var(--text-quaternary)]">(optional)</span>
						</div>
						<input
							type="text"
							value={cwd}
							onChange={(e) => setCwd(e.target.value)}
							placeholder={repoPath}
							className="w-full rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</div>

					{/* Shortcut */}
					<div>
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
							Shortcut <span className="normal-case text-[var(--text-quaternary)]">(optional)</span>
						</div>
						<input
							type="text"
							value={shortcut}
							onKeyDown={handleShortcutCapture}
							readOnly
							placeholder="Press a key combination..."
							className="w-full cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
						{shortcut && (
							<button
								type="button"
								onClick={() => setShortcut("")}
								className="mt-1 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
							>
								Clear shortcut
							</button>
						)}
					</div>

					{/* Scope Toggle */}
					<div>
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">Scope</div>
						<div className="flex gap-1">
							<button
								type="button"
								onClick={() => setScope("repo")}
								className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
									scope === "repo"
										? "bg-[var(--accent)] text-white"
										: "bg-[var(--bg-base)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								This repo
							</button>
							<button
								type="button"
								onClick={() => setScope("global")}
								className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
									scope === "global"
										? "bg-[var(--accent)] text-white"
										: "bg-[var(--bg-base)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								Global
							</button>
						</div>
					</div>
				</div>

				{/* Actions */}
				<div className="mt-3 flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded px-3 py-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSave}
						disabled={!label.trim() || !command.trim()}
						className="rounded bg-[var(--accent)] px-3 py-1 text-[11px] text-white disabled:opacity-40"
					>
						{editAction ? "Save" : "Add"}
					</button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/QuickActionPopover.tsx
git commit -m "feat: implement QuickActionPopover form with all fields"
```

---

### Task 5: QuickActionContextMenu — Right-Click Menu

**Files:**
- Create: `apps/desktop/src/renderer/components/QuickActionContextMenu.tsx`
- Modify: `apps/desktop/src/renderer/components/MainContentArea.tsx`

- [ ] **Step 1: Create the context menu component**

Create `apps/desktop/src/renderer/components/QuickActionContextMenu.tsx`:

```tsx
import { useEffect } from "react";
import { trpc } from "../trpc/client";

interface ContextMenuAction {
	id: string;
	label: string;
	command: string;
	cwd: string | null;
	shortcut: string | null;
	projectId: string | null;
	sortOrder: number;
}

interface QuickActionContextMenuProps {
	action: ContextMenuAction;
	x: number;
	y: number;
	onClose: () => void;
	onEdit: (action: ContextMenuAction) => void;
}

export function QuickActionContextMenu({
	action,
	x,
	y,
	onClose,
	onEdit,
}: QuickActionContextMenuProps) {
	const utils = trpc.useUtils();
	const deleteMutation = trpc.quickActions.delete.useMutation({
		onSuccess: () => utils.quickActions.list.invalidate(),
	});

	useEffect(() => {
		function handleClickOutside() {
			onClose();
		}
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [onClose]);

	return (
		<div
			className="fixed z-[60] min-w-[140px] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-xl"
			style={{ left: x, top: y }}
		>
			<button
				type="button"
				onClick={() => {
					onEdit(action);
					onClose();
				}}
				className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.06)]"
			>
				Edit
			</button>
			<button
				type="button"
				onClick={() => {
					deleteMutation.mutate({ id: action.id });
					onClose();
				}}
				className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--color-danger)] hover:bg-[rgba(255,255,255,0.06)]"
			>
				Delete
			</button>
		</div>
	);
}
```

- [ ] **Step 2: Wire context menu into MainContentArea**

Add imports to `MainContentArea.tsx`:

```tsx
import { QuickActionContextMenu } from "./QuickActionContextMenu";
```

Add state for the context menu:

```tsx
const [contextMenu, setContextMenu] = useState<{
	action: any;
	x: number;
	y: number;
} | null>(null);
const [editAction, setEditAction] = useState<any>(null);
```

Add a `useEffect` to listen for the custom event dispatched by `QuickActionBar`:

```tsx
useEffect(() => {
	function handleContextMenu(e: Event) {
		const { action, x, y } = (e as CustomEvent).detail;
		setContextMenu({ action, x, y });
	}
	window.addEventListener("quick-action-context", handleContextMenu);
	return () => window.removeEventListener("quick-action-context", handleContextMenu);
}, []);
```

Render the context menu and update the popover to pass `editAction`:

```tsx
{contextMenu && (
	<QuickActionContextMenu
		action={contextMenu.action}
		x={contextMenu.x}
		y={contextMenu.y}
		onClose={() => setContextMenu(null)}
		onEdit={(action) => {
			setEditAction(action);
			setShowQuickActionPopover(true);
		}}
	/>
)}
{showQuickActionPopover && projectId && (
	<QuickActionPopover
		projectId={projectId}
		repoPath={cwd}
		onClose={() => {
			setShowQuickActionPopover(false);
			setEditAction(null);
		}}
		editAction={editAction ?? undefined}
	/>
)}
```

- [ ] **Step 3: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/QuickActionContextMenu.tsx apps/desktop/src/renderer/components/MainContentArea.tsx
git commit -m "feat: add right-click context menu for quick action edit/delete"
```

---

### Task 6: Keyboard Shortcuts

**Files:**
- Create: `apps/desktop/src/main/quick-actions/shortcuts.ts`
- Test: `apps/desktop/tests/quick-actions-shortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/quick-actions-shortcuts.test.ts`:

```typescript
import { describe, expect, mock, test } from "bun:test";

// Test the shortcut parsing logic (not the Electron globalShortcut registration,
// which requires a running app). We test the pure function that builds the
// shortcut-to-action map.

describe("buildShortcutMap", () => {
	test("builds map from actions with shortcuts", () => {
		const { buildShortcutMap } = require("../src/main/quick-actions/shortcuts");
		const actions = [
			{ id: "1", shortcut: "CommandOrControl+Shift+B", label: "Build", command: "bun run build" },
			{ id: "2", shortcut: null, label: "Test", command: "bun test" },
			{ id: "3", shortcut: "CommandOrControl+Shift+T", label: "Type Check", command: "bun run type-check" },
		];
		const map = buildShortcutMap(actions);
		expect(map.size).toBe(2);
		expect(map.get("CommandOrControl+Shift+B")?.id).toBe("1");
		expect(map.get("CommandOrControl+Shift+T")?.id).toBe("3");
	});

	test("returns empty map for no actions", () => {
		const { buildShortcutMap } = require("../src/main/quick-actions/shortcuts");
		const map = buildShortcutMap([]);
		expect(map.size).toBe(0);
	});

	test("skips actions with empty shortcut strings", () => {
		const { buildShortcutMap } = require("../src/main/quick-actions/shortcuts");
		const actions = [
			{ id: "1", shortcut: "", label: "Build", command: "bun run build" },
		];
		const map = buildShortcutMap(actions);
		expect(map.size).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/quick-actions-shortcuts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the shortcuts module**

Create `apps/desktop/src/main/quick-actions/shortcuts.ts`:

```typescript
import type { QuickAction } from "../db/schema";

type ShortcutAction = Pick<QuickAction, "id" | "shortcut" | "label" | "command" | "cwd">;

export function buildShortcutMap(
	actions: ShortcutAction[]
): Map<string, ShortcutAction> {
	const map = new Map<string, ShortcutAction>();
	for (const action of actions) {
		if (action.shortcut) {
			map.set(action.shortcut, action);
		}
	}
	return map;
}

let registeredShortcuts: string[] = [];

/**
 * Sync keyboard shortcuts with the current set of quick actions.
 * Call this when the active project changes or when actions are modified.
 *
 * `registerFn` and `unregisterFn` are injected to allow testing without Electron.
 * In production, pass `globalShortcut.register` and `globalShortcut.unregister`.
 */
export function syncShortcuts(
	actions: ShortcutAction[],
	onTrigger: (action: ShortcutAction) => void,
	registerFn: (accelerator: string, callback: () => void) => void,
	unregisterFn: (accelerator: string) => void
): void {
	// Unregister all previously registered shortcuts
	for (const acc of registeredShortcuts) {
		unregisterFn(acc);
	}
	registeredShortcuts = [];

	// Register new ones
	const map = buildShortcutMap(actions);
	for (const [accelerator, action] of map) {
		registerFn(accelerator, () => onTrigger(action));
		registeredShortcuts.push(accelerator);
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/quick-actions-shortcuts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/quick-actions/shortcuts.ts apps/desktop/tests/quick-actions-shortcuts.test.ts
git commit -m "feat: add keyboard shortcut registration for quick actions"
```

---

### Task 7: Shortcut Integration in Main Process

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (or wherever app lifecycle is managed)

This task wires the `syncShortcuts` function into the Electron app lifecycle. The shortcuts need to be re-synced when:
1. The app starts
2. The active project changes (renderer sends an IPC message)
3. Quick actions are created/updated/deleted

- [ ] **Step 1: Add IPC handler for syncing shortcuts**

Read `apps/desktop/src/main/index.ts` to find where IPC handlers are registered. Add a handler that the renderer calls when the active project changes. The handler:
1. Queries quick actions for the current project from the DB
2. Calls `syncShortcuts` with the Electron `globalShortcut` module
3. The `onTrigger` callback sends an IPC event to the renderer's focused window

Add to the main process IPC setup area:

```typescript
import { globalShortcut, BrowserWindow } from "electron";
import { syncShortcuts } from "./quick-actions/shortcuts";
import { getDb } from "./db";
import { quickActions } from "./db/schema";
import { eq, or, isNull } from "drizzle-orm";

ipcMain.handle("quick-actions:sync-shortcuts", (_event, projectId: string | null) => {
	const db = getDb();
	const actions = projectId
		? db
				.select()
				.from(quickActions)
				.where(or(eq(quickActions.projectId, projectId), isNull(quickActions.projectId)))
				.all()
		: db.select().from(quickActions).where(isNull(quickActions.projectId)).all();

	syncShortcuts(
		actions,
		(action) => {
			const win = BrowserWindow.getFocusedWindow();
			if (win) {
				win.webContents.send("quick-action:trigger", {
					command: action.command,
					label: action.label,
					cwd: action.cwd,
				});
			}
		},
		globalShortcut.register.bind(globalShortcut),
		globalShortcut.unregister.bind(globalShortcut)
	);
});
```

- [ ] **Step 2: Add preload bridge for the trigger event and sync call**

In `apps/desktop/src/preload/index.ts`, expose the sync call and the trigger listener:

```typescript
// In the contextBridge.exposeInMainWorld section:
quickActions: {
	syncShortcuts: (projectId: string | null) =>
		ipcRenderer.invoke("quick-actions:sync-shortcuts", projectId),
	onTrigger: (callback: (data: { command: string; label: string; cwd: string | null }) => void) => {
		const handler = (_event: any, data: any) => callback(data);
		ipcRenderer.on("quick-action:trigger", handler);
		return () => ipcRenderer.removeListener("quick-action:trigger", handler);
	},
},
```

- [ ] **Step 3: Call syncShortcuts from the renderer when project changes or actions change**

In `QuickActionBar.tsx`, add a `useEffect` that syncs shortcuts whenever the action list changes:

```typescript
useEffect(() => {
	window.electron.quickActions.syncShortcuts(projectId);
}, [projectId, actionsQuery.data]);
```

Add a `useEffect` in `MainContentArea.tsx` (or `App.tsx`) to listen for trigger events:

```typescript
useEffect(() => {
	const cleanup = window.electron.quickActions.onTrigger(({ command, label, cwd }) => {
		const state = useTabStore.getState();
		const workspaceId = state.activeWorkspaceId;
		const repoPath = state.activeWorkspaceCwd;
		if (!workspaceId) return;
		const resolvedCwd = cwd ? `${repoPath}/${cwd}` : repoPath;
		const tabId = state.addTerminalTab(workspaceId, resolvedCwd, label);
		setTimeout(() => {
			window.electron.terminal.write(tabId, `${command}\n`);
		}, 300);
	});
	return cleanup;
}, []);
```

- [ ] **Step 4: Update TypeScript types for the preload API**

Find the preload type definitions (likely in a `shared/` or `preload/` types file) and add the `quickActions` namespace to the `ElectronAPI` interface.

- [ ] **Step 5: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/components/QuickActionBar.tsx apps/desktop/src/renderer/components/MainContentArea.tsx
git commit -m "feat: wire keyboard shortcuts through IPC for quick actions"
```

---

### Task 8: Agent-Assisted Setup — MCP Tools & Launch Script

**Files:**
- Create: `apps/desktop/src/main/mcp-standalone/quick-actions-tools.ts`
- Create: `apps/desktop/src/main/quick-actions/agent-setup.ts`
- Modify: `apps/desktop/src/main/trpc/routers/quick-actions.ts` (add `launchSetupAgent` route)

- [ ] **Step 1: Create MCP tools for quick actions**

Create `apps/desktop/src/main/mcp-standalone/quick-actions-tools.ts`. Follow the existing MCP tool pattern from the review tools:

```typescript
import type { QuickAction } from "../db/schema";

export interface QuickActionMcpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export const quickActionTools: QuickActionMcpTool[] = [
	{
		name: "add_quick_action",
		description:
			"Add a quick action button to the top bar. Provide a short label, the shell command to run, and optionally a subdirectory and scope.",
		inputSchema: {
			type: "object",
			properties: {
				label: { type: "string", description: "Short button label (e.g. 'Build', 'Test')" },
				command: { type: "string", description: "Shell command to execute" },
				cwd: {
					type: "string",
					description: "Relative subdirectory to run in (optional, defaults to repo root)",
				},
				shortcut: {
					type: "string",
					description: "Keyboard shortcut in Electron accelerator format (optional)",
				},
				scope: {
					type: "string",
					enum: ["global", "repo"],
					description: "Whether this action applies globally or only to this repo",
				},
			},
			required: ["label", "command"],
		},
	},
	{
		name: "list_quick_actions",
		description: "List all currently configured quick action buttons",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "remove_quick_action",
		description: "Remove a quick action by its ID",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "The ID of the quick action to remove" },
			},
			required: ["id"],
		},
	},
];
```

- [ ] **Step 2: Create the agent setup orchestrator**

Create `apps/desktop/src/main/quick-actions/agent-setup.ts`. This follows the same pattern as `apps/desktop/src/main/ai-review/orchestrator.ts`:

```typescript
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { nanoid } from "nanoid";
import { getCliPresets, type LaunchOptions } from "../ai-review/cli-presets";
import { getDb } from "../db";
import { aiReviewSettings } from "../db/schema-ai-review";

export interface SetupAgentResult {
	sessionId: string;
	launchScript: string;
}

export function launchSetupAgent(
	projectId: string,
	repoPath: string
): SetupAgentResult {
	const sessionId = nanoid();
	const setupDir = join(app.getPath("userData"), "quick-action-setup", sessionId);
	mkdirSync(setupDir, { recursive: true });

	const db = getDb();
	const dbPath = join(app.getPath("userData"), "superiorswarm.db");

	// Read the user's preferred CLI
	const settings = db.select().from(aiReviewSettings).get();
	const cliName = settings?.defaultCli ?? "claude";
	const presets = getCliPresets();
	const preset = presets.find((p) => p.name === cliName) ?? presets[0]!;

	// Write MCP config for the quick-actions tools
	const mcpServerPath = join(__dirname, "../mcp-standalone/server.mjs");
	const mcpConfigPath = join(repoPath, ".mcp.json");
	const mcpConfig = {
		mcpServers: {
			superiorswarm: {
				command: "node",
				args: [mcpServerPath],
				env: {
					QUICK_ACTION_SETUP: "true",
					PROJECT_ID: projectId,
					DB_PATH: dbPath,
					WORKTREE_PATH: repoPath,
				},
			},
		},
	};
	writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf-8");

	// Write prompt file
	const promptFilePath = join(setupDir, "setup-prompt.txt");
	const promptContent = `You are helping set up quick action buttons for a development project.

Explore this repository to understand what kind of project it is. Look at:
- package.json, Cargo.toml, go.mod, Makefile, pyproject.toml, etc.
- Existing scripts and build configurations
- README for build/test instructions

Then suggest relevant quick actions. Common examples:
- Build the project
- Run tests
- Start dev server
- Lint/format code
- Type checking

Use the add_quick_action tool to save each action. Ask the user which ones they want before adding them.
Use list_quick_actions to show what's already configured.
Use remove_quick_action if the user wants to remove one.

Project path: ${repoPath}
`;
	writeFileSync(promptFilePath, promptContent, "utf-8");

	// Build the CLI command
	const launchOpts: Partial<LaunchOptions> = {
		mcpServerPath,
		worktreePath: repoPath,
		reviewDir: setupDir,
		promptFilePath,
		dbPath,
	};

	// Write launch script
	const launchScript = join(setupDir, "start-setup.sh");
	const resolvedCommand = preset.command;
	const scriptContent = [
		"#!/bin/bash",
		`cd '${repoPath}'`,
		"",
		`${resolvedCommand} "Help me set up quick action buttons. Read ${promptFilePath} for instructions."`,
	].join("\n");
	writeFileSync(launchScript, scriptContent, "utf-8");
	chmodSync(launchScript, 0o755);

	return { sessionId, launchScript };
}
```

- [ ] **Step 3: Add the tRPC route**

Add to `apps/desktop/src/main/trpc/routers/quick-actions.ts`:

```typescript
import { launchSetupAgent } from "../../quick-actions/agent-setup";
```

Add this procedure to the router:

```typescript
launchSetupAgent: publicProcedure
	.input(z.object({ projectId: z.string(), repoPath: z.string() }))
	.mutation(({ input }) => {
		return launchSetupAgent(input.projectId, input.repoPath);
	}),
```

- [ ] **Step 4: Add "Ask agent" button to the popover**

In `QuickActionPopover.tsx`, add an import and mutation:

```typescript
const launchAgent = trpc.quickActions.launchSetupAgent.useMutation();
const addTerminalTab = useTabStore((s) => s.addTerminalTab);
const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
```

Add a button before the Cancel/Save row:

```tsx
<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
	<button
		type="button"
		onClick={() => {
			if (!activeWorkspaceId) return;
			launchAgent.mutate(
				{ projectId, repoPath },
				{
					onSuccess: ({ launchScript }) => {
						const tabId = addTerminalTab(activeWorkspaceId, repoPath, "Setup Quick Actions");
						setTimeout(() => {
							window.electron.terminal.write(tabId, `bash '${launchScript}'\n`);
						}, 300);
						onClose();
					},
				}
			);
		}}
		className="w-full rounded bg-[var(--bg-base)] px-2 py-1.5 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)]"
	>
		Ask agent to set up commands...
	</button>
</div>
```

- [ ] **Step 5: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/mcp-standalone/quick-actions-tools.ts apps/desktop/src/main/quick-actions/agent-setup.ts apps/desktop/src/main/trpc/routers/quick-actions.ts apps/desktop/src/renderer/components/QuickActionPopover.tsx
git commit -m "feat: add agent-assisted setup for quick actions via MCP"
```

---

### Task 9: MCP Server — Handle Quick Action Tools

**Files:**
- Modify: `apps/desktop/src/main/mcp-standalone/server.mjs` (or whichever file handles MCP tool dispatch)

- [ ] **Step 1: Read the existing MCP server to understand the tool dispatch pattern**

Read `apps/desktop/src/main/mcp-standalone/server.mjs` and understand how it dispatches tool calls. The quick action tools need to be handled when `process.env.QUICK_ACTION_SETUP === "true"`.

- [ ] **Step 2: Add quick action tool handlers**

In the MCP server's tool dispatch, when `QUICK_ACTION_SETUP` env is set, register handlers for `add_quick_action`, `list_quick_actions`, and `remove_quick_action`. These handlers:

- Open the SQLite database at `process.env.DB_PATH`
- `add_quick_action`: Insert a row into `quick_actions` table with the provided fields. Use `process.env.PROJECT_ID` as `projectId` when scope is "repo", null when "global".
- `list_quick_actions`: Select all actions where `projectId = PROJECT_ID OR projectId IS NULL`.
- `remove_quick_action`: Delete the row by ID.

The exact implementation depends on how the existing MCP server is structured — follow the same patterns used for review draft tools (`add_draft_comment`, `finish_review`, etc.).

- [ ] **Step 3: Run the app in dev mode and test the agent setup flow manually**

Run: `bun run dev`

1. Open a project
2. Click "+" in the top bar
3. Click "Ask agent to set up commands..."
4. Verify the agent launches in a new terminal tab
5. Verify the agent can explore the repo and call `add_quick_action`
6. Verify the new action appears in the top bar

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/mcp-standalone/
git commit -m "feat: handle quick action MCP tools in standalone server"
```

---

### Task 10: Manual Testing & Polish

**Files:** Various — bug fixes discovered during testing

- [ ] **Step 1: Run the full test suite**

Run: `cd apps/desktop && bun test`
Expected: All tests pass, including the new quick-actions tests

- [ ] **Step 2: Run lint and type-check**

Run: `bun run lint && bun run type-check`
Expected: No errors

- [ ] **Step 3: Manual testing checklist**

Test in the running app (`bun run dev`):

1. **Add a quick action via popover** — click "+", fill in label + command, save. Verify it appears as a ghost text button.
2. **Run a quick action** — click the button. Verify a new terminal tab opens and the command runs.
3. **Edit via right-click** — right-click a button, choose Edit. Verify popover opens pre-filled. Save changes.
4. **Delete via right-click** — right-click, choose Delete. Verify button disappears.
5. **Global vs repo scope** — add a global action, switch to a different project, verify it still appears.
6. **Working directory** — add an action with a relative cwd (e.g. `apps/desktop`). Verify the terminal opens in that subdirectory.
7. **Keyboard shortcut** — add an action with a shortcut. Press the shortcut. Verify a terminal opens and runs the command.
8. **Agent setup** — click "Ask agent...", interact with the agent, verify actions are saved.

- [ ] **Step 4: Fix any issues found during testing**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: polish quick actions based on manual testing"
```
