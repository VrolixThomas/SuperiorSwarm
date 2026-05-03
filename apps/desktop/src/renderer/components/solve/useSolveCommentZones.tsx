import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { SolveCommentInfo } from "../../../shared/solve-types";
import { SolveCommentWidget } from "./SolveCommentWidget";

type Side = "LEFT" | "RIGHT";

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

interface LineCountModel {
	getLineCount(): number;
}

export function resolveSide(
	comment: SolveCommentInfo,
	modifiedModel: LineCountModel | null,
	originalModel: LineCountModel | null
): Side {
	const explicit = comment.side?.toUpperCase();
	if (explicit === "LEFT") return "LEFT";
	if (explicit === "RIGHT") return "RIGHT";
	if (comment.lineNumber == null) return "RIGHT";
	const modCount = modifiedModel?.getLineCount() ?? 0;
	const origCount = originalModel?.getLineCount() ?? 0;
	if (comment.lineNumber > modCount && comment.lineNumber <= origCount) return "LEFT";
	return "RIGHT";
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
 * Diff-based view-zone manager for solve comments. Comments with side==="LEFT"
 * are anchored to the original (left) pane; everything else goes to the
 * modified (right) pane. When `enabled` is false the inline cards are torn down
 * and a 💬 glyph is rendered in the gutter on the correct side. The active
 * comment's line is always highlighted with a full-line decoration regardless
 * of `enabled`.
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
	const zonesRef = useRef<{ LEFT: Map<number, ZoneEntry>; RIGHT: Map<number, ZoneEntry> }>({
		LEFT: new Map(),
		RIGHT: new Map(),
	});
	const lastEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

	useEffect(() => {
		if (!editor) return;

		if (lastEditorRef.current && lastEditorRef.current !== editor) {
			zonesRef.current.LEFT.clear();
			zonesRef.current.RIGHT.clear();
		}
		lastEditorRef.current = editor;

		const editors: Record<Side, monaco.editor.ICodeEditor> = {
			LEFT: editor.getOriginalEditor(),
			RIGHT: editor.getModifiedEditor(),
		};

		if (!enabled) {
			for (const side of ["LEFT", "RIGHT"] as Side[]) {
				const map = zonesRef.current[side];
				const entries = [...map.values()];
				if (entries.length === 0) continue;
				editors[side].changeViewZones((acc) => {
					for (const e of entries) acc.removeZone(e.zoneId);
				});
				const roots = entries.map((e) => e.root);
				queueMicrotask(() => {
					for (const r of roots) r.unmount();
				});
				map.clear();
			}
			return;
		}

		const originalModel = editor.getOriginalEditor().getModel();
		const modifiedModel = editor.getModifiedEditor().getModel();

		for (const side of ["LEFT", "RIGHT"] as Side[]) {
			const codeEditor = editors[side];
			const map = zonesRef.current[side];
			const lineHeight = codeEditor.getOption(monaco.editor.EditorOption.lineHeight);

			const byLine = new Map<number, SolveCommentInfo[]>();
			for (const c of comments) {
				if (resolveSide(c, modifiedModel, originalModel) !== side) continue;
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

			codeEditor.changeViewZones((acc) => {
				for (const [line, entry] of map) {
					if (!byLine.has(line)) {
						acc.removeZone(entry.zoneId);
						const root = entry.root;
						queueMicrotask(() => root.unmount());
						map.delete(line);
					}
				}

				for (const [line, lineComments] of byLine) {
					const sig = lineComments
						.map((c) => commentSignature(c, c.id === activeCommentId))
						.join("");
					const heightInLines = Math.ceil(estimateZonePx(lineComments) / lineHeight);
					const existing = map.get(line);

					if (!existing) {
						const domNode = makeZoneNode();
						const zoneId = acc.addZone({ afterLineNumber: line, heightInLines, domNode });
						const root = createRoot(domNode);
						const entry: ZoneEntry = { zoneId, domNode, root, heightInLines, signature: sig };
						map.set(line, entry);
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
		}
	}, [editor, comments, workspaceId, enabled, activeCommentId]);

	useEffect(() => {
		if (!editor || enabled) return;
		const editors: Record<Side, monaco.editor.ICodeEditor> = {
			LEFT: editor.getOriginalEditor(),
			RIGHT: editor.getModifiedEditor(),
		};

		const previousGlyphMargin: Record<Side, boolean> = {
			LEFT: editors.LEFT.getOption(monaco.editor.EditorOption.glyphMargin),
			RIGHT: editors.RIGHT.getOption(monaco.editor.EditorOption.glyphMargin),
		};
		editors.LEFT.updateOptions({ glyphMargin: true });
		editors.RIGHT.updateOptions({ glyphMargin: true });

		const originalModel = editor.getOriginalEditor().getModel();
		const modifiedModel = editor.getModifiedEditor().getModel();

		const lineToCommentId: Record<Side, Map<number, string>> = {
			LEFT: new Map(),
			RIGHT: new Map(),
		};
		for (const c of comments) {
			if (c.lineNumber == null) continue;
			const side = resolveSide(c, modifiedModel, originalModel);
			if (!lineToCommentId[side].has(c.lineNumber)) {
				lineToCommentId[side].set(c.lineNumber, c.id);
			}
		}

		const subs: monaco.IDisposable[] = [];
		const collections: monaco.editor.IEditorDecorationsCollection[] = [];
		for (const side of ["LEFT", "RIGHT"] as Side[]) {
			const codeEditor = editors[side];
			const map = lineToCommentId[side];
			const decorations = codeEditor.createDecorationsCollection(
				[...map.keys()].map((line) => ({
					range: new monaco.Range(line, 1, line, 1),
					options: { glyphMarginClassName: "solve-comment-glyph" },
				}))
			);
			collections.push(decorations);
			const sub = codeEditor.onMouseDown((e) => {
				if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
				const line = e.target.position?.lineNumber;
				if (line == null) return;
				const id = map.get(line);
				if (id && onGlyphClick) onGlyphClick(id);
			});
			subs.push(sub);
		}

		return () => {
			editors.LEFT.updateOptions({ glyphMargin: previousGlyphMargin.LEFT });
			editors.RIGHT.updateOptions({ glyphMargin: previousGlyphMargin.RIGHT });
			for (const c of collections) c.clear();
			for (const s of subs) s.dispose();
		};
	}, [editor, comments, enabled, onGlyphClick]);

	useEffect(() => {
		if (!editor) return;
		const active = activeCommentId
			? comments.find((c) => c.id === activeCommentId && c.lineNumber != null)
			: null;
		if (!active || active.lineNumber == null) return;
		const originalModel = editor.getOriginalEditor().getModel();
		const modifiedModel = editor.getModifiedEditor().getModel();
		const side = resolveSide(active, modifiedModel, originalModel);
		const codeEditor = side === "LEFT" ? editor.getOriginalEditor() : editor.getModifiedEditor();
		const decorations = codeEditor.createDecorationsCollection([
			{
				range: new monaco.Range(active.lineNumber, 1, active.lineNumber, 1),
				options: {
					isWholeLine: true,
					className: "solve-comment-active-line",
					linesDecorationsClassName: "solve-comment-active-line-gutter",
				},
			},
		]);
		return () => {
			decorations.clear();
		};
	}, [editor, comments, activeCommentId]);

	useEffect(() => {
		return () => {
			const ed = lastEditorRef.current;
			if (!ed) return;
			const sides: Side[] = ["LEFT", "RIGHT"];
			for (const side of sides) {
				const codeEditor = side === "LEFT" ? ed.getOriginalEditor() : ed.getModifiedEditor();
				const map = zonesRef.current[side];
				const entries = [...map.values()];
				if (entries.length === 0) continue;
				codeEditor.changeViewZones((acc) => {
					for (const e of entries) acc.removeZone(e.zoneId);
				});
				queueMicrotask(() => {
					for (const e of entries) e.root.unmount();
				});
				map.clear();
			}
			lastEditorRef.current = null;
		};
	}, []);
}
