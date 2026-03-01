import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";
import { trpc } from "../trpc/client";

interface FileEditorProps {
	repoPath: string;
	filePath: string;
	language: string;
	initialPosition?: { lineNumber: number; column: number };
}

export function FileEditor({ repoPath, filePath, language, initialPosition }: FileEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveMutation = trpc.diff.saveFileContent.useMutation();

	const { data, isLoading } = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: "HEAD", filePath },
		{ staleTime: 30_000 }
	);

	// Create editor once on mount
	useEffect(() => {
		if (!containerRef.current) return;
		ensureThemeRegistered();
		const editor = monaco.editor.create(containerRef.current, {
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

	// Load content into editor when query data arrives or language changes
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor || !data) return;

		const prev = editor.getModel();
		if (prev) prev.dispose();

		const model = monaco.editor.createModel(data.content, language);
		editor.setModel(model);

		if (initialPosition) {
			editor.setPosition(initialPosition);
			editor.revealPositionInCenter(initialPosition);
		}

		const sub = model.onDidChangeContent(() => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			saveTimerRef.current = setTimeout(() => {
				saveMutation.mutate({ repoPath, filePath, content: model.getValue() });
			}, 500);
		});

		return () => {
			sub.dispose();
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			model.dispose();
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: saveMutation identity is stable
	}, [data, language, repoPath, filePath, initialPosition]);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
				Loading…
			</div>
		);
	}

	return <div ref={containerRef} className="h-full w-full" />;
}
