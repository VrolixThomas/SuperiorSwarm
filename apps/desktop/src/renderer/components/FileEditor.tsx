import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";
import {
	registerLspProviders,
	sendDidChange,
	sendDidClose,
	sendDidOpen,
	setModelRepoPath,
} from "../lsp/monaco-lsp-bridge";
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
	}, []);

	// Load content into editor when query data arrives or language changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: saveMutation.mutate identity is stable
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor || !data) return;

		const prev = editor.getModel();
		if (prev) prev.dispose();

		const fileUri = monaco.Uri.file(`${repoPath}/${filePath}`);
		const existingModel = monaco.editor.getModel(fileUri);
		if (existingModel) existingModel.dispose();
		const model = monaco.editor.createModel(data.content, language, fileUri);
		editor.setModel(model);

		if (initialPosition) {
			editor.setPosition(initialPosition);
			editor.revealPositionInCenter(initialPosition);
		}

		// LSP integration
		const uri = model.uri.toString();
		const supportedLspLanguages = ["typescript", "javascript", "python"];
		const lspEnabled = supportedLspLanguages.includes(language);

		if (lspEnabled) {
			setModelRepoPath(uri, repoPath);
			registerLspProviders(language);
			sendDidOpen(repoPath, language, uri, data.content);
		}

		let version = 1;

		const sub = model.onDidChangeContent(() => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			saveTimerRef.current = setTimeout(() => {
				saveMutation.mutate({ repoPath, filePath, content: model.getValue() });
			}, 500);

			if (lspEnabled) {
				version++;
				sendDidChange(repoPath, language, uri, model.getValue(), version);
			}
		});

		return () => {
			sub.dispose();
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			if (lspEnabled) {
				sendDidClose(repoPath, language, uri);
			}
			model.dispose();
		};
	}, [data, language, repoPath, filePath, initialPosition]);

	return (
		<>
			{isLoading && (
				<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
					Loading…
				</div>
			)}
			<div
				ref={containerRef}
				className="h-full w-full"
				style={isLoading ? { display: "none" } : undefined}
			/>
		</>
	);
}
