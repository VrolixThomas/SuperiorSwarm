# Unified Tickets & PRs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the three separate integration panels (AtlassianPanel, LinearPanel, GitHubPanel) in the sidebar with a single unified section that has a segmented control toggling between a Tickets tab and a Pull Requests tab, grouped by native project.

**Architecture:** The new `UnifiedTicketsSection` component replaces the three integration panels in `Sidebar.tsx`. It contains a `SectionHeader`, a segmented control, and renders either `TicketsTab` or `PullRequestsTab`. Each tab fetches data from its respective providers via existing tRPC queries, merges + groups + sorts client-side. Group collapse state is persisted in `sessionState` via a new tRPC route. No new backend data fetching routes needed.

**Tech Stack:** React 19, Zustand, TanStack Query (via tRPC), Tailwind CSS v4, SQLite (Drizzle ORM)

---

### Task 1: Add sidebar UI state to Zustand store

**Files:**
- Modify: `apps/desktop/src/renderer/stores/projects.ts:3-58`

**Step 1: Add new state and actions to the store interface and implementation**

Add `ticketsPrTab` state and `setTicketsPrTab` action to `ProjectStore`. The `collapsedGroups` state will be managed locally + persisted via tRPC (not Zustand) to avoid coupling store to async DB reads.

```typescript
// In the ProjectStore interface, add after line 20 (closeSettings):
ticketsPrTab: "tickets" | "prs";
setTicketsPrTab: (tab: "tickets" | "prs") => void;
```

```typescript
// In the create() implementation, add after line 30 (sidebarView: "main"):
ticketsPrTab: "tickets" as const,
```

```typescript
// In the create() implementation, add after closeSettings (line 57):
setTicketsPrTab: (tab) => set({ ticketsPrTab: tab }),
```

**Step 2: Run type-check to verify**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/stores/projects.ts
git commit -m "feat: add ticketsPrTab state to project store"
```

---

### Task 2: Add tRPC route for persisting collapsed groups

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/tickets.ts`

The `sessionState` table uses a simple key-value pattern. We'll store collapsed group IDs as a JSON array under a single key.

**Step 1: Add getCollapsedGroups and setCollapsedGroups routes**

Add two new routes to `ticketsRouter` in `apps/desktop/src/main/trpc/routers/tickets.ts`:

```typescript
// Add to imports at top:
import { sessionState } from "../../db/schema";

// Add the session state key constant after imports:
const COLLAPSED_GROUPS_KEY = "sidebar_collapsed_groups";

// Add these two routes inside the router({}) call, after getLinkedTickets:

getCollapsedGroups: publicProcedure.query(() => {
	const db = getDb();
	const row = db
		.select()
		.from(sessionState)
		.where(eq(sessionState.key, COLLAPSED_GROUPS_KEY))
		.get();
	return row?.value ? (JSON.parse(row.value) as string[]) : [];
}),

setCollapsedGroups: publicProcedure
	.input(z.object({ groups: z.array(z.string()) }))
	.mutation(({ input }) => {
		const db = getDb();
		db.insert(sessionState)
			.values({ key: COLLAPSED_GROUPS_KEY, value: JSON.stringify(input.groups) })
			.onConflictDoUpdate({
				target: sessionState.key,
				set: { value: JSON.stringify(input.groups) },
			})
			.run();
	}),
```

Note: `eq` is already imported from `drizzle-orm` at line 1. `sessionState` needs to be added to the import from `../../db/schema` at line 4.

**Step 2: Run type-check to verify**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/tickets.ts
git commit -m "feat: add collapsed groups persistence via sessionState"
```

---

### Task 3: Create the TicketsTab component

**Files:**
- Create: `apps/desktop/src/renderer/components/TicketsTab.tsx`

This component merges Jira issues + Linear issues, groups them by native project (Jira `projectKey` / Linear `teamName`), sorts by status within each group, and renders them with collapsible group headers.

**Step 1: Create TicketsTab.tsx**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JiraIssue } from "../../main/atlassian/jira";
import type { LinearIssue, WorkflowStateType } from "../../main/linear/linear";
import type { TicketIssue } from "../../shared/tickets";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CreateBranchFromIssueModal } from "./CreateBranchFromIssueModal";
import { IssueContextMenu } from "./IssueContextMenu";
import { StateIcon } from "./StateIcon";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

// ── Status sort priority (lower = higher priority) ──────────────────────────

const STATUS_PRIORITY: Record<string, number> = {
	// Linear stateTypes
	started: 0,
	unstarted: 1,
	triage: 2,
	backlog: 3,
	completed: 4,
	cancelled: 5,
	// Jira statusCategories
	"In Progress": 0,
	"To Do": 1,
	Done: 4,
};

function getStatusPriority(issue: MergedTicket): number {
	const key = issue.sortKey;
	return STATUS_PRIORITY[key] ?? 3;
}

// ── Merged ticket type (extends TicketIssue with sort metadata) ─────────────

interface MergedTicket extends TicketIssue {
	groupName: string; // Display name for the group header
	sortKey: string; // stateType (Linear) or statusCategory (Jira)
	stateType?: WorkflowStateType; // For StateIcon rendering (Linear only)
}

// ── Provider icons ──────────────────────────────────────────────────────────

function LinearIcon() {
	return (
		<svg aria-hidden="true" width="12" height="12" viewBox="0 0 100 100" className="shrink-0 opacity-40">
			<path
				d="M2.4 46.4c-.5 1.1-.5 2.4 0 3.6l21.2 47.6c.8 1.7 2.8 2.5 4.5 1.8L97.6 67c1.7-.8 2.5-2.8 1.8-4.5L78.2 15c-.8-1.7-2.8-2.5-4.5-1.8L4.2 45.6c-.7.3-1.4.5-1.8.8z"
				fill="currentColor"
			/>
		</svg>
	);
}

function JiraIcon() {
	return (
		<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className="shrink-0 opacity-40">
			<path
				d="M11.53 2c0 5.17 4.17 9.34 9.34 9.34h.78v.78c0 5.17-4.17 9.34-9.34 9.34a9.34 9.34 0 0 1-9.34-9.34V2.78C2.97 2.35 3.32 2 3.75 2h7.78z"
				fill="currentColor"
			/>
		</svg>
	);
}

function ProviderIcon({ provider }: { provider: "linear" | "jira" }) {
	return provider === "linear" ? <LinearIcon /> : <JiraIcon />;
}

// ── Group header ────────────────────────────────────────────────────────────

function GroupHeader({
	name,
	provider,
	count,
	isCollapsed,
	onToggle,
}: {
	name: string;
	provider: "linear" | "jira";
	count: number;
	isCollapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] transition-colors hover:text-[var(--text-tertiary)]"
		>
			<svg
				aria-hidden="true"
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				className={`shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
			>
				<path
					d="M3 1.5L7 5L3 8.5"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<ProviderIcon provider={provider} />
			<span>{name}</span>
			{count > 0 && <span className="ml-auto text-[10px] tabular-nums">{count}</span>}
		</button>
	);
}

// ── Main component ──────────────────────────────────────────────────────────

export function TicketsTab() {
	const utils = trpc.useUtils();
	const [openModalIssue, setOpenModalIssue] = useState<TicketIssue | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		issue: TicketIssue;
		workspaces: LinkedWorkspace[];
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		position: { x: number; y: number };
		issue: MergedTicket;
		workspaces: LinkedWorkspace[] | undefined;
	} | null>(null);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	// ── Data queries ────────────────────────────────────────────────────────

	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: linearStatus } = trpc.linear.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});

	const hasJira = atlassianStatus?.jira.connected === true;
	const hasLinear = linearStatus?.connected === true;

	const { data: jiraIssues } = trpc.atlassian.getMyIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
		enabled: hasJira,
	});

	const { data: linearIssues } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
		enabled: hasLinear,
	});

	// Prefetch Linear team states for context menu
	useEffect(() => {
		if (!linearIssues) return;
		const teamIds = new Set(linearIssues.map((i) => i.teamId));
		for (const teamId of teamIds) {
			utils.linear.getTeamStates.prefetch({ teamId }, { staleTime: 5 * 60_000 });
		}
	}, [linearIssues, utils]);

	// ── Linked tickets ──────────────────────────────────────────────────────

	const { data: linkedTickets } = trpc.tickets.getLinkedTickets.useQuery(undefined, {
		staleTime: 30_000,
	});
	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedTickets) return map;
		for (const l of linkedTickets) {
			if (l.worktreePath === null) continue;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const existing = map.get(l.ticketId);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(l.ticketId, [entry]);
			}
		}
		return map;
	}, [linkedTickets]);

	// ── Collapsed groups (persisted) ────────────────────────────────────────

	const { data: savedCollapsed } = trpc.tickets.getCollapsedGroups.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setCollapsedMutation = trpc.tickets.setCollapsedGroups.useMutation();
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

	// Sync from DB on first load
	useEffect(() => {
		if (savedCollapsed) {
			setCollapsedGroups(new Set(savedCollapsed));
		}
	}, [savedCollapsed]);

	const toggleGroup = useCallback(
		(groupKey: string) => {
			setCollapsedGroups((prev) => {
				const next = new Set(prev);
				if (next.has(groupKey)) {
					next.delete(groupKey);
				} else {
					next.add(groupKey);
				}
				setCollapsedMutation.mutate({ groups: [...next] });
				return next;
			});
		},
		[setCollapsedMutation]
	);

	// ── Merge + group + sort ────────────────────────────────────────────────

	const grouped = useMemo(() => {
		const merged: MergedTicket[] = [];

		if (jiraIssues) {
			for (const issue of jiraIssues) {
				merged.push({
					provider: "jira",
					id: issue.key,
					identifier: issue.key,
					title: issue.summary,
					url: issue.webUrl,
					status: { id: issue.status, name: issue.status, color: issue.statusColor },
					groupId: issue.projectKey,
					groupName: issue.projectKey,
					sortKey: issue.statusCategory,
				});
			}
		}

		if (linearIssues) {
			for (const issue of linearIssues) {
				merged.push({
					provider: "linear",
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					url: issue.url,
					status: { id: issue.stateId, name: issue.stateName, color: issue.stateColor },
					groupId: issue.teamId,
					groupName: issue.teamName,
					sortKey: issue.stateType,
					stateType: issue.stateType,
				});
			}
		}

		// Group by groupId
		const groups = new Map<string, { name: string; provider: "linear" | "jira"; items: MergedTicket[] }>();
		for (const ticket of merged) {
			const existing = groups.get(ticket.groupId);
			if (existing) {
				existing.items.push(ticket);
			} else {
				groups.set(ticket.groupId, {
					name: ticket.groupName,
					provider: ticket.provider,
					items: [ticket],
				});
			}
		}

		// Sort items within each group by status priority
		for (const group of groups.values()) {
			group.items.sort((a, b) => getStatusPriority(a) - getStatusPriority(b));
		}

		return groups;
	}, [jiraIssues, linearIssues]);

	// ── Navigation ──────────────────────────────────────────────────────────

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

	// ── State update mutations ──────────────────────────────────────────────

	const updateJiraStatus = trpc.atlassian.updateIssueStatus.useMutation({
		onSettled: () => utils.atlassian.getMyIssues.invalidate(),
	});

	const updateLinearState = trpc.linear.updateIssueState.useMutation({
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

	// ── Context menu states ─────────────────────────────────────────────────

	const { data: jiraTransitions, isLoading: jiraTransitionsLoading } =
		trpc.atlassian.getIssueTransitions.useQuery(
			{ issueKey: contextMenu?.issue.provider === "jira" ? contextMenu.issue.id : "" },
			{ enabled: contextMenu?.issue.provider === "jira" && !!contextMenu.issue.id, staleTime: 60_000 }
		);

	const { data: linearStates, isLoading: linearStatesLoading } =
		trpc.linear.getTeamStates.useQuery(
			{ teamId: contextMenu?.issue.provider === "linear" ? contextMenu.issue.groupId : "" },
			{ enabled: contextMenu?.issue.provider === "linear" && !!contextMenu.issue.groupId, staleTime: 5 * 60_000 }
		);

	// ── Loading state ───────────────────────────────────────────────────────

	const isLoading = (hasJira && !jiraIssues) || (hasLinear && !linearIssues);

	if (!hasJira && !hasLinear) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
				No ticket services connected
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	if (grouped.size === 0) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
				No tickets assigned
			</div>
		);
	}

	return (
		<>
			<div className="flex flex-col">
				{[...grouped.entries()].map(([groupId, group]) => {
					const isCollapsed = collapsedGroups.has(groupId);
					return (
						<div key={groupId}>
							<GroupHeader
								name={group.name}
								provider={group.provider}
								count={group.items.length}
								isCollapsed={isCollapsed}
								onToggle={() => toggleGroup(groupId)}
							/>
							{!isCollapsed && (
								<div className="flex flex-col gap-0.5">
									{group.items.map((issue) => {
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
												<StateIcon
													type={issue.stateType ?? "default"}
													color={issue.status.color}
												/>
												<span
													className={`shrink-0 font-mono text-[11px] ${
														linked
															? "font-medium text-[var(--accent)]"
															: "font-medium text-[var(--text-quaternary)]"
													}`}
												>
													{issue.identifier}
												</span>
												<span className="min-w-0 flex-1 truncate">{issue.title}</span>
												<ProviderIcon provider={issue.provider} />
											</button>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Context menu */}
			{contextMenu && (
				<IssueContextMenu
					position={contextMenu.position}
					issue={contextMenu.issue}
					workspaces={contextMenu.workspaces}
					states={contextMenu.issue.provider === "jira" ? jiraTransitions : linearStates}
					statesLoading={
						contextMenu.issue.provider === "jira" ? jiraTransitionsLoading : linearStatesLoading
					}
					openInLabel={contextMenu.issue.provider === "jira" ? "Open in Jira" : "Open in Linear"}
					onClose={() => setContextMenu(null)}
					onStateUpdate={(stateOrTransitionId) => {
						if (contextMenu.issue.provider === "jira") {
							updateJiraStatus.mutate({
								issueKey: contextMenu.issue.id,
								transitionId: stateOrTransitionId,
							});
						} else {
							updateLinearState.mutate({
								issueId: contextMenu.issue.id,
								stateId: stateOrTransitionId,
							});
						}
					}}
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

**Step 2: Run type-check to verify**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/TicketsTab.tsx
git commit -m "feat: create unified TicketsTab component"
```

---

### Task 4: Create the PullRequestsTab component

**Files:**
- Create: `apps/desktop/src/renderer/components/PullRequestsTab.tsx`

This component merges Bitbucket PRs + GitHub PRs, groups by repo, and renders them with collapsible group headers.

**Step 1: Create PullRequestsTab.tsx**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CreateWorktreeFromPRModal } from "./CreateWorktreeFromPRModal";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

// ── Unified PR type ─────────────────────────────────────────────────────────

interface MergedPR {
	provider: "github" | "bitbucket";
	id: string; // unique key for React
	number: number;
	title: string;
	url: string;
	state: "open" | "merged" | "closed";
	isDraft: boolean;
	repoKey: string; // "owner/repo" for grouping
	repoDisplay: string; // same, for display
	// GitHub-specific
	githubPR?: GitHubPR;
	reviewDecision?: GitHubPR["reviewDecision"];
	commentCount?: number;
	// Bitbucket-specific
	bitbucketPR?: BitbucketPullRequest;
}

// ── State dot ───────────────────────────────────────────────────────────────

function PRStateDot({ state }: { state: MergedPR["state"] }) {
	const colors = {
		open: "bg-[#32d74b]", // green
		merged: "bg-[#da77f2]", // purple
		closed: "bg-[#ff453a]", // red
	};
	return <span className={`size-1.5 shrink-0 rounded-full ${colors[state]}`} />;
}

// ── Provider icons ──────────────────────────────────────────────────────────

function GitHubIcon() {
	return (
		<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-40">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

function BitbucketIcon() {
	return (
		<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-40">
			<path d="M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
		</svg>
	);
}

function PRProviderIcon({ provider }: { provider: "github" | "bitbucket" }) {
	return provider === "github" ? <GitHubIcon /> : <BitbucketIcon />;
}

// ── Review badge (GitHub only) ──────────────────────────────────────────────

function ReviewBadge({ decision }: { decision: GitHubPR["reviewDecision"] }) {
	if (!decision) return null;
	const config = {
		approved: { label: "Approved", color: "text-green-400" },
		changes_requested: { label: "Changes", color: "text-red-400" },
		review_required: { label: "Review", color: "text-yellow-400" },
	} as const;
	const { label, color } = config[decision];
	return <span className={`shrink-0 text-[10px] font-medium ${color}`}>{label}</span>;
}

// ── Group header ────────────────────────────────────────────────────────────

function GroupHeader({
	name,
	provider,
	count,
	isCollapsed,
	onToggle,
}: {
	name: string;
	provider: "github" | "bitbucket";
	count: number;
	isCollapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] transition-colors hover:text-[var(--text-tertiary)]"
		>
			<svg
				aria-hidden="true"
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				className={`shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
			>
				<path
					d="M3 1.5L7 5L3 8.5"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<PRProviderIcon provider={provider} />
			<span>{name}</span>
			{count > 0 && <span className="ml-auto text-[10px] tabular-nums">{count}</span>}
		</button>
	);
}

// ── Main component ──────────────────────────────────────────────────────────

export function PullRequestsTab() {
	const utils = trpc.useUtils();
	const [openModalPR, setOpenModalPR] = useState<GitHubPR | null>(null);
	const [linkError, setLinkError] = useState<string | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		pr: MergedPR;
		workspaces: LinkedWorkspace[];
	} | null>(null);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;
	const toggleDiffPanel = useTabStore((s) => s.toggleDiffPanel);

	// ── Data queries ────────────────────────────────────────────────────────

	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: githubStatus } = trpc.github.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});

	const hasBitbucket = atlassianStatus?.bitbucket.connected === true;
	const hasGitHub = githubStatus?.connected === true;

	const { data: bbMyPRs } = trpc.atlassian.getMyPullRequests.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
		enabled: hasBitbucket,
	});
	const { data: bbReviewPRs } = trpc.atlassian.getReviewRequests.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
		enabled: hasBitbucket,
	});
	const { data: ghPRs } = trpc.github.getMyPRs.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
		enabled: hasGitHub,
	});

	// ── Linked PRs (GitHub only — Bitbucket has no linking yet) ─────────────

	const { data: linkedPRs } = trpc.github.getLinkedPRs.useQuery(undefined, {
		staleTime: 30_000,
		enabled: hasGitHub,
	});
	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedPRs) return map;
		for (const l of linkedPRs) {
			if (l.worktreePath === null) continue;
			const key = `${l.prRepoOwner}/${l.prRepoName}#${l.prNumber}`;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const existing = map.get(key);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(key, [entry]);
			}
		}
		return map;
	}, [linkedPRs]);

	// ── Collapsed groups (shared persistence with TicketsTab) ────────────────

	const { data: savedCollapsed } = trpc.tickets.getCollapsedGroups.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setCollapsedMutation = trpc.tickets.setCollapsedGroups.useMutation();
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

	useEffect(() => {
		if (savedCollapsed) {
			setCollapsedGroups(new Set(savedCollapsed));
		}
	}, [savedCollapsed]);

	const toggleGroup = useCallback(
		(groupKey: string) => {
			setCollapsedGroups((prev) => {
				const next = new Set(prev);
				if (next.has(groupKey)) {
					next.delete(groupKey);
				} else {
					next.add(groupKey);
				}
				setCollapsedMutation.mutate({ groups: [...next] });
				return next;
			});
		},
		[setCollapsedMutation]
	);

	// ── Merge + group ───────────────────────────────────────────────────────

	const grouped = useMemo(() => {
		const merged: MergedPR[] = [];

		// Bitbucket PRs
		const allBbPRs = [...(bbMyPRs ?? []), ...(bbReviewPRs ?? [])];
		const seenBb = new Set<string>();
		for (const pr of allBbPRs) {
			const key = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
			if (seenBb.has(key)) continue;
			seenBb.add(key);
			merged.push({
				provider: "bitbucket",
				id: `bb-${pr.workspace}-${pr.repoSlug}-${pr.id}`,
				number: pr.id,
				title: pr.title,
				url: pr.webUrl,
				state: pr.state === "MERGED" ? "merged" : pr.state === "DECLINED" ? "closed" : "open",
				isDraft: false,
				repoKey: `${pr.workspace}/${pr.repoSlug}`,
				repoDisplay: `${pr.workspace}/${pr.repoSlug}`,
				bitbucketPR: pr,
			});
		}

		// GitHub PRs
		for (const pr of ghPRs ?? []) {
			merged.push({
				provider: "github",
				id: `gh-${pr.repoOwner}-${pr.repoName}-${pr.number}`,
				number: pr.number,
				title: pr.title,
				url: pr.url,
				state: pr.state === "closed" ? "closed" : "open",
				isDraft: pr.isDraft,
				repoKey: `${pr.repoOwner}/${pr.repoName}`,
				repoDisplay: `${pr.repoOwner}/${pr.repoName}`,
				githubPR: pr,
				reviewDecision: pr.reviewDecision,
				commentCount: pr.commentCount,
			});
		}

		// Group by repo
		const groups = new Map<string, { name: string; provider: "github" | "bitbucket"; items: MergedPR[] }>();
		for (const pr of merged) {
			const existing = groups.get(pr.repoKey);
			if (existing) {
				existing.items.push(pr);
			} else {
				groups.set(pr.repoKey, {
					name: pr.repoDisplay,
					provider: pr.provider,
					items: [pr],
				});
			}
		}

		return groups;
	}, [bbMyPRs, bbReviewPRs, ghPRs]);

	// ── Navigation (GitHub linked PRs) ──────────────────────────────────────

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace, pr: MergedPR) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

		if (pr.githubPR) {
			const prCtx: import("../../shared/github-types").GitHubPRContext = {
				owner: pr.githubPR.repoOwner,
				repo: pr.githubPR.repoName,
				number: pr.githubPR.number,
				title: pr.githubPR.title,
				sourceBranch: pr.githubPR.branchName,
				targetBranch: "main",
				repoPath: ws.worktreePath,
			};
			store.openPRReviewPanel(ws.workspaceId, prCtx);
		}

		const existing = store.getTabsByWorkspace(ws.workspaceId);
		const hasTerminal = existing.some((t) => t.kind === "terminal");
		if (!hasTerminal) {
			const title = ws.workspaceName ?? ws.workspaceId;
			const tabId = store.addTerminalTab(ws.workspaceId, ws.worktreePath, title);
			attachTerminalRef.current({ workspaceId: ws.workspaceId, terminalId: tabId });
		}
	}, []);

	const handleGitHubLink = async (pr: GitHubPR) => {
		const projects = await utils.github.getProjectsByRepo.fetch({
			owner: pr.repoOwner,
			repo: pr.repoName,
		});
		if (projects.length === 0) {
			setLinkError(`Repository ${pr.repoOwner}/${pr.repoName} is not tracked in BranchFlux.`);
			return;
		}
		setLinkError(null);
		setOpenModalPR(pr);
	};

	// ── Loading ─────────────────────────────────────────────────────────────

	const isLoading = (hasBitbucket && !bbMyPRs && !bbReviewPRs) || (hasGitHub && !ghPRs);

	if (!hasBitbucket && !hasGitHub) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
				No PR services connected
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	if (grouped.size === 0) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
				No pull requests
			</div>
		);
	}

	return (
		<>
			{linkError && (
				<div className="mx-3 my-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] text-red-400">
					{linkError}
				</div>
			)}

			<div className="flex flex-col">
				{[...grouped.entries()].map(([repoKey, group]) => {
					const isCollapsed = collapsedGroups.has(repoKey);
					return (
						<div key={repoKey}>
							<GroupHeader
								name={group.name}
								provider={group.provider}
								count={group.items.length}
								isCollapsed={isCollapsed}
								onToggle={() => toggleGroup(repoKey)}
							/>
							{!isCollapsed && (
								<div className="flex flex-col gap-0.5">
									{group.items.map((pr) => {
										const linkKey =
											pr.provider === "github"
												? `${pr.githubPR!.repoOwner}/${pr.githubPR!.repoName}#${pr.githubPR!.number}`
												: undefined;
										const linked = linkKey ? linkedMap.get(linkKey) : undefined;
										const isLinked = !!linked && linked.length > 0;

										return (
											<button
												key={pr.id}
												type="button"
												onClick={(e) => {
													if (pr.provider === "bitbucket" && pr.bitbucketPR) {
														window.electron.shell.openExternal(pr.url);
													} else if (pr.githubPR) {
														if (!isLinked) {
															handleGitHubLink(pr.githubPR);
														} else if (linked!.length === 1 && linked![0]) {
															navigateToWorkspace(linked![0], pr);
														} else {
															const rect = e.currentTarget.getBoundingClientRect();
															setPopover({
																position: { x: rect.left, y: rect.bottom + 4 },
																pr,
																workspaces: linked!,
															});
														}
													}
												}}
												className={`flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
													isLinked
														? "text-[var(--text-secondary)]"
														: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
												}`}
												title={`${pr.repoDisplay}#${pr.number}: ${pr.title}`}
											>
												<PRStateDot state={pr.state} />
												<span
													className={`shrink-0 font-mono text-[11px] ${
														isLinked
															? "font-medium text-[var(--accent)]"
															: "font-medium text-[var(--text-quaternary)]"
													}`}
												>
													#{pr.number}
												</span>
												{pr.isDraft && (
													<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
														[Draft]
													</span>
												)}
												<span className="min-w-0 flex-1 truncate">{pr.title}</span>
												{pr.reviewDecision && <ReviewBadge decision={pr.reviewDecision} />}
												<PRProviderIcon provider={pr.provider} />
											</button>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{popover && (
				<WorkspacePopover
					position={popover.position}
					workspaces={popover.workspaces}
					onClose={() => setPopover(null)}
					onCreateBranch={() => {
						setPopover(null);
						if (popover.pr.githubPR) {
							handleGitHubLink(popover.pr.githubPR);
						}
					}}
				/>
			)}

			<CreateWorktreeFromPRModal pr={openModalPR} onClose={() => setOpenModalPR(null)} />
		</>
	);
}
```

**Step 2: Run type-check to verify**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat: create unified PullRequestsTab component"
```

---

### Task 5: Create the UnifiedTicketsSection component

**Files:**
- Create: `apps/desktop/src/renderer/components/UnifiedTicketsSection.tsx`

This is the container component with the `SectionHeader` and segmented control.

**Step 1: Create UnifiedTicketsSection.tsx**

```tsx
import { useProjectStore } from "../stores/projects";
import { PullRequestsTab } from "./PullRequestsTab";
import { SectionHeader } from "./SectionHeader";
import { TicketsTab } from "./TicketsTab";

export function UnifiedTicketsSection() {
	const ticketsPrTab = useProjectStore((s) => s.ticketsPrTab);
	const setTicketsPrTab = useProjectStore((s) => s.setTicketsPrTab);
	const [isOpen, setIsOpen] = useState(true);

	return (
		<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
			<SectionHeader
				label="Tickets & PRs"
				isOpen={isOpen}
				onToggle={() => setIsOpen(!isOpen)}
			/>

			{isOpen && (
				<>
					{/* Segmented control */}
					<div className="px-3 pb-2 pt-1">
						<div className="flex rounded-[6px] bg-[var(--bg-base)] p-0.5">
							<button
								type="button"
								onClick={() => setTicketsPrTab("tickets")}
								className={`flex-1 rounded-[5px] px-3 py-1 text-[11px] font-medium transition-all duration-[120ms] ${
									ticketsPrTab === "tickets"
										? "bg-[var(--bg-elevated)] text-[var(--text)]"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								Tickets
							</button>
							<button
								type="button"
								onClick={() => setTicketsPrTab("prs")}
								className={`flex-1 rounded-[5px] px-3 py-1 text-[11px] font-medium transition-all duration-[120ms] ${
									ticketsPrTab === "prs"
										? "bg-[var(--bg-elevated)] text-[var(--text)]"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								Pull Requests
							</button>
						</div>
					</div>

					{/* Active tab */}
					{ticketsPrTab === "tickets" ? <TicketsTab /> : <PullRequestsTab />}
				</>
			)}
		</div>
	);
}
```

Wait — missing `useState` import. The file needs:

```tsx
import { useState } from "react";
import { useProjectStore } from "../stores/projects";
import { PullRequestsTab } from "./PullRequestsTab";
import { SectionHeader } from "./SectionHeader";
import { TicketsTab } from "./TicketsTab";

export function UnifiedTicketsSection() {
	const ticketsPrTab = useProjectStore((s) => s.ticketsPrTab);
	const setTicketsPrTab = useProjectStore((s) => s.setTicketsPrTab);
	const [isOpen, setIsOpen] = useState(true);

	return (
		<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
			<SectionHeader
				label="Tickets & PRs"
				isOpen={isOpen}
				onToggle={() => setIsOpen(!isOpen)}
			/>

			{isOpen && (
				<>
					{/* Segmented control */}
					<div className="px-3 pb-2 pt-1">
						<div className="flex rounded-[6px] bg-[var(--bg-base)] p-0.5">
							<button
								type="button"
								onClick={() => setTicketsPrTab("tickets")}
								className={`flex-1 rounded-[5px] px-3 py-1 text-[11px] font-medium transition-all duration-[120ms] ${
									ticketsPrTab === "tickets"
										? "bg-[var(--bg-elevated)] text-[var(--text)]"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								Tickets
							</button>
							<button
								type="button"
								onClick={() => setTicketsPrTab("prs")}
								className={`flex-1 rounded-[5px] px-3 py-1 text-[11px] font-medium transition-all duration-[120ms] ${
									ticketsPrTab === "prs"
										? "bg-[var(--bg-elevated)] text-[var(--text)]"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								Pull Requests
							</button>
						</div>
					</div>

					{/* Active tab */}
					{ticketsPrTab === "tickets" ? <TicketsTab /> : <PullRequestsTab />}
				</>
			)}
		</div>
	);
}
```

**Step 2: Run type-check to verify**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/UnifiedTicketsSection.tsx
git commit -m "feat: create UnifiedTicketsSection with segmented control"
```

---

### Task 6: Wire up the Sidebar

**Files:**
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`

Replace the three separate integration panel imports and usages with the single `UnifiedTicketsSection`.

**Step 1: Update Sidebar.tsx**

Replace imports (lines 2-4):
```tsx
// Remove these three imports:
import { AtlassianPanel } from "./AtlassianPanel";
import { GitHubPanel } from "./GitHubPanel";
import { LinearPanel } from "./LinearPanel";

// Add this import:
import { UnifiedTicketsSection } from "./UnifiedTicketsSection";
```

Replace the three panel usages (lines 64-66):
```tsx
// Remove these three lines:
<AtlassianPanel />
<LinearPanel />
<GitHubPanel />

// Replace with:
<UnifiedTicketsSection />
```

The full updated `Sidebar.tsx` should be:

```tsx
import { useProjectStore } from "../stores/projects";
import { ProjectList } from "./ProjectList";
import { SettingsView } from "./SettingsView";
import { UnifiedTicketsSection } from "./UnifiedTicketsSection";

export function Sidebar() {
	const { openAddModal, sidebarView, openSettings } = useProjectStore();

	return (
		<aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			{/* Traffic light clearance — empty drag region */}
			<div
				className="shrink-0"
				style={
					{
						height: 52,
						WebkitAppRegion: "drag",
					} as React.CSSProperties
				}
			/>

			{sidebarView === "settings" ? (
				<SettingsView />
			) : (
				<>
					{/* Wordmark */}
					<div className="px-4 pb-6">
						<span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-quaternary)]">
							BranchFlux
						</span>
					</div>

					{/* Add Repository */}
					<div className="px-2 pb-2">
						<button
							type="button"
							onClick={openAddModal}
							className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
						>
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								className="shrink-0"
							>
								<path
									d="M8 3v10M3 8h10"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
							</svg>
							Add Repository
						</button>
					</div>

					{/* Project list + Unified tickets/PRs */}
					<div className="flex-1 overflow-y-auto py-1">
						<ProjectList />
						<UnifiedTicketsSection />
					</div>

					{/* Footer — Settings button */}
					<div className="border-t border-[var(--border-subtle)] p-2">
						<button
							type="button"
							onClick={openSettings}
							className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
						>
							<svg
								aria-hidden="true"
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="shrink-0"
							>
								<circle cx="12" cy="12" r="3" />
								<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
							</svg>
							Settings
						</button>
					</div>
				</>
			)}
		</aside>
	);
}
```

**Step 2: Run type-check to verify**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat: replace integration panels with UnifiedTicketsSection"
```

---

### Task 7: Final lint and verify

**Step 1: Run biome check**

Run: `cd apps/desktop && bunx biome check --write .`
Expected: All files formatted and linted

**Step 2: Run type-check**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: PASS

**Step 3: Run dev to visual verify**

Run: `bun run dev` (from repo root)
Expected: App launches, sidebar shows "Tickets & PRs" section with segmented control. Switching between tabs shows unified ticket/PR lists grouped by project.

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint and format"
```
