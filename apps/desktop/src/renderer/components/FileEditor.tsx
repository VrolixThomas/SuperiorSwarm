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
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface FileEditorProps {
	tabId: string;
	repoPath: string;
	filePath: string;
	language: string;
	initialPosition?: { lineNumber: number; column: number };
}

export function FileEditor({
	tabId,
	repoPath,
	filePath,
	language,
	initialPosition,
}: FileEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Capture initialPosition on mount only; subsequent re-renders (e.g. after store clear) do not update it
	const initialPositionRef = useRef(initialPosition);
	const clearInitialPosition = useTabStore((s) => s.clearInitialPosition);
	const utils = trpc.useUtils();
	const saveMutation = trpc.diff.saveFileContent.useMutation({
		onSuccess: () => {
			utils.diff.getWorkingTreeDiff.invalidate({ repoPath });
			utils.diff.getWorkingTreeStatus.invalidate({ repoPath });
		},
	});

	// Clear initialPosition from store immediately so re-mounts (tab switch away/back) do not re-navigate.
	// tabId and clearInitialPosition are intentionally excluded: this runs on mount only, and tabId
	// is stable for the lifetime of this component instance (it changes only when the key prop changes).
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect, deps excluded intentionally
	useEffect(() => {
		if (initialPositionRef.current) {
			clearInitialPosition(tabId);
		}
	}, []);

	const { data, isLoading } = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: "", filePath },
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

	// Load content into editor when query data arrives or language changes.
	// Note: only one FileEditor mounts per URI at a time (enforced by MainContentArea key prop).
	// biome-ignore lint/correctness/useExhaustiveDependencies: saveMutation.mutate identity is stable; initialPositionRef is a ref (intentionally excluded)
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

		// Use the ref (captured at mount) so re-renders after store clear do not re-navigate
		const position = initialPositionRef.current;
		if (position) {
			editor.setPosition(position);
			editor.revealPositionInCenter(position);
			initialPositionRef.current = undefined; // consume once
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
	}, [data, language, repoPath, filePath]);

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
