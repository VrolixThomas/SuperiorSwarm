// apps/desktop/src/renderer/components/PRReviewFileTab.tsx
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { detectLanguage } from "../../shared/diff-types";
import type {
	AIDraftThread,
	GitHubReviewThread,
	PRContext,
	UnifiedThread,
} from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import { basename } from "../lib/format";
import { emitPRReviewEvent, subscribePRReviewEvent } from "../lib/pr-review-events";
import { prReviewSessionKey, usePRReviewSessionStore } from "../stores/pr-review-session-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { DiffEditor } from "./DiffEditor";
import { MarkdownPreviewButton } from "./MarkdownPreviewButton";
import { MarkdownRenderedDiff } from "./MarkdownRenderedDiff";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ActiveThreadBar } from "./review/ActiveThreadBar";
import { type Hint, ReviewHintBar } from "./review/ReviewHintBar";

// ── Comment thread widget rendered inside a Monaco view zone ──────────────────

function ThreadWidget({
	thread,
	onReply,
	onResolve,
	onAcceptDraft,
	onDeclineDraft,
	onDeleteDraft,
	onSaveEdit,
}: {
	thread: UnifiedThread;
	onReply: (body: string) => void;
	onResolve: () => void;
	onAcceptDraft?: (draftCommentId: string) => void;
	onDeclineDraft?: (draftCommentId: string) => void;
	onDeleteDraft?: (draftCommentId: string) => void;
	onSaveEdit?: (draftCommentId: string, body: string) => void;
}) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyBody, setReplyBody] = useState("");
	const replyInputRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (replyOpen) replyInputRef.current?.focus();
	}, [replyOpen]);

	const isAI = !!thread.isAIDraft;
	const aiThread = isAI ? (thread as AIDraftThread) : null;
	const initialEditText = aiThread ? (aiThread.userEdit ?? aiThread.body) : "";
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState(initialEditText);
	const editInputRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (editing) {
			editInputRef.current?.focus();
			editInputRef.current?.select();
		}
	}, [editing]);

	const submitReply = () => {
		if (!replyBody.trim()) return;
		onReply(replyBody.trim());
		setReplyBody("");
		setReplyOpen(false);
	};
	const cancelReply = () => {
		setReplyBody("");
		setReplyOpen(false);
	};
	const submitEdit = () => {
		if (!aiThread || !onSaveEdit || !editText.trim()) return;
		onSaveEdit(aiThread.draftCommentId, editText.trim());
		setEditing(false);
	};
	const cancelEdit = () => {
		if (!aiThread) return;
		setEditText(aiThread.userEdit ?? aiThread.body);
		setEditing(false);
	};

	// Wire keyboard shortcut → focus reply for this thread (GH only)
	useEffect(() => {
		if (isAI) return;
		return subscribePRReviewEvent("focus-reply", (detail) => {
			if (detail.threadId !== thread.id) return;
			setReplyOpen(true);
			// useEffect above will focus once it's open
		});
	}, [isAI, thread.id]);

	// Wire keyboard shortcut → enter edit mode for this AI draft
	useEffect(() => {
		if (!aiThread) return;
		return subscribePRReviewEvent("edit-thread", (detail) => {
			if (detail.draftCommentId !== aiThread.draftCommentId) return;
			setEditText(aiThread.userEdit ?? aiThread.body);
			setEditing(true);
		});
	}, [aiThread]);

	if (isAI && aiThread) {
		const isUserPending = aiThread.status === "user-pending";
		const isAiPending = aiThread.status === "pending";
		const isError = aiThread.status === "error";
		return (
			<div
				onMouseDown={(e) => e.stopPropagation()}
				className="mx-2 my-1 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] shadow-md overflow-hidden"
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1">
					<div className="flex items-center gap-1.5">
						{!isUserPending && <span className="ai-badge">AI</span>}
						<span className="text-[10px] font-medium text-[var(--text-tertiary)]">
							{isUserPending ? "You" : "SuperiorSwarm AI"}
						</span>
						{isUserPending && (
							<span className="rounded-[3px] border border-[var(--border-active)] bg-[var(--bg-overlay)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
								Pending
							</span>
						)}
						{aiThread.status === "edited" && !editing && (
							<span className="text-[9px] font-medium text-[var(--accent)]">Edited</span>
						)}
						{isError && (
							<span className="rounded-[3px] border border-[rgba(255,69,58,0.3)] bg-[var(--danger-subtle)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">
								Failed
							</span>
						)}
					</div>
					<div className="flex items-center gap-2">
						{(isAiPending || aiThread.status === "edited") && !editing && onSaveEdit && (
							<button
								type="button"
								onClick={() => {
									setEditText(aiThread.userEdit ?? aiThread.body);
									setEditing(true);
								}}
								className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
							>
								Edit
							</button>
						)}
						{isUserPending && (
							<button
								type="button"
								onClick={() => onDeclineDraft?.(aiThread.draftCommentId)}
								className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--term-red)]"
							>
								Delete
							</button>
						)}
						{isError && (
							<button
								type="button"
								onClick={() => onDeleteDraft?.(aiThread.draftCommentId)}
								className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--term-red)]"
							>
								Remove
							</button>
						)}
					</div>
				</div>

				{/* Comment body or edit textarea */}
				{!editing ? (
					<div className="px-3 py-2">
						<MarkdownRenderer content={aiThread.userEdit ?? aiThread.body} />
					</div>
				) : (
					<div className="flex flex-col gap-1.5 p-2">
						<textarea
							ref={editInputRef}
							value={editText}
							onChange={(e) => setEditText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									e.preventDefault();
									cancelEdit();
								} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									submitEdit();
								}
							}}
							rows={Math.max(3, Math.min(10, editText.split("\n").length + 1))}
							className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
						/>
						<div className="flex gap-1.5">
							<button
								type="button"
								onClick={submitEdit}
								disabled={!editText.trim()}
								className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-foreground)] hover:opacity-80 disabled:opacity-40"
							>
								Save
							</button>
							<button
								type="button"
								onClick={cancelEdit}
								className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
							>
								Cancel
							</button>
						</div>
					</div>
				)}

				{/* Accept / Decline buttons for AI suggestions */}
				{isAiPending && !editing && (
					<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
						<button
							type="button"
							onClick={() => onAcceptDraft?.(aiThread.draftCommentId)}
							className="rounded-[4px] px-2 py-0.5 text-[10px] font-medium bg-[var(--success-subtle)] text-[var(--color-success)] hover:opacity-80"
						>
							Accept
						</button>
						<button
							type="button"
							onClick={() => onDeclineDraft?.(aiThread.draftCommentId)}
							className="rounded-[4px] px-2 py-0.5 text-[10px] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:opacity-80"
						>
							Decline
						</button>
					</div>
				)}
			</div>
		);
	}

	const ghThread = thread as GitHubReviewThread;

	return (
		<div
			onMouseDown={(e) => e.stopPropagation()}
			className="mx-2 my-1 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] shadow-md overflow-hidden"
		>
			{/* Thread header */}
			<div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1">
				<span className="text-[10px] font-mono text-[var(--text-quaternary)]">
					{ghThread.path}:{ghThread.line ?? "?"}
				</span>
				<div className="flex items-center gap-2">
					{ghThread.isResolved && (
						<span className="text-[10px] text-[var(--color-success)]">Resolved</span>
					)}
					{!ghThread.isResolved && (
						<button
							type="button"
							onClick={onResolve}
							className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
						>
							Resolve
						</button>
					)}
				</div>
			</div>

			{/* Comments */}
			{ghThread.comments.map((c) => (
				<div key={c.id} className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-0">
					<div className="flex items-center gap-1.5 mb-1">
						<span className="font-medium text-[var(--text-secondary)]">{c.author}</span>
						<span className="text-[var(--text-quaternary)]">
							{new Date(c.createdAt).toLocaleDateString()}
						</span>
					</div>
					<MarkdownRenderer content={c.body} />
				</div>
			))}

			{/* Reply */}
			{!ghThread.isResolved && (
				<div className="border-t border-[var(--border-subtle)]">
					{!replyOpen ? (
						<button
							type="button"
							onClick={() => setReplyOpen(true)}
							className="w-full px-3 py-1.5 text-left text-[10px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)] transition-colors"
						>
							Reply…
						</button>
					) : (
						<div className="flex flex-col gap-1.5 p-2">
							<textarea
								ref={replyInputRef}
								value={replyBody}
								onChange={(e) => setReplyBody(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										e.preventDefault();
										cancelReply();
									} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
										e.preventDefault();
										submitReply();
									}
								}}
								rows={2}
								placeholder="Write a reply…"
								className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
							/>
							<div className="flex gap-1.5">
								<button
									type="button"
									onClick={submitReply}
									disabled={!replyBody.trim()}
									className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-foreground)] hover:opacity-80 disabled:opacity-40"
								>
									Reply
								</button>
								<button
									type="button"
									onClick={cancelReply}
									className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
								>
									Cancel
								</button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ── New thread authoring widget ───────────────────────────────────────────────

function NewThreadWidget({
	line,
	onSave,
	onCancel,
}: {
	line: number;
	onSave: (body: string) => void;
	onCancel: () => void;
}) {
	const [body, setBody] = useState("");
	const commentInputRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		commentInputRef.current?.focus();
	}, []);

	const submit = () => {
		if (body.trim()) onSave(body.trim());
	};

	return (
		<div
			onMouseDown={(e) => e.stopPropagation()}
			className="mx-2 my-1 rounded-[6px] border border-[var(--accent)] bg-[var(--bg-surface)] text-[11px] shadow-lg overflow-hidden"
		>
			<div className="bg-[var(--accent)] px-3 py-1 text-[var(--accent-foreground)] font-medium text-[10px]">
				New Comment on Line {line}
			</div>
			<div className="flex flex-col gap-1.5 p-2">
				<textarea
					ref={commentInputRef}
					value={body}
					onChange={(e) => setBody(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							onCancel();
						} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							submit();
						}
					}}
					rows={3}
					placeholder="Write a comment…"
					className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
				/>
				<div className="flex gap-1.5">
					<button
						type="button"
						onClick={submit}
						disabled={!body.trim()}
						className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-foreground)] hover:opacity-80 disabled:opacity-40"
					>
						Add Comment
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}

// ── Inline comment zones manager ──────────────────────────────────────────────

interface ZoneEntry {
	zoneId: string;
	domNode: HTMLElement;
	root: ReturnType<typeof createRoot>;
	heightInLines: number;
	signature: string;
}

function threadSignature(t: UnifiedThread): string {
	if (t.isAIDraft) {
		const ai = t as AIDraftThread;
		return `ai|${ai.id}|${ai.line}|${ai.status}|${ai.body}|${ai.userEdit ?? ""}`;
	}
	const gh = t as GitHubReviewThread;
	const comments = gh.comments.map((c) => `${c.id}:${c.body}`).join("");
	return `gh|${gh.id}|${gh.line}|${gh.isResolved ? 1 : 0}|${comments}`;
}

function estimateBodyHeight(text: string): number {
	const lines = Math.max(1, Math.ceil(text.length / 60));
	return lines * 16 + 12;
}

function estimateZonePx(threads: UnifiedThread[]): number {
	return threads.reduce((sum, t) => {
		if (t.isAIDraft) {
			const ai = t as AIDraftThread;
			const bodyH = estimateBodyHeight(ai.userEdit ?? ai.body);
			return sum + 32 + bodyH + (ai.status === "pending" ? 36 : 24);
		}
		const gh = t as GitHubReviewThread;
		const commentsH = gh.comments.reduce((s, c) => s + 24 + estimateBodyHeight(c.body), 0);
		return sum + 32 + commentsH + 36;
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
 * Diff-based view-zone manager. Maintains a per-line zone registry and only
 * touches Monaco/React for zones that actually changed. Background refetches
 * that produce structurally-equivalent threads cause zero churn; partial
 * updates re-render only the affected line so sibling textareas keep their
 * in-progress state.
 */
function useInlineCommentZones(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	threads: UnifiedThread[],
	pendingLine: number | null,
	onReply: (threadId: string, body: string) => void,
	onResolve: (threadId: string) => void,
	onSaveNew: (body: string) => void,
	onCancelNew: () => void,
	onAcceptDraft?: (draftCommentId: string) => void,
	onDeclineDraft?: (draftCommentId: string) => void,
	onDeleteDraft?: (draftCommentId: string) => void,
	onSaveEdit?: (draftCommentId: string, body: string) => void
) {
	const zonesRef = useRef<Map<number, ZoneEntry>>(new Map());
	const pendingZoneRef = useRef<(ZoneEntry & { line: number }) | null>(null);
	const lastEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

	useEffect(() => {
		if (!editor) return;

		// Editor swap: previous editor is gone; its zones were auto-disposed.
		if (lastEditorRef.current && lastEditorRef.current !== editor) {
			zonesRef.current.clear();
			pendingZoneRef.current = null;
		}
		lastEditorRef.current = editor;

		const modEditor = editor.getModifiedEditor();
		const lineHeight = modEditor.getOption(monaco.editor.EditorOption.lineHeight);

		const byLine = new Map<number, UnifiedThread[]>();
		for (const t of threads) {
			if (t.line == null) continue;
			const arr = byLine.get(t.line) ?? [];
			arr.push(t);
			byLine.set(t.line, arr);
		}

		const renderLine = (lineThreads: UnifiedThread[], entry: ZoneEntry) => {
			entry.root.render(
				<div className="flex flex-col gap-0.5">
					{lineThreads.map((t) => (
						<ThreadWidget
							key={t.id}
							thread={t}
							onReply={(body) => onReply(t.id, body)}
							onResolve={() => onResolve(t.id)}
							onAcceptDraft={onAcceptDraft}
							onDeclineDraft={onDeclineDraft}
							onDeleteDraft={onDeleteDraft}
							onSaveEdit={onSaveEdit}
						/>
					))}
				</div>
			);
		};

		modEditor.changeViewZones((acc) => {
			// Remove zones whose line no longer has threads.
			for (const [line, entry] of zonesRef.current) {
				if (!byLine.has(line)) {
					acc.removeZone(entry.zoneId);
					const root = entry.root;
					queueMicrotask(() => root.unmount());
					zonesRef.current.delete(line);
				}
			}

			// Add new / update existing.
			for (const [line, lineThreads] of byLine) {
				const sig = lineThreads.map(threadSignature).join("");
				const heightInLines = Math.ceil(estimateZonePx(lineThreads) / lineHeight);
				const existing = zonesRef.current.get(line);

				if (!existing) {
					const domNode = makeZoneNode();
					const zoneId = acc.addZone({ afterLineNumber: line, heightInLines, domNode });
					const root = createRoot(domNode);
					const entry: ZoneEntry = { zoneId, domNode, root, heightInLines, signature: sig };
					zonesRef.current.set(line, entry);
					renderLine(lineThreads, entry);
					continue;
				}

				if (existing.signature === sig && existing.heightInLines === heightInLines) {
					continue;
				}

				if (existing.signature !== sig) {
					renderLine(lineThreads, existing);
					existing.signature = sig;
				}

				if (existing.heightInLines !== heightInLines) {
					// Re-add with new height; same DOM node + React root are reparented, so
					// component state (in-progress textarea, etc.) survives.
					acc.removeZone(existing.zoneId);
					existing.zoneId = acc.addZone({
						afterLineNumber: line,
						heightInLines,
						domNode: existing.domNode,
					});
					existing.heightInLines = heightInLines;
				}
			}

			// Pending new-thread zone — at most one.
			const pending = pendingZoneRef.current;
			if (pendingLine === null) {
				if (pending) {
					acc.removeZone(pending.zoneId);
					const root = pending.root;
					queueMicrotask(() => root.unmount());
					pendingZoneRef.current = null;
				}
			} else if (!pending || pending.line !== pendingLine) {
				if (pending) {
					acc.removeZone(pending.zoneId);
					const root = pending.root;
					queueMicrotask(() => root.unmount());
				}
				const domNode = makeZoneNode();
				const heightInLines = Math.ceil(120 / lineHeight);
				const zoneId = acc.addZone({ afterLineNumber: pendingLine, heightInLines, domNode });
				const root = createRoot(domNode);
				root.render(
					<NewThreadWidget line={pendingLine} onSave={onSaveNew} onCancel={onCancelNew} />
				);
				pendingZoneRef.current = {
					zoneId,
					domNode,
					root,
					heightInLines,
					signature: "",
					line: pendingLine,
				};
			} else {
				// Same pending line — refresh callbacks via re-render (cheap, in-place).
				pending.root.render(
					<NewThreadWidget line={pendingLine} onSave={onSaveNew} onCancel={onCancelNew} />
				);
			}
		});
	}, [
		editor,
		threads,
		pendingLine,
		onReply,
		onResolve,
		onSaveNew,
		onCancelNew,
		onAcceptDraft,
		onDeclineDraft,
		onDeleteDraft,
		onSaveEdit,
	]);

	useEffect(() => {
		// Final teardown when the component unmounts. The captured editor is the
		// one zones were last attached to; if the editor was swapped we already
		// dropped our refs above and this becomes a no-op.
		return () => {
			const ed = lastEditorRef.current;
			if (!ed) return;
			const modEditor = ed.getModifiedEditor();
			const entries = [...zonesRef.current.values()];
			if (pendingZoneRef.current) entries.push(pendingZoneRef.current);
			modEditor.changeViewZones((acc) => {
				for (const e of entries) acc.removeZone(e.zoneId);
			});
			queueMicrotask(() => {
				for (const e of entries) e.root.unmount();
			});
			zonesRef.current.clear();
			pendingZoneRef.current = null;
			lastEditorRef.current = null;
		};
	}, []);
}

// ── Line decorations for threads ──────────────────────────────────────────────

function baseGutterClass(t: UnifiedThread): string {
	if (t.isAIDraft) return "pr-thread-ai-draft-gutter";
	return (t as GitHubReviewThread).isResolved
		? "pr-thread-resolved-gutter"
		: "pr-thread-unresolved-gutter";
}

function baseLineClass(t: UnifiedThread): string | undefined {
	if (t.isAIDraft) return "pr-thread-ai-draft-line";
	return (t as GitHubReviewThread).isResolved ? undefined : "pr-thread-unresolved-line";
}

/**
 * Two collections: a stable base set rebuilt only when threads change, plus a
 * single-decoration overlay tracking the active thread. Splitting prevents an
 * O(threads) rebuild whenever the active thread changes (sidebar/card click).
 */
function useThreadDecorations(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	threads: UnifiedThread[],
	activeThreadId: string | null
) {
	const baseRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const activeRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

	useEffect(() => {
		if (!editor) return;
		const modEditor = editor.getModifiedEditor();
		const decorations: monaco.editor.IModelDeltaDecoration[] = threads
			.filter((t) => t.line != null)
			.map((t) => ({
				range: new monaco.Range(t.line!, 1, t.line!, 1),
				options: {
					isWholeLine: true,
					linesDecorationsClassName: baseGutterClass(t),
					className: baseLineClass(t),
				},
			}));
		baseRef.current = modEditor.createDecorationsCollection(decorations);
		return () => baseRef.current?.clear();
	}, [editor, threads]);

	useEffect(() => {
		if (!editor) return;
		const modEditor = editor.getModifiedEditor();
		activeRef.current?.clear();
		const active = threads.find((t) => t.id === activeThreadId);
		if (!active?.line) return;
		// Skip overlay for resolved GitHub threads — keep them visually muted.
		if (!active.isAIDraft && (active as GitHubReviewThread).isResolved) return;
		activeRef.current = modEditor.createDecorationsCollection([
			{
				range: new monaco.Range(active.line, 1, active.line, 1),
				options: {
					isWholeLine: true,
					linesDecorationsClassName: "pr-thread-active-gutter",
					className: "pr-thread-active-line",
				},
			},
		]);
		return () => activeRef.current?.clear();
	}, [editor, threads, activeThreadId]);
}

// ── Gutter plus button for new threads ────────────────────────────────────────

function useGutterPlusButton(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	onAddThread: (line: number) => void,
	validLines?: Set<number>
) {
	const decorationRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

	useEffect(() => {
		if (!editor) return;
		const modEditor = editor.getModifiedEditor();

		decorationRef.current = modEditor.createDecorationsCollection([]);

		const isValidLine = (line: number) => !validLines || validLines.has(line);

		const moveSub = modEditor.onMouseMove((e) => {
			const line = e.target.position?.lineNumber;
			if (!line || !isValidLine(line)) {
				decorationRef.current?.clear();
				return;
			}

			// Only show on the "modified" side gutter or margin
			const isGutter =
				e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
				e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
				e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;

			if (isGutter) {
				decorationRef.current?.set([
					{
						range: new monaco.Range(line, 1, line, 1),
						options: {
							glyphMarginClassName: "pr-gutter-plus-icon",
							isWholeLine: true,
						},
					},
				]);
			} else {
				decorationRef.current?.clear();
			}
		});

		const leaveSub = modEditor.onMouseLeave(() => {
			decorationRef.current?.clear();
		});

		const clickSub = modEditor.onMouseDown((e) => {
			const isGutter =
				e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
				e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
				e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;

			if (isGutter) {
				const line = e.target.position?.lineNumber;
				if (line && isValidLine(line)) onAddThread(line);
			}
		});

		return () => {
			moveSub.dispose();
			leaveSub.dispose();
			clickSub.dispose();
			decorationRef.current?.clear();
		};
	}, [editor, onAddThread, validLines]);
}

// ── Main component ────────────────────────────────────────────────────────────

const PR_REVIEW_HINTS: Hint[] = [
	{ keys: ["J", "K"], label: "File" },
	{ keys: ["V"], label: "Viewed" },
	{ keys: ["C"], label: "Comment" },
	{ keys: ["Esc"], label: "Clear" },
];

interface PRReviewFileTabProps {
	prCtx: PRContext;
	filePath: string;
	language: string;
}

export function PRReviewFileTab({ prCtx, filePath, language }: PRReviewFileTabProps) {
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	// biome-ignore lint/correctness/useExhaustiveDependencies: prCtx primitives only — avoid recompute on new prCtx ref
	const sessionKey = useMemo(
		() => prReviewSessionKey(activeWorkspaceId ?? "", formatPrIdentifier(prCtx)),
		[activeWorkspaceId, prCtx.owner, prCtx.repo, prCtx.number]
	);
	const activeThreadId = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeThreadId ?? null
	);
	const activeFilePath = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const setScroll = usePRReviewSessionStore((s) => s.setScroll);
	const getScroll = usePRReviewSessionStore((s) => s.getScroll);
	const setFileOrder = usePRReviewSessionStore((s) => s.setFileOrder);
	const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(
		null
	);
	const utils = trpc.useUtils();
	const markdownPaneRef = useRef<HTMLDivElement>(null);
	const isSyncingScrollRef = useRef(false);

	const hideEditor = markdownPreviewMode === "rendered" || markdownPreviewMode === "rich-diff";

	useEffect(() => {
		if (hideEditor) {
			setEditorInstance(null);
			return;
		}
		if (!editorInstance || markdownPreviewMode !== "split") return;
		const modEditor = editorInstance.getModifiedEditor();

		const scrollSub = modEditor.onDidScrollChange((e) => {
			if (isSyncingScrollRef.current) return;
			const pane = markdownPaneRef.current;
			if (!pane) return;
			const editorScrollable = modEditor.getScrollHeight() - modEditor.getLayoutInfo().height;
			const paneScrollable = pane.scrollHeight - pane.clientHeight;
			if (editorScrollable <= 0 || paneScrollable <= 0) return;
			const pct = e.scrollTop / editorScrollable;
			isSyncingScrollRef.current = true;
			pane.scrollTop = pct * paneScrollable;
			requestAnimationFrame(() => {
				isSyncingScrollRef.current = false;
			});
		});

		return () => scrollSub.dispose();
	}, [editorInstance, hideEditor, markdownPreviewMode]);

	const [pendingLine, setPendingLine] = useState<number | null>(null);

	// File content for both sides
	const originalQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: prCtx.repoPath, ref: prCtx.targetBranch, filePath },
		{ staleTime: 60_000 }
	);
	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: prCtx.repoPath, ref: prCtx.sourceBranch, filePath },
		{ staleTime: 60_000 }
	);

	// Diff hunks — used to restrict comments to lines GitHub will accept
	const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
		{ repoPath: prCtx.repoPath, baseBranch: prCtx.targetBranch, headBranch: prCtx.sourceBranch },
		{ staleTime: 60_000 }
	);
	const validDiffLines = useMemo(() => {
		const fileData = branchDiffQuery.data?.files.find((f) => f.path === filePath);
		if (!fileData) return undefined;
		const lines = new Set<number>();
		for (const hunk of fileData.hunks) {
			for (const dl of hunk.lines) {
				if (dl.newLineNumber != null) lines.add(dl.newLineNumber);
			}
		}
		return lines;
	}, [branchDiffQuery.data, filePath]);

	// PR details (threads)
	const { data: prDetails } = trpc.github.getPRDetails.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	useEffect(() => {
		if (!prDetails?.files) return;
		setFileOrder(
			sessionKey,
			prDetails.files.map((f) => f.path)
		);
	}, [prDetails?.files, sessionKey, setFileOrder]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: prCtx primitives only — avoid re-runs on new prCtx ref
	useEffect(() => {
		if (!activeFilePath || !activeWorkspaceId) return;
		if (activeFilePath === filePath) return;
		useTabStore
			.getState()
			.swapPRReviewFile(activeWorkspaceId, prCtx, activeFilePath, detectLanguage(activeFilePath));
	}, [activeFilePath, activeWorkspaceId, filePath, prCtx.owner, prCtx.repo, prCtx.number]);

	// AI review draft for this PR
	const prIdentifier = formatPrIdentifier(prCtx);
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 30_000,
	});
	const matchingDraft = (() => {
		const drafts = reviewDraftsQuery.data?.filter((d) => d.prIdentifier === prIdentifier) ?? [];
		if (drafts.length === 0) return undefined;
		const statusPriority: Record<string, number> = {
			ready: 0,
			in_progress: 1,
			queued: 2,
			submitted: 3,
			failed: 4,
		};
		return drafts.sort((a, b) => {
			const pa = statusPriority[a.status] ?? 5;
			const pb = statusPriority[b.status] ?? 5;
			if (pa !== pb) return pa - pb;
			return (b.roundNumber ?? 1) - (a.roundNumber ?? 1);
		})[0];
	})();
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id, staleTime: 30_000 }
	);

	const invalidateDrafts = () => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
	};

	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});

	const deleteDraftComment = trpc.aiReview.deleteDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});

	// Review mutations
	const addComment = trpc.github.addReviewComment.useMutation({
		onSuccess: () =>
			utils.github.getPRDetails.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});
	const resolveThread = trpc.github.resolveThread.useMutation({
		onSuccess: () =>
			utils.github.getPRDetails.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	// Viewed state
	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);
	const isViewed = viewedFilesList?.includes(filePath) ?? false;
	const markViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: () =>
			utils.github.getViewedFiles.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	// Threads for this file — merge GitHub threads with draft threads (AI + user)
	// Memoized to avoid recreating view zones on every background query refetch
	const draftComments = aiDraftQuery.data?.comments;
	const reviewThreads = prDetails?.reviewThreads;

	const fileThreads: UnifiedThread[] = useMemo(() => {
		const draftFileThreads: AIDraftThread[] = (draftComments ?? [])
			.filter(
				(c) =>
					(c.status === "pending" || c.status === "edited" || c.status === "user-pending") &&
					c.filePath === filePath
			)
			.map((c) => ({
				id: `ai-${c.id}`,
				isAIDraft: true as const,
				draftCommentId: c.id,
				path: c.filePath,
				line: c.lineNumber,
				diffSide: (c.side as "LEFT" | "RIGHT") ?? "RIGHT",
				body: c.body,
				status: c.status as AIDraftThread["status"],
				userEdit: c.userEdit ?? null,
				createdAt:
					typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
			}));

		const githubFileThreads = (reviewThreads ?? []).filter((t) => t.path === filePath);
		return [...githubFileThreads, ...draftFileThreads];
	}, [draftComments, reviewThreads, filePath]);

	const activeThreadOnThisFile = useMemo(
		() =>
			activeThreadId == null ? null : (fileThreads.find((t) => t.id === activeThreadId) ?? null),
		[fileThreads, activeThreadId]
	);

	// Thread navigation
	const unresolvedLines = fileThreads
		.filter((t) => {
			if (t.isAIDraft) return t.status === "pending" && t.line != null;
			return !(t as GitHubReviewThread).isResolved && t.line != null;
		})
		.map((t) => t.line!)
		.sort((a, b) => a - b);
	const [navIdx, setNavIdx] = useState(0);

	const navigateToThread = useCallback(
		(idx: number) => {
			const line = unresolvedLines[idx];
			if (line == null) return;
			editorInstance?.getModifiedEditor().revealLineInCenter(line);
			setNavIdx(idx);
		},
		[unresolvedLines, editorInstance]
	);

	// Get current HEAD commit SHA for review comments (needed by GitHub API)
	const commitId = prDetails?.headCommitOid ?? "";

	const handleReply = useCallback(
		(threadId: string, body: string) => {
			addComment.mutate({ threadId, body });
		},
		[addComment.mutate]
	);

	const addUserComment = trpc.aiReview.addUserComment.useMutation({
		onSuccess: () => {
			setPendingLine(null);
			invalidateDrafts();
		},
	});

	// Use a ref for prCtx so handleSaveNew doesn't change identity when the parent
	// re-renders with the same prCtx data but a different object reference.
	const prCtxRef = useRef(prCtx);
	prCtxRef.current = prCtx;

	const handleSaveNew = useCallback(
		(body: string) => {
			if (pendingLine === null) return;
			const ctx = prCtxRef.current;
			addUserComment.mutate({
				prIdentifier: formatPrIdentifier(ctx),
				prTitle: ctx.title,
				sourceBranch: ctx.sourceBranch,
				targetBranch: ctx.targetBranch,
				filePath,
				lineNumber: pendingLine,
				side: "RIGHT",
				body,
			});
		},
		[pendingLine, filePath, addUserComment.mutate]
	);

	const handleResolve = useCallback(
		(threadId: string) => {
			resolveThread.mutate({ threadId });
		},
		[resolveThread.mutate]
	);

	const handleAcceptDraft = useCallback(
		(draftCommentId: string) => {
			updateDraftComment.mutate({ commentId: draftCommentId, status: "user-pending" });
		},
		[updateDraftComment.mutate]
	);

	const handleDeclineDraft = useCallback(
		(draftCommentId: string) => {
			updateDraftComment.mutate({ commentId: draftCommentId, status: "rejected" });
		},
		[updateDraftComment.mutate]
	);

	const handleDeleteDraft = useCallback(
		(draftCommentId: string) => {
			deleteDraftComment.mutate({ commentId: draftCommentId });
		},
		[deleteDraftComment.mutate]
	);

	const handleSaveEdit = useCallback(
		(draftCommentId: string, body: string) => {
			updateDraftComment.mutate({ commentId: draftCommentId, status: "edited", userEdit: body });
		},
		[updateDraftComment.mutate]
	);

	const handleCancelNew = useCallback(() => setPendingLine(null), []);

	// Hooks for inline zones + decorations + gutter actions
	useInlineCommentZones(
		editorInstance,
		fileThreads,
		pendingLine,
		handleReply,
		handleResolve,
		handleSaveNew,
		handleCancelNew,
		handleAcceptDraft,
		handleDeclineDraft,
		handleDeleteDraft,
		handleSaveEdit
	);
	useThreadDecorations(editorInstance, fileThreads, activeThreadId);
	useGutterPlusButton(editorInstance, (line) => setPendingLine(line), validDiffLines);

	// Keep current state available to event handlers without re-attaching them.
	const keyHandlersRef = useRef({
		editor: null as monaco.editor.ICodeEditor | null,
		filePath,
		isViewed,
		validDiffLines,
		owner: prCtx.owner,
		repo: prCtx.repo,
		number: prCtx.number,
		markViewed,
		setPendingLine,
	});
	useEffect(() => {
		keyHandlersRef.current = {
			editor: editorInstance?.getModifiedEditor() ?? null,
			filePath,
			isViewed,
			validDiffLines,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
			markViewed,
			setPendingLine,
		};
	});

	useEffect(() => {
		const subs = [
			subscribePRReviewEvent("toggle-viewed", () => {
				const r = keyHandlersRef.current;
				r.markViewed.mutate({
					owner: r.owner,
					repo: r.repo,
					number: r.number,
					filePath: r.filePath,
					viewed: !r.isViewed,
				});
			}),
			subscribePRReviewEvent("new-comment", () => {
				const r = keyHandlersRef.current;
				const editor = r.editor;
				if (!editor) return;
				let line = editor.getPosition()?.lineNumber ?? null;
				if (!line || (r.validDiffLines && !r.validDiffLines.has(line))) {
					const ranges = editor.getVisibleRanges();
					line = null;
					for (const range of ranges) {
						for (let l = range.startLineNumber; l <= range.endLineNumber; l++) {
							if (!r.validDiffLines || r.validDiffLines.has(l)) {
								line = l;
								break;
							}
						}
						if (line != null) break;
					}
					if (line == null) return;
					editor.focus();
					editor.setPosition({ lineNumber: line, column: 1 });
				}
				r.setPendingLine(line);
			}),
		];
		return () => {
			for (const unsub of subs) unsub();
		};
	}, []);

	useEffect(() => {
		const editor = editorInstance?.getModifiedEditor();
		if (!editor) return;
		const top = getScroll(sessionKey, filePath);
		if (top != null) editor.setScrollTop(top);
		let raf = 0;
		const sub = editor.onDidScrollChange(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				setScroll(sessionKey, filePath, editor.getScrollTop());
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			sub.dispose();
		};
	}, [editorInstance, filePath, sessionKey, getScroll, setScroll]);

	useEffect(() => {
		const editor = editorInstance?.getModifiedEditor();
		if (!editor || !activeThreadOnThisFile?.line) return;
		const line = activeThreadOnThisFile.line;
		const ranges = editor.getVisibleRanges();
		const isVisible = ranges.some((r) => line >= r.startLineNumber && line <= r.endLineNumber);
		if (!isVisible) {
			editor.revealLineInCenter(line);
		}
	}, [editorInstance, activeThreadOnThisFile]);

	const isLoading = originalQuery.isLoading || modifiedQuery.isLoading;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{activeThreadOnThisFile && (
				<ActiveThreadBar
					thread={activeThreadOnThisFile}
					onAccept={() => {
						if (activeThreadOnThisFile.isAIDraft)
							handleAcceptDraft(activeThreadOnThisFile.draftCommentId);
					}}
					onDecline={() => {
						if (activeThreadOnThisFile.isAIDraft)
							handleDeclineDraft(activeThreadOnThisFile.draftCommentId);
					}}
					onEdit={() =>
						emitPRReviewEvent("edit-thread", {
							draftCommentId: activeThreadOnThisFile.isAIDraft
								? activeThreadOnThisFile.draftCommentId
								: null,
						})
					}
					onReply={() => emitPRReviewEvent("focus-reply", { threadId: activeThreadOnThisFile.id })}
					onResolve={() => {
						if (!activeThreadOnThisFile.isAIDraft) handleResolve(activeThreadOnThisFile.id);
					}}
					onCenter={() => {
						const editor = editorInstance?.getModifiedEditor();
						if (editor && activeThreadOnThisFile.line)
							editor.revealLineInCenter(activeThreadOnThisFile.line);
					}}
				/>
			)}
			{/* Toolbar */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{filePath}
				</span>

				{/* Unresolved comment nav */}
				{unresolvedLines.length > 0 && (
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => navigateToThread(Math.max(0, navIdx - 1))}
							disabled={navIdx === 0}
							className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] disabled:opacity-30"
						>
							←
						</button>
						<span className="text-[10px] text-[var(--color-warning)]">
							{unresolvedLines.length} comment{unresolvedLines.length !== 1 ? "s" : ""}
						</span>
						<button
							type="button"
							onClick={() => navigateToThread(Math.min(unresolvedLines.length - 1, navIdx + 1))}
							disabled={navIdx === unresolvedLines.length - 1}
							className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] disabled:opacity-30"
						>
							→
						</button>
					</div>
				)}

				{/* Viewed toggle */}
				<label className="flex items-center gap-1.5 cursor-pointer">
					<input
						type="checkbox"
						checked={isViewed}
						onChange={(e) =>
							markViewed.mutate({
								owner: prCtx.owner,
								repo: prCtx.repo,
								number: prCtx.number,
								filePath,
								viewed: e.target.checked,
							})
						}
						className="h-3 w-3 rounded accent-[var(--accent)]"
					/>
					<span className="text-[10px] text-[var(--text-quaternary)]">Viewed</span>
				</label>

				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					disabled={hideEditor}
					className={[
						"rounded px-2 py-0.5 text-[11px] transition-colors",
						hideEditor
							? "text-[var(--text-quaternary)] opacity-40 cursor-not-allowed"
							: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
					].join(" ")}
				>
					{diffMode === "split" ? "Inline" : "Split"}
				</button>
				<MarkdownPreviewButton language={language} showRichDiff />
			</div>

			{/* Diff editor */}
			<div className="flex-1 overflow-hidden">
				{isLoading ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Loading…
					</div>
				) : markdownPreviewMode === "rich-diff" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderedDiff
							original={originalQuery.data?.content ?? ""}
							modified={modifiedQuery.data?.content ?? ""}
						/>
					</div>
				) : markdownPreviewMode === "rendered" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderer content={modifiedQuery.data?.content ?? ""} />
					</div>
				) : markdownPreviewMode === "split" ? (
					<div className="flex h-full overflow-hidden">
						<div className="flex-1 overflow-hidden">
							<DiffEditor
								original={originalQuery.data?.content ?? ""}
								modified={modifiedQuery.data?.content ?? ""}
								language={language}
								renderSideBySide={diffMode === "split"}
								readOnly={true}
								onEditorReady={(editor) => {
									setEditorInstance(editor);
								}}
							/>
						</div>
						<div
							ref={markdownPaneRef}
							className="flex-1 overflow-y-auto border-l border-[var(--border)] p-4"
							onScroll={() => {
								if (isSyncingScrollRef.current) return;
								const modEditor = editorInstance?.getModifiedEditor();
								const pane = markdownPaneRef.current;
								if (!modEditor || !pane) return;
								const paneScrollable = pane.scrollHeight - pane.clientHeight;
								const editorScrollable =
									modEditor.getScrollHeight() - modEditor.getLayoutInfo().height;
								if (paneScrollable <= 0 || editorScrollable <= 0) return;
								const pct = pane.scrollTop / paneScrollable;
								isSyncingScrollRef.current = true;
								modEditor.setScrollTop(pct * editorScrollable);
								requestAnimationFrame(() => {
									isSyncingScrollRef.current = false;
								});
							}}
						>
							<MarkdownRenderer content={modifiedQuery.data?.content ?? ""} />
						</div>
					</div>
				) : (
					<DiffEditor
						original={originalQuery.data?.content ?? ""}
						modified={modifiedQuery.data?.content ?? ""}
						language={language}
						renderSideBySide={diffMode === "split"}
						readOnly={true}
						onEditorReady={(editor) => {
							setEditorInstance(editor);
						}}
					/>
				)}
			</div>
			<ReviewHintBar hints={PR_REVIEW_HINTS} />
		</div>
	);
}
