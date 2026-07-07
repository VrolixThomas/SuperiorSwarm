import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";

export function useGutterPlusButton(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	onAddThread: (line: number) => void,
	validLines?: Set<number>
): void {
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
			// Only the glyph margin — where the plus icon renders — opens a composer.
			// Line-number clicks keep their native select-line behavior.
			if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
			const line = e.target.position?.lineNumber;
			if (line && isValidLine(line)) onAddThread(line);
		});

		return () => {
			moveSub.dispose();
			leaveSub.dispose();
			clickSub.dispose();
			decorationRef.current?.clear();
		};
	}, [editor, onAddThread, validLines]);
}
