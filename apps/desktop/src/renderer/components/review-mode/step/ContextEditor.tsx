import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import type { CodeReference, FocusRange } from "../../../../shared/review-path-types";
import { ensureThemeRegistered } from "../../../lib/monacoTheme";
import { useContextDefinition } from "../hooks/useContextDefinition";
import { useFocusDecorations } from "../hooks/useFocusDecorations";
interface Props {
	content: string;
	language: string;
	filePath: string;
	repoPath: string;
	focus: FocusRange[];
	onOpenReference?: (ref: CodeReference) => void;
	onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
}
export function ContextEditor({
	content,
	language,
	filePath,
	repoPath,
	focus,
	onOpenReference,
	onEditorReady,
}: Props) {
	const container = useRef<HTMLDivElement>(null);
	const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
	useEffect(() => {
		if (!container.current) return;
		const instance = monaco.editor.create(container.current, {
			theme: ensureThemeRegistered(),
			readOnly: true,
			domReadOnly: true,
			automaticLayout: true,
			fontSize: 12,
			lineHeight: 20,
			fontFamily: "var(--font-mono)",
			minimap: { enabled: false },
			glyphMargin: true,
			scrollBeyondLastLine: false,
		});
		setEditor(instance);
		return () => instance.dispose();
	}, []);
	// Model identity includes the path even when two files contain exactly the same text.
	// biome-ignore lint/correctness/useExhaustiveDependencies: file identity determines model identity
	useEffect(() => {
		if (!editor) return;
		const model = monaco.editor.createModel(content, language);
		editor.setModel(model);
		onEditorReady?.(editor);
		return () => {
			onEditorReady?.(null);
			editor.setModel(null);
			model.dispose();
		};
	}, [editor, content, language, filePath, onEditorReady]);
	useFocusDecorations(editor, focus);
	useContextDefinition(editor, repoPath, filePath, onOpenReference);
	return <div data-review-context-editor ref={container} className="h-full min-h-0" />;
}
