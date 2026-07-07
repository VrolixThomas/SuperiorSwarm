import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { InlineComment } from "../../../shared/inline-comment-types";

export type AnchoredComment = InlineComment & {
	displayStartLine: number;
	displayEndLine: number;
	outdated: boolean;
};

export interface CreateCommentDraft {
	startLine: number;
	endLine: number;
	body: string;
}

interface InlineCommentLayerProps {
	editor: monaco.editor.IStandaloneDiffEditor | null;
	comments: AnchoredComment[];
	onCreate: (draft: CreateCommentDraft) => void;
	onUpdate: (id: string, body: string) => void;
	onDelete: (id: string) => void;
}

// ── Widgets ───────────────────────────────────────────────────────────────────

function CommentComposer({
	title,
	initialBody,
	submitLabel,
	onSave,
	onCancel,
}: {
	title: string;
	initialBody: string;
	submitLabel: string;
	onSave: (body: string) => void;
	onCancel: () => void;
}) {
	const [body, setBody] = useState(initialBody);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const submit = () => {
		if (body.trim()) onSave(body.trim());
	};

	return (
		<div
			onMouseDown={(e) => e.stopPropagation()}
			className="mx-2 my-1 overflow-hidden rounded-[6px] border border-[var(--accent)] bg-[var(--bg-surface)] text-[11px] shadow-lg"
		>
			<div className="bg-[var(--accent)] px-3 py-1 text-[10px] font-medium text-[var(--accent-foreground)]">
				{title}
			</div>
			<div className="flex flex-col gap-1.5 p-2">
				<textarea
					ref={inputRef}
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
						{submitLabel}
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

function CommentCard({
	comment,
	onUpdate,
	onDelete,
}: {
	comment: AnchoredComment;
	onUpdate: (id: string, body: string) => void;
	onDelete: (id: string) => void;
}) {
	const [editing, setEditing] = useState(false);

	if (editing) {
		return (
			<CommentComposer
				title={`Edit comment on line ${comment.displayStartLine}`}
				initialBody={comment.body}
				submitLabel="Save"
				onSave={(body) => {
					onUpdate(comment.id, body);
					setEditing(false);
				}}
				onCancel={() => setEditing(false)}
			/>
		);
	}

	return (
		<div
			onMouseDown={(e) => e.stopPropagation()}
			className="mx-2 my-1 overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] text-[11px] shadow-sm"
		>
			<div className="flex items-center gap-2 bg-[var(--bg-elevated)] px-3 py-1">
				<span className="text-[10px] font-medium text-[var(--text-tertiary)]">Local comment</span>
				{comment.outdated && (
					<span className="rounded bg-[var(--term-yellow)]/20 px-1 text-[9px] text-[var(--term-yellow)]">
						outdated
					</span>
				)}
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => setEditing(true)}
					className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
				>
					Edit
				</button>
				<button
					type="button"
					onClick={() => onDelete(comment.id)}
					className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--term-red)]"
				>
					Delete
				</button>
			</div>
			<div className="whitespace-pre-wrap px-3 py-1.5 text-[var(--text-secondary)]">
				{comment.body}
			</div>
		</div>
	);
}

// ── Zone plumbing (adapted from PRReviewFileTab) ──────────────────────────────

interface ZoneEntry {
	zoneId: string;
	domNode: HTMLElement;
	root: ReturnType<typeof createRoot>;
	heightInLines: number;
	signature: string;
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

function estimateCommentPx(c: AnchoredComment): number {
	const bodyLines = Math.max(1, Math.ceil(c.body.length / 60) + (c.body.split("\n").length - 1));
	return 30 + bodyLines * 16 + 12;
}

function commentSignature(c: AnchoredComment): string {
	return `${c.id}|${c.displayStartLine}|${c.displayEndLine}|${c.body}|${c.outdated ? 1 : 0}`;
}

export function InlineCommentLayer({
	editor,
	comments,
	onCreate,
	onUpdate,
	onDelete,
}: InlineCommentLayerProps) {
	const [pendingRange, setPendingRange] = useState<{ start: number; end: number } | null>(null);
	const zonesRef = useRef<Map<number, ZoneEntry>>(new Map());
	const pendingZoneRef = useRef<(ZoneEntry & { line: number }) | null>(null);
	const hoverDecorRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const rangeDecorRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const lastEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

	// Gutter hover "+" and click-to-comment (selection-aware).
	useEffect(() => {
		if (!editor) return;
		const modEditor = editor.getModifiedEditor();
		hoverDecorRef.current = modEditor.createDecorationsCollection([]);

		const isGutter = (e: monaco.editor.IEditorMouseEvent) =>
			e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
			e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
			e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;

		const moveSub = modEditor.onMouseMove((e) => {
			const line = e.target.position?.lineNumber;
			if (!line || !isGutter(e)) {
				hoverDecorRef.current?.clear();
				return;
			}
			hoverDecorRef.current?.set([
				{
					range: new monaco.Range(line, 1, line, 1),
					options: { glyphMarginClassName: "pr-gutter-plus-icon", isWholeLine: true },
				},
			]);
		});

		const leaveSub = modEditor.onMouseLeave(() => hoverDecorRef.current?.clear());

		const clickSub = modEditor.onMouseDown((e) => {
			if (!isGutter(e)) return;
			const line = e.target.position?.lineNumber;
			if (!line) return;
			// Multi-line: if the current selection spans lines and contains the
			// clicked line, comment on the whole selection.
			const sel = modEditor.getSelection();
			if (
				sel &&
				sel.startLineNumber !== sel.endLineNumber &&
				line >= sel.startLineNumber &&
				line <= sel.endLineNumber
			) {
				setPendingRange({ start: sel.startLineNumber, end: sel.endLineNumber });
			} else {
				setPendingRange({ start: line, end: line });
			}
		});

		return () => {
			moveSub.dispose();
			leaveSub.dispose();
			clickSub.dispose();
			hoverDecorRef.current?.clear();
		};
	}, [editor]);

	// Range decorations for saved comments.
	useEffect(() => {
		if (!editor) return;
		const modEditor = editor.getModifiedEditor();
		rangeDecorRef.current?.clear();
		rangeDecorRef.current = modEditor.createDecorationsCollection(
			comments.map((c) => ({
				range: new monaco.Range(c.displayStartLine, 1, c.displayEndLine, 1),
				options: { isWholeLine: true, linesDecorationsClassName: "local-comment-gutter" },
			}))
		);
		return () => rangeDecorRef.current?.clear();
	}, [editor, comments]);

	// View zones: one per anchor line (displayEndLine), plus at most one composer.
	useEffect(() => {
		if (!editor) return;

		if (lastEditorRef.current && lastEditorRef.current !== editor) {
			zonesRef.current.clear();
			pendingZoneRef.current = null;
		}
		lastEditorRef.current = editor;

		const modEditor = editor.getModifiedEditor();
		const lineHeight = modEditor.getOption(monaco.editor.EditorOption.lineHeight);

		const byLine = new Map<number, AnchoredComment[]>();
		for (const c of comments) {
			const arr = byLine.get(c.displayEndLine) ?? [];
			arr.push(c);
			byLine.set(c.displayEndLine, arr);
		}

		const renderLine = (lineComments: AnchoredComment[], entry: ZoneEntry) => {
			entry.root.render(
				<div className="flex flex-col gap-0.5">
					{lineComments.map((c) => (
						<CommentCard key={c.id} comment={c} onUpdate={onUpdate} onDelete={onDelete} />
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
				const px = lineComments.reduce((s, c) => s + estimateCommentPx(c), 0);
				const heightInLines = Math.ceil(px / lineHeight);
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
				if (existing.signature === sig && existing.heightInLines === heightInLines) continue;
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

			// Composer zone.
			const pending = pendingZoneRef.current;
			const anchorLine = pendingRange?.end ?? null;
			if (anchorLine === null) {
				if (pending) {
					acc.removeZone(pending.zoneId);
					const root = pending.root;
					queueMicrotask(() => root.unmount());
					pendingZoneRef.current = null;
				}
			} else {
				const range = pendingRange;
				const title =
					range.start === range.end
						? `New comment on line ${anchorLine}`
						: `New comment on lines ${range.start}-${range.end}`;
				const renderComposer = (entry: ZoneEntry) =>
					entry.root.render(
						<CommentComposer
							title={title}
							initialBody=""
							submitLabel="Comment"
							onSave={(body) => {
								onCreate({ startLine: range.start, endLine: range.end, body });
								setPendingRange(null);
							}}
							onCancel={() => setPendingRange(null)}
						/>
					);
				if (!pending || pending.line !== anchorLine) {
					if (pending) {
						acc.removeZone(pending.zoneId);
						const root = pending.root;
						queueMicrotask(() => root.unmount());
					}
					const domNode = makeZoneNode();
					const heightInLines = Math.ceil(130 / lineHeight);
					const zoneId = acc.addZone({ afterLineNumber: anchorLine, heightInLines, domNode });
					const root = createRoot(domNode);
					const entry = { zoneId, domNode, root, heightInLines, signature: "", line: anchorLine };
					pendingZoneRef.current = entry;
					renderComposer(entry);
				} else {
					renderComposer(pending);
				}
			}
		});
	}, [editor, comments, pendingRange, onCreate, onUpdate, onDelete]);

	// Final teardown.
	useEffect(() => {
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

	return null;
}
