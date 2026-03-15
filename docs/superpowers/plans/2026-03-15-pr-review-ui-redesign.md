# PR Review UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the PR review UI from a cramped single-panel layout to a three-zone hybrid architecture: segmented left sidebar, minimal right control rail, and full-width dashboard tab.

**Architecture:** Left sidebar gets a segmented control (Repos | Tickets | PRs) so each section uses the full sidebar height. The right panel becomes a slim file navigator with AI badge and submit button. A new PR Overview dashboard tab opens in the main content area with the AI summary, comment feed, and full PR details.

**Tech Stack:** React 19, Zustand, TanStack Query, tRPC, Tailwind CSS v4, existing design tokens from `styles.css`.

**Spec:** `docs/superpowers/specs/2026-03-15-pr-review-ui-redesign.md`

---

## Chunk 1: Tab Store & Data Layer

### Task 1: Replace `ai-review-summary` tab type with `pr-overview` in tab-store

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts:39-45` (TabItem union), `:92-99` (interface), `:336-396` (implementations)

- [ ] **Step 1: Update the `TabItem` union type**

In `tab-store.ts`, replace the `ai-review-summary` variant (lines 39-45) with:

```typescript
| {
		kind: "pr-overview";
		id: string;
		workspaceId: string;
		title: string;
		prCtx: GitHubPRContext;
  }
```

- [ ] **Step 2: Update the `TabStore` interface**

Replace `openAIReviewSummary` (line 99) with:

```typescript
openPROverview: (workspaceId: string, prCtx: GitHubPRContext) => string;
```

- [ ] **Step 3: Update `openPRReviewPanel` to also open the dashboard tab**

Replace the implementation at line 336-338:

```typescript
openPRReviewPanel: (workspaceId, prCtx) => {
	set({ rightPanel: { open: true, mode: "pr-review", diffCtx: null, prCtx } });
	// Also open the PR Overview dashboard tab
	get().openPROverview(workspaceId, prCtx);
},
```

- [ ] **Step 4: Replace `openAIReviewSummary` with `openPROverview`**

Replace the implementation at lines 372-396:

```typescript
openPROverview: (workspaceId, prCtx) => {
	const found = findTabInWorkspace(
		workspaceId,
		(t) =>
			t.kind === "pr-overview" &&
			t.prCtx.owner === prCtx.owner &&
			t.prCtx.repo === prCtx.repo &&
			t.prCtx.number === prCtx.number
	);
	if (found) {
		ps().setActiveTabInPane(workspaceId, found.pane.id, found.tab.id);
		ps().setFocusedPane(found.pane.id);
		return found.tab.id;
	}
	const id = nextFileTabId();
	const tab: TabItem = {
		kind: "pr-overview",
		id,
		workspaceId,
		title: `PR: ${prCtx.title}`,
		prCtx,
	};
	ps().ensureLayout(workspaceId);
	const focused = resolveFocusedPane(workspaceId);
	if (focused) {
		ps().addTabToPane(workspaceId, focused.id, tab);
	}
	return id;
},
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -30`

Expected: Errors in files that still reference `ai-review-summary` or `openAIReviewSummary` (PaneContent, PRReviewPanel, App). These will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts
git commit -m "refactor(tab-store): replace ai-review-summary tab type with pr-overview"
```

---

### Task 2: Update session serialization and PaneContent for new tab type

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx:25-76` (serialize/deserialize)
- Modify: `apps/desktop/src/renderer/components/panes/PaneContent.tsx:2,73-77`

- [ ] **Step 1: Update `deserializeLayout` to filter stale `ai-review-summary` tabs**

In `App.tsx`, in the `deserializeLayout` function (line 48-57), update the mapping logic to filter out old `ai-review-summary` tabs:

```typescript
.map((saved) => {
	if (saved.kind === "terminal") {
		return terminalMap.get(saved.id) ?? null;
	}
	// Filter out stale ai-review-summary tabs from previous sessions
	if ((saved as any).kind === "ai-review-summary") {
		return null;
	}
	return saved;
})
```

- [ ] **Step 2: Update PaneContent to render `pr-overview` tab instead of `ai-review-summary`**

In `PaneContent.tsx`, replace the import on line 2:

```typescript
import { PROverviewTab } from "../PROverviewTab";
```

Replace the rendering block at lines 73-77:

```typescript
{activeTab?.kind === "pr-overview" && (
	<div className="absolute inset-0">
		<PROverviewTab key={`${activeTab.prCtx.owner}/${activeTab.prCtx.repo}#${activeTab.prCtx.number}`} prCtx={activeTab.prCtx} />
	</div>
)}
```

- [ ] **Step 3: Create a stub `PROverviewTab` so the app compiles**

Create `apps/desktop/src/renderer/components/PROverviewTab.tsx`:

```typescript
import type { GitHubPRContext } from "../../shared/github-types";

export function PROverviewTab({ prCtx }: { prCtx: GitHubPRContext }) {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="text-[13px] text-[var(--text-quaternary)]">
				PR Overview: {prCtx.owner}/{prCtx.repo}#{prCtx.number}
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Remove old `AIReviewSummaryTab` import from `PRReviewPanel.tsx`**

In `PRReviewPanel.tsx`, remove the `openAIReviewSummary` usage. Replace lines 481-482 (`const openAIReviewSummary = ...`, `const hasSummary = ...`) and the summary button block (lines 497-510) with references to `openPROverview`:

```typescript
const openPROverview = useTabStore((s) => s.openPROverview);
```

And update the summary button (lines 497-510) to use:

```typescript
{matchingDraft?.id && activeWorkspaceId && (
	<div className="border-b border-[var(--border-subtle)] px-3 py-1.5">
		<button
			type="button"
			onClick={() => openPROverview(activeWorkspaceId, prCtx)}
			className="flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)]"
		>
			<span className="ai-badge">AI</span>
			<span>View Summary</span>
		</button>
	</div>
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -30`

Expected: Clean compile or only unrelated warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/panes/PaneContent.tsx apps/desktop/src/renderer/components/PROverviewTab.tsx apps/desktop/src/renderer/components/PRReviewPanel.tsx
git commit -m "refactor: wire up pr-overview tab type, add stub PROverviewTab"
```

---

## Chunk 2: Left Sidebar — Segmented Navigation

### Task 3: Add segmented control to the left sidebar

**Files:**
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`

- [ ] **Step 1: Add segment state and replace section rendering**

Replace the full `Sidebar` component content. The key changes:
- Add a `segment` state: `"repos" | "tickets" | "prs"` defaulting to `"repos"`
- Keep "Add Repository" button above the segmented control
- Keep `ProjectList` above the segmented control (always visible for workspace selection)
- Render the segmented control bar
- Conditionally render `TicketsTab` or `PullRequestsTab` based on segment (repos segment shows nothing extra since `ProjectList` is always visible)

```typescript
import { useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectList } from "./ProjectList";
import { PullRequestsTab } from "./PullRequestsTab";
import { SettingsView } from "./SettingsView";
import { SidebarRail } from "./SidebarRail";
import { TicketsTab } from "./TicketsTab";

type SidebarSegment = "repos" | "tickets" | "prs";

interface SidebarProps {
	collapsed: boolean;
	onExpand: (section?: "tickets" | "prs") => void;
}

export function Sidebar({ collapsed, onExpand }: SidebarProps) {
	const { openAddModal, sidebarView, openSettings } = useProjectStore();
	const [segment, setSegment] = useState<SidebarSegment>("repos");

	// Check if any AI reviews need attention (ready or failed)
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, { staleTime: 5_000 });
	const hasAINotification = (reviewDraftsQuery.data ?? []).some(
		(d) => d.status === "ready" || d.status === "failed"
	);

	const handleExpand = (section?: "tickets" | "prs") => {
		onExpand(section);
		if (section === "tickets") {
			setSegment("tickets");
		} else if (section === "prs") {
			setSegment("prs");
		}
	};

	if (collapsed) {
		return <SidebarRail onExpand={handleExpand} />;
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{/* Traffic light clearance */}
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
							<span className="truncate">Add Repository</span>
						</button>
					</div>

					{/* Project list — always visible */}
					<div className="overflow-y-auto border-b border-[var(--border-subtle)]">
						<ProjectList />
					</div>

					{/* Segmented control */}
					<div className="flex gap-1 px-2 py-1.5 border-b border-[var(--border-subtle)]">
						{(["repos", "tickets", "prs"] as const).map((seg) => (
							<button
								key={seg}
								type="button"
								onClick={() => setSegment(seg)}
								className={`relative flex-1 rounded-[5px] py-1 text-[10px] font-medium capitalize transition-colors ${
									segment === seg
										? "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
										: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
								}`}
							>
								{seg === "prs" ? "PRs" : seg.charAt(0).toUpperCase() + seg.slice(1)}
								{seg === "prs" && hasAINotification && segment !== "prs" && (
									<span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-[#30d158]" />
								)}
							</button>
						))}
					</div>

					{/* Segment content */}
					<div className="flex-1 overflow-y-auto">
						{segment === "tickets" && <TicketsTab />}
						{segment === "prs" && <PullRequestsTab />}
					</div>

					{/* Footer — Settings */}
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
							<span className="truncate">Settings</span>
						</button>
					</div>
				</>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Verify the app runs**

Run: `cd /Users/thomas//worktrees/BranchFlux/automatic-pr-review && bun run dev`

Check: Left sidebar shows ProjectList always visible, segmented control below, switching segments shows correct content.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(sidebar): add segmented control for Repos/Tickets/PRs"
```

---

## Chunk 3: Right Sidebar — Control Rail

### Task 4: Create `PRControlRail` component

**Files:**
- Create: `apps/desktop/src/renderer/components/PRControlRail.tsx`

- [ ] **Step 1: Create the control rail component**

Create `apps/desktop/src/renderer/components/PRControlRail.tsx` with the minimal navigator design:

```typescript
import { useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type { AIDraftThread, GitHubPRContext } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { SubmitReviewModal } from "./SubmitReviewModal";

function StatusLine({ details }: { details: { reviewDecision: string | null; ciState: string | null } }) {
	const dotColor = {
		APPROVED: "bg-green-400",
		CHANGES_REQUESTED: "bg-red-400",
		REVIEW_REQUIRED: "bg-yellow-400",
	}[details.reviewDecision ?? ""] ?? "bg-[var(--text-quaternary)]";

	const ciLabel = details.ciState === "SUCCESS" ? "CI ✓"
		: details.ciState === "FAILURE" ? "CI ✗"
		: details.ciState === "PENDING" ? "CI ●"
		: "";

	const decisionLabel = (details.reviewDecision ?? "").replace(/_/g, " ").toLowerCase() || "no reviews";

	return (
		<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
			<div className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
			<span className="truncate text-[10px] text-[var(--text-tertiary)] capitalize">{decisionLabel}</span>
			{ciLabel && (
				<>
					<span className="text-[10px] text-[var(--text-quaternary)]">·</span>
					<span className={`text-[10px] ${details.ciState === "SUCCESS" ? "text-[var(--term-green)]" : details.ciState === "FAILURE" ? "text-[var(--term-red)]" : "text-yellow-400"}`}>{ciLabel}</span>
				</>
			)}
		</div>
	);
}

function FileNavigator({
	files,
	viewedFiles,
	activeFilePath,
	threadCountByFile,
	onFileClick,
	onToggleViewed,
}: {
	files: Array<{ path: string; additions: number; deletions: number }>;
	viewedFiles: Set<string>;
	activeFilePath: string | null;
	threadCountByFile: Map<string, number>;
	onFileClick: (path: string) => void;
	onToggleViewed: (path: string, viewed: boolean) => void;
}) {
	const viewed = viewedFiles.size;
	const total = files.length;

	return (
		<div className="flex flex-1 flex-col overflow-hidden border-b border-[var(--border-subtle)]">
			{/* Progress bar */}
			<div className="flex items-center gap-2 px-3 py-1.5">
				<div className="h-0.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
					<div
						className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
						style={{ width: total > 0 ? `${(viewed / total) * 100}%` : "0%" }}
					/>
				</div>
				<span className="shrink-0 text-[9px] text-[var(--text-quaternary)]">{viewed}/{total}</span>
			</div>

			{/* File rows */}
			<div className="flex-1 overflow-y-auto">
				{files.map((file) => {
					const isViewed = viewedFiles.has(file.path);
					const isActive = file.path === activeFilePath;
					const commentCount = threadCountByFile.get(file.path) ?? 0;
					const filename = file.path.split("/").pop() ?? file.path;

					return (
						<div
							key={file.path}
							className={`flex cursor-pointer items-center gap-1.5 px-3 py-1 transition-colors hover:bg-[var(--bg-elevated)] ${
								isActive ? "border-l-2 border-[var(--accent)] bg-[rgba(10,132,255,0.06)] pl-2.5" : ""
							}`}
							onClick={() => onFileClick(file.path)}
							onKeyDown={() => {}}
							role="button"
							tabIndex={0}
						>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onToggleViewed(file.path, !isViewed);
								}}
								className={`shrink-0 text-[9px] ${isViewed ? "text-[var(--term-green)]" : "text-[var(--text-quaternary)]"}`}
							>
								{isViewed ? "✓" : "○"}
							</button>
							<span
								className={`flex-1 truncate font-mono text-[10px] ${
									isViewed ? "text-[var(--text-quaternary)] line-through" : "text-[var(--text-secondary)]"
								}`}
							>
								{filename}
							</span>
							{commentCount > 0 && (
								<span className="shrink-0 text-[9px] font-semibold text-yellow-400">{commentCount}</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Main Component ──────────────────────────────────────────────────────────

export function PRControlRail({ prCtx }: { prCtx: GitHubPRContext }) {
	const [showSubmitModal, setShowSubmitModal] = useState(false);
	const utils = trpc.useUtils();
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const openPROverview = useTabStore((s) => s.openPROverview);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	// Data queries
	const { data: details } = trpc.github.getPRDetails.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);
	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, { staleTime: 5_000 });
	const matchingDraft = reviewDraftsQuery.data?.find((d) => d.prIdentifier === prIdentifier);
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id }
	);

	const markViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: () =>
			utils.github.getViewedFiles.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	const viewedFiles = new Set(viewedFilesList ?? []);

	// Build thread counts
	const threadCountByFile = new Map<string, number>();
	if (details) {
		for (const t of details.reviewThreads) {
			if (!t.isResolved) {
				threadCountByFile.set(t.path, (threadCountByFile.get(t.path) ?? 0) + 1);
			}
		}
	}
	const aiComments = aiDraftQuery.data?.comments ?? [];
	for (const c of aiComments) {
		if (c.status === "pending" || c.status === "edited") {
			threadCountByFile.set(c.filePath, (threadCountByFile.get(c.filePath) ?? 0) + 1);
		}
	}

	const pendingAICount = aiComments.filter((c) => c.status === "pending" || c.status === "edited").length;
	const acceptedAICount = aiComments.filter((c) => c.status === "approved").length;

	// Map AI comments to AIDraftThread for the submit modal
	const mapComment = (c: (typeof aiComments)[number]): AIDraftThread => ({
		id: `ai-${c.id}`,
		isAIDraft: true as const,
		draftCommentId: c.id,
		path: c.filePath,
		line: c.lineNumber,
		diffSide: (c.side as "LEFT" | "RIGHT") ?? "RIGHT",
		body: c.body,
		status: c.status as AIDraftThread["status"],
		userEdit: c.userEdit ?? null,
		createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
	});

	const acceptedAiThreads = aiComments.filter((c) => c.status === "approved").map(mapComment);

	if (!details) {
		return (
			<div className="flex h-full flex-col gap-2 p-3">
				{[1, 2, 3].map((i) => (
					<div key={i} className="h-3 w-full animate-pulse rounded bg-[var(--bg-elevated)]" />
				))}
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<StatusLine details={details} />
			<FileNavigator
				files={details.files}
				viewedFiles={viewedFiles}
				activeFilePath={null}
				threadCountByFile={threadCountByFile}
				onFileClick={(path) => {
					if (!activeWorkspaceId) return;
					openPRReviewFile(activeWorkspaceId, prCtx, path, detectLanguage(path));
				}}
				onToggleViewed={(path, viewed) =>
					markViewed.mutate({
						owner: prCtx.owner,
						repo: prCtx.repo,
						number: prCtx.number,
						filePath: path,
						viewed,
					})
				}
			/>

			{/* AI suggestions badge */}
			{pendingAICount > 0 && (
				<button
					type="button"
					onClick={() => {
						if (activeWorkspaceId) openPROverview(activeWorkspaceId, prCtx);
					}}
					className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]"
				>
					<span className="ai-badge">AI</span>
					<span className="flex-1 text-[10px] text-[var(--text-tertiary)]">{pendingAICount} suggestion{pendingAICount !== 1 ? "s" : ""}</span>
					<span className="text-[10px] text-[var(--text-quaternary)]">›</span>
				</button>
			)}

			{/* Submit review */}
			<div className="p-3">
				{(acceptedAICount > 0) && (
					<div className="mb-2 text-[10px] text-[var(--text-quaternary)]">
						{acceptedAICount} accepted
					</div>
				)}
				<button
					type="button"
					onClick={() => setShowSubmitModal(true)}
					className="w-full rounded-[5px] border border-[rgba(48,209,88,0.15)] bg-[rgba(48,209,88,0.12)] py-1.5 text-[10px] font-semibold text-[#30d158] transition-colors hover:bg-[rgba(48,209,88,0.2)]"
				>
					Submit Review
				</button>
			</div>

			{showSubmitModal && (
				<SubmitReviewModal
					prCtx={prCtx}
					aiThreads={acceptedAiThreads}
					pendingCount={pendingAICount}
					headCommitOid={details.headCommitOid}
					onClose={() => setShowSubmitModal(false)}
					onSubmitted={() => {
						setShowSubmitModal(false);
						utils.github.getPRDetails.invalidate({
							owner: prCtx.owner,
							repo: prCtx.repo,
							number: prCtx.number,
						});
						utils.github.getMyPRs.invalidate();
						aiDraftQuery.refetch();
					}}
				/>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Create a stub `SubmitReviewModal` so the app compiles**

Create `apps/desktop/src/renderer/components/SubmitReviewModal.tsx`:

```typescript
import type { AIDraftThread, GitHubPRContext } from "../../shared/github-types";

interface SubmitReviewModalProps {
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
	pendingCount: number;
	headCommitOid: string;
	onClose: () => void;
	onSubmitted: () => void;
}

export function SubmitReviewModal(_props: SubmitReviewModalProps) {
	return null; // Implemented in Task 6
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/PRControlRail.tsx apps/desktop/src/renderer/components/SubmitReviewModal.tsx
git commit -m "feat: add PRControlRail component with file navigator and AI badge"
```

---

### Task 5: Wire `PRControlRail` into `DiffPanel`

**Files:**
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx:300-306`

- [ ] **Step 1: Replace `PRReviewPanel` with `PRControlRail` in DiffPanel**

In `DiffPanel.tsx`, update the import to replace `PRReviewPanel` with `PRControlRail`:

Replace the import of `PRReviewPanel` with:

```typescript
import { PRControlRail } from "./PRControlRail";
```

Then replace the PR review rendering block (lines 300-306):

```typescript
if (rightPanel.mode === "pr-review" && rightPanel.prCtx) {
	return (
		<div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{onClose && <PanelEdgeClose onClose={onClose} />}
			<PRControlRail prCtx={rightPanel.prCtx} />
		</div>
	);
}
```

- [ ] **Step 2: Verify the app runs and the right panel shows the control rail**

Run: `cd /Users/thomas//worktrees/BranchFlux/automatic-pr-review && bun run dev`

Check: Click a PR, right panel shows the slim control rail with status, files, and submit button.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/DiffPanel.tsx
git commit -m "feat: wire PRControlRail into DiffPanel replacing PRReviewPanel"
```

---

## Chunk 4: PR Overview Dashboard Tab

### Task 6: Build the `PROverviewTab` component

**Files:**
- Modify: `apps/desktop/src/renderer/components/PROverviewTab.tsx` (replace stub)

- [ ] **Step 1: Implement the full PR Overview dashboard**

Replace the stub with the full implementation. This component has three sections: PR Header, AI Summary Card, and Unified Comments Feed.

```typescript
import { useState } from "react";
import type { AIDraftThread, GitHubPRContext, GitHubPRDetails, UnifiedThread } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { detectLanguage } from "../../shared/diff-types";

// ── PR Header ───────────────────────────────────────────────────────────────

function PRHeader({ details, prCtx }: { details: GitHubPRDetails; prCtx: GitHubPRContext }) {
	const decisionStyle: Record<string, string> = {
		APPROVED: "bg-[rgba(48,209,88,0.08)] border-[rgba(48,209,88,0.12)] text-[#30d158]",
		CHANGES_REQUESTED: "bg-[rgba(255,69,58,0.08)] border-[rgba(255,69,58,0.12)] text-[#ff453a]",
		REVIEW_REQUIRED: "bg-[rgba(255,214,10,0.08)] border-[rgba(255,214,10,0.12)] text-[#fbbf24]",
	};
	const ciStyle = details.ciState === "SUCCESS"
		? "bg-[rgba(48,209,88,0.08)] border-[rgba(48,209,88,0.12)] text-[#30d158]"
		: details.ciState === "FAILURE"
			? "bg-[rgba(255,69,58,0.08)] border-[rgba(255,69,58,0.12)] text-[#ff453a]"
			: "bg-[rgba(255,214,10,0.08)] border-[rgba(255,214,10,0.12)] text-yellow-400";

	return (
		<div className="mb-6">
			<h1 className="mb-1.5 text-[18px] font-semibold leading-snug text-[var(--text)]">{details.title}</h1>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-quaternary)]">
				<span>#{prCtx.number} by {details.author}</span>
				<span>·</span>
				<span>{prCtx.targetBranch} ← {prCtx.sourceBranch}</span>
				<span>·</span>
				<span>{details.files.length} files changed</span>
			</div>

			{/* Status pills */}
			<div className="mt-2.5 flex flex-wrap gap-2">
				{details.reviewDecision && (
					<div className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium ${decisionStyle[details.reviewDecision] ?? ""}`}>
						{details.reviewDecision.replace(/_/g, " ").toLowerCase()}
					</div>
				)}
				{details.ciState && (
					<div className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium ${ciStyle}`}>
						{details.ciState === "SUCCESS" ? "✓ CI passing" : details.ciState === "FAILURE" ? "✗ CI failing" : "● CI pending"}
					</div>
				)}
			</div>

			{/* Reviewers */}
			{details.reviewers.length > 0 && (
				<div className="mt-3 flex items-center gap-2">
					{details.reviewers.map((r) => (
						<div key={r.login} className="flex items-center gap-1.5">
							<div className={`flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold ${
								r.decision === "APPROVED" ? "bg-[rgba(48,209,88,0.15)] text-[#30d158]"
								: "bg-[var(--bg-elevated)] text-[var(--text-quaternary)]"
							}`}>
								{r.login.slice(0, 2).toUpperCase()}
							</div>
							<span className="text-[10px] text-[var(--text-tertiary)]">{r.login}</span>
							{r.decision === "APPROVED" && <span className="text-[9px] text-[#30d158]">approved</span>}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── AI Summary Card ─────────────────────────────────────────────────────────

function AISummaryCard({ markdown }: { markdown: string }) {
	const [collapsed, setCollapsed] = useState(false);

	return (
		<div className="mb-6 rounded-[10px] border border-[rgba(167,139,250,0.1)] bg-[rgba(167,139,250,0.04)] p-4">
			<button
				type="button"
				onClick={() => setCollapsed(!collapsed)}
				className="flex w-full items-center gap-1.5 text-left"
			>
				<span className="ai-badge">AI</span>
				<span className="flex-1 text-[12px] font-medium text-[var(--text-secondary)]">Review Summary</span>
				<span className="text-[10px] text-[var(--text-quaternary)]">{collapsed ? "▸" : "▾"}</span>
			</button>
			{!collapsed && (
				<div className="mt-2.5">
					<MarkdownRenderer content={markdown} />
				</div>
			)}
		</div>
	);
}

// ── Comment Card ────────────────────────────────────────────────────────────

function CommentCard({
	thread,
	onAccept,
	onDismiss,
	onReply,
	onResolve,
	onJumpToFile,
}: {
	thread: UnifiedThread;
	onAccept?: () => void;
	onDismiss?: () => void;
	onReply?: (body: string) => void;
	onResolve?: () => void;
	onJumpToFile: () => void;
}) {
	const [replyText, setReplyText] = useState("");
	const [showReply, setShowReply] = useState(false);

	if (thread.isAIDraft) {
		const isAccepted = thread.status === "approved";
		const isDismissed = thread.status === "rejected";
		if (isAccepted || isDismissed) return null;

		return (
			<div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-3.5 border-l-[3px] border-l-[#a78bfa]">
				<div className="mb-2 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="ai-badge">AI</span>
						<button type="button" onClick={onJumpToFile} className="font-mono text-[10px] text-[var(--text-quaternary)] underline decoration-[var(--border-subtle)] hover:text-[var(--text-tertiary)]">
							{thread.path}:{thread.line}
						</button>
					</div>
					<div className="flex gap-1.5">
						{onAccept && (
							<button type="button" onClick={onAccept} className="rounded-[4px] border border-[rgba(48,209,88,0.15)] bg-[rgba(48,209,88,0.1)] px-3 py-0.5 text-[10px] font-medium text-[#30d158]">
								Accept
							</button>
						)}
						{onDismiss && (
							<button type="button" onClick={onDismiss} className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-0.5 text-[10px] text-[var(--text-quaternary)]">
								Dismiss
							</button>
						)}
					</div>
				</div>
				<p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">{thread.userEdit ?? thread.body}</p>
			</div>
		);
	}

	// GitHub thread
	const firstComment = thread.comments[0];
	if (!firstComment) return null;

	return (
		<div className={`rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-3.5 border-l-[3px] ${
			thread.isResolved ? "border-l-[rgba(48,209,88,0.3)] opacity-50" : "border-l-[#fbbf24]"
		}`}>
			<div className="mb-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[7px] font-semibold text-[var(--text-quaternary)]">
						{firstComment.author.slice(0, 2).toUpperCase()}
					</div>
					<span className="text-[10px] text-[var(--text-tertiary)]">{firstComment.author}</span>
					<button type="button" onClick={onJumpToFile} className="font-mono text-[10px] text-[var(--text-quaternary)] underline decoration-[var(--border-subtle)] hover:text-[var(--text-tertiary)]">
						{thread.path}:{thread.line}
					</button>
					{thread.isResolved && <span className="text-[9px] text-[rgba(48,209,88,0.5)]">resolved</span>}
				</div>
				{!thread.isResolved && (
					<div className="flex gap-1.5">
						<button type="button" onClick={() => setShowReply(!showReply)} className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-0.5 text-[10px] text-[var(--text-quaternary)]">
							Reply
						</button>
						{onResolve && (
							<button type="button" onClick={onResolve} className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-0.5 text-[10px] text-[var(--text-quaternary)]">
								Resolve
							</button>
						)}
					</div>
				)}
			</div>
			{thread.comments.map((c) => (
				<p key={c.id} className="mb-1 text-[12px] leading-relaxed text-[var(--text-tertiary)]">{c.body}</p>
			))}
			{showReply && (
				<div className="mt-2 flex gap-1.5">
					<input
						type="text"
						value={replyText}
						onChange={(e) => setReplyText(e.target.value)}
						placeholder="Reply…"
						className="flex-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
					/>
					<button
						type="button"
						disabled={!replyText.trim()}
						onClick={() => {
							onReply?.(replyText.trim());
							setReplyText("");
							setShowReply(false);
						}}
						className="rounded-[4px] bg-[var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
					>
						Send
					</button>
				</div>
			)}
		</div>
	);
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function PROverviewTab({ prCtx }: { prCtx: GitHubPRContext }) {
	const utils = trpc.useUtils();
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const { data: details, isLoading } = trpc.github.getPRDetails.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, { staleTime: 5_000 });
	const matchingDraft = reviewDraftsQuery.data?.find((d) => d.prIdentifier === prIdentifier);
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id }
	);

	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: () => aiDraftQuery.refetch(),
	});
	const replyMutation = trpc.github.addReviewComment.useMutation({
		onSuccess: () => utils.github.getPRDetails.invalidate({ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number }),
	});
	const resolveMutation = trpc.github.resolveThread.useMutation({
		onSuccess: () => utils.github.getPRDetails.invalidate({ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number }),
	});

	if (isLoading || !details) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-[13px] text-[var(--text-quaternary)]">Loading…</div>
			</div>
		);
	}

	// Build unified threads
	const mapComment = (c: NonNullable<typeof aiDraftQuery.data>["comments"][number]): AIDraftThread => ({
		id: `ai-${c.id}`,
		isAIDraft: true as const,
		draftCommentId: c.id,
		path: c.filePath,
		line: c.lineNumber,
		diffSide: (c.side as "LEFT" | "RIGHT") ?? "RIGHT",
		body: c.body,
		status: c.status as AIDraftThread["status"],
		userEdit: c.userEdit ?? null,
		createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
	});

	const aiThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "pending" || c.status === "edited")
		.map(mapComment);

	const githubThreads: UnifiedThread[] = details.reviewThreads.map((t) => ({ ...t, isAIDraft: false as const }));
	const allThreads: UnifiedThread[] = [...aiThreads, ...githubThreads];

	// Sort: unresolved first, then resolved
	const unresolvedThreads = allThreads.filter((t) => t.isAIDraft || !t.isResolved);
	const resolvedThreads = allThreads.filter((t) => !t.isAIDraft && t.isResolved);

	const jumpToFile = (path: string) => {
		if (!activeWorkspaceId) return;
		openPRReviewFile(activeWorkspaceId, prCtx, path, detectLanguage(path));
	};

	return (
		<div className="h-full overflow-y-auto bg-[var(--bg-base)]">
			<div className="mx-auto max-w-[700px] px-8 py-6">
				<PRHeader details={details} prCtx={prCtx} />

				{aiDraftQuery.data?.summaryMarkdown && (
					<AISummaryCard markdown={aiDraftQuery.data.summaryMarkdown} />
				)}

				{/* Comments */}
				<div>
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">Comments</h2>
						<span className="text-[10px] text-[var(--text-quaternary)]">{allThreads.length} total</span>
					</div>
					<div className="flex flex-col gap-2">
						{unresolvedThreads.map((thread) => (
							<CommentCard
								key={thread.id}
								thread={thread}
								onJumpToFile={() => jumpToFile(thread.path)}
								onAccept={thread.isAIDraft ? () => updateDraftComment.mutate({ commentId: thread.draftCommentId, status: "approved" }) : undefined}
								onDismiss={thread.isAIDraft ? () => updateDraftComment.mutate({ commentId: thread.draftCommentId, status: "rejected" }) : undefined}
								onReply={!thread.isAIDraft ? (body) => replyMutation.mutate({ threadId: thread.id, body }) : undefined}
								onResolve={!thread.isAIDraft && !thread.isResolved ? () => resolveMutation.mutate({ threadId: thread.id }) : undefined}
							/>
						))}
						{resolvedThreads.map((thread) => (
							<CommentCard
								key={thread.id}
								thread={thread}
								onJumpToFile={() => jumpToFile(thread.path)}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Verify the app runs**

Run: `cd /Users/thomas//worktrees/BranchFlux/automatic-pr-review && bun run dev`

Check: Click a PR, the PR Overview tab opens in the main area showing the header, AI summary, and comment feed.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/PROverviewTab.tsx
git commit -m "feat: implement PROverviewTab dashboard with header, AI summary, and comment feed"
```

---

## Chunk 5: Submit Modal & Cleanup

### Task 7: Implement `SubmitReviewModal`

**Files:**
- Modify: `apps/desktop/src/renderer/components/SubmitReviewModal.tsx` (replace stub)

- [ ] **Step 1: Implement the full submit modal**

Replace the stub with:

```typescript
import { useState } from "react";
import type { AIDraftThread, GitHubPRContext } from "../../shared/github-types";
import { trpc } from "../trpc/client";

interface SubmitReviewModalProps {
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
	pendingCount: number;
	headCommitOid: string;
	onClose: () => void;
	onSubmitted: () => void;
}

export function SubmitReviewModal({
	prCtx,
	aiThreads,
	pendingCount,
	headCommitOid,
	onClose,
	onSubmitted,
}: SubmitReviewModalProps) {
	const [body, setBody] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [result, setResult] = useState<{ posted: number; failed: number } | null>(null);

	const createThread = trpc.github.createReviewThread.useMutation();
	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation();
	const submitReview = trpc.github.submitReview.useMutation();

	const handleSubmit = async (verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => {
		setIsSubmitting(true);
		setResult(null);

		// Post accepted AI comments
		let posted = 0;
		let failed = 0;
		for (const comment of aiThreads) {
			if (comment.line == null) continue;
			try {
				await createThread.mutateAsync({
					owner: prCtx.owner,
					repo: prCtx.repo,
					prNumber: prCtx.number,
					body: comment.userEdit ?? comment.body,
					commitId: headCommitOid,
					path: comment.path,
					line: comment.line,
					side: comment.diffSide,
				});
				await updateDraftComment.mutateAsync({
					commentId: comment.draftCommentId,
					status: "submitted",
				});
				posted++;
			} catch {
				failed++;
			}
		}

		if (aiThreads.length > 0) {
			setResult({ posted, failed });
		}

		// Submit verdict
		await submitReview.mutateAsync({
			owner: prCtx.owner,
			repo: prCtx.repo,
			prNumber: prCtx.number,
			verdict,
			body,
		});

		setIsSubmitting(false);
		onSubmitted();
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
			onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
			role="dialog"
			aria-modal="true"
			tabIndex={-1}
		>
			<div className="w-[420px] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
				{/* Header */}
				<div className="border-b border-[var(--border-subtle)] px-5 pb-3 pt-4">
					<div className="text-[14px] font-semibold text-[var(--text)]">Submit Review</div>
					<div className="mt-0.5 text-[11px] text-[var(--text-quaternary)]">
						{prCtx.title} · #{prCtx.number}
					</div>
				</div>

				{/* Pending actions summary */}
				<div className="border-b border-[var(--border-subtle)] px-5 py-3">
					{aiThreads.length > 0 && (
						<div className="mb-1.5 flex items-center gap-2">
							<span className="ai-badge">AI</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								{aiThreads.length} accepted comment{aiThreads.length !== 1 ? "s" : ""} will be posted
							</span>
						</div>
					)}
					{pendingCount > 0 && (
						<div className="flex items-center gap-2">
							<span className="text-[11px] text-yellow-400">⚠</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								{pendingCount} suggestion{pendingCount !== 1 ? "s" : ""} not yet triaged
							</span>
						</div>
					)}
					{aiThreads.length === 0 && pendingCount === 0 && (
						<span className="text-[11px] text-[var(--text-quaternary)]">No AI comments to post</span>
					)}
				</div>

				{/* Result feedback */}
				{result && (
					<div className={`px-5 py-2 text-[10px] ${result.failed > 0 ? "bg-red-900/20 text-red-400" : "bg-green-900/20 text-green-400"}`}>
						{result.posted} comment{result.posted !== 1 ? "s" : ""} posted.
						{result.failed > 0 && ` ${result.failed} failed.`}
					</div>
				)}

				{/* Body */}
				<div className="px-5 py-3">
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						placeholder="Leave a comment (optional)"
						rows={3}
						className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[12px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
					/>
				</div>

				{/* Verdict buttons */}
				<div className="flex gap-2 px-5 pb-4">
					<button
						type="button"
						disabled={isSubmitting}
						onClick={() => handleSubmit("COMMENT")}
						className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-overlay)] disabled:opacity-50"
					>
						Comment
					</button>
					<button
						type="button"
						disabled={isSubmitting}
						onClick={() => handleSubmit("APPROVE")}
						className="flex-1 rounded-md border border-[rgba(48,209,88,0.15)] bg-[rgba(48,209,88,0.12)] py-2 text-[11px] font-semibold text-[#30d158] transition-colors hover:bg-[rgba(48,209,88,0.2)] disabled:opacity-50"
					>
						Approve
					</button>
					<button
						type="button"
						disabled={isSubmitting}
						onClick={() => handleSubmit("REQUEST_CHANGES")}
						className="flex-1 rounded-md border border-[rgba(255,69,58,0.12)] bg-[rgba(255,69,58,0.1)] py-2 text-[11px] font-medium text-[#ff453a] transition-colors hover:bg-[rgba(255,69,58,0.15)] disabled:opacity-50"
					>
						Request Changes
					</button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Verify the modal works**

Run: `cd /Users/thomas//worktrees/BranchFlux/automatic-pr-review && bun run dev`

Check: Click "Submit Review" in the control rail, modal opens with correct summary, Escape/backdrop click closes it.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/SubmitReviewModal.tsx
git commit -m "feat: implement SubmitReviewModal with verdict buttons and AI summary"
```

---

### Task 8: Clean up old files

**Files:**
- Delete: `apps/desktop/src/renderer/components/AIReviewSummaryTab.tsx`
- Delete: `apps/desktop/src/renderer/components/CommentOverview.tsx`
- Delete: `apps/desktop/src/renderer/components/PRReviewPanel.tsx`

- [ ] **Step 1: Verify no remaining imports of deleted files**

Run a search for references to the old components:

```bash
cd apps/desktop && grep -r "AIReviewSummaryTab\|CommentOverview\|PRReviewPanel" src/renderer/ --include="*.ts" --include="*.tsx" -l
```

Expected: Only the files themselves and possibly `DiffPanel.tsx` (which we already updated). Fix any remaining references.

- [ ] **Step 2: Delete the old files**

```bash
rm apps/desktop/src/renderer/components/AIReviewSummaryTab.tsx
rm apps/desktop/src/renderer/components/CommentOverview.tsx
rm apps/desktop/src/renderer/components/PRReviewPanel.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -30`

Expected: Clean compile.

- [ ] **Step 4: Verify the app runs end-to-end**

Run: `cd /Users/thomas//worktrees/BranchFlux/automatic-pr-review && bun run dev`

Check:
- Left sidebar: segmented control works (Repos/Tickets/PRs), project list always visible
- Click a PR: right panel shows control rail (status, files, AI badge, submit), main area shows PR Overview tab
- Click a file in the control rail: opens diff tab alongside PR Overview
- Accept/dismiss AI comments in the dashboard
- Submit Review modal opens from control rail button
- Terminals coexist with PR tabs

- [ ] **Step 5: Run linter**

Run: `cd /Users/thomas//worktrees/BranchFlux/automatic-pr-review && bun run check`

Fix any issues.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove old PRReviewPanel, CommentOverview, and AIReviewSummaryTab"
```
