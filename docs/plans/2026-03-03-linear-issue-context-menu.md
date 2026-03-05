# Linear Issue Context Menu — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hover overlay on Linear issue rows with a right-click context menu, keeping left-click navigation unchanged.

**Architecture:** Create a new `IssueContextMenu.tsx` component following the existing `WorkspaceContextMenu` pattern (fixed positioning, viewport clamping, click-outside + Escape dismissal). Then simplify `LinearIssueList.tsx` by removing all hover overlay code and wiring up the context menu via `onContextMenu`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, tRPC (TanStack Query), Zustand, Electron IPC

---

### Task 1: Create `IssueContextMenu.tsx`

**Files:**
- Create: `apps/desktop/src/renderer/components/IssueContextMenu.tsx`

**Reference files (read these for patterns):**
- `apps/desktop/src/renderer/components/WorkspaceItem.tsx:42-110` — context menu pattern (positioning, viewport clamping, dismissal)
- `apps/desktop/src/renderer/components/WorkspacePopover.tsx` — `LinkedWorkspace` type export, menu item styling, branch icon SVG

**Step 1: Create the component file**

Create `apps/desktop/src/renderer/components/IssueContextMenu.tsx` with the following complete code:

```tsx
import { useEffect, useRef, useState } from "react";
import type { LinkedWorkspace } from "./WorkspacePopover";
import { trpc } from "../trpc/client";

interface IssueContextMenuProps {
	position: { x: number; y: number };
	issue: {
		id: string;
		identifier: string;
		url: string;
		stateId: string;
		teamId: string;
	};
	workspaces: LinkedWorkspace[] | undefined;
	onClose: () => void;
	onStateUpdate: (issueId: string, stateId: string) => void;
	onCreateBranch: () => void;
	onNavigateToWorkspace: (ws: LinkedWorkspace) => void;
}

export function IssueContextMenu({
	position,
	issue,
	workspaces,
	onClose,
	onStateUpdate,
	onCreateBranch,
	onNavigateToWorkspace,
}: IssueContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);

	const { data: states } = trpc.linear.getTeamStates.useQuery(
		{ teamId: issue.teamId },
		{ staleTime: 5 * 60_000 },
	);

	// Viewport clamping
	useEffect(() => {
		if (!menuRef.current) return;
		const rect = menuRef.current.getBoundingClientRect();
		let { x, y } = position;

		if (x + rect.width > window.innerWidth) {
			x = window.innerWidth - rect.width - 8;
		}
		if (y + rect.height > window.innerHeight) {
			y = window.innerHeight - rect.height - 8;
		}

		if (x !== position.x || y !== position.y) {
			setAdjusted({ x, y });
		}
	}, [position]);

	// Click outside → close
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onClose]);

	// Escape → close
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	return (
		<div
			ref={menuRef}
			role="menu"
			className="fixed z-50 min-w-[180px] max-w-[260px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: adjusted.x, top: adjusted.y }}
		>
			{/* State picker */}
			<div className="px-3 py-1.5">
				<select
					className="w-full rounded bg-[var(--bg-overlay)] px-2 py-1 text-[13px] text-[var(--text-secondary)] outline-none"
					value={issue.stateId}
					onChange={(e) => {
						onStateUpdate(issue.id, e.target.value);
					}}
					onClick={(e) => e.stopPropagation()}
				>
					{states?.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name}
						</option>
					))}
				</select>
			</div>

			<div className="my-1 border-t border-[var(--border)]" />

			{/* Open in Linear */}
			<button
				type="button"
				role="menuitem"
				className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
				onClick={() => {
					window.electron.shell.openExternal(issue.url);
					onClose();
				}}
			>
				<span>Open in Linear</span>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="shrink-0 text-[var(--text-quaternary)]"
				>
					<path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
					<path d="M10 2h4v4" />
					<path d="M14 2L8 8" />
				</svg>
			</button>

			{/* Create branch */}
			<button
				type="button"
				role="menuitem"
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
				onClick={() => {
					onClose();
					onCreateBranch();
				}}
			>
				<span>Create branch</span>
			</button>

			{/* Workspace entries (only if linked) */}
			{workspaces && workspaces.length > 0 && (
				<>
					<div className="my-1 border-t border-[var(--border)]" />
					{workspaces.map((ws) => (
						<button
							key={ws.workspaceId}
							type="button"
							role="menuitem"
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
							onClick={() => {
								onNavigateToWorkspace(ws);
								onClose();
							}}
						>
							<svg
								aria-hidden="true"
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="shrink-0 text-[var(--text-quaternary)]"
							>
								<line x1="6" y1="3" x2="6" y2="15" />
								<circle cx="18" cy="6" r="3" />
								<circle cx="6" cy="18" r="3" />
								<path d="M18 9a9 9 0 0 1-9 9" />
							</svg>
							<span className="truncate">
								{ws.workspaceName ?? ws.workspaceId}
							</span>
						</button>
					))}
				</>
			)}
		</div>
	);
}
```

**Step 2: Verify the file compiles**

Run: `bun run type-check` from the repo root.
Expected: No new errors from `IssueContextMenu.tsx`. (Pre-existing errors in `ExtensionManager.tsx` and test files are expected and unrelated.)

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/IssueContextMenu.tsx
git commit -m "feat: add IssueContextMenu component for right-click actions"
```

---

### Task 2: Refactor `LinearIssueList.tsx` to use context menu

**Files:**
- Modify: `apps/desktop/src/renderer/components/LinearIssueList.tsx`

**What to remove:**
1. The `StatePicker` component definition (lines 7-37) — state picking is now inside `IssueContextMenu`
2. The `hoveredIssueId` state (line 41) and all references
3. `onMouseEnter` / `onMouseLeave` handlers (lines 176-177)
4. The `group relative` class on the row wrapper div (line 175) — no longer needed
5. The entire hover overlay div (lines 235-279) — the gradient + opaque overlay with StatePicker + external link button

**What to add:**
1. Import `IssueContextMenu` from `./IssueContextMenu`
2. Context menu state: `const [contextMenu, setContextMenu] = useState<{ position: { x: number; y: number }; issue: BranchIssue; workspaces: LinkedWorkspace[] | undefined; } | null>(null);`
3. `onContextMenu` handler on each issue row button
4. Render `<IssueContextMenu>` when `contextMenu` is non-null

**Step 1: Apply changes to `LinearIssueList.tsx`**

Replace the entire file content with:

```tsx
import { useCallback, useMemo, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { type BranchIssue, CreateBranchFromIssueModal } from "./CreateBranchFromIssueModal";
import { IssueContextMenu } from "./IssueContextMenu";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

export function LinearIssueList() {
	const utils = trpc.useUtils();
	const [openModalIssue, setOpenModalIssue] = useState<BranchIssue | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		issue: BranchIssue;
		workspaces: LinkedWorkspace[];
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		position: { x: number; y: number };
		issue: BranchIssue;
		workspaces: LinkedWorkspace[] | undefined;
	} | null>(null);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	// Team selection
	const { data: teams } = trpc.linear.getTeams.useQuery(undefined, { staleTime: 5 * 60_000 });
	const { data: selectedTeamId } = trpc.linear.getSelectedTeam.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setTeamMutation = trpc.linear.setSelectedTeam.useMutation({
		onSuccess: () => utils.linear.getAssignedIssues.invalidate(),
	});

	// Issues
	const { data: issues, isLoading } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	// Linked issues → Map<linearIssueId, LinkedWorkspace[]>
	const { data: linkedIssues } = trpc.linear.getLinkedIssues.useQuery(undefined, {
		staleTime: 30_000,
	});
	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedIssues) return map;
		for (const l of linkedIssues) {
			if (l.worktreePath === null) continue;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const existing = map.get(l.linearIssueId);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(l.linearIssueId, [entry]);
			}
		}
		return map;
	}, [linkedIssues]);

	// Navigate to a single workspace (with terminal tab creation)
	const navigateToWorkspace = useCallback((ws: LinkedWorkspace) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

		const existing = store.getTabsByWorkspace(ws.workspaceId);
		const hasTerminal = existing.some((t) => t.kind === "terminal");
		if (!hasTerminal) {
			const title = ws.workspaceName ?? ws.workspaceId;
			const tabId = store.addTerminalTab(ws.workspaceId, ws.worktreePath, title);
			attachTerminalRef.current({ workspaceId: ws.workspaceId, terminalId: tabId });
		}
	}, []);

	// State update (optimistic)
	const updateStateMutation = trpc.linear.updateIssueState.useMutation({
		onMutate: async ({ issueId, stateId }) => {
			await utils.linear.getAssignedIssues.cancel();
			const prev = utils.linear.getAssignedIssues.getData();
			utils.linear.getAssignedIssues.setData(undefined, (old) => {
				if (!old) return old;
				return old.map((issue) => {
					if (issue.id !== issueId) return issue;
					const states = utils.linear.getTeamStates.getData({ teamId: issue.teamId });
					const newState = states?.find((s) => s.id === stateId);
					return {
						...issue,
						stateId,
						...(newState
							? { stateName: newState.name, stateColor: newState.color, stateType: newState.type }
							: {}),
					};
				});
			});
			return { prev };
		},
		onError: (_err, _vars, ctx) => {
			if (ctx?.prev) utils.linear.getAssignedIssues.setData(undefined, ctx.prev);
		},
		onSettled: () => utils.linear.getAssignedIssues.invalidate(),
	});

	if (isLoading && !issues) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	return (
		<>
			<div className="flex flex-col gap-0.5">
				{/* Team selector — only shown when user has multiple teams */}
				{teams && teams.length > 1 && (
					<div className="px-3 pb-1">
						<select
							className="w-full rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] outline-none"
							value={selectedTeamId ?? ""}
							onChange={(e) => setTeamMutation.mutate({ teamId: e.target.value || null })}
						>
							<option value="">All teams</option>
							{teams.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
					</div>
				)}

				{/* Issue list */}
				{!issues || issues.length === 0 ? (
					<div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">
						No issues assigned
					</div>
				) : (
					issues.map((issue) => {
						const linked = linkedMap.get(issue.id);

						return (
							<button
								key={issue.id}
								type="button"
								onClick={(e) => {
									if (!linked) {
										setOpenModalIssue(issue);
									} else if (linked.length === 1 && linked[0]) {
										navigateToWorkspace(linked[0]);
									} else {
										const rect = e.currentTarget.getBoundingClientRect();
										setPopover({
											position: { x: rect.left, y: rect.bottom + 4 },
											issue,
											workspaces: linked,
										});
									}
								}}
								onContextMenu={(e) => {
									e.preventDefault();
									setContextMenu({
										position: { x: e.clientX, y: e.clientY },
										issue,
										workspaces: linked,
									});
								}}
								className={`flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
									linked
										? "text-[var(--text-secondary)]"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
								title={
									linked
										? `Open workspace for ${issue.identifier}`
										: `${issue.identifier}: ${issue.title}`
								}
							>
								{/* Status dot */}
								<span
									className="h-2 w-2 shrink-0 rounded-full"
									style={{ backgroundColor: issue.stateColor }}
								/>
								<span className="shrink-0 font-medium text-[var(--text-quaternary)]">
									{issue.identifier}
								</span>
								<span className="min-w-0 flex-1 truncate">{issue.title}</span>
								{/* Chain icon — visible when linked */}
								{linked && (
									<svg
										aria-hidden="true"
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="shrink-0 text-[var(--accent)]"
									>
										<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
										<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
									</svg>
								)}
							</button>
						);
					})
				)}
			</div>

			{/* Context menu */}
			{contextMenu && (
				<IssueContextMenu
					position={contextMenu.position}
					issue={contextMenu.issue}
					workspaces={contextMenu.workspaces}
					onClose={() => setContextMenu(null)}
					onStateUpdate={(issueId, stateId) =>
						updateStateMutation.mutate({ issueId, stateId })
					}
					onCreateBranch={() => {
						setContextMenu(null);
						setOpenModalIssue(contextMenu.issue);
					}}
					onNavigateToWorkspace={(ws) => {
						navigateToWorkspace(ws);
						setContextMenu(null);
					}}
				/>
			)}

			{/* Workspace popover */}
			{popover && (
				<WorkspacePopover
					position={popover.position}
					workspaces={popover.workspaces}
					onClose={() => setPopover(null)}
					onCreateBranch={() => {
						setPopover(null);
						setOpenModalIssue(popover.issue);
					}}
				/>
			)}

			<CreateBranchFromIssueModal issue={openModalIssue} onClose={() => setOpenModalIssue(null)} />
		</>
	);
}
```

Key changes from the original:
- **Removed**: `StatePickerProps` interface, `StatePicker` component, `hoveredIssueId` state, `onMouseEnter`/`onMouseLeave`, `group relative` wrapper div, entire hover overlay (gradient + opaque div with StatePicker + external link button)
- **Added**: `contextMenu` state, `onContextMenu` handler on each button, `<IssueContextMenu>` render block
- **Simplified**: Issue rows are now direct `<button>` elements (no wrapper `<div>`) since there's no overlay to position relative to
- **Kept unchanged**: all left-click behavior, `linkedMap`, `navigateToWorkspace`, `WorkspacePopover`, `CreateBranchFromIssueModal`, `updateStateMutation` with optimistic updates, team selector, loading state

**Step 2: Verify the file compiles**

Run: `bun run type-check` from the repo root.
Expected: No new errors from `LinearIssueList.tsx`. (Pre-existing errors in `ExtensionManager.tsx` and test files are expected.)

**Step 3: Run lint/format**

Run: `bun run check` from the repo root.
Expected: Biome auto-fixes formatting. No lint errors.

**Step 4: Run tests**

Run: `bun test` from `apps/desktop/`.
Expected: All 178 tests pass. (No tests directly exercise `LinearIssueList` since it's a React component requiring Electron context, but verify nothing is broken.)

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/LinearIssueList.tsx
git commit -m "refactor: replace hover overlay with right-click context menu in issue list

Remove StatePicker, hover state, gradient overlay, and external link button
from issue rows. Add onContextMenu handler opening IssueContextMenu with
state picker, open-in-Linear, create-branch, and workspace navigation."
```

---

### Task 3: Final verification

**Step 1: Full build check**

Run: `bun run build` from the repo root.
Expected: Build succeeds with no errors.

**Step 2: Type check**

Run: `bun run type-check` from the repo root.
Expected: No new type errors.

**Step 3: Run all tests**

Run: `bun test` from `apps/desktop/`.
Expected: All tests pass.
