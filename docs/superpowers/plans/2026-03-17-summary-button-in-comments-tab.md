# Summary Button in Comments Tab — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Summary" button to the CommentsTab sort bar that opens the PROverviewTab.

**Architecture:** Two new props on CommentsTab, a conditional button in the sort bar, and an early-return fix for the zero-threads edge case.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## Chunk 1: Implementation

### Task 1: Add props and button to CommentsTab

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRControlRail.tsx:460-586` (CommentsTab component)
- Modify: `apps/desktop/src/renderer/components/PRControlRail.tsx:957-962` (CommentsTab call site)

- [ ] **Step 1: Add new props to CommentsTab signature**

Change the function signature at line 460:

```tsx
function CommentsTab({
	details,
	prCtx,
	aiThreads,
	summaryMarkdown,
	onShowSummary,
}: {
	details: GitHubPRDetails;
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
	summaryMarkdown: string | null;
	onShowSummary: () => void;
}) {
```

- [ ] **Step 2: Fix zero-threads early return**

Replace the early return at line 528-534:

```tsx
if (allThreads.length === 0 && !summaryMarkdown) {
	return (
		<div className="flex flex-1 items-center justify-center">
			<span className="text-[12px] text-[var(--text-quaternary)]">No comments yet</span>
		</div>
	);
}
```

- [ ] **Step 3: Add Summary button to the sort control bar**

Replace the sort control div at line 555-568 with:

```tsx
{/* Sort control */}
<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
	<span className="text-[11px] text-[var(--text-tertiary)]">
		{allThreads.length} thread{allThreads.length !== 1 ? "s" : ""}
	</span>
	<div className="flex items-center gap-1.5">
		{summaryMarkdown && (
			<button
				type="button"
				onClick={onShowSummary}
				className="flex items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none transition-colors hover:text-[var(--text-secondary)]"
			>
				✦ Summary
			</button>
		)}
		<select
			value={sortMode}
			onChange={(e) => setSortMode(e.target.value as SortMode)}
			className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none"
		>
			<option value="by-file">By file</option>
			<option value="by-reviewer">By reviewer</option>
			<option value="latest-first">Latest first</option>
		</select>
	</div>
</div>
```

- [ ] **Step 4: Pass new props at the call site**

Replace lines 957-962:

```tsx
{tab === "comments" && (
	<CommentsTab
		details={details}
		prCtx={prCtx}
		aiThreads={[...aiThreads, ...userPendingThreads]}
		summaryMarkdown={aiDraftQuery.data?.summaryMarkdown ?? null}
		onShowSummary={() => activeWorkspaceId && openPROverview(activeWorkspaceId, prCtx)}
	/>
)}
```

- [ ] **Step 5: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/PRControlRail.tsx
git commit -m "feat: add summary button to comments tab sort bar"
```
