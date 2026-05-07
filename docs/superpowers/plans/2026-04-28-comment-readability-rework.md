# Comment Readability Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make solve comments fully readable in the sidebar, retain inline-at-the-line cards in the diff, and let the user toggle inline cards off when the diff feels busy.

**Architecture:** A single shared `<SolveCommentCard>` component renders the comment in two surfaces — sidebar (full markdown body, no clamp) and inline view-zone (existing inline placement). A new per-session `commentsVisible` flag in the solve-session-store gates view-zone creation; when off, Monaco glyph-margin decorations mark comment lines and clicking one flips the flag back on and selects that comment.

**Tech Stack:** React 19, TypeScript (strict), Zustand, Monaco diff editor, Bun test runner, Biome.

**Spec:** `docs/superpowers/specs/2026-04-28-comment-readability-rework-design.md`

---

## File map

**Create:**
- `apps/desktop/src/renderer/components/solve/SolveCommentCard.tsx` — shared comment card; one of two variants.

**Modify:**
- `apps/desktop/src/renderer/stores/solve-session-store.ts` — add `commentsVisible`, `setCommentsVisible`, `toggleCommentsVisible`.
- `apps/desktop/tests/solve-session-store.test.ts` — tests for the new field & actions.
- `apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx` — becomes thin wrapper that delegates to `<SolveCommentCard variant="inline">`.
- `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx` — accept `enabled` flag; when false, tear down zones and emit glyph decorations + click handler.
- `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx` — read `commentsVisible`, render header toggle, pipe into hook.
- `apps/desktop/src/renderer/components/solve/SolveSidebar.tsx` — comments subsection rows replaced by `<SolveCommentCard variant="sidebar">`; ref-based scroll-into-view for active card.
- `apps/desktop/src/renderer/components/SolveReviewTab.tsx` — sidebar wrapper width `w-[320px]` → `w-[400px]`.
- `apps/desktop/src/renderer/styles.css` — `.solve-comment-glyph::before` rule.

---

## Task 1: Add `commentsVisible` to solve-session-store

**Files:**
- Modify: `apps/desktop/src/renderer/stores/solve-session-store.ts`
- Test: `apps/desktop/tests/solve-session-store.test.ts`

- [ ] **Step 1: Write failing tests for the new field & actions**

Append to `apps/desktop/tests/solve-session-store.test.ts` (before the closing `});`):

```typescript
	it("commentsVisible defaults to true on a fresh session", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile(KEY, "a.ts");
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(true);
	});

	it("setCommentsVisible flips the flag", () => {
		const { setCommentsVisible } = useSolveSessionStore.getState();
		setCommentsVisible(KEY, false);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(false);
		setCommentsVisible(KEY, true);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(true);
	});

	it("setCommentsVisible to same value is a no-op (same Map reference)", () => {
		const { setCommentsVisible } = useSolveSessionStore.getState();
		setCommentsVisible(KEY, false);
		const before = useSolveSessionStore.getState().sessions;
		setCommentsVisible(KEY, false);
		expect(useSolveSessionStore.getState().sessions).toBe(before);
	});

	it("toggleCommentsVisible flips between true and false", () => {
		const { toggleCommentsVisible } = useSolveSessionStore.getState();
		toggleCommentsVisible(KEY);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(false);
		toggleCommentsVisible(KEY);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(true);
	});

	it("dropSession clears commentsVisible state", () => {
		const { setCommentsVisible, dropSession } = useSolveSessionStore.getState();
		setCommentsVisible(KEY, false);
		dropSession(KEY);
		expect(useSolveSessionStore.getState().sessions.has(KEY)).toBe(false);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && bun test tests/solve-session-store.test.ts`
Expected: 5 new tests fail with "Property `commentsVisible` does not exist" or `setCommentsVisible is not a function`.

- [ ] **Step 3: Add field, actions, and default to the store**

Edit `apps/desktop/src/renderer/stores/solve-session-store.ts`:

Replace the `SolveSession` interface:

```typescript
export interface SolveSession {
	activeFilePath: string | null;
	activeCommentId: string | null;
	scrollByFile: Map<string, number>;
	expandedGroupIds: Set<string>;
	fileOrder: string[];
	commentsVisible: boolean;
}
```

Replace the `SolveSessionStore` interface (add the two new actions):

```typescript
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
	setCommentsVisible: (key: string, visible: boolean) => void;
	toggleCommentsVisible: (key: string) => void;
	dropSession: (key: string) => void;
	dropSessionsForWorkspace: (workspaceId: string) => void;
}
```

Replace `emptySession`:

```typescript
function emptySession(): SolveSession {
	return {
		activeFilePath: null,
		activeCommentId: null,
		scrollByFile: new Map(),
		expandedGroupIds: new Set(),
		fileOrder: [],
		commentsVisible: true,
	};
}
```

Inside the `create<SolveSessionStore>()(...)` body, add the two new actions just before `dropSession:`:

```typescript
	setCommentsVisible: (key, visible) =>
		set((state) => {
			const next = withSession(state, key, (s) =>
				s.commentsVisible === visible ? s : { ...s, commentsVisible: visible }
			);
			return next === state.sessions ? state : { sessions: next };
		}),

	toggleCommentsVisible: (key) =>
		set((state) => {
			const next = withSession(state, key, (s) => ({ ...s, commentsVisible: !s.commentsVisible }));
			return next === state.sessions ? state : { sessions: next };
		}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/solve-session-store.test.ts`
Expected: all tests pass (16 passing).

- [ ] **Step 5: Run type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/stores/solve-session-store.ts apps/desktop/tests/solve-session-store.test.ts
git commit -m "feat(solve): add commentsVisible flag to solve-session-store"
```

---

## Task 2: Extract `<SolveCommentCard>` from `SolveCommentWidget`

**Files:**
- Create: `apps/desktop/src/renderer/components/solve/SolveCommentCard.tsx`
- Modify: `apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx`

**Why no test:** project has no DOM/RTL setup. Extraction preserves behaviour; verified by code inspection + type-check + manual run.

- [ ] **Step 1: Create the shared card component**

Create `apps/desktop/src/renderer/components/solve/SolveCommentCard.tsx`:

```typescript
import { useState } from "react";
import type { SolveCommentInfo } from "../../../shared/solve-types";
import { basename } from "../../lib/format";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { DraftReplySignoff } from "./DraftReplySignoff";

interface Props {
	comment: SolveCommentInfo;
	workspaceId: string;
	variant: "inline" | "sidebar";
	isActive?: boolean;
	onSelect?: () => void;
}

export function SolveCommentCard({ comment, workspaceId, variant, isActive, onSelect }: Props) {
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

	const wrapperClass =
		variant === "inline"
			? [
					"mx-2 my-1 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] shadow-md overflow-hidden border-l-2",
					isActive ? "border-l-[var(--accent)]" : "border-l-[var(--border-subtle)]",
				].join(" ")
			: [
					"w-full border-t border-[var(--border-subtle)] bg-[var(--bg-base)] text-[11px] cursor-pointer hover:bg-[var(--bg-elevated)] border-l-2",
					isActive ? "border-l-[var(--accent)]" : "border-l-transparent",
				].join(" ");

	const lineRef = comment.lineNumber != null ? `line ${comment.lineNumber}` : "file-level";

	return (
		<div
			className={wrapperClass}
			onClick={variant === "sidebar" ? onSelect : undefined}
			data-active={isActive ? "true" : undefined}
		>
			<div className="flex items-center gap-[6px] px-3 py-2">
				<div className="w-[16px] h-[16px] rounded-full bg-[var(--bg-active)] flex items-center justify-center text-[8px] font-semibold text-[var(--text-secondary)]">
					{comment.author.charAt(0).toUpperCase()}
				</div>
				<span className="text-[12px] font-medium">{comment.author}</span>
				<span
					className="font-mono text-[10.5px] text-[var(--text-tertiary)]"
					title={`${comment.filePath}${comment.lineNumber != null ? `:${comment.lineNumber}` : " (file-level)"}`}
				>
					{variant === "sidebar" ? `${basename(comment.filePath)} · ${lineRef}` : lineRef}
				</span>
				<span className="ml-auto text-[10.5px] font-medium" style={{ color: statusColor }}>
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
						onClick={(e) => {
							e.stopPropagation();
							setShowFollowUp(!showFollowUp);
						}}
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
				<div className="px-3 pb-2" onClick={(e) => e.stopPropagation()}>
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
				<div className="px-3 pb-2" onClick={(e) => e.stopPropagation()}>
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
				<div
					className="mx-3 mb-2 py-[9px] px-[12px] bg-[var(--bg-base)] border border-[var(--accent)] rounded-[6px]"
					onClick={(e) => e.stopPropagation()}
				>
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

- [ ] **Step 2: Replace SolveCommentWidget body with thin wrapper**

Replace the entire contents of `apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx` with:

```typescript
import type { SolveCommentInfo } from "../../../shared/solve-types";
import { SolveCommentCard } from "./SolveCommentCard";

interface Props {
	comment: SolveCommentInfo;
	workspaceId: string;
	isActive?: boolean;
}

export function SolveCommentWidget({ comment, workspaceId, isActive }: Props) {
	return (
		<SolveCommentCard
			comment={comment}
			workspaceId={workspaceId}
			variant="inline"
			isActive={isActive}
		/>
	);
}
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 4: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: all existing tests pass (no behaviour change).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveCommentCard.tsx apps/desktop/src/renderer/components/solve/SolveCommentWidget.tsx
git commit -m "refactor(solve): extract SolveCommentCard from SolveCommentWidget"
```

---

## Task 3: Add `enabled` flag and glyph decoration to `useSolveCommentZones`

**Files:**
- Modify: `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

**Why no test:** Monaco editor instance has no headless harness in this project; verify by manual smoke + type-check.

- [ ] **Step 1: Add the glyph CSS rule**

Append to `apps/desktop/src/renderer/styles.css`:

```css
.solve-comment-glyph::before {
	content: "💬";
	display: inline-block;
	width: 100%;
	font-size: 11px;
	line-height: 1;
	text-align: center;
	cursor: pointer;
}
```

- [ ] **Step 2: Update the hook signature**

Replace `apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx` with:

```tsx
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

interface Options {
	enabled?: boolean;
	activeCommentId?: string | null;
	onGlyphClick?: (commentId: string) => void;
}

function commentSignature(c: SolveCommentInfo, isActive: boolean): string {
	const replyKey = c.reply ? `${c.reply.id}:${c.reply.status}:${c.reply.body}` : "-";
	return `${c.id}|${c.status}|${c.body}|${c.followUpText ?? ""}|${replyKey}|${isActive ? "A" : "_"}`;
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
 * Diff-based view-zone manager for solve comments. When `enabled` is false the
 * zones are torn down and a small glyph-margin marker is rendered at every
 * comment's line on the modified-side editor; clicking a marker invokes
 * `onGlyphClick` with the comment id.
 */
export function useSolveCommentZones(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	comments: SolveCommentInfo[],
	workspaceId: string,
	options: Options = {}
) {
	const enabled = options.enabled ?? true;
	const activeCommentId = options.activeCommentId ?? null;
	const onGlyphClick = options.onGlyphClick;
	const zonesRef = useRef<Map<number, ZoneEntry>>(new Map());
	const lastEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

	useEffect(() => {
		if (!editor) return;

		if (lastEditorRef.current && lastEditorRef.current !== editor) {
			zonesRef.current.clear();
		}
		lastEditorRef.current = editor;

		const modEditor = editor.getModifiedEditor();

		if (!enabled) {
			const entries = [...zonesRef.current.values()];
			if (entries.length > 0) {
				modEditor.changeViewZones((acc) => {
					for (const e of entries) acc.removeZone(e.zoneId);
				});
				const roots = entries.map((e) => e.root);
				queueMicrotask(() => roots.forEach((r) => r.unmount()));
				zonesRef.current.clear();
			}
			return;
		}

		const lineHeight = modEditor.getOption(monaco.editor.EditorOption.lineHeight);

		const byLine = new Map<number, SolveCommentInfo[]>();
		for (const c of comments) {
			const line = c.lineNumber ?? 1;
			const arr = byLine.get(line) ?? [];
			arr.push(c);
			byLine.set(line, arr);
		}

		const renderLine = (lineComments: SolveCommentInfo[], entry: ZoneEntry) => {
			entry.root.render(
				<div className="flex flex-col gap-0.5">
					{lineComments.map((c) => (
						<SolveCommentWidget
							key={c.id}
							comment={c}
							workspaceId={workspaceId}
							isActive={c.id === activeCommentId}
						/>
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
				const sig = lineComments.map((c) => commentSignature(c, c.id === activeCommentId)).join("");
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
	}, [editor, comments, workspaceId, enabled, activeCommentId]);

	useEffect(() => {
		if (!editor || enabled) return;
		const modEditor = editor.getModifiedEditor();
		modEditor.updateOptions({ glyphMargin: true });

		const lineToCommentId = new Map<number, string>();
		for (const c of comments) {
			if (c.lineNumber == null) continue;
			if (!lineToCommentId.has(c.lineNumber)) lineToCommentId.set(c.lineNumber, c.id);
		}

		const decorations = modEditor.createDecorationsCollection(
			[...lineToCommentId.keys()].map((line) => ({
				range: new monaco.Range(line, 1, line, 1),
				options: { glyphMarginClassName: "solve-comment-glyph" },
			}))
		);

		const sub = modEditor.onMouseDown((e) => {
			if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
			const line = e.target.position?.lineNumber;
			if (line == null) return;
			const id = lineToCommentId.get(line);
			if (id && onGlyphClick) onGlyphClick(id);
		});

		return () => {
			decorations.clear();
			sub.dispose();
		};
	}, [editor, comments, enabled, onGlyphClick]);

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

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: clean. (If `MouseTargetType` is missing, import path may need to be `monaco.editor.MouseTargetType` — already used in the code above.)

- [ ] **Step 4: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/useSolveCommentZones.tsx apps/desktop/src/renderer/styles.css
git commit -m "feat(solve): make comment zones toggleable with gutter glyph fallback"
```

---

## Task 4: Add toggle button to `SolveDiffPane` and wire `commentsVisible`

**Files:**
- Modify: `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx`

**Why no test:** UI wiring; verify by type-check + manual run.

- [ ] **Step 1: Update `SolveDiffPane.tsx`**

Replace the file's contents at `apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx` with:

```tsx
import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { detectLanguage } from "../../../shared/diff-types";
import type { SolveGroupInfo, SolveSessionInfo } from "../../../shared/solve-types";
import { solveSessionKey, useSolveSessionStore } from "../../stores/solve-session-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { DiffEditor } from "../DiffEditor";
import { type Hint, ReviewHintBar } from "../review/ReviewHintBar";
import { SolveCommentWidget } from "./SolveCommentWidget";
import { useSolveCommentZones } from "./useSolveCommentZones";

const SOLVE_HINTS: Hint[] = [
	{ keys: ["J", "K"], label: "File" },
	{ keys: ["⇧J", "⇧K"], label: "Group" },
	{ keys: ["A"], label: "Approve" },
	{ keys: ["P"], label: "Push" },
	{ keys: ["⏎"], label: "Follow-up" },
	{ keys: ["Esc"], label: "Clear" },
];

interface Props {
	session: SolveSessionInfo;
	repoPath: string;
	workspaceId: string;
}

export function SolveDiffPane({ session, repoPath, workspaceId }: Props) {
	const sessionKey = solveSessionKey(session.workspaceId, session.id);
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);

	const activeFilePath = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const activeCommentId = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeCommentId ?? null
	);
	const commentsVisible = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.commentsVisible ?? true
	);
	const setScroll = useSolveSessionStore((s) => s.setScroll);
	const getScroll = useSolveSessionStore((s) => s.getScroll);
	const setCommentsVisible = useSolveSessionStore((s) => s.setCommentsVisible);
	const toggleCommentsVisible = useSolveSessionStore((s) => s.toggleCommentsVisible);
	const selectComment = useSolveSessionStore((s) => s.selectComment);
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

	const onGlyphClick = useCallback(
		(commentId: string) => {
			setCommentsVisible(sessionKey, true);
			selectComment(sessionKey, commentId);
		},
		[sessionKey, setCommentsVisible, selectComment]
	);

	useSolveCommentZones(editorInstance, fileComments, workspaceId, {
		enabled: commentsVisible,
		activeCommentId,
		onGlyphClick,
	});

	useEffect(() => {
		const ed = editorInstance?.getModifiedEditor();
		if (!ed || !activeFilePath) return;
		const top = getScroll(sessionKey, activeFilePath);
		if (top != null) ed.setScrollTop(top);
		let raf = 0;
		const sub = ed.onDidScrollChange(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				setScroll(sessionKey, activeFilePath, ed.getScrollTop());
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			sub.dispose();
		};
	}, [editorInstance, sessionKey, activeFilePath, getScroll, setScroll]);

	useEffect(() => {
		const ed = editorInstance?.getModifiedEditor();
		if (!ed || !activeCommentId) return;
		const c = fileComments.find((fc) => fc.id === activeCommentId);
		if (!c?.lineNumber) return;
		ed.revealLineInCenter(c.lineNumber);
	}, [editorInstance, activeCommentId, fileComments]);

	if (!activeFilePath || !selectedGroup) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-[var(--text-tertiary)]">
				Select a file from the sidebar
			</div>
		);
	}

	const shortHash = commitHash ? commitHash.slice(0, 7) : "no commit";
	const isLoading = !!commitHash && (originalQuery.isLoading || modifiedQuery.isLoading);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{activeFilePath}
				</span>
				<span className="font-mono text-[11px] text-[var(--text-quaternary)]">{shortHash}</span>
				<button
					type="button"
					onClick={() => toggleCommentsVisible(sessionKey)}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					title={commentsVisible ? "Hide inline comments" : "Show inline comments"}
				>
					💬 Comments: {commentsVisible ? "On" : "Off"}
				</button>
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
								<SolveCommentWidget
									key={c.id}
									comment={c}
									workspaceId={workspaceId}
									isActive={c.id === activeCommentId}
								/>
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
			<ReviewHintBar hints={SOLVE_HINTS} />
		</div>
	);
}
```

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 3: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx
git commit -m "feat(solve): add Comments toggle button in diff header"
```

---

## Task 5: Replace sidebar comment rows with `<SolveCommentCard variant="sidebar">`

**Files:**
- Modify: `apps/desktop/src/renderer/components/solve/SolveSidebar.tsx`

**Why no test:** existing `solve-sidebar.test.ts` covers `buildSidebarRows` (pure function); the refactor only changes JSX and adds a scroll-into-view effect. Verify by type-check + existing tests + manual.

- [ ] **Step 1: Remove the now-redundant helper functions**

In `apps/desktop/src/renderer/components/solve/SolveSidebar.tsx`, delete the two function declarations `commentStatusColor` and `commentStatusLabel` (the block beginning with `function commentStatusColor(status: SolveCommentStatus)` and ending with the closing brace of `commentStatusLabel`). They now live inside `SolveCommentCard`.

- [ ] **Step 2: Replace the imports block**

Replace the import block at the top of `apps/desktop/src/renderer/components/solve/SolveSidebar.tsx` (the section before `interface Props`) with:

```typescript
import { useEffect, useMemo, useRef } from "react";
import type { SolveGroupInfo, SolveSessionInfo } from "../../../shared/solve-types";
import { basename } from "../../lib/format";
import { solveSessionKey, useSolveSessionStore } from "../../stores/solve-session-store";
import { trpc } from "../../trpc/client";
import { GroupAction } from "./GroupAction";
import { RatioBadge } from "./RatioBadge";
import { SolveCommentCard } from "./SolveCommentCard";
```

(After Step 1, `SolveCommentStatus` is no longer referenced anywhere in the file, so dropping it now is safe.)

- [ ] **Step 3: Add an active-card ref and scroll-into-view effect

In `SolveSidebar.tsx`, replace the existing `interface Props` and the start of the component (down to the start of the `return (` statement) with:

```typescript
interface Props {
	session: SolveSessionInfo;
}

export function SolveSidebar({ session }: Props) {
	const utils = trpc.useUtils();
	const sessionKey = solveSessionKey(session.workspaceId, session.id);

	const expanded = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.expandedGroupIds ?? new Set<string>()
	);
	const activeFilePath = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const activeCommentId = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeCommentId ?? null
	);
	const selectFile = useSolveSessionStore((s) => s.selectFile);
	const selectComment = useSolveSessionStore((s) => s.selectComment);
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

	const rowsByGroup = useMemo(() => buildSidebarRows(session.groups), [session.groups]);

	const flatFileOrder = useMemo(() => {
		const out: string[] = [];
		for (const g of session.groups.filter((g) => g.status !== "reverted")) {
			const rows = rowsByGroup.get(g.id) ?? [];
			for (const r of rows) out.push(r.path);
		}
		return out;
	}, [session.groups, rowsByGroup]);

	useEffect(() => {
		setFileOrder(sessionKey, flatFileOrder);
	}, [sessionKey, flatFileOrder, setFileOrder]);

	useEffect(() => {
		if (expanded.size > 0 || activeFilePath !== null) return;
		const first = session.groups
			.filter((g) => g.status !== "reverted")
			.find((g) => (rowsByGroup.get(g.id) ?? []).length > 0);
		if (!first) return;
		setExpandedGroups(sessionKey, new Set([first.id]));
		const firstRow = rowsByGroup.get(first.id)?.[0];
		if (firstRow) selectFile(sessionKey, firstRow.path);
	}, [
		sessionKey,
		expanded.size,
		activeFilePath,
		session.groups,
		rowsByGroup,
		setExpandedGroups,
		selectFile,
	]);

	const activeCardRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		activeCardRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeCommentId]);
```

- [ ] **Step 4: Replace the comments-subsection JSX**

Inside the JSX inside the `{!isReverted && isExpanded && !isSolving && (...)}` block, replace the entire `{/* COMMENTS subsection */}` block (the conditional rendering of `group.comments.length > 0` and its mapped rows) with:

```tsx
									{/* COMMENTS subsection */}
									{group.comments.length > 0 && (
										<>
											<div className="px-[12px] pb-[4px] pt-[6px] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
												Comments
											</div>
											{group.comments.map((comment) => {
												const isActive = activeCommentId === comment.id;
												return (
													<div
														key={comment.id}
														ref={isActive ? activeCardRef : undefined}
													>
														<SolveCommentCard
															comment={comment}
															workspaceId={session.workspaceId}
															variant="sidebar"
															isActive={isActive}
															onSelect={() => {
																selectFile(sessionKey, comment.filePath);
																selectComment(sessionKey, comment.id);
															}}
														/>
													</div>
												);
											})}
										</>
									)}
```

- [ ] **Step 5: Run type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 6: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: all 20 existing rework tests + the 5 new store tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/solve/SolveSidebar.tsx
git commit -m "feat(solve): render full comment cards in sidebar via SolveCommentCard"
```

---

## Task 6: Widen sidebar to 400px

**Files:**
- Modify: `apps/desktop/src/renderer/components/SolveReviewTab.tsx`

- [ ] **Step 1: Locate the wrapper**

Run: `grep -n 'w-\[320px\]' apps/desktop/src/renderer/components/SolveReviewTab.tsx`
Expected: a single match on the sidebar wrapper `<div>` (the one that contains `<SolveSidebar />`).

- [ ] **Step 2: Replace 320 with 400**

Use Edit to change the matched class:

```
Old: w-[320px]
New: w-[400px]
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/SolveReviewTab.tsx
git commit -m "feat(solve): widen comment-solver sidebar to 400px"
```

---

## Task 7: Final verification

**Files:** None modified.

- [ ] **Step 1: Run full test suite**

Run: `cd apps/desktop && bun test`
Expected: all tests pass.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 3: Run lint**

Run: `bun run check`
Expected: clean (or only auto-fix output that should already be applied).

- [ ] **Step 4: Manual smoke**

Run: `bun run dev`

Verify in the running app:
1. Open a comment-solve session with at least 2 groups, several files, and 2+ comments per file (one with `lineNumber != null`, one file-level if available).
2. Sidebar comment cards render full markdown body, no clipping.
3. Click a sidebar comment card → diff opens to that file at that line; the clicked card gains the accent left-border; the inline card on the line gains the accent left-border.
4. In the diff header, click `💬 Comments: On` → button toggles to `Off`, all inline cards disappear, a 💬 glyph appears in the gutter at every line that had a comment.
5. Click a 💬 glyph → button toggles back to `On`, inline cards return, the clicked comment becomes active in both surfaces.
6. Open a second solve session in another workspace → its `commentsVisible` defaults to `On` independent of the first session.
7. Close the solve-review tab → reopen → state resets cleanly (no stale view-zones).

If any step fails, fix in a follow-up commit and re-run from Step 1.
