import type * as monaco from "monaco-editor";
import { useEffect } from "react";
import type { FocusRange } from "../../../../shared/review-path-types";
import "./focus-decorations.css";

type Editor = monaco.editor.IStandaloneDiffEditor | monaco.editor.IStandaloneCodeEditor;
function decorate(
	editor: monaco.editor.IStandaloneCodeEditor,
	focus: FocusRange[],
	side: FocusRange["side"]
) {
	const apply = () => {
		const count = editor.getModel()?.getLineCount() ?? 0;
		const decorations: monaco.editor.IModelDeltaDecoration[] = [];
		for (const range of focus) {
			if (
				range.side !== side ||
				range.startLine < 1 ||
				range.endLine < range.startLine ||
				range.startLine > count
			)
				continue;
			decorations.push({
				range: {
					startLineNumber: range.startLine,
					startColumn: 1,
					endLineNumber: Math.min(range.endLine, count),
					endColumn: 1,
				},
				options: { isWholeLine: true, lineNumberClassName: "review-focus-line-number" },
			});
			decorations.push({
				range: {
					startLineNumber: range.startLine,
					startColumn: 1,
					endLineNumber: range.startLine,
					endColumn: 1,
				},
				options: {
					glyphMarginClassName: "review-focus-agent",
					glyphMarginHoverMessage: { value: "Agent focus" },
				},
			});
		}
		collection.set(decorations);
	};
	const collection = editor.createDecorationsCollection();
	apply();
	const changed = editor.onDidChangeModel(apply);
	return () => {
		changed.dispose();
		collection.clear();
	};
}
export function useFocusDecorations(editor: Editor | null, focus: FocusRange[]): void {
	useEffect(() => {
		if (!editor) return;
		if ("getModifiedEditor" in editor) {
			const left = decorate(editor.getOriginalEditor(), focus, "LEFT");
			const right = decorate(editor.getModifiedEditor(), focus, "RIGHT");
			return () => {
				left();
				right();
			};
		}
		return decorate(editor, focus, "RIGHT");
	}, [editor, focus]);
}
