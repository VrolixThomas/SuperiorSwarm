import * as monaco from "monaco-editor";
import { initVimMode } from "monaco-vim";
import { useEffect, useRef, useState } from "react";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";
import { useEditorSettingsStore } from "../stores/editor-settings";

interface DiffEditorProps {
	original: string;
	modified: string;
	language: string;
	renderSideBySide: boolean;
	onModifiedChange?: (content: string) => void;
	onEditorReady?: (editor: monaco.editor.IStandaloneDiffEditor) => void;
}

export function DiffEditor({
	original,
	modified,
	language,
	renderSideBySide,
	onModifiedChange,
	onEditorReady,
}: DiffEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
	// Keep callback refs stable so effects always use the latest prop
	const onChangeRef = useRef(onModifiedChange);
	useEffect(() => {
		onChangeRef.current = onModifiedChange;
	}, [onModifiedChange]);
	const onEditorReadyRef = useRef(onEditorReady);
	useEffect(() => {
		onEditorReadyRef.current = onEditorReady;
	}, [onEditorReady]);

	const vimStatusRef = useRef<HTMLDivElement>(null);
	const vimModeRef = useRef<ReturnType<typeof initVimMode> | null>(null);
	const [editorReady, setEditorReady] = useState(false);
	const vimEnabled = useEditorSettingsStore((s) => s.vimEnabled);

	// Create the diff editor once on mount
	// biome-ignore lint/correctness/useExhaustiveDependencies: editor created once on mount, renderSideBySide updated separately
	useEffect(() => {
		if (!containerRef.current) return;
		ensureThemeRegistered();
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
			glyphMargin: true,
		});
		editorRef.current = editor;
		setEditorReady(true);
		onEditorReadyRef.current?.(editor);
		return () => {
			setEditorReady(false);
			editor.dispose();
			editorRef.current = null;
		};
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

	// Attach or detach vim mode on the modified (right) editor
	// biome-ignore lint/correctness/useExhaustiveDependencies: editorReady is an intentional trigger to re-run after editor creation
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;

		if (vimEnabled && vimStatusRef.current) {
			vimModeRef.current = initVimMode(editor.getModifiedEditor(), vimStatusRef.current);
		}

		return () => {
			vimModeRef.current?.dispose();
			vimModeRef.current = null;
		};
	}, [vimEnabled, editorReady]);

	return (
		<div className="flex h-full w-full flex-col">
			<div ref={containerRef} className="min-h-0 flex-1" />
			{vimEnabled && (
				<div
					ref={vimStatusRef}
					className="flex h-5 shrink-0 items-center border-t border-[var(--border)] bg-[var(--bg-elevated)] px-2 font-mono text-[11px] text-[var(--text-secondary)]"
				/>
			)}
		</div>
	);
}
