# Unified PR Review Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge ReviewWorkspaceTab into PROverviewTab so there's one PR tab that conditionally gains review features when a draft is active.

**Architecture:** PROverviewTab detects active review drafts via existing tRPC queries. When a draft exists (status not dismissed/submitted), the tab renders review-mode UI: status strip, grouped-by-file comments with approve/reject/edit, submit bar, chain history. When no draft exists, the current read-only view renders unchanged. ReviewWorkspaceTab is deleted and all references to the `review-workspace` tab kind are removed.

**Tech Stack:** React 19, TypeScript, tRPC, Zustand (tab-store/pane-store)

---

### Task 1: Extend ReviewFileGroupCard to support GitHub threads

**Files:**
- Modify: `apps/desktop/src/renderer/components/ReviewFileGroupCard.tsx`
- Modify: `apps/desktop/src/shared/github-types.ts`

The card currently only renders AI draft comments. It needs to also render GitHub platform threads (with reply/resolve actions) inside the same file group.

- [ ] **Step 1: Define a union type for file-grouped items**

In `apps/desktop/src/shared/github-types.ts`, add:

```typescript
/** A single item within a file group card — either an AI draft comment or a GitHub thread */
export type FileGroupItem =
	| {
			kind: "ai-draft";
			id: string;
			lineNumber: number | null;
			body: string;
			status: string;
			userEdit: string | null;
			roundDelta: "new" | "resolved" | "still_open" | "regressed" | null;
	  }
	| {
			kind: "github-thread";
			id: string;
			lineNumber: number | null;
			isResolved: boolean;
			comments: Array<{ id: string; body: string; author: string; createdAt: string }>;
	  };
```

- [ ] **Step 2: Update ReviewFileGroupCard props to use the union type**

Replace the `comments` prop type in `ReviewFileGroupCard.tsx`:

```typescript
import type { FileGroupItem } from "../../shared/github-types";

interface ReviewFileGroupCardProps {
	filePath: string;
	items: FileGroupItem[];
	defaultExpanded: boolean;
	onApprove: (commentId: string) => void;
	onReject: (commentId: string) => void;
	onEdit: (commentId: string, newBody: string) => void;
	onApproveAll: (commentIds: string[]) => void;
	onOpenInDiff: (filePath: string) => void;
	onReplyToThread?: (threadId: string, body: string) => void;
	onResolveThread?: (threadId: string) => void;
}
```

Update the component body: rename `comments` to `items` throughout. Update `nonRejected` filter to only apply to `ai-draft` items. Update `approvedCount`, `pendingIds` to only count `ai-draft` items. The `allApproved` check should only consider AI drafts (GitHub threads don't have approval state).

- [ ] **Step 3: Add a GitHubThreadRow component inside ReviewFileGroupCard**

Below the existing `CommentRow` component, add a `GitHubThreadRow`:

```tsx
function GitHubThreadRow({
	item,
	onReply,
	onResolve,
}: {
	item: Extract<FileGroupItem, { kind: "github-thread" }>;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
}) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyBody, setReplyBody] = useState("");

	return (
		<div
			className={[
				"py-[8px] border-b border-[var(--border-subtle)] last:border-b-0",
				item.isResolved ? "opacity-50" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			<div className="flex items-start gap-[8px]">
				{/* Line number */}
				<div className="shrink-0 w-[40px]">
					{item.lineNumber != null && (
						<span className="[font-family:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]">
							L{item.lineNumber}
						</span>
					)}
				</div>

				{/* Thread body */}
				<div className="flex-1 min-w-0">
					{item.comments.map((c) => (
						<div key={c.id} className="mb-[6px] last:mb-0">
							<div className="flex items-center gap-[4px] mb-[2px]">
								<span className="text-[10.5px] font-medium text-[var(--text-secondary)]">
									{c.author}
								</span>
							</div>
							<div className="text-[12px] text-[var(--text-secondary)] leading-[1.55]">
								<MarkdownRenderer content={c.body} />
							</div>
						</div>
					))}

					{/* Actions */}
					<div className="flex items-center gap-[4px] mt-[5px]">
						{item.isResolved ? (
							<span className="text-[10.5px] font-medium text-[var(--success)]">Resolved</span>
						) : (
							<>
								{onResolve && (
									<button
										type="button"
										onClick={() => onResolve(item.id)}
										className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
									>
										Resolve
									</button>
								)}
								{onReply && !replyOpen && (
									<button
										type="button"
										onClick={() => setReplyOpen(true)}
										className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
									>
										Reply
									</button>
								)}
							</>
						)}
					</div>

					{/* Reply input */}
					{replyOpen && (
						<div className="mt-[6px]">
							<textarea
								value={replyBody}
								onChange={(e) => setReplyBody(e.target.value)}
								placeholder="Write a reply..."
								className="w-full min-h-[50px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] font-[var(--font-family)] resize-y"
							/>
							<div className="flex gap-[6px] mt-[4px] justify-end">
								<button
									type="button"
									onClick={() => {
										setReplyOpen(false);
										setReplyBody("");
									}}
									className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => {
										if (replyBody.trim() && onReply) {
											onReply(item.id, replyBody.trim());
											setReplyBody("");
											setReplyOpen(false);
										}
									}}
									disabled={!replyBody.trim()}
									className={[
										"py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none",
										replyBody.trim()
											? "cursor-pointer opacity-100"
											: "cursor-not-allowed opacity-50",
									].join(" ")}
								>
									Reply
								</button>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Update the card body to render both item types**

In the `{expanded && ...}` block, replace the `nonRejected.map(...)` with:

```tsx
{expanded && (
	<div className="border-t border-[var(--border-subtle)] px-[12px] pt-[10px] pb-[12px]">
		{items
			.filter((item) =>
				item.kind === "ai-draft" ? item.status !== "rejected" : true
			)
			.map((item) =>
				item.kind === "ai-draft" ? (
					<CommentRow
						key={item.id}
						comment={item}
						onApprove={onApprove}
						onReject={onReject}
						onEdit={onEdit}
						onOpenInDiff={() => onOpenInDiff(filePath)}
					/>
				) : (
					<GitHubThreadRow
						key={item.id}
						item={item}
						onReply={onReplyToThread}
						onResolve={onResolveThread}
					/>
				)
			)}
	</div>
)}
```

- [ ] **Step 5: Update header counts to only count AI drafts**

```typescript
const aiDrafts = items.filter((i) => i.kind === "ai-draft");
const nonRejected = aiDrafts.filter((c) => c.status !== "rejected");
const allApproved = nonRejected.length > 0 && nonRejected.every((c) => c.status === "approved");
const approvedCount = nonRejected.filter((c) => c.status === "approved").length;
const pendingIds = nonRejected
	.filter((c) => c.status !== "approved" && c.status !== "edited")
	.map((c) => c.id);
const totalItemCount = items.filter((i) =>
	i.kind === "ai-draft" ? i.status !== "rejected" : true
).length;
```

Use `totalItemCount` for the badge in the header instead of `nonRejected.length`.

- [ ] **Step 6: Verify build passes**

Run: `bun run type-check`
Expected: success (PROverviewTab doesn't use this card yet — only ReviewWorkspaceTab does, and it will be deleted in a later task, so expect type errors from ReviewWorkspaceTab at this point — that's fine)

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/ReviewFileGroupCard.tsx apps/desktop/src/shared/github-types.ts
git commit -m "feat: extend ReviewFileGroupCard to support GitHub threads alongside AI comments"
```

---

### Task 2: Add review-mode UI to PROverviewTab

**Files:**
- Modify: `apps/desktop/src/renderer/components/PROverviewTab.tsx`

This is the main change. PROverviewTab gains: status strip, grouped-by-file cards, bottom bar, chain history — all conditional on `hasActiveDraft`.

- [ ] **Step 1: Add imports and review-mode state**

At the top of `PROverviewTab.tsx`, add imports:

```typescript
import { ReviewFileGroupCard } from "./ReviewFileGroupCard";
import { ReviewVerdictConfirmation } from "./ReviewVerdictConfirmation";
import type { FileGroupItem } from "../../shared/github-types";
```

- [ ] **Step 2: Add review mutations and state inside PROverviewTab**

Inside the `PROverviewTab` component function, after the existing `aiDraftQuery`, add:

```typescript
const [showVerdictConfirmation, setShowVerdictConfirmation] = useState(false);
const [historyExpanded, setHistoryExpanded] = useState(false);

const hasActiveDraft =
	!!matchingDraft &&
	matchingDraft.status !== "dismissed" &&
	matchingDraft.status !== "submitted";

const { data: chainHistory } = trpc.aiReview.getReviewChainHistory.useQuery(
	{ reviewChainId: aiDraftQuery.data?.reviewChainId ?? "" },
	{ enabled: hasActiveDraft && !!aiDraftQuery.data?.reviewChainId }
);

const cancelMutation = trpc.aiReview.cancelReview.useMutation({
	onSuccess: () => utils.aiReview.invalidate(),
});
const updateComment = trpc.aiReview.updateDraftComment.useMutation({
	onSuccess: () => utils.aiReview.invalidate(),
});
const batchUpdate = trpc.aiReview.batchUpdateDraftComments.useMutation({
	onSuccess: () => utils.aiReview.invalidate(),
});
const submitReview = trpc.aiReview.submitReview.useMutation({
	onSuccess: () => {
		utils.aiReview.invalidate();
		setShowVerdictConfirmation(false);
	},
});
const dismissPending = trpc.aiReview.dismissPendingComments.useMutation({
	onSuccess: () => utils.aiReview.invalidate(),
});
const addReplyComment = trpc.github.addReviewComment.useMutation({
	onSuccess: () =>
		utils.projects.getPRDetails.invalidate({
			provider: prCtx.provider,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
		}),
});
const resolveThread = trpc.github.resolveThread.useMutation({
	onSuccess: () =>
		utils.projects.getPRDetails.invalidate({
			provider: prCtx.provider,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
		}),
});
```

- [ ] **Step 3: Add the `mapResolution` helper**

Above the `PROverviewTab` component (or inside it), add the helper from ReviewWorkspaceTab:

```typescript
function mapResolution(
	resolution: string | null
): "new" | "resolved" | "still_open" | "regressed" | null {
	switch (resolution) {
		case "new":
			return "new";
		case "resolved-by-code":
			return "resolved";
		case "still-open":
			return "still_open";
		case "incorrectly-resolved":
			return "regressed";
		default:
			return null;
	}
}
```

- [ ] **Step 4: Add review-mode computed values**

Inside PROverviewTab, after the mutations, compute review-mode values (guarded by `hasActiveDraft`):

```typescript
const draftComments = aiDraftQuery.data?.comments ?? [];
const isSolving =
	hasActiveDraft &&
	(matchingDraft.status === "queued" || matchingDraft.status === "in_progress");
const isCancelled = hasActiveDraft && matchingDraft.status === "cancelled";
const draftId = matchingDraft?.id ?? "";

// Comment counts (AI draft only)
let approvedCount = 0;
let rejectedCount = 0;
let pendingCount = 0;
if (hasActiveDraft) {
	for (const c of draftComments) {
		if (c.status === "approved") approvedCount++;
		else if (c.status === "rejected") rejectedCount++;
		else if (c.status !== "submitted") pendingCount++;
	}
}
const totalNonRejected = draftComments.length - rejectedCount;
const approvalPct = totalNonRejected > 0 ? (approvedCount / totalNonRejected) * 100 : 0;

const aiSuggestion =
	rejectedCount > 0
		? "Request Changes"
		: pendingCount === 0 && approvedCount > 0
			? "Approve"
			: "Comment";
```

- [ ] **Step 5: Build grouped-by-file items merging AI + GitHub threads**

```typescript
const groupedByFile = useMemo(() => {
	if (!hasActiveDraft || !details) return null;

	const map = new Map<string, FileGroupItem[]>();

	// AI draft comments
	for (const c of draftComments) {
		const items = map.get(c.filePath) ?? [];
		items.push({
			kind: "ai-draft",
			id: c.id,
			lineNumber: c.lineNumber,
			body: c.body,
			status: c.status,
			userEdit: c.userEdit ?? null,
			roundDelta: mapResolution(c.resolution ?? null),
		});
		map.set(c.filePath, items);
	}

	// GitHub threads
	for (const t of details.reviewThreads) {
		const items = map.get(t.path) ?? [];
		items.push({
			kind: "github-thread",
			id: t.id,
			lineNumber: t.line,
			isResolved: t.isResolved,
			comments: t.comments.map((c) => ({
				id: c.id,
				body: c.body,
				author: c.author,
				createdAt: c.createdAt,
			})),
		});
		map.set(t.path, items);
	}

	// Sort items within each file by line number
	for (const [, items] of map) {
		items.sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
	}

	return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}, [hasActiveDraft, draftComments, details]);

const firstPendingFile = groupedByFile?.find(([, items]) =>
	items.some(
		(i) =>
			i.kind === "ai-draft" &&
			i.status !== "approved" &&
			i.status !== "rejected" &&
			i.status !== "submitted"
	)
)?.[0];
```

- [ ] **Step 6: Add StatusStrip sub-component**

Add it as a local component in PROverviewTab.tsx (copied from ReviewWorkspaceTab, adapted to the PROverviewTab styling context — using `mx-6 mt-5` margins like the existing sections):

```tsx
function StatusStrip({
	approvedCount,
	rejectedCount,
	pendingCount,
	approvalPct,
	roundNumber,
	aiSuggestion,
	isSolving,
	onCancel,
}: {
	approvedCount: number;
	rejectedCount: number;
	pendingCount: number;
	approvalPct: number;
	roundNumber: number;
	aiSuggestion: string;
	isSolving: boolean;
	onCancel: () => void;
}) {
	return (
		<div className="mx-6 mt-4 mb-1">
			<div className="flex items-center gap-[5px] mb-[8px]">
				{isSolving && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)]">
						<span className="w-1 h-1 rounded-full bg-current animate-pulse" />
						Reviewing…
					</span>
				)}
				{approvedCount > 0 && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)]">
						<span className="w-1 h-1 rounded-full bg-current" />
						{approvedCount} approved
					</span>
				)}
				{rejectedCount > 0 && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--danger-subtle)] text-[var(--danger)]">
						<span className="w-1 h-1 rounded-full bg-current" />
						{rejectedCount} rejected
					</span>
				)}
				{pendingCount > 0 && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
						<span className="w-1 h-1 rounded-full bg-current" />
						{pendingCount} pending
					</span>
				)}
				{isSolving && (
					<button
						type="button"
						onClick={onCancel}
						className="ml-auto px-[10px] py-[3px] rounded-[6px] text-[11px] font-medium text-[var(--danger)] bg-[var(--danger-subtle)] border-none cursor-pointer"
					>
						Cancel
					</button>
				)}
			</div>
			<div className="flex justify-between items-center mb-[5px]">
				<span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
					Round {roundNumber}
				</span>
				{!isSolving && (
					<span className="text-[10.5px] text-[var(--text-tertiary)]">
						AI suggests: {aiSuggestion}
					</span>
				)}
			</div>
			<div className="h-[2px] bg-[var(--bg-elevated)] rounded-[1px] overflow-hidden">
				<div
					className="h-full bg-[var(--success)] rounded-[1px]"
					style={{ width: `${approvalPct}%`, transition: "width 0.5s ease" }}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 7: Add ReviewBottomBar sub-component**

```tsx
function ReviewBottomBar({
	statusMessage,
	isSolving,
	pendingCount,
	showVerdictConfirmation,
	isSubmitting,
	onDismiss,
	onShowVerdict,
	onCancelVerdict,
	onSubmitVerdict,
}: {
	statusMessage: string;
	isSolving: boolean;
	pendingCount: number;
	showVerdictConfirmation: boolean;
	isSubmitting: boolean;
	onDismiss: () => void;
	onShowVerdict: () => void;
	onCancelVerdict: () => void;
	onSubmitVerdict: (verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES", body: string) => void;
}) {
	if (showVerdictConfirmation) {
		return (
			<ReviewVerdictConfirmation
				onSubmit={onSubmitVerdict}
				onCancel={onCancelVerdict}
				isSubmitting={isSubmitting}
			/>
		);
	}

	return (
		<div className="border-t border-[var(--border-subtle)] px-6 py-3 flex items-center justify-between">
			<span className="text-[11px] text-[var(--text-tertiary)]">{statusMessage}</span>
			<div className="flex items-center gap-[6px]">
				<button
					type="button"
					onClick={onDismiss}
					className="px-[14px] py-[6px] rounded-[6px] text-[12px] font-medium text-[var(--text-secondary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Dismiss
				</button>
				{!isSolving && (
					<button
						type="button"
						onClick={onShowVerdict}
						disabled={pendingCount > 0}
						className={[
							"px-4 py-[6px] rounded-[6px] text-[12px] font-semibold border-none",
							pendingCount === 0
								? "cursor-pointer bg-[var(--success)] text-white"
								: "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-tertiary)]",
						].join(" ")}
					>
						Submit Review
					</button>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 8: Update the return JSX to conditionally render review mode**

Replace the current return in `PROverviewTab` with:

```tsx
const statusMessage = isSolving
	? "Reviewing..."
	: isCancelled
		? "Cancelled"
		: pendingCount > 0
			? `${pendingCount} comments pending review`
			: "All comments reviewed";

return (
	<div className="flex flex-col h-full overflow-hidden">
		<div className="flex-1 overflow-y-auto bg-[var(--bg-base)]">
			<div className="mx-auto max-w-[800px] pb-10">
				{/* PR Header — always shown */}
				<PRHeader details={details} prCtx={prCtx} />

				{/* Status Strip — review mode only */}
				{hasActiveDraft && (
					<StatusStrip
						approvedCount={approvedCount}
						rejectedCount={rejectedCount}
						pendingCount={pendingCount}
						approvalPct={approvalPct}
						roundNumber={aiDraftQuery.data?.roundNumber ?? 1}
						aiSuggestion={aiSuggestion}
						isSolving={isSolving}
						onCancel={() => cancelMutation.mutate({ draftId })}
					/>
				)}

				{/* AI Summary — always shown when available */}
				{summaryMarkdown && <AISummaryCard summaryMarkdown={summaryMarkdown} />}

				{/* Review mode: grouped-by-file cards */}
				{hasActiveDraft && groupedByFile && (
					<div className="mx-6 mt-5">
						<div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)] mb-2">
							{groupedByFile.length} Files
						</div>
						{groupedByFile.map(([filePath, fileItems]) => (
							<ReviewFileGroupCard
								key={filePath}
								filePath={filePath}
								items={fileItems}
								defaultExpanded={filePath === firstPendingFile}
								onApprove={(commentId) =>
									updateComment.mutate({ commentId, status: "approved" })
								}
								onReject={(commentId) =>
									updateComment.mutate({ commentId, status: "rejected" })
								}
								onEdit={(commentId, newBody) =>
									updateComment.mutate({
										commentId,
										status: "edited",
										userEdit: newBody,
									})
								}
								onApproveAll={(commentIds) =>
									batchUpdate.mutate({ commentIds, status: "approved" })
								}
								onOpenInDiff={(path) => {
									if (!activeWorkspaceId) return;
									openPRReviewFile(activeWorkspaceId, prCtx, path, detectLanguage(path));
								}}
								onReplyToThread={(threadId, body) =>
									addReplyComment.mutate({ threadId, body })
								}
								onResolveThread={(threadId) =>
									resolveThread.mutate({ threadId })
								}
							/>
						))}
					</div>
				)}

				{/* Read-only mode: flat comments feed */}
				{!hasActiveDraft && (
					<CommentsFeed details={details} prCtx={prCtx} aiThreads={aiThreads} />
				)}

				{/* Chain History — review mode only */}
				{hasActiveDraft && chainHistory && chainHistory.length > 1 && (
					<div className="mx-6 mt-5">
						<button
							type="button"
							onClick={() => setHistoryExpanded(!historyExpanded)}
							className="flex items-center gap-[6px] cursor-pointer select-none mb-[6px] bg-transparent border-none p-0"
						>
							<span
								className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
								style={{
									transform: historyExpanded ? "rotate(90deg)" : "none",
								}}
							>
								›
							</span>
							<span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
								Review History · {chainHistory.length} rounds
							</span>
						</button>
						{historyExpanded && (
							<div className="bg-[var(--bg-elevated)] rounded-[6px] p-[10px_14px]">
								{chainHistory.map((entry) => (
									<div
										key={entry.id}
										className="text-[11px] text-[var(--text-secondary)] py-[3px]"
									>
										Round {entry.roundNumber} ·{" "}
										{new Date(entry.createdAt).toLocaleDateString("en-US", {
											month: "short",
											day: "numeric",
										})}{" "}
										· {entry.commentCount} comments ·{" "}
										<span className="capitalize">{entry.status}</span>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>

		{/* Bottom Bar — review mode only */}
		{hasActiveDraft && (
			<ReviewBottomBar
				statusMessage={statusMessage}
				isSolving={isSolving}
				pendingCount={pendingCount}
				showVerdictConfirmation={showVerdictConfirmation}
				isSubmitting={submitReview.isPending}
				onDismiss={() => dismissPending.mutate({ draftId })}
				onShowVerdict={() => setShowVerdictConfirmation(true)}
				onCancelVerdict={() => setShowVerdictConfirmation(false)}
				onSubmitVerdict={(verdict, body) =>
					submitReview.mutate({ draftId, verdict, body })
				}
			/>
		)}
	</div>
);
```

- [ ] **Step 9: Add missing imports**

Make sure these are imported at the top of PROverviewTab:

```typescript
import { useMemo, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
```

Also ensure `openPRReviewFile` and `activeWorkspaceId` are available from the tab store (add inside the component):

```typescript
const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
```

- [ ] **Step 10: Verify build passes**

Run: `bun run type-check`
Expected: may still have errors from ReviewWorkspaceTab (deleted in next task) but PROverviewTab should compile

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src/renderer/components/PROverviewTab.tsx
git commit -m "feat: add review-mode UI to PROverviewTab with status strip, file groups, and submit bar"
```

---

### Task 3: Remove ReviewWorkspaceTab and all references

**Files:**
- Delete: `apps/desktop/src/renderer/components/ReviewWorkspaceTab.tsx`
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`
- Modify: `apps/desktop/src/renderer/components/panes/PaneContent.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Delete ReviewWorkspaceTab.tsx**

```bash
rm apps/desktop/src/renderer/components/ReviewWorkspaceTab.tsx
```

- [ ] **Step 2: Remove the `review-workspace` tab kind from tab-store.ts**

In `apps/desktop/src/renderer/stores/tab-store.ts`, remove the union member from `TabItem`:

```typescript
// DELETE this entire block from the TabItem union:
	| {
			kind: "review-workspace";
			id: string;
			workspaceId: string;
			draftId: string;
			title: string;
	  };
```

- [ ] **Step 3: Remove `addReviewWorkspaceTab` from tab-store.ts**

Remove the type from the store interface (line ~172):

```typescript
// DELETE:
	addReviewWorkspaceTab: (workspaceId: string, draftId: string) => string;
```

Remove the implementation (the `addReviewWorkspaceTab: (workspaceId, draftId) => { ... }` block).

- [ ] **Step 4: Remove the review-workspace case from PaneContent.tsx**

In `apps/desktop/src/renderer/components/panes/PaneContent.tsx`, remove:

```tsx
// DELETE:
			{activeTab?.kind === "review-workspace" && (
				<div className="absolute inset-0">
					<ReviewWorkspaceTab draftId={activeTab.draftId} />
				</div>
			)}
```

And remove the import:

```typescript
// DELETE:
import { ReviewWorkspaceTab } from "../ReviewWorkspaceTab";
```

- [ ] **Step 5: Remove the review-workspace filter from App.tsx**

In `apps/desktop/src/renderer/App.tsx`, remove:

```typescript
// DELETE:
				if ((saved as { kind: string }).kind === "review-workspace") {
					return null;
				}
```

- [ ] **Step 6: Verify build passes**

Run: `bun run type-check`
Expected: success, no references to `review-workspace` remain

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "refactor: remove ReviewWorkspaceTab — features now live in PROverviewTab"
```

---

### Task 4: Update PRControlRail to stop opening review-workspace tabs

**Files:**
- Modify: `apps/desktop/src/renderer/components/PRControlRail.tsx`

- [ ] **Step 1: Update `triggerReview` onSuccess callback**

In `PRControlRail.tsx`, find the `triggerReview` mutation's `onSuccess` and remove the `addReviewWorkspaceTab` call:

```typescript
const triggerReview = trpc.aiReview.triggerReview.useMutation({
	onSuccess: (launchInfo) => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
		if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;
		const tabStore = useTabStore.getState();
		const tabId = tabStore.addTerminalTab(
			launchInfo.reviewWorkspaceId,
			launchInfo.worktreePath,
			"AI Review"
		);
		// REMOVED: tabStore.addReviewWorkspaceTab(...)
		attachTerminal.mutate({
			workspaceId: launchInfo.reviewWorkspaceId,
			terminalId: tabId,
		});
		setTimeout(() => {
			window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
		}, 500);
	},
});
```

- [ ] **Step 2: Update `triggerFollowUp` onSuccess callback**

Same change — remove `addReviewWorkspaceTab`:

```typescript
const triggerFollowUp = trpc.aiReview.triggerFollowUp.useMutation({
	onSuccess: (launchInfo) => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
		if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;
		const tabStore = useTabStore.getState();
		const tabId = tabStore.addTerminalTab(
			launchInfo.reviewWorkspaceId,
			launchInfo.worktreePath,
			"AI Re-review"
		);
		// REMOVED: tabStore.addReviewWorkspaceTab(...)
		attachTerminal.mutate({
			workspaceId: launchInfo.reviewWorkspaceId,
			terminalId: tabId,
		});
		setTimeout(() => {
			window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
		}, 500);
	},
});
```

- [ ] **Step 3: Update the review-in-progress banner**

The banner in CommentsTab currently tries to find a `review-workspace` tab. Since that tab kind no longer exists, update it to find the `pr-overview` tab instead:

```tsx
{/* Review-in-progress banner */}
{hasActiveDraft && (
	<button
		type="button"
		onClick={() => {
			const tabStore = useTabStore.getState();
			const tabs = tabStore.getVisibleTabs();
			const overviewTab = tabs.find(
				(t) => t.kind === "pr-overview" && t.prCtx.owner === prCtx.owner && t.prCtx.repo === prCtx.repo && t.prCtx.number === prCtx.number
			);
			if (overviewTab) tabStore.setActiveTab(overviewTab.id);
		}}
		className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)]"
	>
		<span className="size-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
		<span className="flex-1 text-[10px] text-[var(--text-tertiary)]">
			AI review in progress
		</span>
		<span className="text-[10px] text-[var(--accent)]">View in PR Tab</span>
	</button>
)}
```

- [ ] **Step 4: Verify build passes**

Run: `bun run type-check`
Expected: success

- [ ] **Step 5: Run tests**

Run: `cd apps/desktop && bun test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/PRControlRail.tsx
git commit -m "refactor: stop opening review-workspace tabs from PRControlRail"
```

---

### Task 5: Clean up and verify

**Files:**
- Modify: `apps/desktop/tests/workspace-review.test.ts` (if it references review-workspace)

- [ ] **Step 1: Search for any remaining references to review-workspace or ReviewWorkspaceTab**

Run: `grep -r "review-workspace\|ReviewWorkspaceTab\|addReviewWorkspaceTab" apps/desktop/src/ apps/desktop/tests/`
Expected: no matches

- [ ] **Step 2: Fix any remaining references found**

If grep finds any, update them. Likely candidates:
- `tests/workspace-review.test.ts` — may reference `addReviewWorkspaceTab`

- [ ] **Step 3: Run full type-check**

Run: `bun run type-check`
Expected: success

- [ ] **Step 4: Run full test suite**

Run: `cd apps/desktop && bun test`
Expected: all tests pass

- [ ] **Step 5: Run linter**

Run: `bun run check`
Expected: no new errors

- [ ] **Step 6: Final commit if any cleanup was needed**

```bash
git add -u
git commit -m "chore: clean up remaining review-workspace references"
```
