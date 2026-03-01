import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";

const EDITOR_THEME = "branchflux-dark";
let themeRegistered = false;

interface DiffEditorProps {
	original: string;
	modified: string;
	language: string;
	renderSideBySide: boolean;
	onModifiedChange?: (content: string) => void;
}

export function DiffEditor({
	original,
	modified,
	language,
	renderSideBySide,
	onModifiedChange,
}: DiffEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
	// Keep onModifiedChange ref stable so the model subscription always calls the latest prop
	const onChangeRef = useRef(onModifiedChange);
	useEffect(() => {
		onChangeRef.current = onModifiedChange;
	}, [onModifiedChange]);

	// Create the diff editor once on mount
	useEffect(() => {
		if (!containerRef.current) return;
		if (!themeRegistered) {
			monaco.editor.defineTheme(EDITOR_THEME, {
				base: "vs-dark",
				inherit: true,
				rules: [],
				colors: {
					"editor.background": "#161618",
					"diffEditor.insertedTextBackground": "#1a3a2a80",
					"diffEditor.removedTextBackground": "#3a1a1a80",
					"diffEditor.insertedLineBackground": "#1a3a2a40",
					"diffEditor.removedLineBackground": "#3a1a1a40",
				},
			});
			themeRegistered = true;
		}
		const editor = monaco.editor.createDiffEditor(containerRef.current, {
			readOnly: false,
			renderSideBySide,
			theme: EDITOR_THEME,
			fontSize: 13,
			fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace",
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			lineNumbers: "on",
			folding: true,
			wordWrap: "off",
			automaticLayout: true,
		});
		editorRef.current = editor;
		return () => {
			editor.dispose();
			editorRef.current = null;
		};
	// biome-ignore lint/correctness/useExhaustiveDependencies: editor created once on mount
	}, []);

	// Recreate models when content or language changes
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;

		const prev = editor.getModel();
		if (prev) {
			prev.original.dispose();
			prev.modified.dispose();
		}

		const origModel = monaco.editor.createModel(original, language);
		const modModel = monaco.editor.createModel(modified, language);
		editor.setModel({ original: origModel, modified: modModel });

		const sub = modModel.onDidChangeContent(() => {
			onChangeRef.current?.(modModel.getValue());
		});

		return () => {
			sub.dispose();
			origModel.dispose();
			modModel.dispose();
		};
	}, [original, modified, language]);

	// Update split/inline mode without recreating the editor
	useEffect(() => {
		editorRef.current?.updateOptions({ renderSideBySide });
	}, [renderSideBySide]);

	return <div ref={containerRef} className="h-full w-full" />;
}
