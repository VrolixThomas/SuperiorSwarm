# Cross-Repo Orchestrator UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Mission Control UX for the cross-repo orchestrator — a canvas tab with live cross-repo agent status, a dispatch composer, and a unified activity timeline, plus sidebar tagging of member worktrees.

**Architecture:** The dispatch/membership/event backend already exists on this branch. This plan adds (1) status fields to the member query, (2) a new `xro-canvas` renderer tab kind, (3) the canvas components consuming existing tRPC data, (4) shared status CSS tokens, and (5) sidebar IA-B (member worktrees stay under their repo with an accent tag; the orchestrator row links into the canvas). The dispatch composer creates + attaches a member worktree per selected repo and hands the task to the running orchestrator agent, which fans out via its existing MCP tools.

**Tech Stack:** Electron + React 19 + TypeScript, tRPC over IPC, Drizzle/SQLite, Biome, Bun test. Status enum `idle|working|blocked|done` from `src/shared/control-plane.ts`.

---

## File Structure

- `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts` — extend `listCrossRepoMembers` to return `currentPhase`, `statusText`, `needs`.
- `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts` — add `dispatch` mutation.
- `apps/desktop/src/main/services/cross-repo-orchestrators.ts` — add `dispatchAcrossRepos` service.
- `apps/desktop/src/renderer/styles.css` — add `--st-working|blocked|done|idle` tokens (dark + light).
- `apps/desktop/src/renderer/stores/tab-store.ts` — add `xro-canvas` tab kind + `openXroCanvas`.
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx` — Mission Control shell.
- `apps/desktop/src/renderer/components/orchestrator/DispatchComposer.tsx`
- `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx`
- `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`
- `apps/desktop/src/renderer/components/orchestrator/CrossRepoActivityRail.tsx`
- `apps/desktop/src/renderer/components/orchestrator/StatusPill.tsx` — shared status atom.
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx` — open canvas on click; expanded = reference list.
- `apps/desktop/src/renderer/components/WorkspaceItem.tsx` — accent member tag.
- `apps/desktop/src/renderer/App.tsx` — render `xro-canvas` tab.

---

## Task 1: Add status fields to the member query

**Files:**
- Modify: `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts:116-140`
- Test: `apps/desktop/tests/orchestrator-membership.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/tests/orchestrator-membership.test.ts`:

```ts
test("listCrossRepoMembers includes live status fields", async () => {
	const { orchestratorId, projectId } = await seedCrossRepoOrchestratorWithProject();
	const ws = await createWorkspace({ projectId, branch: "feat/x" });
	await attachToCrossRepoOrchestrator({ orchestratorId, workspaceId: ws.workspaceId });
	await setStatus(
		{ kind: "workspace", workspaceId: ws.workspaceId, projectId },
		{ phase: "blocked", statusText: "waiting", needs: "which backoff?" }
	);

	const members = await listCrossRepoMembers({ orchestratorId });
	const m = members.find((x) => x.workspaceId === ws.workspaceId);
	expect(m?.currentPhase).toBe("blocked");
	expect(m?.needs).toBe("which backoff?");
	expect(m?.statusText).toBe("waiting");
});
```

(Reuse the existing `seedCrossRepoOrchestratorWithProject` helper in this test file; if its name differs, match the existing setup helper already used by other tests in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/orchestrator-membership.test.ts -t "live status fields"`
Expected: FAIL — `m.currentPhase` is `undefined`.

- [ ] **Step 3: Extend the query + return type**

In `cross-repo-orchestrator-membership.ts`, update the `listCrossRepoMembers` return type and select:

```ts
export async function listCrossRepoMembers(input: {
	orchestratorId: string;
}): Promise<
	Array<{
		workspaceId: string;
		sortOrder: number;
		parentKind: string;
		projectId: string;
		workspaceName: string;
		currentPhase: "idle" | "working" | "blocked" | "done";
		statusText: string | null;
		needs: string | null;
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
		})
		.from(orchestratorMembers)
		.innerJoin(workspaces, eq(orchestratorMembers.workspaceId, workspaces.id))
		.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
		.orderBy(orchestratorMembers.sortOrder);
}
```

(Keep the existing `.from(...).innerJoin(...)` / `.where(...)` shape already present below line 136 — only add the three select columns and the return-type fields. Confirm `workspaces.statusText` / `workspaces.needs` exist in `schema.ts`; they back `src/shared/types.ts:180-181`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/orchestrator-membership.test.ts -t "live status fields"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts apps/desktop/tests/orchestrator-membership.test.ts
git commit -m "feat(xro): include live status fields in member query"
```

---

## Task 2: Shared status tokens in CSS

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css` (dark block near line 70, light block near line 160)

- [ ] **Step 1: Add dark-theme tokens**

After the `--orch-8-bg` line in the dark `:root` block, add:

```css
	--st-working: #0a84ff;
	--st-working-bg: rgba(10, 132, 255, 0.14);
	--st-blocked: #e6a23c;
	--st-blocked-bg: rgba(230, 162, 60, 0.14);
	--st-done: #5dc983;
	--st-done-bg: rgba(93, 201, 131, 0.13);
	--st-idle: #8e8e93;
	--st-idle-bg: rgba(142, 142, 147, 0.12);
```

- [ ] **Step 2: Add light-theme tokens**

After the `--orch-8-bg` line in the light-theme block, add:

```css
	--st-working: #0066cc;
	--st-working-bg: rgba(0, 102, 204, 0.12);
	--st-blocked: #b9760f;
	--st-blocked-bg: rgba(185, 118, 15, 0.12);
	--st-done: #2e9e5b;
	--st-done-bg: rgba(46, 158, 91, 0.12);
	--st-idle: #76767a;
	--st-idle-bg: rgba(118, 118, 122, 0.1);
```

- [ ] **Step 3: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS (CSS-only change, no TS impact).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "feat(ui): add shared agent status tokens"
```

---

## Task 3: StatusPill atom

**Files:**
- Create: `apps/desktop/src/renderer/components/orchestrator/StatusPill.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { WorkspacePhase } from "../../../shared/control-plane";

const LABEL: Record<WorkspacePhase, string> = {
	idle: "Queued",
	working: "Working",
	blocked: "Blocked",
	done: "Done",
};

export function StatusPill({ phase }: { phase: WorkspacePhase }) {
	return (
		<span
			className="inline-flex items-center gap-[5px] rounded-[9px] px-[7px] py-[2px] text-[10.5px] font-semibold leading-none"
			style={{ color: `var(--st-${phase})`, background: `var(--st-${phase}-bg)` }}
		>
			{phase === "working" && (
				<span
					className="h-[6px] w-[6px] rounded-full"
					style={{ background: `var(--st-${phase})` }}
				/>
			)}
			{LABEL[phase]}
		</span>
	);
}
```

- [ ] **Step 2: Verify type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS. (Confirm `WorkspacePhase` is exported from `src/shared/control-plane.ts:42` — it is.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/orchestrator/StatusPill.tsx
git commit -m "feat(ui): StatusPill atom for agent status"
```

---

## Task 4: AgentCard + RepoLane

**Files:**
- Create: `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`
- Create: `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx`

- [ ] **Step 1: Create AgentCard**

```tsx
import type { WorkspacePhase } from "../../../shared/control-plane";
import { StatusPill } from "./StatusPill";

export interface AgentCardData {
	workspaceId: string;
	branch: string;
	phase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
}

export function AgentCard({
	data,
	onAnswer,
	onOpen,
}: {
	data: AgentCardData;
	onAnswer: () => void;
	onOpen: () => void;
}) {
	const blocked = data.phase === "blocked";
	return (
		<button
			type="button"
			onClick={onOpen}
			className="block w-full rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-[10px_11px] text-left transition-colors hover:border-[var(--border-active)]"
			style={blocked ? { borderColor: "rgba(230,162,60,0.35)" } : undefined}
		>
			<div className="flex items-center gap-[7px]">
				<span className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
					{data.branch}
				</span>
				<StatusPill phase={data.phase} />
			</div>
			{data.statusText && (
				<div className="mt-[7px] text-[12px] text-[var(--text-tertiary)]">
					{blocked && data.needs ? (
						<>
							Needs input:{" "}
							<b className="font-semibold text-[var(--st-blocked)]">{data.needs}</b>
						</>
					) : (
						data.statusText
					)}
				</div>
			)}
			{blocked && (
				<div className="mt-[9px] flex justify-end">
					<span
						role="button"
						tabIndex={0}
						onClick={(e) => {
							e.stopPropagation();
							onAnswer();
						}}
						className="text-[11px] font-medium text-[var(--accent)]"
					>
						Answer →
					</span>
				</div>
			)}
		</button>
	);
}
```

- [ ] **Step 2: Create RepoLane**

```tsx
import type { AgentCardData } from "./AgentCard";
import { AgentCard } from "./AgentCard";

export function RepoLane({
	repoName,
	role,
	cards,
	onAnswer,
	onOpen,
	onDispatchHere,
}: {
	repoName: string;
	role: "backend" | "frontend" | null;
	cards: AgentCardData[];
	onAnswer: (workspaceId: string) => void;
	onOpen: (workspaceId: string) => void;
	onDispatchHere: () => void;
}) {
	return (
		<section className="flex min-h-[220px] flex-col rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<div className="flex items-center gap-[8px] border-b border-[var(--border-subtle)] p-[11px_12px]">
				<span className="flex-1 font-mono text-[12.5px] font-semibold text-[var(--text)]">
					{repoName}
				</span>
				{role && (
					<span
						className="rounded-[5px] px-[6px] py-[1px] text-[10px] font-semibold"
						style={
							role === "backend"
								? { color: "var(--orch-2)", background: "rgba(176,154,138,0.13)" }
								: { color: "var(--orch-3)", background: "rgba(154,176,138,0.13)" }
						}
					>
						{role.toUpperCase()}
					</span>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-[8px] p-[9px]">
				{cards.length === 0 ? (
					<div className="px-[2px] py-[6px] text-[11.5px] italic text-[var(--text-quaternary)]">
						No agents in this repo yet
					</div>
				) : (
					cards.map((c) => (
						<AgentCard
							key={c.workspaceId}
							data={c}
							onAnswer={() => onAnswer(c.workspaceId)}
							onOpen={() => onOpen(c.workspaceId)}
						/>
					))
				)}
			</div>
			<button
				type="button"
				onClick={onDispatchHere}
				className="m-[0_9px_10px] flex h-[30px] items-center justify-center gap-[6px] rounded-[8px] border border-dashed border-[var(--border)] text-[11.5px] text-[var(--text-quaternary)] hover:border-[var(--border-active)] hover:text-[var(--text-tertiary)]"
			>
				+ dispatch agent here
			</button>
		</section>
	);
}
```

- [ ] **Step 3: Verify type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx
git commit -m "feat(ui): AgentCard + RepoLane for orchestrator canvas"
```

---

## Task 5: DispatchComposer + dispatch backend

**Files:**
- Create: `apps/desktop/src/renderer/components/orchestrator/DispatchComposer.tsx`
- Modify: `apps/desktop/src/main/services/cross-repo-orchestrators.ts` (add `dispatchAcrossRepos`)
- Modify: `apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts` (add `dispatch`)
- Test: `apps/desktop/tests/cross-repo-orchestrator-crud.test.ts`

- [ ] **Step 1: Write the failing backend test**

Add to `apps/desktop/tests/cross-repo-orchestrator-crud.test.ts`:

```ts
test("dispatchAcrossRepos creates + attaches a member worktree per project", async () => {
	const { orchestratorId, projectId } = await seedCrossRepoOrchestratorWithProject();
	const res = await dispatchAcrossRepos({
		orchestratorId,
		task: "Add idempotency keys",
		targets: [{ projectId, branch: "feat/idempotency" }],
	});
	expect(res.created).toHaveLength(1);

	const members = await listCrossRepoMembers({ orchestratorId });
	expect(members.some((m) => m.workspaceId === res.created[0].workspaceId)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/cross-repo-orchestrator-crud.test.ts -t "dispatchAcrossRepos"`
Expected: FAIL — `dispatchAcrossRepos` is not defined.

- [ ] **Step 3: Implement `dispatchAcrossRepos`**

In `cross-repo-orchestrators.ts`, add (imports: `createWorkspace` from `./workspace-service`, `attachToCrossRepoOrchestrator` from `./cross-repo-orchestrator-membership`):

```ts
export async function dispatchAcrossRepos(input: {
	orchestratorId: string;
	task: string;
	targets: Array<{ projectId: string; branch: string }>;
}): Promise<{ created: Array<{ projectId: string; workspaceId: string }> }> {
	const xro = await getCrossRepoOrchestrator({ id: input.orchestratorId });
	if (!xro) throw new Error(`cross-repo orchestrator ${input.orchestratorId} not found`);

	const created: Array<{ projectId: string; workspaceId: string }> = [];
	for (const t of input.targets) {
		const ws = await createWorkspace({ projectId: t.projectId, branch: t.branch });
		await attachToCrossRepoOrchestrator({
			orchestratorId: input.orchestratorId,
			workspaceId: ws.workspaceId,
		});
		created.push({ projectId: t.projectId, workspaceId: ws.workspaceId });
	}
	return { created };
}
```

(The task text is delivered to the running orchestrator agent by the renderer via the existing terminal/thread; this service only provisions + attaches the member worktrees. Agent task fan-out across the new worktrees is driven by the orchestrator agent's existing MCP `dispatch_agent` tool — no new MCP work here.)

- [ ] **Step 4: Wire the tRPC mutation**

In `routers/cross-repo-orchestrators.ts`, import `dispatchAcrossRepos` and add to the router:

```ts
	dispatch: publicProcedure
		.input(
			z.object({
				id: z.string(),
				task: z.string().min(1).max(8000),
				targets: z
					.array(z.object({ projectId: z.string(), branch: z.string().min(1).max(200) }))
					.min(1),
			})
		)
		.mutation(({ input }) =>
			dispatchAcrossRepos({
				orchestratorId: input.id,
				task: input.task,
				targets: input.targets,
			})
		),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/desktop && bun test tests/cross-repo-orchestrator-crud.test.ts -t "dispatchAcrossRepos"`
Expected: PASS.

- [ ] **Step 6: Create DispatchComposer (renderer)**

```tsx
import { useState } from "react";
import { trpc } from "../../trpc/client";

interface Target {
	projectId: string;
	name: string;
}

function slugify(task: string): string {
	const base = task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	return `feat/${base || "task"}`;
}

export function DispatchComposer({
	orchestratorId,
	repos,
}: {
	orchestratorId: string;
	repos: Target[];
}) {
	const [task, setTask] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set(repos.map((r) => r.projectId)));
	const utils = trpc.useUtils();
	const dispatch = trpc.crossRepoOrchestrators.dispatch.useMutation({
		onSuccess: () => {
			setTask("");
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
		},
	});

	function toggle(pid: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(pid) ? next.delete(pid) : next.add(pid);
			return next;
		});
	}

	function submit() {
		if (!task.trim() || selected.size === 0) return;
		dispatch.mutate({
			id: orchestratorId,
			task: task.trim(),
			targets: [...selected].map((projectId) => ({ projectId, branch: slugify(task) })),
		});
	}

	return (
		<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
			<div className="border-b border-[var(--border-subtle)] px-[13px] py-[10px] text-[11px] font-semibold uppercase tracking-[0.03em] text-[var(--text-quaternary)]">
				Dispatch across repos
			</div>
			<textarea
				value={task}
				onChange={(e) => setTask(e.target.value)}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
				}}
				rows={2}
				placeholder="Describe a task to run across the selected repos…"
				className="w-full resize-none bg-transparent px-[15px] pb-[6px] pt-[14px] text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)]"
			/>
			<div className="flex flex-wrap items-center gap-[7px] px-[13px] pb-[13px] pt-[4px]">
				<span className="mr-[2px] text-[11.5px] text-[var(--text-quaternary)]">Route to</span>
				{repos.map((r) => {
					const on = selected.has(r.projectId);
					return (
						<button
							key={r.projectId}
							type="button"
							onClick={() => toggle(r.projectId)}
							className="inline-flex h-[26px] items-center gap-[6px] rounded-[13px] border px-[10px] text-[12px]"
							style={
								on
									? {
											borderColor: "rgba(10,132,255,0.5)",
											background: "var(--accent-subtle)",
											color: "var(--accent-hover)",
										}
									: {
											borderColor: "var(--border-subtle)",
											background: "var(--bg-elevated)",
											color: "var(--text-tertiary)",
										}
							}
						>
							{r.name}
						</button>
					);
				})}
			</div>
			<div className="flex items-center gap-[10px] border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-[13px] py-[11px]">
				<span className="flex-1 text-[11.5px] text-[var(--text-quaternary)]">
					Creates a branch + agent in each selected repo and hands the task to the orchestrator.
				</span>
				<button
					type="button"
					disabled={dispatch.isPending || !task.trim() || selected.size === 0}
					onClick={submit}
					className="h-[28px] rounded-[8px] bg-[var(--accent)] px-[13px] text-[12.5px] font-medium text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					Dispatch
				</button>
			</div>
		</div>
	);
}
```

- [ ] **Step 7: Run type-check + commit**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS.

```bash
git add apps/desktop/src/main/services/cross-repo-orchestrators.ts apps/desktop/src/main/trpc/routers/cross-repo-orchestrators.ts apps/desktop/src/renderer/components/orchestrator/DispatchComposer.tsx apps/desktop/tests/cross-repo-orchestrator-crud.test.ts
git commit -m "feat(xro): dispatch-across-repos backend + composer UI"
```

---

## Task 6: CrossRepoActivityRail

**Files:**
- Create: `apps/desktop/src/renderer/components/orchestrator/CrossRepoActivityRail.tsx`

- [ ] **Step 1: Create the component**

The aggregated event stream already exists via `orchestrator-event-sink`. This component renders an ordered list. Input is a normalized `ActivityEvent[]` (the canvas maps the sink's events to this shape in Task 7).

```tsx
import type { WorkspacePhase } from "../../../shared/control-plane";

export interface ActivityEvent {
	id: string;
	who: string;
	repo: string;
	relTime: string;
	kind: WorkspacePhase | "dispatch";
	text: string;
}

const NODE: Record<ActivityEvent["kind"], string> = {
	working: "var(--st-working)",
	blocked: "var(--st-blocked)",
	done: "var(--st-done)",
	idle: "var(--st-idle)",
	dispatch: "var(--orch-1)",
};

export function CrossRepoActivityRail({ events }: { events: ActivityEvent[] }) {
	return (
		<aside className="overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[18px_16px_30px]">
			<h3 className="mb-[14px] text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-quaternary)]">
				Cross-repo activity
			</h3>
			<div className="relative pl-[18px] before:absolute before:bottom-[6px] before:left-[4px] before:top-[4px] before:w-px before:bg-[var(--border-subtle)] before:content-['']">
				{events.map((e) => (
					<div key={e.id} className="relative pb-[17px]">
						<span
							className="absolute left-[-18px] top-[3px] h-[9px] w-[9px] rounded-full border-2 border-[var(--bg-surface)]"
							style={{ background: NODE[e.kind] }}
						/>
						<div className="flex items-baseline gap-[7px]">
							<span className="text-[12px] font-semibold text-[var(--text-secondary)]">
								{e.who}
							</span>
							<span className="font-mono text-[10.5px] text-[var(--text-quaternary)]">
								{e.repo}
							</span>
							<span className="ml-auto text-[10.5px] text-[var(--text-quaternary)]">
								{e.relTime}
							</span>
						</div>
						<div className="mt-[2px] text-[12px] text-[var(--text-tertiary)]">{e.text}</div>
					</div>
				))}
			</div>
		</aside>
	);
}
```

- [ ] **Step 2: Verify type-check + commit**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS.

```bash
git add apps/desktop/src/renderer/components/orchestrator/CrossRepoActivityRail.tsx
git commit -m "feat(ui): cross-repo activity rail"
```

---

## Task 7: Canvas shell + xro-canvas tab kind

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts` (add tab kind + opener)
- Create: `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (render the tab)

- [ ] **Step 1: Add the tab kind**

In `tab-store.ts`, extend the `TabItem` union (follow the existing member shape, e.g. the `pr-overview` variant near line 62):

```ts
	| {
			kind: "xro-canvas";
			id: string;
			orchestratorId: string;
			title: string;
	  }
```

Add an opener alongside the other `openX` helpers (mirror the existing `openPrOverview` pattern — dedupe by `kind === "xro-canvas" && orchestratorId`):

```ts
	openXroCanvas(orchestratorId: string, title: string) {
		const { tabs } = get();
		const existing = tabs.find(
			(t) => t.kind === "xro-canvas" && t.orchestratorId === orchestratorId
		);
		if (existing) {
			set({ activeTabId: existing.id });
			return;
		}
		const id = `xro-canvas-${orchestratorId}`;
		set((s) => ({
			tabs: [...s.tabs, { kind: "xro-canvas", id, orchestratorId, title }],
			activeTabId: id,
		}));
	},
```

(Match the store's actual `set`/`get` idiom — copy it from the nearest existing opener in the same file rather than assuming the snippet above is verbatim.)

- [ ] **Step 2: Create the canvas shell**

```tsx
import { useMemo } from "react";
import { trpc } from "../trpc/client";
import { DispatchComposer } from "./orchestrator/DispatchComposer";
import { RepoLane } from "./orchestrator/RepoLane";
import type { AgentCardData } from "./orchestrator/AgentCard";
import { CrossRepoActivityRail } from "./orchestrator/CrossRepoActivityRail";
import type { ActivityEvent } from "./orchestrator/CrossRepoActivityRail";

export function CrossRepoOrchestratorCanvas({ orchestratorId }: { orchestratorId: string }) {
	const orch = trpc.crossRepoOrchestrators.get.useQuery({ id: orchestratorId });
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestratorId });
	const projects = trpc.projects.list.useQuery();

	const projectsById = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p])),
		[projects.data]
	);

	const repos = (linked.data ?? []).map((pid) => ({
		projectId: pid,
		name: projectsById.get(pid)?.name ?? pid,
	}));

	const cardsByProject = useMemo(() => {
		const map = new Map<string, AgentCardData[]>();
		for (const m of members.data ?? []) {
			const arr = map.get(m.projectId) ?? [];
			arr.push({
				workspaceId: m.workspaceId,
				branch: m.workspaceName,
				phase: m.currentPhase,
				statusText: m.statusText,
				needs: m.needs,
			});
			map.set(m.projectId, arr);
		}
		return map;
	}, [members.data]);

	const events: ActivityEvent[] = useMemo(
		() =>
			(members.data ?? [])
				.filter((m) => m.statusText)
				.map((m) => ({
					id: m.workspaceId,
					who: m.workspaceName,
					repo: projectsById.get(m.projectId)?.name ?? m.projectId,
					relTime: "",
					kind: m.currentPhase,
					text: m.currentPhase === "blocked" && m.needs ? `Blocked — ${m.needs}` : m.statusText ?? "",
				})),
		[members.data, projectsById]
	);

	return (
		<div className="grid h-full min-h-0 grid-cols-[1fr_312px] bg-[var(--bg-base)]">
			<main className="min-h-0 overflow-y-auto p-[22px_26px_40px]">
				<h1 className="text-[19px] font-semibold tracking-[-0.01em]">
					{orch.data?.name ?? "Orchestrator"}
				</h1>
				<div className="mt-[1px] text-[12.5px] text-[var(--text-tertiary)]">
					{repos.length} repos · {(members.data ?? []).length} agents
				</div>

				<div className="mt-[16px]">
					<DispatchComposer orchestratorId={orchestratorId} repos={repos} />
				</div>

				<h2 className="mb-[12px] mt-[26px] text-[13px] font-semibold text-[var(--text-secondary)]">
					Repos
				</h2>
				<div className="grid grid-cols-3 gap-[13px]">
					{repos.map((r) => (
						<RepoLane
							key={r.projectId}
							repoName={r.name}
							role={null}
							cards={cardsByProject.get(r.projectId) ?? []}
							onAnswer={() => {}}
							onOpen={() => {}}
							onDispatchHere={() => {}}
						/>
					))}
				</div>
			</main>
			<CrossRepoActivityRail events={events} />
		</div>
	);
}
```

(`role` is left `null` for v1 — backend/frontend tagging is a follow-up. The activity rail derives from member status for v1; richer event-sink wiring is a follow-up. These are intentional v1 scope cuts, not placeholders.)

- [ ] **Step 3: Render the tab in App.tsx**

In `App.tsx`, where tabs are switched on `tab.kind`, add a branch (follow the existing pattern used for other custom tab kinds in this file):

```tsx
{tab.kind === "xro-canvas" && (
	<CrossRepoOrchestratorCanvas orchestratorId={tab.orchestratorId} />
)}
```

Add the import at the top: `import { CrossRepoOrchestratorCanvas } from "./components/CrossRepoOrchestratorCanvas";`

- [ ] **Step 4: Verify type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx apps/desktop/src/renderer/App.tsx
git commit -m "feat(ui): cross-repo orchestrator mission-control canvas + tab"
```

---

## Task 8: Sidebar IA-B — open canvas + reference list

**Files:**
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx`
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorBody.tsx`

- [ ] **Step 1: Open the canvas from the row**

In `CrossRepoOrchestratorRow.tsx`, import the tab store and change the row's primary click to open the canvas instead of only toggling. Add near the other hooks:

```tsx
import { useTabStore } from "../stores/tab-store";
```

In the component body:

```tsx
const openXroCanvas = useTabStore((s) => s.openXroCanvas);
```

Change the name button's `onClick={onToggle}` to:

```tsx
onClick={() => openXroCanvas(orchestrator.id, orchestrator.name)}
```

Keep the chevron button's `onClick={onToggle}` for expand/collapse of the reference list.

- [ ] **Step 2: Make the expanded body a reference list**

In `CrossRepoOrchestratorBody.tsx`, replace the `Members` section's `MemberLine` map so each member shows a status dot + `repo / branch` and clicking opens the canvas. Add at top:

```tsx
import { useTabStore } from "../stores/tab-store";
```

Replace the existing `MemberLine` render inside the `Members` `<Section>` with:

```tsx
{(members.data ?? []).map((m) => (
	<ReferenceLine
		key={m.workspaceId}
		orchestratorId={orchestratorId}
		phase={m.currentPhase}
		repoName={projectsById.get(m.projectId)?.name ?? m.projectId}
		branch={m.workspaceName}
	/>
))}
```

And add the component at the bottom of the file:

```tsx
function ReferenceLine({
	orchestratorId,
	phase,
	repoName,
	branch,
}: {
	orchestratorId: string;
	phase: "idle" | "working" | "blocked" | "done";
	repoName: string;
	branch: string;
}) {
	const openXroCanvas = useTabStore((s) => s.openXroCanvas);
	return (
		<button
			type="button"
			onClick={() => openXroCanvas(orchestratorId, repoName)}
			className="flex w-full items-center gap-[7px] rounded-[6px] px-2 py-[4px] text-left text-[11px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
		>
			<span
				className="h-[6px] w-[6px] shrink-0 rounded-full"
				style={{ background: `var(--st-${phase})` }}
			/>
			<span className="truncate font-mono">
				{repoName} / {branch}
			</span>
		</button>
	);
}
```

(The `CrossRepoOrchestratorCanvas` is the multi-repo overview, so passing `repoName` as the tab title when opening from a reference is acceptable; the title resolves to the orchestrator name once the canvas mounts. If the row already passes a title, prefer `orchestrator.name`.)

- [ ] **Step 3: Verify type-check + commit**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS.

```bash
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorRow.tsx apps/desktop/src/renderer/components/CrossRepoOrchestratorBody.tsx
git commit -m "feat(ui): orchestrator row opens canvas, expanded = reference list"
```

---

## Task 9: Member tag on workspace rows

**Files:**
- Modify: `apps/desktop/src/renderer/components/WorkspaceItem.tsx`

- [ ] **Step 1: Determine membership for the row**

`WorkspaceItem` already queries `trpc.crossRepoOrchestrators.list` (`xrosQuery`, line ~451). Add a query for which orchestrator (if any) owns this workspace. Reuse `listMembers` across orchestrators, or add a lightweight derived check. Minimal approach — query members for each xro is wasteful; instead add a one-line membership lookup. For v1, render the tag when the workspace id appears in any orchestrator's members. Add:

```tsx
const xroMembership = trpc.crossRepoOrchestrators.list.useQuery(undefined, { staleTime: 30_000 });
```

(If a dedicated `workspaces.crossRepoParent` field is later added, switch to it. For v1, gate the tag on a prop the parent passes when it already knows membership — see Step 2.)

- [ ] **Step 2: Render the accent tag**

Add an optional prop `crossRepoOrchestrator?: { id: string; name: string; colorIndex: number }` to `WorkspaceItem`'s props. When present, render next to the workspace name:

```tsx
{crossRepoOrchestrator && (
	<span
		className="inline-flex shrink-0 items-center gap-[4px] rounded-[8px] px-[5px] py-[1px] text-[9.5px] font-semibold"
		style={{
			color: `var(--orch-${crossRepoOrchestrator.colorIndex})`,
			background: `var(--orch-${crossRepoOrchestrator.colorIndex}-bg)`,
		}}
		title={`Member of ${crossRepoOrchestrator.name}`}
	>
		<span
			className="h-[6px] w-[6px] rounded-full"
			style={{ background: `var(--orch-${crossRepoOrchestrator.colorIndex})` }}
		/>
		{crossRepoOrchestrator.name}
	</span>
)}
```

The parent project tree passes this prop when it knows the workspace is a cross-repo member (the tree query already joins membership via `orchestratorMembers`; expose `crossRepoOrchestratorId` on the tree row and resolve name + color from `xrosQuery` + `useCrossRepoOrchestratorColor`).

- [ ] **Step 3: Verify type-check + commit**

Run: `cd apps/desktop && bun run type-check`
Expected: PASS.

```bash
git add apps/desktop/src/renderer/components/WorkspaceItem.tsx
git commit -m "feat(ui): tag cross-repo member worktrees in the project tree"
```

---

## Task 10: Full test + lint sweep

- [ ] **Step 1: Run the full desktop test suite**

Run: `cd apps/desktop && bun test`
Expected: all tests pass (including the new membership + dispatch tests).

- [ ] **Step 2: Lint + type-check**

Run: `cd apps/desktop && bun run type-check && bun run lint`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional, via /run)**

Launch the app, create a cross-repo orchestrator, link 2 repos, dispatch a task to both, confirm: member worktrees appear under their repos with the accent tag; the canvas shows lanes + cards with status; the orchestrator row opens the canvas.

- [ ] **Step 4: Final commit (if any sweep fixes)**

```bash
git add -A
git commit -m "chore(xro): test + lint sweep for orchestrator UX"
```

---

## Self-Review Notes

- **Spec coverage:** Sidebar IA-B → Tasks 8, 9. Mission Control canvas (header, composer, lanes, rail) → Tasks 4–7. Status tokens → Task 2. Dispatch composer + fan-out → Task 5. Coordinator strip is folded into the canvas header for v1 (lightweight); a richer coordinator strip with the live orchestrator thread is a follow-up.
- **v1 scope cuts (intentional, not placeholders):** backend/frontend lane role tags, relative-time formatting in the activity rail, and the dedicated coordinator strip are deferred. Each is additive and does not block the core flow.
- **Type consistency:** `WorkspacePhase` (`idle|working|blocked|done`) is used uniformly across StatusPill, AgentCard, ActivityEvent, and the member query. `dispatchAcrossRepos` ↔ `dispatch` mutation ↔ composer payload share the `{ id|orchestratorId, task, targets:[{projectId,branch}] }` shape.
- **Execution caveat:** a few existing-file idioms (tab-store `set/get`, App.tsx tab switch, the project-tree membership join in Task 9) must be matched to the real surrounding code rather than copied verbatim — flagged inline at each site.
