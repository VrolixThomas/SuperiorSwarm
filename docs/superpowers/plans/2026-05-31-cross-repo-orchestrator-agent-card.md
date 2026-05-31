# Cross-repo Orchestrator Richer Agent Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the overview's agent card readable and useful — expandable full status, a freshness timestamp, and an explicit "Open terminal" action — instead of a single clamped sentence.

**Architecture:** One backend field (`statusUpdatedAt`) is added to the `listCrossRepoMembers` query; the rest is the overview subcomponents. `AgentCard` is restructured from a single giant `<button>` into a `<div>` with explicit action buttons and a local Show-more expand. The canvas passes the timestamp and widens its container; the repo section widens the card basis.

**Tech Stack:** React 19 + TypeScript, tRPC (superjson — `Date` preserved), Drizzle/SQLite, Bun test, Biome (tabs, double quotes, semicolons, width 100), strict TS. The project's `bun run type-check` does NOT cover the renderer — verify renderer changes with `npx tsc --project tsconfig.renderer.json --noEmit`.

---

## File map

- `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts` — add `statusUpdatedAt` to `listCrossRepoMembers` (Task 1).
- `apps/desktop/tests/cross-repo-orchestrator-members-worktree.test.ts` — extend with a `statusUpdatedAt` assertion (Task 1).
- `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx` — `AgentCardData` field + rich expandable card (Task 2).
- `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx` — pass `statusUpdatedAt`, widen container (Task 3).
- `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx` — widen card basis (Task 3).

Reused: `formatRelativeTime(dateStr: string | undefined)` from `src/shared/tickets.ts` (`""` when undefined, else "just now"/"Nm ago"/"Nh ago"/"Nd ago"/"Nmo ago"). `StatusPill` from `./StatusPill` (unchanged).

---

### Task 1: `listCrossRepoMembers` returns `statusUpdatedAt`

**Files:**
- Modify: `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts` (the `listCrossRepoMembers` function)
- Modify: `apps/desktop/tests/cross-repo-orchestrator-members-worktree.test.ts`

- [ ] **Step 1: Extend the existing test**

Open `apps/desktop/tests/cross-repo-orchestrator-members-worktree.test.ts`. Add a second test inside the existing `describe(...)` block (after the existing test). It seeds a member, sets a known `statusUpdatedAt`, and asserts it round-trips:

```typescript
	test("returns statusUpdatedAt, or null when unset", async () => {
		const project = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [project] });

		const withTs = await seedWorkspace(project, { name: "with-ts" });
		const ts = new Date("2026-05-30T12:00:00.000Z");
		getDb().update(workspaces).set({ statusUpdatedAt: ts }).where(eq(workspaces.id, withTs)).run();

		const noTs = await seedWorkspace(project, { name: "no-ts" });

		await addProjectToCrossRepoOrchestrator({ orchestratorId: xro, projectId: project });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: withTs });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: noTs });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		const byId = new Map(members.map((m) => [m.workspaceId, m]));
		expect(byId.get(withTs)?.statusUpdatedAt?.getTime()).toBe(ts.getTime());
		expect(byId.get(noTs)?.statusUpdatedAt).toBeNull();
	});
```

(The imports `eq`, `getDb`, `workspaces`, `seedProject`, `seedWorkspace`, `seedCrossRepoOrchestrator`, `addProjectToCrossRepoOrchestrator`, `attachToCrossRepoOrchestrator`, `listCrossRepoMembers` already exist at the top of this file from the prior test — reuse them, do not re-import.)

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `bun test tests/cross-repo-orchestrator-members-worktree.test.ts`
Expected: the new test FAILS — `statusUpdatedAt` is `undefined` on the returned rows.

- [ ] **Step 3: Implement**

In `apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts`, in `listCrossRepoMembers`:

Add `statusUpdatedAt: Date | null` to the Promise return-type array shape (after `worktreePath: string | null;`).

Add `statusUpdatedAt: workspaces.statusUpdatedAt,` to the `.select({...})` (after the `needs: workspaces.needs,` line, before `worktreePath: worktrees.path,`).

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `bun test tests/cross-repo-orchestrator-members-worktree.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/cross-repo-orchestrator-membership.ts apps/desktop/tests/cross-repo-orchestrator-members-worktree.test.ts
git commit -m "feat(xro): listCrossRepoMembers returns statusUpdatedAt"
```
(No --no-verify. No Co-Authored-By trailers.)

---

### Task 2: Rich, expandable `AgentCard`

**Files:**
- Modify: `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx`

- [ ] **Step 1: Replace the entire file**

Replace the ENTIRE contents of `apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx` with:

```tsx
import { useState } from "react";
import type { WorkspacePhase } from "../../../shared/control-plane";
import { formatRelativeTime } from "../../../shared/tickets";
import { StatusPill } from "./StatusPill";

export interface AgentCardData {
	workspaceId: string;
	branch: string;
	phase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
	worktreePath: string | null;
	statusUpdatedAt: string | null;
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
	const [expanded, setExpanded] = useState(false);
	const blocked = data.phase === "blocked";
	const relTime = formatRelativeTime(data.statusUpdatedAt ?? undefined);
	const isLong = (data.statusText?.length ?? 0) > 140;

	return (
		<div
			className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-[11px_12px]"
			style={blocked ? { borderColor: "rgba(230,162,60,0.35)" } : undefined}
		>
			<div className="flex items-center gap-[7px]">
				<span className="flex-1 truncate font-mono text-[12px] text-[var(--text-secondary)]">
					{data.branch}
				</span>
				{relTime && (
					<span className="shrink-0 text-[10.5px] text-[var(--text-quaternary)]">{relTime}</span>
				)}
				<StatusPill phase={data.phase} />
			</div>

			{data.statusText && (
				<div
					className={[
						"mt-[8px] whitespace-pre-wrap text-[12px] leading-[1.5] text-[var(--text-tertiary)]",
						expanded
							? "max-h-[240px] overflow-y-auto"
							: "overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:4] [display:-webkit-box]",
					].join(" ")}
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

			{isLong && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-[5px] text-[11px] font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}

			<div className="mt-[10px] flex items-center gap-[8px]">
				<button
					type="button"
					onClick={onOpen}
					className="inline-flex h-[26px] items-center gap-[5px] rounded-[7px] border border-[var(--border)] bg-[var(--bg-surface)] px-[10px] text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text)]"
				>
					Open terminal →
				</button>
				{blocked && (
					<button
						type="button"
						onClick={onAnswer}
						className="ml-auto inline-flex h-[26px] items-center rounded-[7px] border border-[rgba(230,162,60,0.35)] bg-[var(--st-blocked-bg)] px-[10px] text-[11.5px] font-semibold text-[var(--st-blocked)] hover:bg-[rgba(230,162,60,0.22)]"
					>
						Answer
					</button>
				)}
			</div>
		</div>
	);
}
```

Notes for the implementer:
- The card root is now a `<div>` (not a `<button>`), so the previous nested-button a11y workaround (the `biome-ignore` lines + `role="button"` span) is gone on purpose — `onOpen`/`onAnswer` are real `<button>`s.
- `whitespace-pre-wrap` preserves the agent's line breaks; the collapsed state still clamps to 4 visual lines via the webkit utilities.
- Verify `--st-blocked-bg` exists in `src/renderer/styles.css` (it was added in the status-pill work). If it does not, use `rgba(230,162,60,0.14)` literally instead.

- [ ] **Step 2: Renderer type-check + Biome**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/cross-repo-orchestrator/apps/desktop
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "^src/renderer/components/orchestrator/(AgentCard|RepoLane)|^src/renderer/components/CrossRepoOrchestratorCanvas" || echo "NO ERRORS IN CARD/CONSUMERS"
npx biome check src/renderer/components/orchestrator/AgentCard.tsx 2>&1 | tail -3
```
Expected: `AgentCardData` now requires `statusUpdatedAt`, so `CrossRepoOrchestratorCanvas.tsx` (which builds the card data) will show a type error about the missing property — that is the EXPECTED seam closed by Task 3. There must be NO error inside `AgentCard.tsx` itself. Biome on AgentCard.tsx clean (run `npx biome check --write` then re-check if only formatting).

- [ ] **Step 3: Commit**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/cross-repo-orchestrator
git add apps/desktop/src/renderer/components/orchestrator/AgentCard.tsx
git commit -m "feat(xro): expandable agent card with timestamp + explicit open-terminal action"
```
(No --no-verify. If a pre-commit hook type-checks the renderer and fails on the EXPECTED canvas seam, report BLOCKED with the output rather than bypassing — but prior branch commits committed cross-file renderer seams without the hook blocking.)

---

### Task 3: Canvas passes `statusUpdatedAt` + wider layout/cards

**Files:**
- Modify: `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`
- Modify: `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx`

- [ ] **Step 1: Canvas — add the field to the card data + widen the container**

In `apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx`:

(a) In the `cardsByProject` `useMemo`, the `arr.push({...})` currently ends with `worktreePath: m.worktreePath,`. Add a line after it:
```tsx
					statusUpdatedAt: m.statusUpdatedAt ? new Date(m.statusUpdatedAt).toISOString() : null,
```
So the pushed object becomes:
```tsx
				arr.push({
					workspaceId: m.workspaceId,
					branch: m.workspaceName,
					phase: m.currentPhase,
					statusText: m.statusText,
					needs: m.needs,
					worktreePath: m.worktreePath,
					statusUpdatedAt: m.statusUpdatedAt ? new Date(m.statusUpdatedAt).toISOString() : null,
				});
```

(b) Widen the content container: change the inner wrapper class `mx-auto w-full max-w-[820px] p-[22px_26px_40px]` to `mx-auto w-full max-w-[1100px] p-[22px_26px_40px]`.

- [ ] **Step 2: RepoLane — widen the card basis**

In `apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx`, change the per-card wrapper class from `min-w-0 basis-[240px]` to `min-w-0 grow basis-[340px]`:
```tsx
							<div key={c.workspaceId} className="min-w-0 grow basis-[340px]">
```

- [ ] **Step 3: Renderer type-check + Biome (seam now closed)**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/cross-repo-orchestrator/apps/desktop
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "^src/renderer/components/(CrossRepoOrchestratorCanvas|orchestrator/RepoLane|orchestrator/AgentCard)" || echo "NO ERRORS IN TOUCHED FILES"
npx biome check src/renderer/components/CrossRepoOrchestratorCanvas.tsx src/renderer/components/orchestrator/RepoLane.tsx 2>&1 | tail -3
```
Expected: "NO ERRORS IN TOUCHED FILES" (the `statusUpdatedAt` property now satisfies `AgentCardData`). Biome clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/cross-repo-orchestrator
git add apps/desktop/src/renderer/components/CrossRepoOrchestratorCanvas.tsx apps/desktop/src/renderer/components/orchestrator/RepoLane.tsx
git commit -m "feat(xro): pass agent status timestamp + widen overview layout and cards"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Tests + type-checks + Biome**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/cross-repo-orchestrator/apps/desktop
bun test tests/cross-repo-orchestrator-members-worktree.test.ts
npx tsc --project tsconfig.renderer.json --noEmit 2>&1 | grep -E "^src/renderer/components/(CrossRepoOrchestrator|orchestrator/)" || echo "NO XRO ERRORS"
bun run type-check
npx biome check \
  src/main/services/cross-repo-orchestrator-membership.ts \
  src/renderer/components/orchestrator/AgentCard.tsx \
  src/renderer/components/CrossRepoOrchestratorCanvas.tsx \
  src/renderer/components/orchestrator/RepoLane.tsx
```
Expected: members test passes (2 tests); "NO XRO ERRORS" (the renderer-project will still print unrelated pre-existing `src/main/.../review.ts` SQLite-typing errors — ignore those, the grep is anchored to `^src/renderer/components/(CrossRepoOrchestrator|orchestrator/)` so only our files match); `bun run type-check` (main) clean; Biome reports no errors.

- [ ] **Step 2: Manual smoke (user-run)**

Start the app (`bun run dev`), open an orchestrator. Verify on an agent card: branch + phase pill + relative time in the header; the status reads beyond two lines and a `Show more` reveals the full text (long statuses scroll inside a 240px box rather than walling the card); `Open terminal →` opens that agent's terminal; a blocked card shows `Answer`; cards are wider and use the horizontal space.

- [ ] **Step 3: Final commit (only if fixups were needed)**

```bash
git add -A
git commit -m "chore(xro): agent card verification fixups"
```

---

## Notes for the implementer

- **Renderer is not covered by `bun run type-check`.** Verify renderer changes with `npx tsc --project tsconfig.renderer.json --noEmit` and grep anchored to `^src/renderer/components/...`; unrelated pre-existing errors (`src/main/trpc/routers/review.ts`, `pane-store.ts:513`) are noise.
- **Tasks 2→3 are a seam:** Task 2 adds the required `statusUpdatedAt` to `AgentCardData`, which breaks the canvas until Task 3 supplies it. Run them in order; the Task-2 type error in the canvas is expected and closed by Task 3.
- **superjson preserves `Date`,** so `m.statusUpdatedAt` is a `Date | null` in the renderer; `new Date(m.statusUpdatedAt).toISOString()` is robust either way and yields the `string | null` the card expects.
- **Reuse `formatRelativeTime`** from `src/shared/tickets.ts`; do not write a new time formatter.
