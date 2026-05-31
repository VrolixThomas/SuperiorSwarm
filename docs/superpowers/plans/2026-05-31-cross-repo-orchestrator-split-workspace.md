# Cross-repo Orchestrator Split Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one click on a cross-repo orchestrator open a split workspace — coordinator terminal left, all-info overview right — and strip the sidebar to a clean flat list with real member navigation in the overview.

**Architecture:** The orchestrator's id doubles as a renderer `workspaceId`, so its terminal tabs and the `xro-canvas` overview tab already share one pane layout. A new `openXroWorkspace` opener sets the active workspace (today's click never does — the core bug), builds a deterministic horizontal split (coordinator terminal in the original/left pane, overview pushed into the new/right pane), and auto-starts the coordinator by writing a server-supplied launch command into the terminal tab. The sidebar body is removed; member navigation moves into the overview's now-clickable member cards, which need a `worktreePath` added to the member query.

**Tech Stack:** Electron + React 19 + TypeScript, Bun test runner, Drizzle ORM (SQLite), tRPC over IPC, Zustand (tab-store / pane-store), Biome.

---

## File map

- `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts` — add `worktreePath` to `listCrossRepoMembers` (Task 1).
- `apps/desktop/src/main/services/cross-repo-orchestrators.ts` — add `getCoordinatorLaunch`; repurpose start to `markAgentStarted` (Task 2).
- `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts` — expose `getCoordinatorLaunch` + `markAgentStarted`, drop `startAgent` (Task 2).
- `apps/desktop/src/renderer/stores/tab-store.ts` — add `openXroWorkspace` (Task 3).
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx` — simplify + active highlight + click→open+autostart (Task 4).
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx` — drop expand/body (Task 5).
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorBody.tsx` — delete (Task 5).
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx` — wire member `onOpen`/`onAnswer`, map `worktreePath` (Task 6).
- Tests: `tests/cross-repo-orchestrator-members-worktree.test.ts`, `tests/cross-repo-coordinator-launch.test.ts`, `tests/tab-store-xro-workspace.test.ts`.

Run a single test file with: `bun test tests/<file>.ts` (from `apps/desktop/`).
Type-check: `cd apps/desktop && bun run type-check`. Lint: `bun run check`.

---

### Task 1: `listCrossRepoMembers` returns `worktreePath`

**Files:**
- Modify: `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts:116-152`
- Test: `apps/desktop/tests/cross-repo-orchestrator-members-worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/cross-repo-orchestrator-members-worktree.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { nanoid } from "nanoid";
import { getDb } from "../src/main/db";
import { worktrees, workspaces } from "../src/main/db/schema";
import {
	addProjectToCrossRepoOrchestrator,
	attachToCrossRepoOrchestrator,
	listCrossRepoMembers,
} from "../src/main/services/cross-repo-orchestrator-membership";
import {
	seedCrossRepoOrchestrator,
	seedProject,
	seedWorkspace,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

describe("listCrossRepoMembers worktreePath", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("returns the member's worktree path, or null when none", async () => {
		const project = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [project] });

		// Member WITH a worktree
		const withWt = await seedWorkspace(project, { name: "with-wt" });
		const wtId = `wt-${nanoid(6)}`;
		const wtPath = "/tmp/worktrees/with-wt";
		getDb()
			.insert(worktrees)
			.values({ id: wtId, projectId: project, path: wtPath, branch: "feat/x", createdAt: new Date() })
			.run();
		getDb().update(workspaces).set({ worktreeId: wtId }).where(eq(workspaces.id, withWt)).run();

		// Member WITHOUT a worktree
		const noWt = await seedWorkspace(project, { name: "no-wt" });

		await addProjectToCrossRepoOrchestrator({ orchestratorId: xro, projectId: project });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: withWt });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: noWt });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		const byId = new Map(members.map((m) => [m.workspaceId, m]));
		expect(byId.get(withWt)?.worktreePath).toBe(wtPath);
		expect(byId.get(noWt)?.worktreePath).toBeNull();
	});
});

import { eq } from "drizzle-orm";
```

(Move the `import { eq }` to the top with the other imports when writing the file — shown at the bottom here only for visibility.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cross-repo-orchestrator-members-worktree.test.ts`
Expected: FAIL — `worktreePath` is `undefined` (property does not exist on the returned rows).

- [ ] **Step 3: Implement**

In `cross-repo-orchestrator-membership.ts`, add `worktrees` to the schema import:

```typescript
import {
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	orchestratorMembers,
	worktrees,
	workspaces,
} from "../db/schema";
```

Extend the `listCrossRepoMembers` return type and query (replace lines 116-152):

```typescript
export async function listCrossRepoMembers(input: {
	orchestratorId: string;
}): Promise<
	Array<{
		workspaceId: string;
		sortOrder: number;
		parentKind: string;
		projectId: string;
		workspaceName: string;
		currentPhase: WorkspacePhase;
		statusText: string | null;
		needs: string | null;
		worktreePath: string | null;
	}>
> {
	const db = getDb();
	return db
		.select({
			workspaceId: orchestratorMembers.workspaceId,
			sortOrder: orchestratorMembers.sortOrder,
			parentKind: orchestratorMembers.parentKind,
			projectId: workspaces.projectId,
			workspaceName: workspaces.name,
			currentPhase: workspaces.currentPhase,
			statusText: workspaces.statusText,
			needs: workspaces.needs,
			worktreePath: worktrees.path,
		})
		.from(orchestratorMembers)
		.innerJoin(workspaces, eq(workspaces.id, orchestratorMembers.workspaceId))
		.leftJoin(worktrees, eq(worktrees.id, workspaces.worktreeId))
		.where(
			and(
				eq(orchestratorMembers.orchestratorId, input.orchestratorId),
				eq(orchestratorMembers.parentKind, "cross_repo")
			)
		)
		.orderBy(asc(orchestratorMembers.sortOrder))
		.all();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cross-repo-orchestrator-members-worktree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts apps/desktop/tests/cross-repo-orchestrator-members-worktree.test.ts
git commit -m "feat(xro): listCrossRepoMembers returns member worktreePath"
```

---

### Task 2: Coordinator launch command exposed server-side

**Files:**
- Modify: `apps/desktop/src/main/services/cross-repo-orchestrators.ts:119-152` (replace `startCrossRepoOrchestratorAgent`)
- Modify: `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts:82-88`
- Test: `apps/desktop/tests/cross-repo-coordinator-launch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/cross-repo-coordinator-launch.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getCoordinatorLaunch,
	markAgentStarted,
} from "../src/main/services/cross-repo-orchestrators";
import { getCrossRepoOrchestrator } from "../src/main/services/cross-repo-orchestrators";
import { seedCrossRepoOrchestrator, setupTestDb, teardownTestDb } from "./helpers/db";

describe("coordinator launch", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("getCoordinatorLaunch builds the CLI command for the agent kind", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "claude", workDir: "/tmp/xro-abc" });
		const launch = await getCoordinatorLaunch({ id: xro });
		expect(launch.cwd).toBe("/tmp/xro-abc");
		expect(launch.command).toBe("claude --dangerously-skip-permissions");
	});

	test("getCoordinatorLaunch uses gemini preset flags", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "gemini", workDir: "/tmp/xro-g" });
		const launch = await getCoordinatorLaunch({ id: xro });
		expect(launch.command).toBe("gemini --yolo");
	});

	test("markAgentStarted flips status to working", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "claude" });
		await markAgentStarted({ id: xro });
		const row = await getCrossRepoOrchestrator({ id: xro });
		expect(row?.status).toBe("working");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cross-repo-coordinator-launch.test.ts`
Expected: FAIL — `getCoordinatorLaunch` / `markAgentStarted` are not exported.

- [ ] **Step 3: Implement**

In `cross-repo-orchestrators.ts`, replace `startCrossRepoOrchestratorAgent` (lines 119-152) with these two functions. Keep the existing `assertAgentKind`, `CLI_PRESETS` import, `escapeShellSingleQuote`, and `getCrossRepoOrchestrator`. Remove the now-unused imports `defaultSpawnFn` and `createWorkspace`? — `createWorkspace` is still used by `dispatchAcrossRepos`; keep it. `defaultSpawnFn` is no longer used here — remove it from the import on line 18 (leaving `import { createWorkspace } from "./workspace-service";`).

```typescript
export async function getCoordinatorLaunch(input: {
	id: string;
}): Promise<{ cwd: string; command: string }> {
	const row = await getCrossRepoOrchestrator({ id: input.id });
	if (!row) throw new Error(`cross-repo orchestrator ${input.id} not found`);

	const agentKind = assertAgentKind(row.agentKind);
	const preset = CLI_PRESETS[agentKind];
	if (!preset) throw new Error(`no CLI preset for agentKind: ${agentKind}`);

	const command = [preset.command, preset.permissionFlag].filter(Boolean).join(" ");
	return { cwd: row.workDir, command };
}

export async function markAgentStarted(input: { id: string }): Promise<{ ok: true }> {
	getDb()
		.update(crossRepoOrchestrators)
		.set({ status: "working", updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	return { ok: true };
}
```

The `escapeShellSingleQuote` helper is now unused (the renderer runs the command in an interactive shell, no script file). Remove it to satisfy `noUnusedLocals`.

- [ ] **Step 4: Update the router**

In `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts`, change the import block (lines 10-19) to import `getCoordinatorLaunch` and `markAgentStarted` instead of `startCrossRepoOrchestratorAgent`:

```typescript
import {
	createCrossRepoOrchestrator,
	deleteCrossRepoOrchestrator,
	dispatchAcrossRepos,
	getCoordinatorLaunch,
	getCrossRepoOrchestrator,
	listCrossRepoOrchestrators,
	markAgentStarted,
	renameCrossRepoOrchestrator,
	stopCrossRepoOrchestratorAgent,
} from "../../services/cross-repo-orchestrators";
```

Replace the `startAgent` procedure (lines 82-84) with:

```typescript
	getCoordinatorLaunch: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => getCoordinatorLaunch(input)),

	markAgentStarted: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => markAgentStarted(input)),
```

Leave `stopAgent` as-is.

- [ ] **Step 5: Run test + type-check**

Run: `bun test tests/cross-repo-coordinator-launch.test.ts`
Expected: PASS.
Run: `cd apps/desktop && bun run type-check`
Expected: no errors. (Fixes any remaining reference to the removed `startAgent` — grep `startCrossRepoOrchestratorAgent` and `startAgent` to confirm none remain except the Row, handled in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/services/cross-repo-orchestrators.ts apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts apps/desktop/tests/cross-repo-coordinator-launch.test.ts
git commit -m "feat(xro): expose coordinator launch command + markAgentStarted, drop broadcaster start"
```

---

### Task 3: `openXroWorkspace` opener in tab-store

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts` (interface near line 190; implementation near line 734)
- Test: `apps/desktop/tests/tab-store-xro-workspace.test.ts`

The opener builds the split so the coordinator terminal is in the original (left) pane and the canvas is pushed into the new (right) pane. `splitPane(ws, paneId, "horizontal", tab)` places `tab` in the NEW pane (right). It returns a `{ terminalTabId, started }` shape so the Row knows whether to run the launch command.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/tab-store-xro-workspace.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from "bun:test";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import { useTabStore } from "../src/renderer/stores/tab-store";

function resetStores() {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useTabStore.setState({ activeWorkspaceId: null, activeWorkspaceCwd: "" });
}

describe("openXroWorkspace", () => {
	beforeEach(() => resetStores());

	test("sets active workspace and builds terminal-left / canvas-right split", () => {
		const result = useTabStore.getState().openXroWorkspace("xro-1", "Checkout", "/tmp/xro-1");

		expect(useTabStore.getState().activeWorkspaceId).toBe("xro-1");
		expect(result.started).toBe(true);

		const tabs = useTabStore.getState().getTabsByWorkspace("xro-1");
		const terminals = tabs.filter((t) => t.kind === "terminal");
		const canvases = tabs.filter((t) => t.kind === "xro-canvas");
		expect(terminals).toHaveLength(1);
		expect(canvases).toHaveLength(1);
		expect(result.terminalTabId).toBe(terminals[0]!.id);

		// Two panes: left holds the terminal, right holds the canvas.
		const layout = usePaneStore.getState().layouts["xro-1"];
		expect(layout?.type).toBe("split");
		if (layout?.type === "split") {
			const [left, right] = layout.children;
			expect(left.type === "pane" && left.tabs[0]?.kind).toBe("terminal");
			expect(right.type === "pane" && right.tabs[0]?.kind).toBe("xro-canvas");
		}
	});

	test("reattaches without spawning a second coordinator", () => {
		useTabStore.getState().openXroWorkspace("xro-1", "Checkout", "/tmp/xro-1");
		const again = useTabStore.getState().openXroWorkspace("xro-1", "Checkout", "/tmp/xro-1");

		expect(again.started).toBe(false);
		const terminals = useTabStore
			.getState()
			.getTabsByWorkspace("xro-1")
			.filter((t) => t.kind === "terminal");
		expect(terminals).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tab-store-xro-workspace.test.ts`
Expected: FAIL — `openXroWorkspace` is not a function.

- [ ] **Step 3: Add the interface entry**

In the `TabStore` interface, directly after the `openXroCanvas` line (around line 190), add:

```typescript
	openXroWorkspace: (
		orchestratorId: string,
		title: string,
		workDir: string
	) => { terminalTabId: string; started: boolean };
```

- [ ] **Step 4: Implement the action**

In the store body, directly after the `openXroCanvas` implementation (after line 761), add. This tags the coordinator terminal with `presetName: "xro-coordinator"` so the reattach guard can find it:

```typescript
	openXroWorkspace: (orchestratorId, title, workDir) => {
		const workspaceId = orchestratorId;
		get().setActiveWorkspace(workspaceId, workDir);
		ps().ensureLayout(workspaceId);

		// Reattach: if a coordinator terminal already exists, just focus it and
		// make sure the canvas tab is present. Do not spawn a second coordinator.
		const existingCoord = findTabInWorkspace(
			workspaceId,
			(t) => t.kind === "terminal" && t.presetName === "xro-coordinator"
		);
		if (existingCoord) {
			ps().setActiveTabInPane(workspaceId, existingCoord.pane.id, existingCoord.tab.id);
			ps().setFocusedPane(existingCoord.pane.id);
			get().openXroCanvas(orchestratorId, title);
			return { terminalTabId: existingCoord.tab.id, started: false };
		}

		// First open: coordinator terminal in the original (left) pane, then split
		// the canvas off into the new (right) pane.
		const left = resolveFocusedPane(workspaceId);
		const terminalTabId = nextTerminalId();
		const terminalTab: TabItem = {
			kind: "terminal",
			id: terminalTabId,
			workspaceId,
			title: "Coordinator",
			cwd: workDir,
			presetName: "xro-coordinator",
		};
		if (left) {
			ps().addTabToPane(workspaceId, left.id, terminalTab);
			const canvasTab: TabItem = {
				kind: "xro-canvas",
				id: `xro-canvas-${orchestratorId}`,
				workspaceId,
				orchestratorId,
				title,
			};
			ps().splitPane(workspaceId, left.id, "horizontal", canvasTab);
			ps().setFocusedPane(left.id);
		}
		return { terminalTabId, started: true };
	},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/tab-store-xro-workspace.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts apps/desktop/tests/tab-store-xro-workspace.test.ts
git commit -m "feat(xro): openXroWorkspace builds coordinator/overview split with reattach guard"
```

---

### Task 4: Simplify the Row, add active highlight, wire click→open+autostart

**Files:**
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx` (rewrite)

No new automated test — this is a presentational component verified by type-check + lint + manual run. Keep behavior described exactly.

- [ ] **Step 1: Rewrite the Row**

Replace the entire contents of `CrossRepoOrchestratorRow.tsx` with the following. Changes from current: removes `expanded`/`onToggle` props, the chevron, the count pill, and the Start pill; keeps the meatball + context menu; adds the active highlight; click now calls `openXroWorkspace` and runs the coordinator launch command for a first open.

```tsx
import { useEffect, useRef, useState } from "react";
import { useCrossRepoOrchestratorColor } from "../hooks/useCrossRepoOrchestratorColor";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface Props {
	orchestrator: { id: string; name: string };
	allOrchestratorIds: string[];
	onRename?: () => void;
	onDelete?: () => void;
}

export function CrossRepoOrchestratorRow({
	orchestrator,
	allOrchestratorIds,
	onRename,
	onDelete,
}: Props) {
	const openXroWorkspace = useTabStore((s) => s.openXroWorkspace);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const colorIndex = useCrossRepoOrchestratorColor(orchestrator.id, allOrchestratorIds);
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestrator.id });
	const detail = trpc.crossRepoOrchestrators.get.useQuery({ id: orchestrator.id });

	const utils = trpc.useUtils();
	// Fetch-on-demand: the launch command is only needed at click time.
	const getLaunch = trpc.crossRepoOrchestrators.getCoordinatorLaunch.useQuery(
		{ id: orchestrator.id },
		{ enabled: false }
	);
	const markStarted = trpc.crossRepoOrchestrators.markAgentStarted.useMutation();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	const swatchVar = `var(--orch-${colorIndex})`;
	const isActive = activeWorkspaceId === orchestrator.id;

	const memberRows = members.data ?? [];
	const working = memberRows.filter((m) => m.currentPhase === "working").length;
	const blocked = memberRows.filter((m) => m.currentPhase === "blocked").length;
	const memberCount = memberRows.length;

	async function open() {
		const workDir = detail.data?.workDir ?? "";
		const { terminalTabId, started } = openXroWorkspace(
			orchestrator.id,
			orchestrator.name,
			workDir
		);
		if (!started) return;
		// Auto-start the coordinator: run the launch command in the fresh terminal,
		// mirroring App.tsx agentDispatch.onOpen (wait for the pty to mount, then write).
		try {
			const res = await getLaunch.refetch();
			const cmd = res.data?.command;
			if (cmd) {
				attachTerminal.mutate({ workspaceId: orchestrator.id, terminalId: terminalTabId });
				setTimeout(() => {
					window.electron.terminal.write(terminalTabId, `${cmd}\n`);
				}, 300);
				markStarted.mutate(
					{ id: orchestrator.id },
					{ onSuccess: () => utils.crossRepoOrchestrators.list.invalidate() }
				);
			}
		} catch (err) {
			console.warn("[xro] coordinator start failed:", (err as Error).message);
		}
	}

	function openMeatball(e: React.MouseEvent<HTMLButtonElement>) {
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		setMenu({ x: rect.right, y: rect.bottom });
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: cannot use <button> — row contains a nested menu button
		<div
			role="button"
			tabIndex={0}
			onClick={open}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					open();
				}
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				setMenu({ x: e.clientX, y: e.clientY });
			}}
			className={[
				"group relative flex w-full cursor-pointer items-center gap-[9px] rounded-[8px] border py-[9px] pl-[10px] pr-[8px] text-left transition-colors duration-[120ms]",
				isActive
					? "border-[rgba(154,176,138,0.28)]"
					: "border-transparent hover:bg-[var(--bg-elevated)]",
			].join(" ")}
			style={isActive ? { background: `var(--orch-${colorIndex}-bg)` } : undefined}
		>
			{isActive && (
				<span
					className="absolute left-[-2px] top-[7px] bottom-[7px] w-[2.5px] rounded-[2px]"
					style={{ background: swatchVar }}
				/>
			)}
			<svg
				role="img"
				aria-label="Cross-repo orchestrator"
				width="16"
				height="16"
				viewBox="0 0 14 14"
				fill="none"
				className="shrink-0"
			>
				<title>Cross-repo orchestrator</title>
				<circle cx="3" cy="7" r="2" stroke={swatchVar} strokeWidth="1.2" />
				<circle cx="11" cy="7" r="2" stroke={swatchVar} strokeWidth="1.2" />
				<circle cx="7" cy="7" r="1.1" fill={swatchVar} />
				<path d="M5 7h.6M8.4 7H9" stroke={swatchVar} strokeWidth="1.1" />
			</svg>

			<span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
				{orchestrator.name}
			</span>

			<span className="flex shrink-0 items-center gap-[8px] text-[11px] text-[var(--text-tertiary)]">
				{working === 0 && blocked === 0 ? (
					<span>{memberCount === 0 ? "" : "idle"}</span>
				) : (
					<>
						{working > 0 && (
							<span className="inline-flex items-center gap-[5px]">
								<span className="h-[6px] w-[6px] rounded-full bg-[var(--st-working)]" />
								{working}
							</span>
						)}
						{blocked > 0 && (
							<span className="inline-flex items-center gap-[5px]">
								<span className="h-[6px] w-[6px] rounded-full bg-[var(--st-blocked)]" />
								{blocked}
							</span>
						)}
					</>
				)}
			</span>

			<button
				type="button"
				aria-label="Cross-repo orchestrator options"
				aria-haspopup="menu"
				aria-expanded={menu !== null}
				onClick={openMeatball}
				className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-[6px] border-none bg-transparent text-[var(--text-quaternary)] opacity-0 transition-opacity hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] group-hover:opacity-100"
			>
				<svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
					<circle cx="6" cy="2" r="1.1" />
					<circle cx="6" cy="6" r="1.1" />
					<circle cx="6" cy="10" r="1.1" />
				</svg>
			</button>

			{menu && (
				<ContextMenu
					position={menu}
					onClose={() => setMenu(null)}
					onRename={onRename}
					onDelete={onDelete}
				/>
			)}
		</div>
	);
}

function ContextMenu({
	position,
	onClose,
	onRename,
	onDelete,
}: {
	position: { x: number; y: number };
	onClose: () => void;
	onRename?: () => void;
	onDelete?: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function onClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		}
		document.addEventListener("mousedown", onClick);
		return () => document.removeEventListener("mousedown", onClick);
	}, [onClose]);

	if (!onRename && !onDelete) return null;

	return (
		<div
			ref={ref}
			className="fixed z-50 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: position.x, top: position.y }}
		>
			{onRename && (
				<button
					type="button"
					className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--bg-overlay)]"
					onClick={() => {
						onRename();
						onClose();
					}}
				>
					Rename
				</button>
			)}
			{onDelete && (
				<button
					type="button"
					className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--bg-overlay)]"
					onClick={() => {
						onDelete();
						onClose();
					}}
				>
					Delete
				</button>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Type-check + lint**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors. If `window.electron.terminal.write` is untyped, confirm the signature exists (preload `src/preload/index.ts:40` exposes `write: (id, data) => ...`).
Run: `bun run check`
Expected: clean (the `role="button"` div keeps its `biome-ignore`).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx
git commit -m "feat(xro): simplify sidebar row, add active highlight, click opens split + autostarts coordinator"
```

---

### Task 5: Drop the expandable body from the Group

**Files:**
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx`
- Delete: `apps/desktop/src/renderer/components/CrossRepoOrchestratorBody.tsx`

- [ ] **Step 1: Edit the Group**

Remove the `CrossRepoOrchestratorBody` import (line 3). Remove the `expanded` state (line 17) and `setExpanded`. In the create popover's `onCreated` (line 65), drop the expand call — change to `onCreated={() => utils.crossRepoOrchestrators.list.invalidate()}` (add `const utils = trpc.useUtils();` if not already present — it is, line 9). Replace the rows block (lines 102-123) with rows that no longer pass `expanded`/`onToggle` and no longer render the body:

```tsx
				) : (
					<div className="mt-1 px-1">
						{all.map((o) => (
							<CrossRepoOrchestratorRow
								key={o.id}
								orchestrator={o}
								allOrchestratorIds={allIds}
								onRename={() => {
									const name = window.prompt("Rename cross-repo orchestrator", o.name);
									if (name?.trim()) renameMut.mutate({ id: o.id, name: name.trim() });
								}}
								onDelete={() => {
									if (window.confirm(`Delete "${o.name}"?`)) deleteMut.mutate({ id: o.id });
								}}
							/>
						))}
					</div>
				)}
```

- [ ] **Step 2: Delete the body component**

```bash
git rm apps/desktop/src/renderer/components/CrossRepoOrchestratorBody.tsx
```

- [ ] **Step 3: Type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors. (Confirms nothing else imports `CrossRepoOrchestratorBody`.) If type-check reports the import still referenced anywhere, grep `CrossRepoOrchestratorBody` and remove remaining references.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorGroup.tsx
git commit -m "feat(xro): remove expandable sidebar body — all info lives in the overview"
```

---

### Task 6: Overview member navigation

**Files:**
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`

`AgentCardData` (in `orchestrator/AgentCard.tsx`) currently has no `worktreePath`. Add it there, then wire the canvas handlers. `RepoLane`'s `onOpen`/`onAnswer` already pass the member `workspaceId`; the canvas maps that id back to the member row to get the worktree path.

- [ ] **Step 1: Extend `AgentCardData`**

In `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`, add `worktreePath: string | null;` to the `AgentCardData` interface (after `needs`). No render change is required (the field is used by the canvas handler, not the card body).

- [ ] **Step 2: Wire the canvas handlers**

In `CrossRepoOrchestratorCanvas.tsx`, add the imports and a navigation helper, map `worktreePath` into the cards, and replace the empty `onAnswer`/`onOpen` handlers.

Add at the top with the other imports:

```tsx
import { useTabStore } from "../stores/tab-store";
```

Add the attach mutation and member lookup inside the component (after the existing queries):

```tsx
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const membersById = useMemo(
		() => new Map((members.data ?? []).map((m) => [m.workspaceId, m])),
		[members.data]
	);

	function openMember(workspaceId: string) {
		const m = membersById.get(workspaceId);
		if (!m?.worktreePath) return;
		const store = useTabStore.getState();
		store.setActiveWorkspace(m.workspaceId, m.worktreePath);
		const existing = store.getTabsByWorkspace(m.workspaceId);
		if (!existing.some((t) => t.kind === "terminal")) {
			const tabId = store.addTerminalTab(m.workspaceId, m.worktreePath, m.workspaceName);
			attachTerminal.mutate({ workspaceId: m.workspaceId, terminalId: tabId });
		}
	}
```

Add `worktreePath: m.worktreePath` to the `cardsByProject` push (in the `arr.push({...})` block):

```tsx
				arr.push({
					workspaceId: m.workspaceId,
					branch: m.workspaceName,
					phase: m.currentPhase,
					statusText: m.statusText,
					needs: m.needs,
					worktreePath: m.worktreePath,
				});
```

Replace the `RepoLane` handlers (currently `onAnswer={() => {}}` / `onOpen={() => {}}` / `onDispatchHere={() => {}}`):

```tsx
							onAnswer={(workspaceId) => openMember(workspaceId)}
							onOpen={(workspaceId) => openMember(workspaceId)}
							onDispatchHere={() => {}}
```

- [ ] **Step 3: Type-check + lint**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors (the new `worktreePath` field flows from the Task 1 query through to `AgentCardData`).
Run: `bun run check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx
git commit -m "feat(xro): overview member cards open the member workspace + terminal"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the new + adjacent test files**

Run:
```bash
cd apps/desktop
bun test tests/cross-repo-orchestrator-members-worktree.test.ts tests/cross-repo-coordinator-launch.test.ts tests/tab-store-xro-workspace.test.ts tests/orchestrator-membership.test.ts tests/cross-repo-orchestrator.test.ts
```
Expected: all PASS. (Pre-existing full-suite failures from port collisions / `ctx.kind` requirements are unrelated; run feature files in isolation.)

- [ ] **Step 2: Type-check + lint the whole app**

Run: `cd apps/desktop && bun run type-check && bun run check`
Expected: no errors, no new lint findings.

- [ ] **Step 3: Manual smoke (user-run)**

Start the app (`bun run dev` from repo root). Verify: sidebar rows are clean (icon + name + dot counts, meatball on hover, active highlight); clicking a row switches the main view and shows terminal-left / overview-right with the coordinator CLI running; clicking a member card in the overview switches to that member's workspace with its terminal; re-clicking the orchestrator row does not spawn a second coordinator.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(xro): split-workspace redesign verification fixups"
```

---

## Notes for the implementer

- **Bun store tests run without a DOM.** `tab-store`/`pane-store` are plain Zustand — the Task 3 test manipulates them directly. Do not pull in React Testing Library.
- **`window.electron.terminal.write`** is the preload bridge (`src/preload/index.ts:40`). The 300ms delay before writing mirrors the existing `agentDispatch.onOpen` handler in `App.tsx` — the pty needs a moment to attach.
- **Do not reintroduce the broadcaster path** for the coordinator. The whole point is deterministic pane placement, which the broadcaster (focused-pane insert) breaks.
- **`detail.data?.workDir`** may be briefly undefined on first render; `open()` reads it at click time, by which point the `get` query has resolved in practice. If a race is observed, gate the row's click affordance on `detail.data` being present.
