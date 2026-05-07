# Comment Solver UI Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-tab Solve Review flow (overview tab + per-file diff tab) with a single sidebar-driven tab where comments live as inline view-zones at the lines they fixed — mirroring the existing `ReviewTab` and `PRReviewFileTab` patterns.

**Architecture:** Single `SolveReviewTab` component. Left sidebar = grouped file list (one section per commit-group, with the group's `GroupAction`). Main pane = Monaco diff for the selected file with `SolveCommentWidget` view-zones at each comment's `lineNumber`. Per-session UI state (selected file, scroll-by-file, active comment, expanded groups, file order) lives in a new `solve-session-store` keyed by `solveSessionId`. Keyboard shortcuts ride on a new `solve-review-events` bus that mirrors `pr-review-events`. The legacy `comment-fix-file` tab kind and its component are deleted.

**Tech Stack:** React 19, TypeScript (strict), Zustand stores, Monaco diff editor (`monaco-editor`), tRPC over Electron IPC, Bun test runner, Biome.

**Reference files (read for patterns, copy-adapt, do not modify):**
- `apps/desktop/src/renderer/stores/pr-review-session-store.ts` — store shape to mirror
- `apps/desktop/src/renderer/lib/pr-review-events.ts` — event bus pattern to mirror
- `apps/desktop/src/renderer/components/PRReviewFileTab.tsx` — `useInlineCommentZones`, `useThreadDecorations`, scroll persistence, view-zone widget rendering
- `apps/desktop/src/renderer/components/review/ActiveThreadBar.tsx` — active-comment bar pattern
- `apps/desktop/src/renderer/components/review/ReviewHintBar.tsx` — keyboard hint strip

**Spec:** `docs/superpowers/specs/2026-04-27-comment-solver-ui-rework-design.md`

---

## Task 1: Extract `GroupAction` and `RatioBadge` from `SolveCommitGroupCard.tsx`

**Why:** The sidebar in the new layout reuses these two sub-components verbatim. Extract them first so later tasks just import. No behavior change.

**Files:**
- Create: `apps/desktop/src/renderer/components/solve/GroupAction.tsx`
- Create: `apps/desktop/src/renderer/components/solve/RatioBadge.tsx`
- Modify: `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`

- [ ] **Step 1: Create `solve/RatioBadge.tsx`**

```tsx
// apps/desktop/src/renderer/components/solve/RatioBadge.tsx
import type { SolveGroupInfo } from "../../../shared/solve-types";

export function RatioBadge({ group }: { group: SolveGroupInfo }) {
	const fixed = group.comments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const total = group.comments.length;
	const hasUnclear = group.comments.some((c) => c.status === "unclear");

	const bg =
		total === 0
			? "var(--bg-active)"
			: fixed === total
				? "var(--success-subtle)"
				: hasUnclear
					? "var(--warning-subtle)"
					: "var(--bg-active)";
	const color =
		total === 0
			? "var(--text-tertiary)"
			: fixed === total
				? "var(--success)"
				: hasUnclear
					? "var(--warning)"
					: "var(--text-tertiary)";

	return (
		<span
			className="shrink-0 py-[1px] px-[7px] rounded-full font-mono text-[10px] font-medium"
			style={{ background: bg, color }}
		>
			{fixed}/{total}
		</span>
	);
}
```

- [ ] **Step 2: Create `solve/GroupAction.tsx`**

```tsx
// apps/desktop/src/renderer/components/solve/GroupAction.tsx
import type { SolveGroupInfo } from "../../../shared/solve-types";

interface Props {
	group: SolveGroupInfo;
	onApprove: () => void;
	onRevoke: () => void;
	onPush: () => void;
	isPushing: boolean;
}

export function GroupAction({ group, onApprove, onRevoke, onPush, isPushing }: Props) {
	const hasDraftReplies = group.comments.some((c) => c.reply?.status === "draft");

	if (group.status === "pending") {
		return (
			<span className="flex items-center gap-[6px] text-[11.5px] text-[var(--accent)] font-medium">
				<span
					className="w-[6px] h-[6px] rounded-full bg-[var(--accent)]"
					style={{ animation: "blink 1.6s ease-in-out infinite" }}
				/>
				Solving
			</span>
		);
	}
	if (group.status === "submitted") {
		return (
			<span className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)]">
				✓ Pushed
			</span>
		);
	}
	if (group.status === "approved") {
		return (
			<div className="flex items-center gap-[6px]">
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRevoke();
					}}
					className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Revoke
				</button>
				{hasDraftReplies ? (
					<span className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)]">
						✓ Approved
					</span>
				) : (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onPush();
						}}
						disabled={isPushing}
						className={`py-[4px] px-[12px] rounded-[6px] text-[11.5px] font-semibold border-none ${isPushing ? "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-tertiary)]" : "cursor-pointer bg-[var(--success)] text-[var(--accent-foreground)]"}`}
					>
						{isPushing ? "Pushing…" : "Push & post"}
					</button>
				)}
			</div>
		);
	}
	if (group.status === "fixed") {
		return (
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onApprove();
				}}
				className="py-[4px] px-[12px] rounded-[6px] text-[11.5px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
			>
				Approve
			</button>
		);
	}
	return null;
}
```

- [ ] **Step 3: Update `SolveCommitGroupCard.tsx` to import from new locations**

Open `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`. At the top of the file, after the existing imports, add:

```ts
import { GroupAction } from "./solve/GroupAction";
import { RatioBadge } from "./solve/RatioBadge";
```

Then remove the local `RatioBadge` function (currently at lines 146-178) and the local `GroupAction` function (currently at lines 180-261). The JSX call sites (`<RatioBadge group={group} />` and `<GroupAction ... />`) stay unchanged — they now resolve to the imported versions.

- [ ] **Step 4: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors. The `noUnusedLocals` rule will fire if a local function reference remains; remove if so.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/GroupAction.tsx \
        apps/desktop/src/renderer/components/solve/RatioBadge.tsx \
        apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx
git commit -m "refactor(solve): extract GroupAction and RatioBadge"
```

---

## Task 2: Extract `SolveCommentWidget` and `DraftReplySignoff`

**Why:** This component is the unit rendered inside the diff view-zone. Lift it from `SolveCommitGroupCard.CommentItem` so both the new diff pane and the comments-only fallback render the same markup. No behavior change.

**Files:**
- Create: `apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx`
- Create: `apps/desktop/src/renderer/components/solve/DraftReplySignoff.tsx`
- Modify: `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`

- [ ] **Step 1: Create `solve/DraftReplySignoff.tsx`**

```tsx
// apps/desktop/src/renderer/components/solve/DraftReplySignoff.tsx
import type { SolveReplyInfo } from "../../../shared/solve-types";
import { trpc } from "../../trpc/client";

export function DraftReplySignoff({
	reply,
	onEdit,
}: {
	reply: SolveReplyInfo;
	onEdit: () => void;
}) {
	const utils = trpc.useUtils();
	const approveMutation = trpc.commentSolver.approveReply.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});
	const deleteMutation = trpc.commentSolver.deleteReply.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	return (
		<div className="mt-[8px] py-[9px] px-[12px] bg-[var(--bg-base)] border border-[var(--border-default)] rounded-[6px]">
			<div className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[var(--warning)] mb-[4px] opacity-75">
				Draft reply
			</div>
			<div className="text-[12px] text-[var(--text-secondary)] leading-[1.5]">{reply.body}</div>
			<div className="flex items-center gap-[6px] mt-[8px] pt-[8px] border-t border-[var(--border-subtle)]">
				<span className="text-[11px] text-[var(--text-tertiary)] flex-1">Post this reply?</span>
				<button
					type="button"
					onClick={onEdit}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
				>
					Edit
				</button>
				<button
					type="button"
					onClick={() => deleteMutation.mutate({ replyId: reply.id })}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
				>
					Discard
				</button>
				<button
					type="button"
					onClick={() => approveMutation.mutate({ replyId: reply.id })}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
				>
					Approve &amp; post
				</button>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Create `solve/SolveCommentWidget.tsx`**

```tsx
// apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx
import { useState } from "react";
import type { SolveCommentInfo } from "../../../shared/solve-types";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { DraftReplySignoff } from "./DraftReplySignoff";

interface Props {
	comment: SolveCommentInfo;
	workspaceId: string;
}

export function SolveCommentWidget({ comment, workspaceId }: Props) {
	const [showFollowUp, setShowFollowUp] = useState(false);
	const [followUpText, setFollowUpText] = useState("");
	const utils = trpc.useUtils();

	const [editingReply, setEditingReply] = useState(false);
	const [editReplyText, setEditReplyText] = useState("");

	const updateReplyMutation = trpc.commentSolver.updateReply.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const followUpMutation = trpc.commentSolver.requestFollowUp.useMutation({
		onSuccess: (result) => {
			setShowFollowUp(false);
			setFollowUpText("");
			utils.commentSolver.invalidate();

			if (result.promptPath && result.worktreePath) {
				const tabStore = useTabStore.getState();
				const tabs = tabStore.getTabsByWorkspace(workspaceId);
				const solverTab = tabs.find((t) => t.kind === "terminal" && t.title === "AI Solver");

				if (solverTab) {
					tabStore.setActiveTab(solverTab.id);
					window.electron.terminal
						.write(solverTab.id, `bash '${result.launchScript}'\r`)
						.catch((err: unknown) =>
							console.error("[solve] failed to write follow-up command:", err)
						);
				} else {
					const tabId = tabStore.addTerminalTab(workspaceId, result.worktreePath, "AI Solver");
					window.electron.terminal
						.create(tabId, result.worktreePath)
						.then(() => window.electron.terminal.write(tabId, `bash '${result.launchScript}'\r`))
						.catch((err: unknown) =>
							console.error("[solve] failed to launch follow-up agent:", err)
						);
				}
			}
		},
	});

	const statusColor =
		comment.status === "fixed" || comment.status === "wont_fix"
			? "var(--success)"
			: comment.status === "unclear"
				? "var(--warning)"
				: comment.status === "changes_requested"
					? "var(--accent)"
					: "var(--text-tertiary)";

	const statusLabel =
		comment.status === "fixed"
			? "✓ Fixed"
			: comment.status === "unclear"
				? "? Unclear"
				: comment.status === "changes_requested"
					? "↻ Changes requested"
					: comment.status === "wont_fix"
						? "— Won't fix"
						: "Pending";

	return (
		<div className="mx-2 my-1 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] shadow-md overflow-hidden">
			<div className="flex items-center gap-[6px] px-3 py-2">
				<div className="w-[16px] h-[16px] rounded-full bg-[var(--bg-active)] flex items-center justify-center text-[8px] font-semibold text-[var(--text-secondary)]">
					{comment.author.charAt(0).toUpperCase()}
				</div>
				<span className="text-[12px] font-medium">{comment.author}</span>
				{comment.lineNumber && (
					<span className="font-mono text-[10.5px] text-[var(--text-tertiary)]">
						line {comment.lineNumber}
					</span>
				)}
				<span
					className="ml-auto text-[10.5px] font-medium"
					style={{ color: statusColor }}
				>
					{statusLabel}
				</span>
			</div>
			<div className="px-3 pb-2 text-[12px] text-[var(--text-secondary)] leading-[1.55]">
				<MarkdownRenderer content={comment.body} />
			</div>
			<div className="flex items-center gap-[8px] px-3 pb-2">
				{(comment.status === "fixed" || comment.status === "unclear") && (
					<button
						type="button"
						onClick={() => setShowFollowUp(!showFollowUp)}
						className="text-[10.5px] text-[var(--text-tertiary)] bg-transparent border-none cursor-pointer underline underline-offset-2"
					>
						Follow up
					</button>
				)}
			</div>
			{comment.status === "unclear" && (
				<div className="px-3 pb-2 text-[10.5px] text-[var(--text-tertiary)] leading-[1.4]">
					AI couldn't address this — use Follow up above or accept as-is.
				</div>
			)}
			{showFollowUp && (
				<div className="px-3 pb-2">
					<textarea
						value={followUpText}
						onChange={(e) => setFollowUpText(e.target.value)}
						placeholder="What should be changed?"
						className="w-full min-h-[60px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] resize-y"
					/>
					<div className="flex gap-[6px] mt-[6px] justify-end">
						<button
							type="button"
							onClick={() => {
								setShowFollowUp(false);
								setFollowUpText("");
							}}
							className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => followUpMutation.mutate({ commentId: comment.id, followUpText })}
							disabled={!followUpText.trim()}
							className={[
								"py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none",
								followUpText.trim()
									? "cursor-pointer opacity-100"
									: "cursor-not-allowed opacity-50",
							].join(" ")}
						>
							Request changes
						</button>
					</div>
				</div>
			)}
			{comment.followUpText && (
				<div className="mx-3 mb-2 py-[6px] px-[10px] bg-[var(--accent-subtle)] rounded-[6px] text-[11.5px] text-[var(--accent)]">
					Follow-up: {comment.followUpText}
				</div>
			)}
			{comment.reply?.status === "draft" && !editingReply && (
				<div className="px-3 pb-2">
					<DraftReplySignoff
						reply={comment.reply}
						onEdit={() => {
							setEditingReply(true);
							setEditReplyText(comment.reply?.body ?? "");
						}}
					/>
				</div>
			)}
			{editingReply && comment.reply && (
				<div className="mx-3 mb-2 py-[9px] px-[12px] bg-[var(--bg-base)] border border-[var(--accent)] rounded-[6px]">
					<div className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[var(--text-tertiary)] mb-[4px]">
						Edit reply
					</div>
					<textarea
						value={editReplyText}
						onChange={(e) => setEditReplyText(e.target.value)}
						className="w-full min-h-[60px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] resize-y"
					/>
					<div className="flex gap-[6px] mt-[6px] justify-end">
						<button
							type="button"
							onClick={() => setEditingReply(false)}
							className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => {
								if (comment.reply) {
									updateReplyMutation.mutate({
										replyId: comment.reply.id,
										body: editReplyText,
									});
								}
								setEditingReply(false);
							}}
							disabled={!editReplyText.trim()}
							className={[
								"py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none",
								editReplyText.trim()
									? "cursor-pointer opacity-100"
									: "cursor-not-allowed opacity-50",
							].join(" ")}
						>
							Save
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 3: Update `SolveCommitGroupCard.tsx` to import the widget**

Open `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`. At the top, add:

```ts
import { SolveCommentWidget } from "./solve/SolveCommentWidget";
```

In `CommentsAddressedSection`, replace the `<CommentItem>` JSX with `<SolveCommentWidget>`:

```tsx
{comments.map((comment) => (
	<SolveCommentWidget key={comment.id} comment={comment} workspaceId={workspaceId} />
))}
```

Then remove the now-unused local `CommentItem` and `DraftReplySignoff` functions from this file.

- [ ] **Step 4: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors.

- [ ] **Step 5: Sanity-check by hand**

Run: `bun run dev`
Open a workspace with an existing solve session. Confirm the comment cards still render the same: status pill, follow-up button, draft-reply sign-off. No visual diff vs. before.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx \
        apps/desktop/src/renderer/components/solve/DraftReplySignoff.tsx \
        apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx
git commit -m "refactor(solve): extract SolveCommentWidget and DraftReplySignoff"
```

---

## Task 3: Add `solve-session-store.ts` with tests

**Why:** Per-session UI state (selection, scroll-by-file, expanded groups, file order) lives here. Tests guarantee selection invariants and scroll persistence stay correct as we wire UI on top.

**Files:**
- Create: `apps/desktop/src/renderer/stores/solve-session-store.ts`
- Create: `apps/desktop/tests/solve-session-store.test.ts`

- [ ] **Step 1: Write failing tests for selection and scroll**

```ts
// apps/desktop/tests/solve-session-store.test.ts
import { beforeEach, describe, expect, it } from "bun:test";
import { useSolveSessionStore } from "../src/renderer/stores/solve-session-store";

describe("solve-session-store", () => {
	beforeEach(() => {
		useSolveSessionStore.setState({ sessions: new Map() });
	});

	it("selectFile sets activeFilePath", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile("s1", "src/foo.ts");
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("src/foo.ts");
	});

	it("selectFile to same path is a no-op (same Map reference)", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile("s1", "src/foo.ts");
		const before = useSolveSessionStore.getState().sessions;
		selectFile("s1", "src/foo.ts");
		expect(useSolveSessionStore.getState().sessions).toBe(before);
	});

	it("setFileOrder drops scroll entries for files no longer present", () => {
		const { setFileOrder, setScroll } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts", "c.ts"]);
		setScroll("s1", "a.ts", 100);
		setScroll("s1", "b.ts", 200);
		setFileOrder("s1", ["a.ts", "c.ts"]);
		const s = useSolveSessionStore.getState().sessions.get("s1");
		expect(s?.scrollByFile.get("a.ts")).toBe(100);
		expect(s?.scrollByFile.has("b.ts")).toBe(false);
	});

	it("setFileOrder reselects to first file when active is removed", () => {
		const { setFileOrder, selectFile } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts"]);
		selectFile("s1", "b.ts");
		setFileOrder("s1", ["a.ts", "c.ts"]);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("a.ts");
	});

	it("setFileOrder keeps active file when still present", () => {
		const { setFileOrder, selectFile } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts"]);
		selectFile("s1", "b.ts");
		setFileOrder("s1", ["a.ts", "b.ts", "c.ts"]);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("b.ts");
	});

	it("advanceFile moves through fileOrder and clamps at ends", () => {
		const { setFileOrder, selectFile, advanceFile } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts", "c.ts"]);
		selectFile("s1", "a.ts");
		advanceFile("s1", 1);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("b.ts");
		advanceFile("s1", 1);
		advanceFile("s1", 1); // clamped
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("c.ts");
		advanceFile("s1", -1);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("b.ts");
	});

	it("toggleGroupExpanded flips a group's expanded state", () => {
		const { toggleGroupExpanded } = useSolveSessionStore.getState();
		toggleGroupExpanded("s1", "g1");
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(true);
		toggleGroupExpanded("s1", "g1");
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(false);
	});

	it("setExpandedGroups replaces the whole set", () => {
		const { setExpandedGroups } = useSolveSessionStore.getState();
		setExpandedGroups("s1", new Set(["g1", "g2"]));
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(true);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g2")).toBe(true);
		setExpandedGroups("s1", new Set(["g3"]));
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(false);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g3")).toBe(true);
	});

	it("dropSession removes a session", () => {
		const { selectFile, dropSession } = useSolveSessionStore.getState();
		selectFile("s1", "a.ts");
		dropSession("s1");
		expect(useSolveSessionStore.getState().sessions.has("s1")).toBe(false);
	});

	it("getScroll returns undefined for unknown path", () => {
		const { getScroll } = useSolveSessionStore.getState();
		expect(getScroll("s1", "missing.ts")).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to confirm they fail (module does not exist yet)**

Run: `cd apps/desktop && bun test tests/solve-session-store.test.ts`
Expected: FAIL with "Cannot find module" for `solve-session-store`.

- [ ] **Step 3: Implement `solve-session-store.ts`**

```ts
// apps/desktop/src/renderer/stores/solve-session-store.ts
import { create } from "zustand";

export interface SolveSession {
	activeFilePath: string | null;
	activeCommentId: string | null;
	scrollByFile: Map<string, number>;
	expandedGroupIds: Set<string>;
	fileOrder: string[];
}

export interface SolveSessionStore {
	sessions: Map<string, SolveSession>;

	selectFile: (key: string, path: string | null) => void;
	advanceFile: (key: string, delta: 1 | -1) => void;
	selectComment: (key: string, id: string | null) => void;
	setScroll: (key: string, path: string, top: number) => void;
	getScroll: (key: string, path: string) => number | undefined;
	setFileOrder: (key: string, files: string[]) => void;
	toggleGroupExpanded: (key: string, groupId: string) => void;
	setExpandedGroups: (key: string, groupIds: Set<string>) => void;
	dropSession: (key: string) => void;
}

function emptySession(): SolveSession {
	return {
		activeFilePath: null,
		activeCommentId: null,
		scrollByFile: new Map(),
		expandedGroupIds: new Set(),
		fileOrder: [],
	};
}

function withSession(
	state: SolveSessionStore,
	key: string,
	mut: (s: SolveSession) => SolveSession
): Map<string, SolveSession> {
	const cur = state.sessions.get(key) ?? emptySession();
	const next = mut(cur);
	if (next === cur) return state.sessions;
	const map = new Map(state.sessions);
	map.set(key, next);
	return map;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export const useSolveSessionStore = create<SolveSessionStore>()((set, get) => ({
	sessions: new Map(),

	selectFile: (key, path) =>
		set((state) => {
			const next = withSession(state, key, (s) =>
				s.activeFilePath === path ? s : { ...s, activeFilePath: path }
			);
			return next === state.sessions ? state : { sessions: next };
		}),

	advanceFile: (key, delta) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				if (s.fileOrder.length === 0) return s;
				if (s.activeFilePath === null) {
					return { ...s, activeFilePath: s.fileOrder[0] ?? null };
				}
				const idx = s.fileOrder.indexOf(s.activeFilePath);
				if (idx === -1) return { ...s, activeFilePath: s.fileOrder[0] ?? null };
				const nextIdx = Math.min(s.fileOrder.length - 1, Math.max(0, idx + delta));
				const nextPath = s.fileOrder[nextIdx] ?? null;
				return nextPath === s.activeFilePath ? s : { ...s, activeFilePath: nextPath };
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	selectComment: (key, id) =>
		set((state) => {
			const next = withSession(state, key, (s) =>
				s.activeCommentId === id ? s : { ...s, activeCommentId: id }
			);
			return next === state.sessions ? state : { sessions: next };
		}),

	setScroll: (key, path, top) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				if (s.scrollByFile.get(path) === top) return s;
				const m = new Map(s.scrollByFile);
				m.set(path, top);
				return { ...s, scrollByFile: m };
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	getScroll: (key, path) => get().sessions.get(key)?.scrollByFile.get(path),

	setFileOrder: (key, files) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				const orderUnchanged = arraysEqual(s.fileOrder, files);
				const stillThere = s.activeFilePath != null && files.includes(s.activeFilePath);
				const nextActive =
					s.activeFilePath != null && !stillThere ? (files[0] ?? null) : s.activeFilePath;
				const fileSet = new Set(files);
				let scroll = s.scrollByFile;
				let hasStale = false;
				for (const p of s.scrollByFile.keys()) {
					if (!fileSet.has(p)) {
						hasStale = true;
						break;
					}
				}
				if (hasStale) {
					scroll = new Map();
					for (const [p, top] of s.scrollByFile) if (fileSet.has(p)) scroll.set(p, top);
				}
				if (orderUnchanged && nextActive === s.activeFilePath && scroll === s.scrollByFile) {
					return s;
				}
				return {
					...s,
					fileOrder: orderUnchanged ? s.fileOrder : [...files],
					activeFilePath: nextActive,
					scrollByFile: scroll,
				};
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	toggleGroupExpanded: (key, groupId) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				const expanded = new Set(s.expandedGroupIds);
				if (expanded.has(groupId)) expanded.delete(groupId);
				else expanded.add(groupId);
				return { ...s, expandedGroupIds: expanded };
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	setExpandedGroups: (key, groupIds) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				if (s.expandedGroupIds.size === groupIds.size) {
					let allMatch = true;
					for (const id of groupIds) {
						if (!s.expandedGroupIds.has(id)) {
							allMatch = false;
							break;
						}
					}
					if (allMatch) return s;
				}
				return { ...s, expandedGroupIds: new Set(groupIds) };
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	dropSession: (key) =>
		set((state) => {
			if (!state.sessions.has(key)) return state;
			const map = new Map(state.sessions);
			map.delete(key);
			return { sessions: map };
		}),
}));
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd apps/desktop && bun test tests/solve-session-store.test.ts`
Expected: All 10 tests pass.

- [ ] **Step 5: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/stores/solve-session-store.ts \
        apps/desktop/tests/solve-session-store.test.ts
git commit -m "feat(solve): add solve-session-store with selection and scroll state"
```

---

## Task 4: Add `solve-review-events.ts`

**Why:** Keyboard shortcuts emit on a window event bus so they don't have to be threaded through React props. Mirrors `pr-review-events.ts`.

**Files:**
- Create: `apps/desktop/src/renderer/lib/solve-review-events.ts`

- [ ] **Step 1: Create the events module**

```ts
// apps/desktop/src/renderer/lib/solve-review-events.ts
interface SolveReviewEventMap {
	"select-file": { delta: 1 | -1 };
	"select-group": { delta: 1 | -1 };
	"next-comment": { delta: 1 | -1 };
	"toggle-group": undefined;
	"toggle-sidebar": undefined;
	"approve-current-group": undefined;
	"revoke-current-group": undefined;
	"push-current-group": undefined;
	"open-follow-up": undefined;
	"clear-active": undefined;
}

type EventName = keyof SolveReviewEventMap;

const channel = (name: EventName) => `solve-review:${name}`;

export function emitSolveReviewEvent<K extends EventName>(
	name: K,
	...args: SolveReviewEventMap[K] extends undefined ? [] : [SolveReviewEventMap[K]]
): void {
	const detail = args[0];
	window.dispatchEvent(new CustomEvent(channel(name), detail !== undefined ? { detail } : {}));
}

export function subscribeSolveReviewEvent<K extends EventName>(
	name: K,
	handler: (detail: SolveReviewEventMap[K]) => void
): () => void {
	const wrapped = (e: Event) => handler((e as CustomEvent<SolveReviewEventMap[K]>).detail);
	window.addEventListener(channel(name), wrapped);
	return () => window.removeEventListener(channel(name), wrapped);
}
```

- [ ] **Step 2: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/lib/solve-review-events.ts
git commit -m "feat(solve): add solve-review event bus"
```

---

## Task 5: Build `SolveSidebar`

**Why:** Group-sectioned file list. Replaces the per-card `ChangedFilesSection` strip and the entire commit-group expand/collapse layout. Selecting a file here is what drives the diff pane in the next task.

**Files:**
- Create: `apps/desktop/src/renderer/components/solve/SolveSidebar.tsx`

- [ ] **Step 1: Create `SolveSidebar.tsx`**

```tsx
// apps/desktop/src/renderer/components/solve/SolveSidebar.tsx
import { useEffect, useMemo } from "react";
import type { SolveGroupInfo, SolveSessionInfo } from "../../../shared/solve-types";
import { useSolveSessionStore } from "../../stores/solve-session-store";
import { trpc } from "../../trpc/client";
import { GroupAction } from "./GroupAction";
import { RatioBadge } from "./RatioBadge";

interface Props {
	session: SolveSessionInfo;
}

interface FileRow {
	groupId: string;
	path: string;
	additions: number;
	deletions: number;
	isUnchanged: boolean; // commented-on but not in changedFiles
}

function buildSidebarRows(groups: SolveGroupInfo[]): Map<string, FileRow[]> {
	const byGroup = new Map<string, FileRow[]>();
	for (const g of groups) {
		const rows: FileRow[] = [];
		const seen = new Set<string>();
		for (const f of g.changedFiles) {
			if (seen.has(f.path)) continue;
			seen.add(f.path);
			rows.push({
				groupId: g.id,
				path: f.path,
				additions: f.additions,
				deletions: f.deletions,
				isUnchanged: false,
			});
		}
		// Add commented-on files not in changedFiles (rare but real for the group's
		// own file-level comments).
		for (const c of g.comments) {
			if (seen.has(c.filePath)) continue;
			seen.add(c.filePath);
			rows.push({
				groupId: g.id,
				path: c.filePath,
				additions: 0,
				deletions: 0,
				isUnchanged: true,
			});
		}
		byGroup.set(g.id, rows);
	}
	return byGroup;
}

export function SolveSidebar({ session }: Props) {
	const utils = trpc.useUtils();
	const sessionId = session.id;

	const expanded = useSolveSessionStore(
		(s) => s.sessions.get(sessionId)?.expandedGroupIds ?? new Set<string>()
	);
	const activeFilePath = useSolveSessionStore(
		(s) => s.sessions.get(sessionId)?.activeFilePath ?? null
	);
	const selectFile = useSolveSessionStore((s) => s.selectFile);
	const toggleGroupExpanded = useSolveSessionStore((s) => s.toggleGroupExpanded);
	const setFileOrder = useSolveSessionStore((s) => s.setFileOrder);
	const setExpandedGroups = useSolveSessionStore((s) => s.setExpandedGroups);

	const approveMutation = trpc.commentSolver.approveGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});
	const pushMutation = trpc.commentSolver.pushGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});
	const revokeMutation = trpc.commentSolver.revokeGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const visibleGroups = useMemo(
		() => session.groups.filter((g) => g.status !== "reverted"),
		[session.groups]
	);

	const rowsByGroup = useMemo(() => buildSidebarRows(visibleGroups), [visibleGroups]);

	// Flatten all file paths in order for j/k navigation.
	const flatFileOrder = useMemo(() => {
		const out: string[] = [];
		for (const g of visibleGroups) {
			const rows = rowsByGroup.get(g.id) ?? [];
			for (const r of rows) out.push(r.path);
		}
		return out;
	}, [visibleGroups, rowsByGroup]);

	useEffect(() => {
		setFileOrder(sessionId, flatFileOrder);
	}, [sessionId, flatFileOrder, setFileOrder]);

	// First-load: expand the first non-empty group, auto-select its first file.
	useEffect(() => {
		if (expanded.size > 0 || activeFilePath !== null) return;
		const first = visibleGroups.find((g) => (rowsByGroup.get(g.id) ?? []).length > 0);
		if (!first) return;
		setExpandedGroups(sessionId, new Set([first.id]));
		const firstRow = rowsByGroup.get(first.id)?.[0];
		if (firstRow) selectFile(sessionId, firstRow.path);
	}, [
		sessionId,
		expanded.size,
		activeFilePath,
		visibleGroups,
		rowsByGroup,
		setExpandedGroups,
		selectFile,
	]);

	return (
		<div className="flex h-full flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-base)]">
			{visibleGroups.map((group) => {
				const rows = rowsByGroup.get(group.id) ?? [];
				const isExpanded = expanded.has(group.id);
				const isSolving = group.status === "pending";
				const draftReplyCount = group.comments.filter(
					(c) => c.reply?.status === "draft"
				).length;
				return (
					<div key={group.id} className="border-b border-[var(--border-subtle)]">
						<div
							onClick={() => !isSolving && toggleGroupExpanded(sessionId, group.id)}
							className={[
								"flex items-center justify-between px-[12px] py-[10px] select-none",
								isSolving ? "cursor-default" : "cursor-pointer",
							].join(" ")}
						>
							<div className="flex items-center gap-[7px] min-w-0 flex-1">
								<span
									className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
									style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
								>
									›
								</span>
								<span className="text-[13px] font-medium tracking-[-0.015em] whitespace-nowrap overflow-hidden text-ellipsis">
									{group.label}
								</span>
								<RatioBadge group={group} />
								{draftReplyCount > 0 && (
									<span className="shrink-0 py-[1px] px-[7px] rounded-full text-[10px] font-medium bg-[var(--warning-subtle)] text-[var(--warning)]">
										✉ {draftReplyCount} draft
									</span>
								)}
							</div>
							<div className="flex items-center gap-[6px] shrink-0 ml-[12px]">
								<GroupAction
									group={group}
									onApprove={() => approveMutation.mutate({ groupId: group.id })}
									onRevoke={() => revokeMutation.mutate({ groupId: group.id })}
									onPush={() => pushMutation.mutate({ groupId: group.id })}
									isPushing={pushMutation.isPending}
								/>
							</div>
						</div>
						{isExpanded && !isSolving && (
							<div className="pb-[6px]">
								{rows.length === 0 && (
									<div className="px-[12px] pb-[6px] font-mono text-[10.5px] text-[var(--text-tertiary)]">
										no code changes
									</div>
								)}
								{rows.map((row) => {
									const selected = row.path === activeFilePath;
									return (
										<div
											key={row.path}
											onClick={() => selectFile(sessionId, row.path)}
											className={[
												"flex items-center gap-[8px] py-[5px] pl-[26px] pr-[10px] cursor-pointer",
												selected
													? "bg-[var(--bg-active)]"
													: "hover:bg-[var(--bg-elevated)]",
											].join(" ")}
										>
											<span className="text-[var(--text-tertiary)] text-[11px]">⬡</span>
											<span className="font-mono text-[11.5px] text-[var(--accent)] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
												{row.path}
											</span>
											{row.isUnchanged ? (
												<span className="font-mono text-[10px] text-[var(--text-tertiary)] shrink-0">
													(unchanged)
												</span>
											) : (
												<span className="font-mono text-[10px] text-[var(--text-tertiary)] shrink-0">
													{row.additions > 0 && (
														<span className="text-[var(--success)] opacity-70">
															+{row.additions}
														</span>
													)}
													{row.additions > 0 && row.deletions > 0 && " "}
													{row.deletions > 0 && (
														<span className="text-[var(--danger)] opacity-70">
															−{row.deletions}
														</span>
													)}
												</span>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				);
			})}
			{session.groups.some((g) => g.status === "reverted") && (
				<div className="px-[12px] py-[10px] text-[10.5px] text-[var(--text-tertiary)] opacity-60">
					{session.groups.filter((g) => g.status === "reverted").length} reverted group(s) hidden
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors. (Component is not yet wired into the tab; just verify it compiles.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveSidebar.tsx
git commit -m "feat(solve): add SolveSidebar with grouped file list"
```

---

## Task 6: Build `SolveDiffPane` with `useSolveCommentZones`

**Why:** Main pane. Renders the Monaco diff for the selected file and adds inline `SolveCommentWidget` view-zones at each comment's `lineNumber`. Adapts the proven `useInlineCommentZones` mechanism from `PRReviewFileTab` so background refetches don't churn React roots.

**Files:**
- Create: `apps/desktop/src/renderer/components/solve/useSolveCommentZones.ts`
- Create: `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx`

- [ ] **Step 1: Create `useSolveCommentZones.ts`**

```ts
// apps/desktop/src/renderer/components/solve/useSolveCommentZones.ts
import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { SolveCommentInfo } from "../../../shared/solve-types";
import { SolveCommentWidget } from "./SolveCommentWidget";

interface ZoneEntry {
	zoneId: string;
	domNode: HTMLElement;
	root: ReturnType<typeof createRoot>;
	heightInLines: number;
	signature: string;
}

function commentSignature(c: SolveCommentInfo): string {
	const replyKey = c.reply ? `${c.reply.id}:${c.reply.status}:${c.reply.body}` : "-";
	return `${c.id}|${c.status}|${c.body}|${c.followUpText ?? ""}|${replyKey}`;
}

function estimateBodyHeight(text: string): number {
	const lines = Math.max(1, Math.ceil(text.length / 60));
	return lines * 16 + 12;
}

function estimateZonePx(comments: SolveCommentInfo[]): number {
	return comments.reduce((sum, c) => {
		const body = estimateBodyHeight(c.body);
		const followUp = c.followUpText ? estimateBodyHeight(c.followUpText) + 12 : 0;
		const reply = c.reply?.status === "draft" ? estimateBodyHeight(c.reply.body) + 60 : 0;
		const status = 28;
		return sum + 36 + body + followUp + reply + status;
	}, 0);
}

function makeZoneNode(): HTMLElement {
	const domNode = document.createElement("div");
	domNode.style.pointerEvents = "auto";
	domNode.style.zIndex = "10";
	domNode.style.width = "100%";
	domNode.addEventListener("mousedown", (e) => e.stopPropagation());
	domNode.addEventListener("keydown", (e) => e.stopPropagation());
	return domNode;
}

/**
 * Diff-based view-zone manager for solve comments. Keys zones by line number,
 * diffs by signature so background refetches don't unmount widgets that have
 * in-flight textarea state.
 */
export function useSolveCommentZones(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	comments: SolveCommentInfo[],
	workspaceId: string
) {
	const zonesRef = useRef<Map<number, ZoneEntry>>(new Map());
	const lastEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

	useEffect(() => {
		if (!editor) return;

		if (lastEditorRef.current && lastEditorRef.current !== editor) {
			zonesRef.current.clear();
		}
		lastEditorRef.current = editor;

		const modEditor = editor.getModifiedEditor();
		const lineHeight = modEditor.getOption(monaco.editor.EditorOption.lineHeight);

		const byLine = new Map<number, SolveCommentInfo[]>();
		for (const c of comments) {
			const line = c.lineNumber ?? 1; // file-level comments anchor to line 1
			const arr = byLine.get(line) ?? [];
			arr.push(c);
			byLine.set(line, arr);
		}

		const renderLine = (lineComments: SolveCommentInfo[], entry: ZoneEntry) => {
			entry.root.render(
				<div className="flex flex-col gap-0.5">
					{lineComments.map((c) => (
						<SolveCommentWidget key={c.id} comment={c} workspaceId={workspaceId} />
					))}
				</div>
			);
		};

		modEditor.changeViewZones((acc) => {
			for (const [line, entry] of zonesRef.current) {
				if (!byLine.has(line)) {
					acc.removeZone(entry.zoneId);
					const root = entry.root;
					queueMicrotask(() => root.unmount());
					zonesRef.current.delete(line);
				}
			}

			for (const [line, lineComments] of byLine) {
				const sig = lineComments.map(commentSignature).join("");
				const heightInLines = Math.ceil(estimateZonePx(lineComments) / lineHeight);
				const existing = zonesRef.current.get(line);

				if (!existing) {
					const domNode = makeZoneNode();
					const zoneId = acc.addZone({ afterLineNumber: line, heightInLines, domNode });
					const root = createRoot(domNode);
					const entry: ZoneEntry = { zoneId, domNode, root, heightInLines, signature: sig };
					zonesRef.current.set(line, entry);
					renderLine(lineComments, entry);
					continue;
				}

				if (existing.signature === sig && existing.heightInLines === heightInLines) {
					continue;
				}

				if (existing.signature !== sig) {
					renderLine(lineComments, existing);
					existing.signature = sig;
				}

				if (existing.heightInLines !== heightInLines) {
					acc.removeZone(existing.zoneId);
					existing.zoneId = acc.addZone({
						afterLineNumber: line,
						heightInLines,
						domNode: existing.domNode,
					});
					existing.heightInLines = heightInLines;
				}
			}
		});
	}, [editor, comments, workspaceId]);

	useEffect(() => {
		return () => {
			const ed = lastEditorRef.current;
			if (!ed) return;
			const modEditor = ed.getModifiedEditor();
			const entries = [...zonesRef.current.values()];
			modEditor.changeViewZones((acc) => {
				for (const e of entries) acc.removeZone(e.zoneId);
			});
			queueMicrotask(() => {
				for (const e of entries) e.root.unmount();
			});
			zonesRef.current.clear();
			lastEditorRef.current = null;
		};
	}, []);
}
```

- [ ] **Step 2: Create `SolveDiffPane.tsx`**

```tsx
// apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx
import * as monaco from "monaco-editor";
import { useEffect, useMemo, useState } from "react";
import { detectLanguage } from "../../../shared/diff-types";
import type { SolveGroupInfo, SolveSessionInfo } from "../../../shared/solve-types";
import { useSolveSessionStore } from "../../stores/solve-session-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { DiffEditor } from "../DiffEditor";
import { SolveCommentWidget } from "./SolveCommentWidget";
import { useSolveCommentZones } from "./useSolveCommentZones";

interface Props {
	session: SolveSessionInfo;
	repoPath: string;
	workspaceId: string;
}

export function SolveDiffPane({ session, repoPath, workspaceId }: Props) {
	const sessionId = session.id;
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);

	const activeFilePath = useSolveSessionStore(
		(s) => s.sessions.get(sessionId)?.activeFilePath ?? null
	);
	const setScroll = useSolveSessionStore((s) => s.setScroll);
	const getScroll = useSolveSessionStore((s) => s.getScroll);
	const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(
		null
	);

	const selectedGroup: SolveGroupInfo | null = useMemo(() => {
		if (!activeFilePath) return null;
		for (const g of session.groups) {
			if (g.status === "reverted") continue;
			if (g.changedFiles.some((f) => f.path === activeFilePath)) return g;
			if (g.comments.some((c) => c.filePath === activeFilePath)) return g;
		}
		return null;
	}, [session.groups, activeFilePath]);

	const commitHash = selectedGroup?.commitHash ?? null;
	const language = activeFilePath ? detectLanguage(activeFilePath) : "plaintext";

	const originalQuery = trpc.diff.getFileContent.useQuery(
		{
			repoPath,
			ref: commitHash ? `${commitHash}~1` : "",
			filePath: activeFilePath ?? "",
		},
		{ enabled: !!commitHash && !!activeFilePath, staleTime: 60_000 }
	);
	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{
			repoPath,
			ref: commitHash ?? "",
			filePath: activeFilePath ?? "",
		},
		{ enabled: !!commitHash && !!activeFilePath, staleTime: 60_000 }
	);

	const fileComments = useMemo(() => {
		if (!selectedGroup || !activeFilePath) return [];
		return selectedGroup.comments.filter((c) => c.filePath === activeFilePath);
	}, [selectedGroup, activeFilePath]);

	useSolveCommentZones(editorInstance, fileComments, workspaceId);

	// Per-file scroll persistence.
	useEffect(() => {
		const ed = editorInstance?.getModifiedEditor();
		if (!ed || !activeFilePath) return;
		const top = getScroll(sessionId, activeFilePath);
		if (top != null) ed.setScrollTop(top);
		let raf = 0;
		const sub = ed.onDidScrollChange(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				setScroll(sessionId, activeFilePath, ed.getScrollTop());
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			sub.dispose();
		};
	}, [editorInstance, sessionId, activeFilePath, getScroll, setScroll]);

	if (!activeFilePath || !selectedGroup) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-[var(--text-tertiary)]">
				Select a file from the sidebar
			</div>
		);
	}

	const shortHash = commitHash ? commitHash.slice(0, 7) : "no commit";
	const isLoading =
		!!commitHash && (originalQuery.isLoading || modifiedQuery.isLoading);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{activeFilePath}
				</span>
				<span className="font-mono text-[11px] text-[var(--text-quaternary)]">{shortHash}</span>
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					{diffMode === "split" ? "Inline" : "Split"}
				</button>
			</div>
			<div className="flex-1 overflow-hidden">
				{!commitHash ? (
					<div className="h-full overflow-y-auto p-4">
						<div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-tertiary)] mb-[8px]">
							Comments only — no code changes
						</div>
						<div className="flex flex-col gap-1">
							{fileComments.map((c) => (
								<SolveCommentWidget key={c.id} comment={c} workspaceId={workspaceId} />
							))}
						</div>
					</div>
				) : isLoading ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Loading…
					</div>
				) : (
					<DiffEditor
						original={originalQuery.data?.content ?? ""}
						modified={modifiedQuery.data?.content ?? ""}
						language={language}
						renderSideBySide={diffMode === "split"}
						readOnly={true}
						onEditorReady={(editor) => setEditorInstance(editor)}
					/>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx \
        apps/desktop/src/renderer/components/solve/useSolveCommentZones.ts
git commit -m "feat(solve): add SolveDiffPane with inline comment view-zones"
```

---

## Task 7: Wire the new layout into `SolveReviewTab.tsx`

**Why:** Replace the commit-group card list with `<SolveSidebar />` + `<SolveDiffPane />`. Keep `PRHeader`, `ProgressStrip`, `BottomBar` exactly as they are.

**Files:**
- Modify: `apps/desktop/src/renderer/components/SolveReviewTab.tsx`

- [ ] **Step 1: Replace `SolveReviewTab` body with the new layout**

Open `apps/desktop/src/renderer/components/SolveReviewTab.tsx`. Replace the entire `SolveReviewTab` component (lines 12-132) with:

```tsx
export function SolveReviewTab({ workspaceId, solveSessionId }: Props) {
	const utils = trpc.useUtils();

	const { data: session, isLoading } = trpc.commentSolver.getSolveSession.useQuery(
		{ sessionId: solveSessionId },
		{
			refetchInterval: (query) => {
				const status = query.state.data?.status;
				return status === "queued" || status === "in_progress" ? 3000 : false;
			},
		}
	);

	const cancelMutation = trpc.commentSolver.cancelSolve.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const dismissMutation = trpc.commentSolver.dismissSolve.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const pushMutation = trpc.commentSolver.pushAndPost.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);

	const prevStatusRef = useRef<SolveSessionStatus | undefined>(undefined);
	useEffect(() => {
		if (prevStatusRef.current === "in_progress" && session?.status === "ready") {
			useTabStore.getState().setActiveTab(`solve-review-${solveSessionId}`);
		}
		prevStatusRef.current = session?.status;
	}, [session?.status, solveSessionId]);

	if (isLoading || !session) {
		return <div className="p-6 text-[var(--text-secondary)]">Loading…</div>;
	}

	const isSolving = session.status === "queued" || session.status === "in_progress";
	const isCancelled = session.status === "cancelled";
	const isReady = session.status === "ready";

	const groups = session.groups ?? [];
	const allComments = groups.flatMap((g) => g.comments);
	const resolvedCount = allComments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const pendingCount = allComments.filter((c) => c.status === "open").length;
	const unclearCount = allComments.filter((c) => c.status === "unclear").length;

	const approvedGroups = groups.filter((g) => g.status === "approved").length;
	const submittedGroups = groups.filter((g) => g.status === "submitted").length;
	const totalGroups = groups.filter((g) => g.status !== "reverted").length;

	const draftGroups = groups
		.filter((g) => g.status === "approved" && g.comments.some((c) => c.reply?.status === "draft"))
		.map((g) => g.label);
	const hasDraftRepliesInApproved = draftGroups.length > 0;
	const totalDraftReplies = groups.reduce(
		(n, g) => n + g.comments.filter((c) => c.reply?.status === "draft").length,
		0
	);
	const canPushAll = approvedGroups > 0 && !hasDraftRepliesInApproved && isReady;

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="px-7 pt-[22px] pb-[18px] border-b border-[var(--border-subtle)]">
				<PRHeader
					session={session}
					isSolving={isSolving}
					onCancel={() => cancelMutation.mutate({ sessionId: solveSessionId })}
				/>
				<ProgressStrip
					resolvedCount={resolvedCount}
					pendingCount={pendingCount}
					unclearCount={unclearCount}
					approvedGroups={approvedGroups}
					submittedGroups={submittedGroups}
					totalGroups={totalGroups}
					totalDraftReplies={totalDraftReplies}
				/>
			</div>
			<div className="flex flex-1 min-h-0 overflow-hidden">
				<div className="w-[280px] shrink-0">
					<SolveSidebar session={session} />
				</div>
				<div className="flex-1 min-w-0">
					<SolveDiffPane
						session={session}
						repoPath={activeWorkspaceCwd ?? ""}
						workspaceId={workspaceId}
					/>
				</div>
			</div>
			{isCancelled && (
				<div className="px-7 py-3 text-center border-t border-[var(--border-subtle)]">
					<button
						disabled
						className="px-4 py-[6px] rounded-[6px] text-[12px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none opacity-40 cursor-not-allowed"
					>
						Re-solve remaining comments
					</button>
				</div>
			)}
			<BottomBar
				canPush={canPushAll}
				isSolving={isSolving}
				isSubmitted={session.status === "submitted"}
				draftGroups={draftGroups}
				approvedGroups={approvedGroups}
				totalGroups={totalGroups}
				submittedGroups={submittedGroups}
				isPushing={pushMutation.isPending}
				onDismiss={() => dismissMutation.mutate({ sessionId: solveSessionId })}
				onPush={() => pushMutation.mutate({ sessionId: solveSessionId })}
			/>
		</div>
	);
}
```

- [ ] **Step 2: Add the new imports at the top of the file**

After the existing imports in `SolveReviewTab.tsx`, add:

```ts
import { SolveSidebar } from "./solve/SolveSidebar";
import { SolveDiffPane } from "./solve/SolveDiffPane";
```

Remove the `import { SolveCommitGroupCard } from "./SolveCommitGroupCard";` line.

- [ ] **Step 3: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors. The `noUnusedLocals` rule may flag any leftover imports — clean those up.

- [ ] **Step 4: Manual sanity check in dev**

Run: `bun run dev`
Open a workspace with an existing solve session. Verify:
- Sidebar shows groups; first group is auto-expanded; first file is auto-selected.
- Clicking a different file in the sidebar swaps the diff in the main pane (no new tab opens).
- Switching back to a previously-viewed file restores its scroll position.
- Comments appear inline at their line numbers.
- `Approve` / `Push & post` buttons in the sidebar work.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/SolveReviewTab.tsx
git commit -m "feat(solve): replace card list with sidebar + diff pane"
```

---

## Task 8: Wire keyboard shortcuts via `solve-review-events`

**Why:** `j`/`k`/`J`/`K`/`a`/`p`/`r`/`Enter`/`Esc`/`[`/`]`/`Cmd+\`. Mirrors the keyboard layer in `ReviewTab` and `PRReviewFileTab`.

**Files:**
- Create: `apps/desktop/src/renderer/components/solve/useSolveKeyboard.ts`
- Modify: `apps/desktop/src/renderer/components/SolveReviewTab.tsx`

- [ ] **Step 1: Create `useSolveKeyboard.ts`**

```ts
// apps/desktop/src/renderer/components/solve/useSolveKeyboard.ts
import { useEffect } from "react";
import { emitSolveReviewEvent } from "../../lib/solve-review-events";

/**
 * Window-level keyboard handler for the Solve Review tab. Active only when the
 * tab is mounted. Skips when focus is in an editable element so textarea/input
 * keystrokes pass through.
 */
export function useSolveKeyboard(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		function isEditable(el: EventTarget | null): boolean {
			if (!(el instanceof HTMLElement)) return false;
			const tag = el.tagName;
			return (
				tag === "INPUT" ||
				tag === "TEXTAREA" ||
				tag === "SELECT" ||
				el.isContentEditable === true
			);
		}
		function onKey(e: KeyboardEvent) {
			if (isEditable(e.target)) return;
			if (e.metaKey && e.key === "\\") {
				e.preventDefault();
				emitSolveReviewEvent("toggle-sidebar");
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			switch (e.key) {
				case "j":
					e.preventDefault();
					emitSolveReviewEvent("select-file", { delta: 1 });
					break;
				case "k":
					e.preventDefault();
					emitSolveReviewEvent("select-file", { delta: -1 });
					break;
				case "J":
					e.preventDefault();
					emitSolveReviewEvent("select-group", { delta: 1 });
					break;
				case "K":
					e.preventDefault();
					emitSolveReviewEvent("select-group", { delta: -1 });
					break;
				case "n":
					e.preventDefault();
					emitSolveReviewEvent("next-comment", { delta: 1 });
					break;
				case "N":
					e.preventDefault();
					emitSolveReviewEvent("next-comment", { delta: -1 });
					break;
				case "a":
					e.preventDefault();
					emitSolveReviewEvent("approve-current-group");
					break;
				case "r":
					e.preventDefault();
					emitSolveReviewEvent("revoke-current-group");
					break;
				case "p":
					e.preventDefault();
					emitSolveReviewEvent("push-current-group");
					break;
				case "Enter":
					e.preventDefault();
					emitSolveReviewEvent("open-follow-up");
					break;
				case "Escape":
					e.preventDefault();
					emitSolveReviewEvent("clear-active");
					break;
				case "[":
				case "]":
					e.preventDefault();
					emitSolveReviewEvent("toggle-group");
					break;
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled]);
}
```

- [ ] **Step 2: Wire `select-file` and `select-group` handlers in `SolveReviewTab`**

In `SolveReviewTab.tsx`, after the `prevStatusRef` effect, add:

```tsx
useEffect(() => {
	const subs = [
		subscribeSolveReviewEvent("select-file", ({ delta }) => {
			useSolveSessionStore.getState().advanceFile(solveSessionId, delta);
		}),
		subscribeSolveReviewEvent("select-group", ({ delta }) => {
			const store = useSolveSessionStore.getState();
			const ses = store.sessions.get(solveSessionId);
			if (!session) return;
			const groups = session.groups.filter((g) => g.status !== "reverted");
			if (groups.length === 0) return;
			const currentPath = ses?.activeFilePath;
			const currentIdx =
				groups.findIndex((g) =>
					g.changedFiles.some((f) => f.path === currentPath) ||
					g.comments.some((c) => c.filePath === currentPath)
				) ?? 0;
			const safeCurrent = currentIdx === -1 ? 0 : currentIdx;
			const nextIdx = Math.min(groups.length - 1, Math.max(0, safeCurrent + delta));
			const nextGroup = groups[nextIdx];
			if (!nextGroup) return;
			const expanded = new Set(ses?.expandedGroupIds ?? []);
			expanded.add(nextGroup.id);
			store.setExpandedGroups(solveSessionId, expanded);
			const firstFile =
				nextGroup.changedFiles[0]?.path ?? nextGroup.comments[0]?.filePath ?? null;
			if (firstFile) store.selectFile(solveSessionId, firstFile);
		}),
		subscribeSolveReviewEvent("toggle-group", () => {
			const store = useSolveSessionStore.getState();
			const ses = store.sessions.get(solveSessionId);
			if (!session) return;
			const groups = session.groups.filter((g) => g.status !== "reverted");
			const currentPath = ses?.activeFilePath;
			const current = groups.find(
				(g) =>
					g.changedFiles.some((f) => f.path === currentPath) ||
					g.comments.some((c) => c.filePath === currentPath)
			);
			if (current) store.toggleGroupExpanded(solveSessionId, current.id);
		}),
		subscribeSolveReviewEvent("approve-current-group", () => {
			const ses = useSolveSessionStore.getState().sessions.get(solveSessionId);
			if (!session || !ses?.activeFilePath) return;
			const group = session.groups.find(
				(g) =>
					g.changedFiles.some((f) => f.path === ses.activeFilePath) ||
					g.comments.some((c) => c.filePath === ses.activeFilePath)
			);
			if (group && group.status === "fixed") {
				approveGroupMutation.mutate({ groupId: group.id });
			}
		}),
		subscribeSolveReviewEvent("revoke-current-group", () => {
			const ses = useSolveSessionStore.getState().sessions.get(solveSessionId);
			if (!session || !ses?.activeFilePath) return;
			const group = session.groups.find(
				(g) =>
					g.changedFiles.some((f) => f.path === ses.activeFilePath) ||
					g.comments.some((c) => c.filePath === ses.activeFilePath)
			);
			if (group && group.status === "approved") {
				revokeGroupMutation.mutate({ groupId: group.id });
			}
		}),
		subscribeSolveReviewEvent("push-current-group", () => {
			const ses = useSolveSessionStore.getState().sessions.get(solveSessionId);
			if (!session || !ses?.activeFilePath) return;
			const group = session.groups.find(
				(g) =>
					g.changedFiles.some((f) => f.path === ses.activeFilePath) ||
					g.comments.some((c) => c.filePath === ses.activeFilePath)
			);
			if (group && group.status === "approved") {
				const hasDrafts = group.comments.some((c) => c.reply?.status === "draft");
				if (!hasDrafts) pushGroupMutation.mutate({ groupId: group.id });
			}
		}),
	];
	return () => {
		for (const unsub of subs) unsub();
	};
}, [session, solveSessionId, approveGroupMutation, revokeGroupMutation, pushGroupMutation]);
```

Add the supporting mutations near the existing ones at the top of the component:

```tsx
const approveGroupMutation = trpc.commentSolver.approveGroup.useMutation({
	onSuccess: () => utils.commentSolver.invalidate(),
});
const revokeGroupMutation = trpc.commentSolver.revokeGroup.useMutation({
	onSuccess: () => utils.commentSolver.invalidate(),
});
const pushGroupMutation = trpc.commentSolver.pushGroup.useMutation({
	onSuccess: () => utils.commentSolver.invalidate(),
});
```

Add the imports:

```ts
import { useSolveSessionStore } from "../stores/solve-session-store";
import { subscribeSolveReviewEvent } from "../lib/solve-review-events";
import { useSolveKeyboard } from "./solve/useSolveKeyboard";
```

Then enable the keyboard handler at the top of the component (after the `useTabStore(...)` line):

```ts
useSolveKeyboard(!!session);
```

- [ ] **Step 3: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors.

- [ ] **Step 4: Manual sanity check**

Run: `bun run dev`. Open a solve session. Press `j`/`k` — file changes in sidebar and diff pane. Press `J`/`K` — jumps groups. Press `a`/`r`/`p` while on a group with the right status — corresponding mutation fires (verify in DevTools network tab or by watching the UI flip).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/useSolveKeyboard.ts \
        apps/desktop/src/renderer/components/SolveReviewTab.tsx
git commit -m "feat(solve): add keyboard shortcuts (j/k/J/K/a/r/p/Esc)"
```

---

## Task 9: Add `ReviewHintBar` to the Solve Review tab

**Why:** Surfaces the active keyboard shortcuts at the bottom of the diff pane. Matches the reference tabs.

**Files:**
- Modify: `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx`

- [ ] **Step 1: Add the hint bar**

Open `SolveDiffPane.tsx`. Add the import at the top:

```ts
import { type Hint, ReviewHintBar } from "../review/ReviewHintBar";
```

Define the hints constant at the top of the file (outside the component):

```ts
const SOLVE_HINTS: Hint[] = [
	{ keys: ["J", "K"], label: "File" },
	{ keys: ["⇧J", "⇧K"], label: "Group" },
	{ keys: ["A"], label: "Approve" },
	{ keys: ["P"], label: "Push" },
	{ keys: ["⏎"], label: "Follow-up" },
	{ keys: ["Esc"], label: "Clear" },
];
```

Wrap the existing return JSX in a fragment so the hint bar sits below the diff:

```tsx
return (
	<div className="flex h-full flex-col overflow-hidden">
		{/* existing toolbar */}
		<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
			{/* … unchanged … */}
		</div>
		<div className="flex-1 overflow-hidden">{/* … unchanged … */}</div>
		<ReviewHintBar hints={SOLVE_HINTS} />
	</div>
);
```

- [ ] **Step 2: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx
git commit -m "feat(solve): add keyboard hint bar to diff pane"
```

---

## Task 10: Delete `CommentFixFileTab` and the `comment-fix-file` tab kind

**Why:** No code path opens this tab anymore. Removing it deletes the legacy ping-pong path entirely.

**Files:**
- Delete: `apps/desktop/src/renderer/components/CommentFixFileTab.tsx`
- Modify: `apps/desktop/src/renderer/stores/tab-store.ts`
- Modify: `apps/desktop/src/renderer/components/panes/PaneContent.tsx`

- [ ] **Step 1: Confirm the reference list**

Run: `grep -rn "comment-fix-file\|CommentFixFileTab\|openCommentFixFile" apps/desktop/src`
Expected: hits in `tab-store.ts`, `CommentFixFileTab.tsx`, and `panes/PaneContent.tsx` (line 3 import + line 96+ render branch). If anything else shows up, add it to the change set for the task.

- [ ] **Step 2: Remove the discriminator from `TabItem`**

In `apps/desktop/src/renderer/stores/tab-store.ts`, delete the `comment-fix-file` arm of the `TabItem` discriminated union (currently around line 67-77):

```ts
// REMOVE this entire arm:
| {
		kind: "comment-fix-file";
		id: string;
		workspaceId: string;
		groupId: string;
		filePath: string;
		commitHash: string;
		title: string;
		language: string;
		repoPath: string;
  };
```

- [ ] **Step 3: Remove the action and any predicate referring to it**

In the same file, remove:

- The `openCommentFixFile` field from the `TabStore` interface (around line 193).
- The `openCommentFixFile: (workspaceId, groupId, filePath, commitHash, repoPath, language) => { ... }` action body (around lines 728-762).
- Any `findTabInWorkspace` predicate that uses `t.kind === "comment-fix-file"`.

Run `grep -n "comment-fix-file\|openCommentFixFile" apps/desktop/src/renderer/stores/tab-store.ts` to confirm zero hits remain.

- [ ] **Step 4: Update the tab content renderer**

Open `apps/desktop/src/renderer/components/panes/PaneContent.tsx`. Remove the `import { CommentFixFileTab } from "../CommentFixFileTab";` line at the top, and remove the `{activeTab?.kind === "comment-fix-file" && (...)}` JSX branch (around line 96). Run `grep -n "comment-fix-file\|CommentFixFileTab" apps/desktop/src/renderer/components/panes/PaneContent.tsx` afterwards to confirm zero hits.

- [ ] **Step 5: Delete the file**

```bash
git rm apps/desktop/src/renderer/components/CommentFixFileTab.tsx
```

- [ ] **Step 6: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors. If TS complains about exhaustive switch coverage, the renderer's switch from Step 4 is missing the removal.

- [ ] **Step 7: Manual sanity check**

Run: `bun run dev`. Open a solve session. Confirm:
- Clicking a file in the sidebar does NOT open a separate tab anymore.
- The Solve Review tab still loads, sidebar + diff still work.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/stores/tab-store.ts \
        apps/desktop/src/renderer/components/panes/PaneContent.tsx
git commit -m "feat(solve): remove legacy comment-fix-file tab kind"
```

---

## Task 11: Delete `SolveCommitGroupCard.tsx`

**Why:** Nothing imports it after Task 7. `noUnusedLocals` and visual confirmation in dev say it's dead.

**Files:**
- Delete: `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`

- [ ] **Step 1: Confirm no imports remain**

Run: `grep -rn "SolveCommitGroupCard" apps/desktop/src`
Expected: zero hits.

- [ ] **Step 2: Delete the file**

```bash
git rm apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx
```

- [ ] **Step 3: Type-check and lint**

Run: `bun run type-check && bun run check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(solve): remove SolveCommitGroupCard"
```

---

## Task 12: Component test for `SolveSidebar` group expand/select

**Why:** Lock down the sidebar's selection contract so it's not silently broken by future store changes. Lightweight smoke test using React Testing Library — already established by other component tests in this repo (see `apps/desktop/tests/conflict-hint-bar.test.ts` for the local pattern).

**Files:**
- Create: `apps/desktop/tests/solve-sidebar.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/desktop/tests/solve-sidebar.test.tsx
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SolveSessionInfo } from "../src/shared/solve-types";
import { SolveSidebar } from "../src/renderer/components/solve/SolveSidebar";
import { useSolveSessionStore } from "../src/renderer/stores/solve-session-store";

// Stub trpc client minimally — SolveSidebar only uses useUtils + a few mutations.
mock.module("../src/renderer/trpc/client", () => ({
	trpc: {
		useUtils: () => ({ commentSolver: { invalidate: () => {} } }),
		commentSolver: {
			approveGroup: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
			pushGroup: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
			revokeGroup: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
		},
	},
}));

function makeSession(): SolveSessionInfo {
	return {
		id: "s1",
		prProvider: "github",
		prIdentifier: "owner/repo#1",
		prTitle: "Test PR",
		sourceBranch: "feature",
		targetBranch: "main",
		status: "ready",
		commitSha: null,
		workspaceId: "w1",
		createdAt: new Date(),
		updatedAt: new Date(),
		lastActivityAt: null,
		groups: [
			{
				id: "g1",
				label: "Group one",
				status: "fixed",
				commitHash: "abc123def456",
				order: 0,
				changedFiles: [
					{ path: "src/a.ts", changeType: "M", additions: 3, deletions: 1 },
					{ path: "src/b.ts", changeType: "M", additions: 0, deletions: 5 },
				],
				comments: [
					{
						id: "c1",
						platformCommentId: "p1",
						author: "User",
						body: "comment",
						filePath: "src/a.ts",
						lineNumber: 10,
						side: null,
						threadId: null,
						status: "fixed",
						commitSha: null,
						groupId: "g1",
						followUpText: null,
						reply: null,
					},
				],
			},
		],
	};
}

describe("SolveSidebar", () => {
	beforeEach(() => {
		useSolveSessionStore.setState({ sessions: new Map() });
	});
	afterEach(() => cleanup());

	it("auto-expands the first group and selects its first file on mount", () => {
		render(<SolveSidebar session={makeSession()} />);
		const state = useSolveSessionStore.getState().sessions.get("s1");
		expect(state?.expandedGroupIds.has("g1")).toBe(true);
		expect(state?.activeFilePath).toBe("src/a.ts");
	});

	it("clicking a file row updates activeFilePath", () => {
		render(<SolveSidebar session={makeSession()} />);
		const row = screen.getByText("src/b.ts");
		fireEvent.click(row);
		const state = useSolveSessionStore.getState().sessions.get("s1");
		expect(state?.activeFilePath).toBe("src/b.ts");
	});

	it("clicking the group header collapses the group", () => {
		render(<SolveSidebar session={makeSession()} />);
		const header = screen.getByText("Group one");
		fireEvent.click(header);
		const state = useSolveSessionStore.getState().sessions.get("s1");
		expect(state?.expandedGroupIds.has("g1")).toBe(false);
	});
});
```

- [ ] **Step 2: Confirm the test framework imports resolve**

Run: `cd apps/desktop && bun test tests/solve-sidebar.test.tsx`
Expected: all 3 tests pass.

If `@testing-library/react` is missing as a dep, install it:

```bash
cd apps/desktop && bun add -d @testing-library/react @testing-library/dom
```

Re-run the test.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tests/solve-sidebar.test.tsx apps/desktop/package.json apps/desktop/bun.lock
git commit -m "test(solve): cover SolveSidebar auto-select and click contracts"
```

(`apps/desktop/package.json` and `bun.lock` only show changes if Step 2 added the testing-library dep.)

---

## Task 13: End-to-end manual smoke test and final verify

**Why:** UI rework lands in lots of small commits. Walk the full flow once at the end to catch anything the type-checker missed.

- [ ] **Step 1: Start the app fresh**

```bash
bun run dev
```

- [ ] **Step 2: Walk the flow**

In a workspace with a recent solve session (or trigger a new one):

1. Open the Solve Review tab. Confirm header + progress strip at top, sidebar on left, diff on right, hint bar at bottom.
2. Click each file in each group. Confirm scroll position is restored when revisiting a file.
3. Confirm comments appear inline at their line numbers in the diff pane.
4. Open a follow-up textarea on a comment. Type a few characters. Watch the session refetch (3s while in-progress, but force one by triggering a mutation). Confirm the textarea content survives.
5. Press `j`/`k` — file changes. Press `J`/`K` — group jumps. Press `a` on a `fixed` group — it flips to approved. Press `r` — it goes back. Press `p` on an approved group with no draft replies — it pushes.
6. Approve a draft reply via the inline `Approve & post` button. Confirm the comment widget updates to show the posted state.
7. Confirm no `comment-fix-file` tab is ever spawned. Confirm closing and reopening the Solve Review tab does not crash (store is intentionally lost).

- [ ] **Step 3: Run the full test suite once**

```bash
cd apps/desktop && bun test
```

Expected: all tests pass.

- [ ] **Step 4: Run type-check and Biome check at root**

```bash
bun run type-check && bun run check
```

Expected: clean.

- [ ] **Step 5: Final commit if any cleanup needed**

If Steps 1-4 found anything to fix, commit it:

```bash
git add -A
git commit -m "fix(solve): post-rework cleanup"
```

Otherwise nothing to commit — the rework is complete.

---

## Summary of files

**Created:**
- `apps/desktop/src/renderer/components/solve/GroupAction.tsx`
- `apps/desktop/src/renderer/components/solve/RatioBadge.tsx`
- `apps/desktop/src/renderer/components/solve/DraftReplySignoff.tsx`
- `apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx`
- `apps/desktop/src/renderer/components/solve/SolveSidebar.tsx`
- `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx`
- `apps/desktop/src/renderer/components/solve/useSolveCommentZones.ts`
- `apps/desktop/src/renderer/components/solve/useSolveKeyboard.ts`
- `apps/desktop/src/renderer/stores/solve-session-store.ts`
- `apps/desktop/src/renderer/lib/solve-review-events.ts`
- `apps/desktop/tests/solve-session-store.test.ts`
- `apps/desktop/tests/solve-sidebar.test.tsx`

**Modified:**
- `apps/desktop/src/renderer/components/SolveReviewTab.tsx`
- `apps/desktop/src/renderer/stores/tab-store.ts`
- (Tab content renderer — path discovered in Task 10 Step 1)

**Deleted:**
- `apps/desktop/src/renderer/components/CommentFixFileTab.tsx`
- `apps/desktop/src/renderer/components/SolveCommitGroupCard.tsx`

---

## Deferred (intentionally not in this plan)

These items are mentioned in the spec but are pure polish on top of the core rework. They produce no required behavior and are easy to add later without rework.

- **`SolveActiveCommentBar`** — A top-of-pane bar that surfaces the currently-active comment when one is clicked. Because the comment widget is already inline at its line in the diff, the bar is a navigation convenience, not a correctness requirement. Add later by tracking `activeCommentId` in `solve-session-store` (already provisioned) and rendering a `<SolveActiveCommentBar />` above the `<DiffEditor />` in `SolveDiffPane`.
- **`next-comment` / `open-follow-up` / `clear-active` / `toggle-sidebar` event subscribers** — These events are emitted by `useSolveKeyboard` (Task 8) but have no subscribers in this plan. Window-level `CustomEvent` with no listener is a silent no-op, so the keys do nothing in phase 1. Wire when the active-comment bar lands.

If a reviewer disagrees with the deferral, treat both items as a single follow-up task: add the bar component, track `activeCommentId` from widget clicks, subscribe the four deferred events, and re-test the keyboard flow.
