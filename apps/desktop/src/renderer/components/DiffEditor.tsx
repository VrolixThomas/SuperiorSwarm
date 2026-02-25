import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { initializeVSCodeApi } from "../lib/vscode-init";

interface DiffEditorProps {
	original: string;
	modified: string;
	language: string;
	renderSideBySide: boolean;
}

export function DiffEditor({ original, modified, language, renderSideBySide }: DiffEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
	const vsCodeInitialized = useRef(false);

	// Initialize VS Code API once, then create the editor
	useEffect(() => {
		if (!containerRef.current || vsCodeInitialized.current) return;
		vsCodeInitialized.current = true;

		let editor: monaco.editor.IStandaloneDiffEditor | null = null;
		const container = containerRef.current;

		initializeVSCodeApi().then(() => {
			if (!container) return;
			editor = monaco.editor.createDiffEditor(container, {
				readOnly: false,
				renderSideBySide,
				theme: "vs-dark",
				fontSize: 13,
				fontFamily: "var(--font-mono, monospace)",
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				lineNumbers: "on",
				folding: true,
				wordWrap: "off",
				automaticLayout: true,
			});
			editorRef.current = editor;

			const originalModel = monaco.editor.createModel(original, language);
			const modifiedModel = monaco.editor.createModel(modified, language);
			editor.setModel({ original: originalModel, modified: modifiedModel });
		});

		return () => {
			editor?.dispose();
			editorRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // intentionally empty — editor created once

	// Update models when content changes
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;

		const currentModel = editor.getModel();
		if (currentModel) {
			currentModel.original.dispose();
			currentModel.modified.dispose();
		}

		const originalModel = monaco.editor.createModel(original, language);
		const modifiedModel = monaco.editor.createModel(modified, language);
		editor.setModel({ original: originalModel, modified: modifiedModel });

		return () => {
			originalModel.dispose();
			modifiedModel.dispose();
		};
	}, [original, modified, language]);

	// Update side-by-side mode
	useEffect(() => {
		editorRef.current?.updateOptions({ renderSideBySide });
	}, [renderSideBySide]);

	return <div ref={containerRef} className="h-full w-full" />;
}
