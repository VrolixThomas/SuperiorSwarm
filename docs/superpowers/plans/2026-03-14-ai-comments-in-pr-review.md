# AI Comments in PR Review View — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate AI draft review comments into the existing PR review inline editor and right panel, with accept/decline actions and unified comment overview.

**Architecture:** AI draft comments from SQLite are merged with GitHub review threads in the renderer. ThreadWidget is extended with AI-specific UI (badge, accept/decline buttons). PRReviewPanel gets a comment overview section with sort/group options. Accepted comments are posted to GitHub as part of the normal Submit Review flow.

**Tech Stack:** React 19, Monaco Editor (view zones + decorations), tRPC, Zustand, TanStack Query, Drizzle ORM (SQLite)

**Spec:** `docs/superpowers/specs/2026-03-14-ai-comments-in-pr-review-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/renderer/components/CommentOverview.tsx` | Unified comment list with sort/group, click-to-navigate |

### Modified Files

| File | Changes |
|------|---------|
| `src/renderer/components/PRReviewFileTab.tsx` | Fetch AI drafts, merge with threads, extend ThreadWidget with AI badge + accept/decline |
| `src/renderer/components/PRReviewPanel.tsx` | Add CommentOverview section below file list, pass AI drafts + threads |
| `src/renderer/styles.css` | Add AI draft gutter decoration + AI badge styles |
| `src/main/trpc/routers/github.ts` | Extend submitReview to post accepted AI comments before verdict |
| `src/shared/github-types.ts` | Add `AIDraftThread` type extending review thread concept |

All paths relative to `apps/desktop/`.

---

## Chunk 1: AI Draft Thread Types and CSS

### Task 1: Add AI Draft Types

**Files:**
- Modify: `apps/desktop/src/shared/github-types.ts`

- [ ] **Step 1: Add AIDraftThread interface**

Add below the existing `GitHubReviewThread` interface:

```typescript
/** An AI draft comment transformed into a thread-like structure for unified rendering */
export interface AIDraftThread {
	id: string;
	isAIDraft: true;
	draftCommentId: string;
	path: string;
	line: number | null;
	diffSide: "LEFT" | "RIGHT";
	body: string;
	status: "pending" | "approved" | "rejected" | "edited";
	userEdit: string | null;
	createdAt: string;
}

/** Union type for rendering — either a real GitHub thread or an AI draft */
export type UnifiedThread =
	| (GitHubReviewThread & { isAIDraft?: false })
	| AIDraftThread;
```

- [ ] **Step 2: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/shared/github-types.ts
git commit -m "feat(ai-review): add AIDraftThread and UnifiedThread types"
```

---

### Task 2: Add AI Draft CSS Styles

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add AI draft gutter and badge styles**

Add after the existing `.pr-gutter-plus-icon:hover` rule:

```css
/* AI draft comment decorations */
.pr-thread-ai-draft-gutter {
	width: 6px !important;
	margin-left: 4px;
	border-radius: 50%;
	background: #a78bfa; /* violet-400 */
}

.pr-thread-ai-draft-line {
	background: rgba(167, 139, 250, 0.06);
}

/* AI badge pill */
.ai-badge {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	padding: 1px 6px;
	border-radius: 4px;
	background: rgba(167, 139, 250, 0.15);
	color: #a78bfa;
	font-size: 10px;
	font-weight: 600;
	line-height: 16px;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "feat(ai-review): add AI draft gutter and badge CSS styles"
```

---

## Chunk 2: Extend ThreadWidget for AI Comments

### Task 3: Extend ThreadWidget with AI Support

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRReviewFileTab.tsx`

This is the core task. The `ThreadWidget` component (lines 12-117) needs to handle both `GitHubReviewThread` and `AIDraftThread`.

- [ ] **Step 1: Update ThreadWidget props and rendering**

Change the ThreadWidget props to accept `UnifiedThread`:

```typescript
import type {
	GitHubPRContext,
	GitHubReviewThread,
	UnifiedThread,
	AIDraftThread,
} from "../../shared/github-types";
```

Update the component signature:

```typescript
function ThreadWidget({
	thread,
	onReply,
	onResolve,
	onAcceptDraft,
	onDeclineDraft,
}: {
	thread: UnifiedThread;
	onReply: (body: string) => void;
	onResolve: () => void;
	onAcceptDraft?: (draftCommentId: string) => void;
	onDeclineDraft?: (draftCommentId: string) => void;
}) {
```

Inside the component, add an `isAI` check:

```typescript
const isAI = thread.isAIDraft === true;
```

**Thread header**: For AI drafts, show the AI badge instead of file path. Replace the header section:

```tsx
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
	<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
		{isAI ? (
			<>
				<span className="ai-badge">AI</span>
				<span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
					BranchFlux AI
				</span>
			</>
		) : (
			<span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
				{thread.path}:{thread.line}
			</span>
		)}
	</div>
	{/* Resolve button for GitHub threads only */}
	{!isAI && (
		thread.isResolved ? (
			<span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>Resolved</span>
		) : (
			<button type="button" onClick={onResolve} style={resolveButtonStyle}>
				Resolve
			</button>
		)
	)}
</div>
```

**Comment body**: For AI drafts, render the single comment body directly. For GitHub threads, keep the existing comments map:

```tsx
<div style={{ padding: "8px 10px" }}>
	{isAI ? (
		<div>
			<div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap" }}>
				{thread.userEdit ?? thread.body}
			</div>
		</div>
	) : (
		(thread as GitHubReviewThread).comments.map((c) => (
			<div key={c.id} style={{ marginBottom: 8 }}>
				<div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>
					{c.author} · {new Date(c.createdAt).toLocaleDateString()}
				</div>
				<div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap" }}>
					{c.body}
				</div>
			</div>
		))
	)}
</div>
```

**Accept/Decline buttons**: Add below the body, only for AI drafts with status "pending":

```tsx
{isAI && thread.status === "pending" && (
	<div style={{
		display: "flex",
		gap: 6,
		padding: "6px 10px",
		borderTop: "1px solid var(--border)",
	}}>
		<button
			type="button"
			onClick={() => onAcceptDraft?.(thread.draftCommentId)}
			style={{
				padding: "3px 10px",
				fontSize: 11,
				fontWeight: 500,
				borderRadius: 4,
				border: "none",
				cursor: "pointer",
				background: "rgba(48, 209, 88, 0.15)",
				color: "#30d158",
			}}
		>
			Accept
		</button>
		<button
			type="button"
			onClick={() => onDeclineDraft?.(thread.draftCommentId)}
			style={{
				padding: "3px 10px",
				fontSize: 11,
				fontWeight: 500,
				borderRadius: 4,
				border: "none",
				cursor: "pointer",
				background: "var(--bg-elevated)",
				color: "var(--text-tertiary)",
			}}
		>
			Decline
		</button>
	</div>
)}
```

**Left border**: Wrap the entire widget in a container that applies a violet left border for AI drafts:

```tsx
<div style={{
	borderLeft: isAI ? "2px solid #a78bfa" : undefined,
	background: "var(--bg-surface)",
	borderRadius: 6,
	border: isAI ? undefined : "1px solid var(--border)",
	borderTop: isAI ? "1px solid var(--border)" : undefined,
	borderRight: isAI ? "1px solid var(--border)" : undefined,
	borderBottom: isAI ? "1px solid var(--border)" : undefined,
	overflow: "hidden",
}}>
```

- [ ] **Step 2: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/PRReviewFileTab.tsx
git commit -m "feat(ai-review): extend ThreadWidget with AI badge and accept/decline"
```

---

### Task 4: Fetch AI Drafts and Merge with GitHub Threads

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRReviewFileTab.tsx`

- [ ] **Step 1: Add AI draft query and merge logic**

Inside the `PRReviewFileTab` component (around line 430 where queries are defined), add the AI draft query:

```typescript
// Build PR identifier to look up AI review draft
const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
const reviewDrafts = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
	staleTime: 5_000,
});
const matchingDraft = reviewDrafts.data?.find((d) => d.prIdentifier === prIdentifier);
const aiDraft = trpc.aiReview.getReviewDraft.useQuery(
	{ draftId: matchingDraft?.id ?? "" },
	{ enabled: !!matchingDraft?.id }
);
```

Add the accept/decline mutations:

```typescript
const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
	onSuccess: () => aiDraft.refetch(),
});
```

Transform AI comments into `AIDraftThread[]` and merge with GitHub threads:

```typescript
const aiThreads: AIDraftThread[] = (aiDraft.data?.comments ?? [])
	.filter((c) => c.status !== "rejected")
	.map((c) => ({
		id: `ai-${c.id}`,
		isAIDraft: true as const,
		draftCommentId: c.id,
		path: c.filePath,
		line: c.lineNumber,
		diffSide: (c.side as "LEFT" | "RIGHT") ?? "RIGHT",
		body: c.body,
		status: c.status as "pending" | "approved" | "rejected" | "edited",
		userEdit: c.userEdit ?? null,
		createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
	}));

// Merge for this file
const githubFileThreads = (prDetails?.reviewThreads ?? []).filter((t) => t.path === filePath);
const aiFileThreads = aiThreads.filter((t) => t.path === filePath);
const fileThreads: UnifiedThread[] = [
	...githubFileThreads,
	...aiFileThreads,
];
```

Replace the existing `fileThreads` variable (line ~472) with this merged version.

- [ ] **Step 2: Update useInlineCommentZones to use UnifiedThread**

Change the `threads` parameter type in `useInlineCommentZones` from `GitHubReviewThread[]` to `UnifiedThread[]`. Update the thread grouping logic to work with both types.

Pass `onAcceptDraft` and `onDeclineDraft` callbacks:

```typescript
useInlineCommentZones(
	editorInstance?.getModifiedEditor() ?? null,
	fileThreads,
	pendingLine,
	handleReply,
	handleResolve,
	handleSaveNew,
	handleCancelNew,
	handleAcceptDraft,
	handleDeclineDraft
);
```

Where the handlers are:

```typescript
const handleAcceptDraft = (draftCommentId: string) => {
	updateDraftComment.mutate({ commentId: draftCommentId, status: "approved" });
};

const handleDeclineDraft = (draftCommentId: string) => {
	updateDraftComment.mutate({ commentId: draftCommentId, status: "rejected" });
};
```

- [ ] **Step 3: Update useThreadDecorations for AI drafts**

In `useThreadDecorations`, update the decoration mapping to use the AI gutter class:

```typescript
.map((t) => ({
	range: new monaco.Range(t.line!, 1, t.line!, 1),
	options: {
		isWholeLine: true,
		linesDecorationsClassName: t.isAIDraft
			? "pr-thread-ai-draft-gutter"
			: t.isResolved
				? "pr-thread-resolved-gutter"
				: "pr-thread-unresolved-gutter",
		className: t.isAIDraft
			? "pr-thread-ai-draft-line"
			: t.isResolved
				? undefined
				: "pr-thread-unresolved-line",
	},
}))
```

- [ ] **Step 4: Update thread navigation to include AI drafts**

Update the `unresolvedLines` calculation to include pending AI drafts:

```typescript
const unresolvedLines = fileThreads
	.filter((t) => {
		if (t.isAIDraft) return t.status === "pending" && t.line != null;
		return !t.isResolved && t.line != null;
	})
	.map((t) => t.line!)
	.sort((a, b) => a - b);
```

- [ ] **Step 5: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/PRReviewFileTab.tsx
git commit -m "feat(ai-review): fetch AI drafts and merge with GitHub threads inline"
```

---

## Chunk 3: Comment Overview in Right Panel

### Task 5: Create CommentOverview Component

**Files:**
- Create: `apps/desktop/src/renderer/components/CommentOverview.tsx`

- [ ] **Step 1: Create the component**

```typescript
import { useMemo, useState } from "react";
import type {
	GitHubPRContext,
	GitHubPRDetails,
	GitHubReviewThread,
	AIDraftThread,
	UnifiedThread,
} from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";

type SortMode = "by-file" | "by-reviewer" | "latest-first";

interface CommentOverviewProps {
	details: GitHubPRDetails;
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
}

function detectLanguage(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
		py: "python", rs: "rust", go: "go", md: "markdown", json: "json", css: "css",
		html: "html", yml: "yaml", yaml: "yaml", sh: "shell", bash: "shell",
	};
	return map[ext] ?? ext;
}

export function CommentOverview({ details, prCtx, aiThreads }: CommentOverviewProps) {
	const [sortMode, setSortMode] = useState<SortMode>("by-file");
	const [collapsed, setCollapsed] = useState(false);
	const store = useTabStore();

	// Merge all threads into unified list
	const allThreads: UnifiedThread[] = useMemo(() => {
		const github: UnifiedThread[] = details.reviewThreads.map((t) => ({
			...t,
			isAIDraft: false as const,
		}));
		const ai: UnifiedThread[] = aiThreads.filter((t) => t.status !== "rejected");
		return [...github, ...ai];
	}, [details.reviewThreads, aiThreads]);

	const totalCount = allThreads.length;

	// Group/sort based on mode
	const grouped = useMemo(() => {
		if (sortMode === "by-file") {
			const map = new Map<string, UnifiedThread[]>();
			for (const t of allThreads) {
				const list = map.get(t.path) ?? [];
				list.push(t);
				map.set(t.path, list);
			}
			return [...map.entries()].map(([path, threads]) => ({ label: path, threads }));
		}

		if (sortMode === "by-reviewer") {
			const map = new Map<string, UnifiedThread[]>();
			for (const t of allThreads) {
				const author = t.isAIDraft
					? "BranchFlux AI"
					: (t as GitHubReviewThread).comments[0]?.author ?? "Unknown";
				const list = map.get(author) ?? [];
				list.push(t);
				map.set(author, list);
			}
			return [...map.entries()].map(([label, threads]) => ({ label, threads }));
		}

		// latest-first: flat list sorted by date
		const sorted = [...allThreads].sort((a, b) => {
			const dateA = a.isAIDraft
				? a.createdAt
				: (a as GitHubReviewThread).comments[0]?.createdAt ?? "";
			const dateB = b.isAIDraft
				? b.createdAt
				: (b as GitHubReviewThread).comments[0]?.createdAt ?? "";
			return dateB.localeCompare(dateA);
		});
		return [{ label: "", threads: sorted }];
	}, [allThreads, sortMode]);

	const handleClickThread = (thread: UnifiedThread) => {
		const wsId = store.activeWorkspaceId;
		if (!wsId) return;
		store.openPRReviewFile(wsId, prCtx, thread.path, detectLanguage(thread.path));
		// Scroll to line handled by PRReviewFileTab on mount via thread navigation
	};

	if (totalCount === 0) return null;

	return (
		<div style={{ borderTop: "1px solid var(--border)" }}>
			{/* Header */}
			<button
				type="button"
				onClick={() => setCollapsed(!collapsed)}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					width: "100%",
					padding: "8px 12px",
					background: "none",
					border: "none",
					cursor: "pointer",
					color: "var(--text-secondary)",
				}}
			>
				<span style={{ fontSize: 12, fontWeight: 600 }}>
					Comments ({totalCount})
				</span>
				<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
					{!collapsed && (
						<select
							value={sortMode}
							onChange={(e) => setSortMode(e.target.value as SortMode)}
							onClick={(e) => e.stopPropagation()}
							style={{
								fontSize: 10,
								padding: "2px 4px",
								background: "var(--bg-elevated)",
								color: "var(--text-tertiary)",
								border: "1px solid var(--border)",
								borderRadius: 4,
								cursor: "pointer",
							}}
						>
							<option value="by-file">By file</option>
							<option value="by-reviewer">By reviewer</option>
							<option value="latest-first">Latest first</option>
						</select>
					)}
					<span style={{ fontSize: 10 }}>{collapsed ? "+" : "-"}</span>
				</div>
			</button>

			{/* Comment list */}
			{!collapsed && (
				<div style={{ maxHeight: 300, overflowY: "auto" }}>
					{grouped.map(({ label, threads }) => (
						<div key={label}>
							{label && (
								<div style={{
									padding: "4px 12px",
									fontSize: 10,
									fontWeight: 600,
									color: "var(--text-quaternary)",
									textTransform: "uppercase",
									letterSpacing: "0.5px",
								}}>
									{label}
								</div>
							)}
							{threads.map((t) => {
								const body = t.isAIDraft
									? (t.userEdit ?? t.body)
									: (t as GitHubReviewThread).comments[0]?.body ?? "";
								const author = t.isAIDraft
									? "AI"
									: (t as GitHubReviewThread).comments[0]?.author ?? "";
								const isAccepted = t.isAIDraft && t.status === "approved";

								return (
									<button
										type="button"
										key={t.id}
										onClick={() => handleClickThread(t)}
										style={{
											display: "flex",
											alignItems: "flex-start",
											gap: 8,
											width: "100%",
											padding: "6px 12px",
											background: "none",
											border: "none",
											cursor: "pointer",
											textAlign: "left",
											transition: "background 120ms",
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.background = "var(--bg-elevated)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = "none";
										}}
									>
										{/* Author indicator */}
										<div style={{ flexShrink: 0, marginTop: 2 }}>
											{t.isAIDraft ? (
												<span className="ai-badge">AI</span>
											) : (
												<span style={{
													display: "inline-block",
													width: 16,
													height: 16,
													borderRadius: "50%",
													background: "var(--bg-overlay)",
													fontSize: 9,
													textAlign: "center",
													lineHeight: "16px",
													color: "var(--text-tertiary)",
												}}>
													{author[0]?.toUpperCase() ?? "?"}
												</span>
											)}
										</div>

										{/* Content */}
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{
												display: "flex",
												alignItems: "center",
												gap: 4,
												fontSize: 11,
												color: "var(--text-tertiary)",
											}}>
												<span style={{ fontFamily: "monospace", fontSize: 10 }}>
													{t.path.split("/").pop()}:{t.line ?? "?"}
												</span>
												{isAccepted && (
													<span style={{ color: "#30d158", fontSize: 10 }}>&#10003;</span>
												)}
											</div>
											<div style={{
												fontSize: 11,
												color: "var(--text-secondary)",
												whiteSpace: "nowrap",
												overflow: "hidden",
												textOverflow: "ellipsis",
												maxWidth: "100%",
											}}>
												{body.split("\n")[0]}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/CommentOverview.tsx
git commit -m "feat(ai-review): add CommentOverview component with sort/group"
```

---

### Task 6: Integrate CommentOverview into PRReviewPanel

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRReviewPanel.tsx`

- [ ] **Step 1: Add AI draft query and CommentOverview**

Import the component and add the AI draft query at the top of the `PRReviewPanel` component:

```typescript
import { CommentOverview } from "./CommentOverview";
import type { AIDraftThread } from "../../shared/github-types";
```

Inside the component, add the AI draft lookup (after the existing `getPRDetails` query):

```typescript
const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
const reviewDrafts = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
	staleTime: 5_000,
});
const matchingDraft = reviewDrafts.data?.find((d) => d.prIdentifier === prIdentifier);
const aiDraft = trpc.aiReview.getReviewDraft.useQuery(
	{ draftId: matchingDraft?.id ?? "" },
	{ enabled: !!matchingDraft?.id }
);

const aiThreads: AIDraftThread[] = (aiDraft.data?.comments ?? [])
	.filter((c) => c.status !== "rejected")
	.map((c) => ({
		id: `ai-${c.id}`,
		isAIDraft: true as const,
		draftCommentId: c.id,
		path: c.filePath,
		line: c.lineNumber,
		diffSide: (c.side as "LEFT" | "RIGHT") ?? "RIGHT",
		body: c.body,
		status: c.status as "pending" | "approved" | "rejected" | "edited",
		userEdit: c.userEdit ?? null,
		createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
	}));
```

- [ ] **Step 2: Render CommentOverview between FileList and SubmitReview**

In the JSX, insert between the `<FileList>` and `<SubmitReview>` sections:

```tsx
{prDetails && (
	<CommentOverview
		details={prDetails}
		prCtx={prCtx}
		aiThreads={aiThreads}
	/>
)}
```

- [ ] **Step 3: Update FileList unresolved count to include AI drafts**

In the `FileList` component, update the thread count calculation to include AI pending comments:

```typescript
// Count AI pending comments per file
for (const t of aiThreads) {
	if (t.status === "pending") {
		threadCountByFile.set(t.path, (threadCountByFile.get(t.path) ?? 0) + 1);
	}
}
```

Pass `aiThreads` as a prop to `FileList`.

- [ ] **Step 4: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/PRReviewPanel.tsx
git commit -m "feat(ai-review): integrate CommentOverview into PR review panel"
```

---

## Chunk 4: Submit Review with Accepted AI Comments

### Task 7: Extend Submit Review to Post Accepted AI Comments

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRReviewPanel.tsx`

- [ ] **Step 1: Update SubmitReview to accept and post AI comments**

Add `aiThreads` and `prDetails` as props to `SubmitReview`:

```typescript
function SubmitReview({
	prCtx,
	aiThreads,
	headCommitOid,
	onSubmitted,
}: {
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
	headCommitOid: string;
	onSubmitted: () => void;
})
```

Add state for submission progress:

```typescript
const [submitResult, setSubmitResult] = useState<{
	posted: number;
	failed: number;
} | null>(null);
```

Add `createReviewThread` mutation:

```typescript
const createThread = trpc.github.createReviewThread.useMutation();
const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation();
```

Update the submit handler to first post accepted AI comments, then submit the verdict:

```typescript
const handleSubmit = async (verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") => {
	const accepted = aiThreads.filter((t) => t.status === "approved");
	let posted = 0;
	let failed = 0;

	// Post accepted AI comments to GitHub
	for (const thread of accepted) {
		try {
			await createThread.mutateAsync({
				owner: prCtx.owner,
				repo: prCtx.repo,
				prNumber: prCtx.number,
				body: thread.userEdit ?? thread.body,
				commitId: headCommitOid,
				path: thread.path,
				line: thread.line ?? 1,
				side: thread.diffSide,
			});
			await updateDraftComment.mutateAsync({
				commentId: thread.draftCommentId,
				status: "approved", // Keep as approved — it's now posted
			});
			posted++;
		} catch {
			failed++;
		}
	}

	// Submit the review verdict
	submit.mutate({
		owner: prCtx.owner,
		repo: prCtx.repo,
		prNumber: prCtx.number,
		verdict,
		body: body,
	});

	if (accepted.length > 0) {
		setSubmitResult({ posted, failed });
	}
};
```

- [ ] **Step 2: Add feedback UI for posted AI comments**

Below the submit buttons, show the result:

```tsx
{submitResult && (
	<div style={{
		marginTop: 8,
		padding: "6px 10px",
		borderRadius: 6,
		background: submitResult.failed > 0
			? "rgba(255, 69, 58, 0.1)"
			: "rgba(48, 209, 88, 0.1)",
		fontSize: 11,
		color: submitResult.failed > 0 ? "#ff453a" : "#30d158",
	}}>
		{submitResult.posted} AI comment{submitResult.posted !== 1 ? "s" : ""} posted.
		{submitResult.failed > 0 && ` ${submitResult.failed} failed.`}
	</div>
)}
```

- [ ] **Step 3: Pass new props from PRReviewPanel**

Update the `SubmitReview` usage in `PRReviewPanel`:

```tsx
<SubmitReview
	prCtx={prCtx}
	aiThreads={aiThreads}
	headCommitOid={prDetails?.headCommitOid ?? ""}
	onSubmitted={() => {
		prDetailsQuery.refetch();
		aiDraft.refetch();
	}}
/>
```

- [ ] **Step 4: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/PRReviewPanel.tsx
git commit -m "feat(ai-review): post accepted AI comments on review submission"
```

---

### Task 8: Lint, Format, and Final Check

**Files:**
- All modified files

- [ ] **Step 1: Run biome check**

```bash
bun run check
```

Fix any formatting issues in the files we touched.

- [ ] **Step 2: Run type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: lint and format ai-review integration"
```
