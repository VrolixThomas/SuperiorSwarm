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
