# Cross-repo Orchestrator Overview Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un-cramp the cross-repo orchestrator overview — single-column layout, repos stacked as full-width sections with wrapping agent cards and clamped status, plus add/unlink-repo controls — by removing the activity rail and reworking the overview subcomponents.

**Architecture:** All changes live in the overview (`CrossRepoOrchestratorCanvas`) and its subcomponents (`RepoLane` repurposed as a full-width repo section, `AgentCard` status clamped, a new `AddRepoButton`). The `CrossRepoActivityRail` is deleted. No backend, tRPC, or schema changes — `linkProject` / `unlinkProject` / `listLinkedProjects` / `projects.list` already exist. These are presentational React changes; verification is renderer type-check + Biome + manual smoke (the project's `bun run type-check` does NOT cover the renderer — use `npx tsc --project tsconfig.renderer.json --noEmit`).

**Tech Stack:** React 19 + TypeScript, tRPC (React Query), Zustand, Biome (tabs, double quotes, semicolons, width 100), strict TS.

---

## File map

- `apps/desktop/src/renderer/components/orchestrator/CrossRepoActivityRail.tsx` — DELETE (Task 1).
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx` — single column, drop rail, add repo controls (Tasks 1, 4).
- `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx` — clamp status to 2 lines (Task 2).
- `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx` — full-width repo section, wrapping cards, unlink, no `onDispatchHere` (Task 3).
- `apps/desktop/src/renderer/components/orchestrator/AddRepoButton.tsx` — CREATE, link an unlinked project (Task 4).

Verification commands (from `apps/desktop/`):
- Renderer type-check (touched files): `npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "CrossRepoOrchestratorCanvas|orchestrator/AgentCard|orchestrator/RepoLane|orchestrator/AddRepoButton|orchestrator/CrossRepoActivityRail" || echo "NO ERRORS IN TOUCHED FILES"`
- Biome: `npx biome check <files>`

There is no Bun store/DOM test harness for these presentational components in this repo (the prior redesign verified its renderer components via type-check + lint + manual smoke). Follow that same discipline: no new automated test files; each task is gated on type-check + Biome + the described manual check.

---

### Task 1: Remove the activity rail; make the canvas a single column

**Files:**
- Delete: `apps/desktop/src/renderer/components/orchestrator/CrossRepoActivityRail.tsx`
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`

- [ ] **Step 1: Delete the activity rail component**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/cross-repo-orchestrator
git rm apps/desktop/src/renderer/components/orchestrator/CrossRepoActivityRail.tsx
```

- [ ] **Step 2: Edit the canvas — remove rail imports + events, switch to single column**

In `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`:

Remove these two imports (lines 5-6):
```tsx
import type { ActivityEvent } from "./orchestrator/CrossRepoActivityRail";
import { CrossRepoActivityRail } from "./orchestrator/CrossRepoActivityRail";
```

Remove the entire `events` useMemo block (lines 60-74, the `const events: ActivityEvent[] = useMemo(...)`).

Replace the `return (...)` JSX (lines 76-110) with this single-column version (the `grid grid-cols-3` for repos and the trailing `<CrossRepoActivityRail .../>` are gone; the repo stack and add-repo control come in Tasks 3-4 — for THIS task keep `RepoLane` but stack it in a vertical flage so the file stays compilable):

```tsx
	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--bg-base)]">
			<div className="mx-auto w-full max-w-[820px] p-[22px_26px_40px]">
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
				<div className="flex flex-col gap-[12px]">
					{repos.map((r) => (
						// biome-ignore lint/a11y/useValidAriaRole: `role` is a domain prop (backend/frontend), not an ARIA role
						<RepoLane
							key={r.projectId}
							repoName={r.name}
							role={null}
							cards={cardsByProject.get(r.projectId) ?? []}
							onAnswer={(workspaceId) => openMember(workspaceId)}
							onOpen={(workspaceId) => openMember(workspaceId)}
							onDispatchHere={() => {}}
						/>
					))}
				</div>
			</div>
		</div>
	);
```

NOTE: `RepoLane` still has its `onDispatchHere` prop at this point (removed in Task 3). Keep passing `onDispatchHere={() => {}}` here so the file compiles; Task 4 replaces this whole `RepoLane` call to add `onUnlink` and drop `onDispatchHere`.

- [ ] **Step 3: Renderer type-check + Biome**

Run (from `apps/desktop/`):
```bash
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "CrossRepoOrchestratorCanvas|CrossRepoActivityRail" || echo "NO ERRORS"
npx biome check src/renderer/components/CrossRepoOrchestratorCanvas.tsx
```
Expected: "NO ERRORS" (the rail is gone and nothing else imports it — confirm with `grep -rn "CrossRepoActivityRail" src` returning nothing). Biome clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx
git commit -m "feat(xro): single-column overview, remove redundant activity rail"
```
(The `git rm` of the rail is already staged. No --no-verify. No Co-Authored-By trailers.)

---

### Task 2: Clamp the agent-card status to 2 lines

**Files:**
- Modify: `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`

- [ ] **Step 1: Clamp the status block + add a full-text tooltip**

Replace the status block (lines 36-46) with a 2-line-clamped version that also carries the full text as a `title` tooltip. The clamp uses the webkit line-clamp utilities (the codebase uses arbitrary Tailwind classes):

```tsx
			{data.statusText && (
				<div
					title={blocked && data.needs ? `Needs input: ${data.needs}` : data.statusText}
					className="mt-[7px] overflow-hidden text-[12px] text-[var(--text-tertiary)] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
				>
					{blocked && data.needs ? (
						<>
							Needs input: <b className="font-semibold text-[var(--st-blocked)]">{data.needs}</b>
						</>
					) : (
						data.statusText
					)}
				</div>
			)}
```

Leave everything else (the branch row, StatusPill, the blocked "Answer →" affordance, the click-to-open button) unchanged.

- [ ] **Step 2: Renderer type-check + Biome**

```bash
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep "orchestrator/AgentCard" || echo "NO ERRORS"
npx biome check src/renderer/components/orchestrator/AgentCard.tsx
```
Expected: "NO ERRORS"; Biome clean. (If Biome reorders the arbitrary classes, accept its formatting.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx
git commit -m "feat(xro): clamp agent-card status to 2 lines with full-text tooltip"
```

---

### Task 3: Repurpose `RepoLane` as a full-width repo section with wrapping cards + unlink

**Files:**
- Modify: `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx`

The new section is full-width: a header row (repo name + agent count + hover unlink `×`) and a `flex-wrap` row of fixed-width agent cards. The `onDispatchHere` prop and the dashed "dispatch agent here" button are removed (it was never wired). A new `onUnlink: () => void` prop is added. The `AgentCard` is given a fixed width via a wrapper so cards sit side by side and wrap.

- [ ] **Step 1: Replace the component**

Replace the ENTIRE contents of `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx` with:

```tsx
import type { AgentCardData } from "./AgentCard";
import { AgentCard } from "./AgentCard";

export function RepoLane({
	repoName,
	role,
	cards,
	onAnswer,
	onOpen,
	onUnlink,
}: {
	repoName: string;
	role: "backend" | "frontend" | null;
	cards: AgentCardData[];
	onAnswer: (workspaceId: string) => void;
	onOpen: (workspaceId: string) => void;
	onUnlink: () => void;
}) {
	return (
		<section className="group/repo rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<div className="flex items-center gap-[8px] border-b border-[var(--border-subtle)] p-[11px_12px]">
				<span className="font-mono text-[12.5px] font-semibold text-[var(--text)]">{repoName}</span>
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
				<span className="text-[11px] text-[var(--text-quaternary)] tabular-nums">
					{cards.length} {cards.length === 1 ? "agent" : "agents"}
				</span>
				<button
					type="button"
					onClick={onUnlink}
					aria-label={`Unlink ${repoName}`}
					title="Unlink repo"
					className="ml-auto px-[4px] text-[14px] leading-none text-[var(--text-quaternary)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/repo:opacity-100"
				>
					×
				</button>
			</div>
			<div className="p-[10px]">
				{cards.length === 0 ? (
					<div className="px-[2px] py-[4px] text-[11.5px] italic text-[var(--text-quaternary)]">
						No agents yet — dispatch a task to start one here
					</div>
				) : (
					<div className="flex flex-wrap gap-[8px]">
						{cards.map((c) => (
							<div key={c.workspaceId} className="w-[240px]">
								<AgentCard
									data={c}
									onAnswer={() => onAnswer(c.workspaceId)}
									onOpen={() => onOpen(c.workspaceId)}
								/>
							</div>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
```

- [ ] **Step 2: Renderer type-check**

```bash
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "orchestrator/RepoLane|CrossRepoOrchestratorCanvas" || echo "NO ERRORS"
```
Expected: an error in `CrossRepoOrchestratorCanvas.tsx` because it still passes `onDispatchHere` and does not pass `onUnlink` — that is the EXPECTED seam closed by Task 4. There must be NO error inside `RepoLane.tsx` itself. (If the grep shows only `CrossRepoOrchestratorCanvas` errors about `onUnlink`/`onDispatchHere`, that is correct; report it and proceed. If it shows a `RepoLane` error, fix it.)

- [ ] **Step 3: Biome**

```bash
npx biome check src/renderer/components/orchestrator/RepoLane.tsx
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx
git commit -m "feat(xro): repo lane becomes full-width section with wrapping cards + unlink"
```
(Do NOT use --no-verify. If the pre-commit hook type-checks the renderer and fails on the EXPECTED `CrossRepoOrchestratorCanvas` seam, report BLOCKED with the hook output rather than bypassing — but first verify the hook scope: the prior tasks in this branch committed renderer changes without the hook blocking on cross-file seams, so it likely will not block here.)

---

### Task 4: Add-repo control + wire unlink into the canvas

**Files:**
- Create: `apps/desktop/src/renderer/components/orchestrator/AddRepoButton.tsx`
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`

- [ ] **Step 1: Create the AddRepoButton**

This mirrors the link-repo dropdown pattern from the (now-deleted) sidebar body: a button that opens a list of unlinked projects, closes on outside-click, and calls `linkProject` on pick. Create `apps/desktop/src/renderer/components/orchestrator/AddRepoButton.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc/client";

export function AddRepoButton({ orchestratorId }: { orchestratorId: string }) {
	const [open, setOpen] = useState(false);
	const wrap = useRef<HTMLDivElement>(null);

	const utils = trpc.useUtils();
	const projects = trpc.projects.list.useQuery();
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const linkProject = trpc.crossRepoOrchestrators.linkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
		},
	});

	useEffect(() => {
		if (!open) return;
		function onDown(e: MouseEvent) {
			if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	const linkedIds = new Set(linked.data ?? []);
	const unlinked = (projects.data ?? []).filter((p) => !linkedIds.has(p.id));

	return (
		<div className="relative" ref={wrap}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={unlinked.length === 0}
				title={unlinked.length === 0 ? "All repos linked" : "Link another repo"}
				aria-expanded={open}
				className="inline-flex h-[24px] items-center gap-[5px] rounded-[7px] border border-[var(--border)] bg-[var(--bg-elevated)] px-[9px] text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text)] disabled:opacity-40"
			>
				<svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden="true">
					<path d="M5.5 1.5v8M1.5 5.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
				</svg>
				Add repo
			</button>
			{open && unlinked.length > 0 && (
				<div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]">
					{unlinked.map((p) => (
						<button
							key={p.id}
							type="button"
							className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)]"
							onClick={() => {
								linkProject.mutate({ id: orchestratorId, projectId: p.id });
								setOpen(false);
							}}
						>
							{p.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Wire it + unlink into the canvas**

In `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`:

Add the import alongside the others:
```tsx
import { AddRepoButton } from "./orchestrator/AddRepoButton";
```

Add the unlink mutation next to the existing `attachTerminal` mutation declaration:
```tsx
	const unlinkProject = trpc.crossRepoOrchestrators.unlinkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
		},
	});
```

That requires a `utils` handle — add near the queries (if not already present):
```tsx
	const utils = trpc.useUtils();
```

Change the "Repos" heading row to include the Add-repo button, and update the `RepoLane` call to pass `onUnlink` and drop `onDispatchHere`. Replace the heading + repo-stack block from Task 1 with:

```tsx
				<div className="mb-[12px] mt-[26px] flex items-center justify-between">
					<h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">Repos</h2>
					<AddRepoButton orchestratorId={orchestratorId} />
				</div>
				<div className="flex flex-col gap-[12px]">
					{repos.map((r) => (
						// biome-ignore lint/a11y/useValidAriaRole: `role` is a domain prop (backend/frontend), not an ARIA role
						<RepoLane
							key={r.projectId}
							repoName={r.name}
							role={null}
							cards={cardsByProject.get(r.projectId) ?? []}
							onAnswer={(workspaceId) => openMember(workspaceId)}
							onOpen={(workspaceId) => openMember(workspaceId)}
							onUnlink={() => {
								if (window.confirm(`Unlink "${r.name}" from this orchestrator?`)) {
									unlinkProject.mutate({ id: orchestratorId, projectId: r.projectId });
								}
							}}
						/>
					))}
					{repos.length === 0 && (
						<div className="rounded-[10px] border border-dashed border-[var(--border)] px-[14px] py-[16px] text-center text-[12px] text-[var(--text-tertiary)]">
							No repos linked yet. Use “Add repo” to link one.
						</div>
					)}
				</div>
```

- [ ] **Step 3: Renderer type-check + Biome**

```bash
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "CrossRepoOrchestratorCanvas|orchestrator/AddRepoButton|orchestrator/RepoLane" || echo "NO ERRORS IN TOUCHED FILES"
npx biome check src/renderer/components/CrossRepoOrchestratorCanvas.tsx src/renderer/components/orchestrator/AddRepoButton.tsx
```
Expected: "NO ERRORS IN TOUCHED FILES" (the Task-3 seam is now closed — `onUnlink` is passed, `onDispatchHere` is gone). Biome clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/orchestrator/AddRepoButton.tsx apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx
git commit -m "feat(xro): add + unlink repos from the overview header"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the rail is fully gone**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/cross-repo-orchestrator
grep -rn "CrossRepoActivityRail\|ActivityEvent\|onDispatchHere" apps/desktop/src && echo "FOUND STRAGGLERS (investigate)" || echo "CLEAN"
```
Expected: "CLEAN" (no references to the deleted rail, its event type, or the removed prop anywhere in src).

- [ ] **Step 2: Renderer type-check (all touched files) + main type-check + Biome**

```bash
cd apps/desktop
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "CrossRepoOrchestrator|orchestrator/AgentCard|orchestrator/RepoLane|orchestrator/AddRepoButton" || echo "NO XRO ERRORS"
bun run type-check
npx biome check \
  src/renderer/components/CrossRepoOrchestratorCanvas.tsx \
  src/renderer/components/orchestrator/AgentCard.tsx \
  src/renderer/components/orchestrator/RepoLane.tsx \
  src/renderer/components/orchestrator/AddRepoButton.tsx
```
Expected: "NO XRO ERRORS"; main type-check clean; Biome reports no errors (pre-existing warnings elsewhere are fine).

- [ ] **Step 3: Manual smoke (user-run)**

Start the app (`bun run dev` from repo root), open an orchestrator. Verify: overview is a single column (no right-hand activity rail) and no longer cramped; repos are full-width stacked sections; agent cards wrap horizontally and a long status clamps to 2 lines with a hover tooltip; `Add repo` lists unlinked projects and linking one makes its section + the composer "Route to" chip appear; the repo header `×` unlinks (after confirm) and the section disappears; clicking an agent card still opens that member's terminal.

- [ ] **Step 4: Final commit (only if verification required fixups)**

```bash
git add -A
git commit -m "chore(xro): overview polish verification fixups"
```

---

## Notes for the implementer

- **Renderer is not covered by `bun run type-check`.** Always verify renderer changes with `npx tsc --project tsconfig.renderer.json --noEmit` and grep for the touched files; unrelated pre-existing errors in `src/main/ai-review/*` and `pane-store.ts:513` are noise.
- **No new test files.** These are presentational components with no existing Bun/DOM harness; the prior redesign verified equivalents via type-check + lint + manual smoke. Do not scaffold a test runner.
- **Tasks 3 and 4 form a seam:** Task 3 changes `RepoLane`'s props (adds `onUnlink`, drops `onDispatchHere`) which breaks the canvas until Task 4 updates the call site. Run them in order; the Task-3 type-check error in the canvas is expected and closed by Task 4.
- **Reuse, don't reinvent:** `AddRepoButton` is the same dropdown pattern the deleted `CrossRepoOrchestratorBody` used for linking; the mutations (`linkProject`, `unlinkProject`) and queries (`listLinkedProjects`, `projects.list`) are unchanged.
