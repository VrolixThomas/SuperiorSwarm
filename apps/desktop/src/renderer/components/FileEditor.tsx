import * as monaco from "monaco-editor";
import { initVimMode } from "monaco-vim";
import { useEffect, useRef, useState } from "react";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";
import {
	registerLspProviders,
	sendDidChange,
	sendDidClose,
	sendDidOpen,
	setModelRepoPath,
} from "../lsp/monaco-lsp-bridge";
import { useEditorSettingsStore } from "../stores/editor-settings";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownPreviewButton } from "./MarkdownPreviewButton";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
	const vimStatusRef = useRef<HTMLDivElement>(null);
	const vimModeRef = useRef<ReturnType<typeof initVimMode> | null>(null);
	const [editorReady, setEditorReady] = useState(false);
	const vimEnabled = useEditorSettingsStore((s) => s.vimEnabled);
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const [previewContent, setPreviewContent] = useState("");
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
		setEditorReady(true);
		return () => {
			setEditorReady(false);
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
		setPreviewContent(data.content);

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
			setPreviewContent(model.getValue());

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: editorReady is an intentional trigger to re-run after editor creation
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;

		if (vimEnabled && vimStatusRef.current) {
			vimModeRef.current = initVimMode(editor, vimStatusRef.current);
		}

		return () => {
			vimModeRef.current?.dispose();
			vimModeRef.current = null;
		};
	}, [vimEnabled, editorReady]);

	return (
		<>
			{isLoading && (
				<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
					Loading…
				</div>
			)}
			<div
				className="flex h-full w-full flex-col"
				style={isLoading ? { display: "none" } : undefined}
			>
				{language === "markdown" && (
					<div className="flex h-8 shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
						<MarkdownPreviewButton language={language} />
					</div>
				)}
				<div className="flex min-h-0 flex-1 overflow-hidden">
					{/* Monaco container — always mounted to preserve editor lifecycle.
					    Hidden via display:none in "rendered" mode; automaticLayout
					    handles the resize when it becomes visible again. */}
					<div
						className="flex min-h-0 flex-1 flex-col overflow-hidden"
						style={
							language === "markdown" && markdownPreviewMode === "rendered"
								? { display: "none" }
								: undefined
						}
					>
						<div ref={containerRef} className="min-h-0 flex-1" />
						{vimEnabled && (
							<div
								ref={vimStatusRef}
								className="flex h-5 shrink-0 items-center border-t border-[var(--border)] bg-[var(--bg-elevated)] px-2 font-mono text-[11px] text-[var(--text-secondary)]"
							/>
						)}
					</div>
					{language === "markdown" && markdownPreviewMode !== "off" && (
						<div className="flex-1 overflow-y-auto border-l border-[var(--border)] p-4">
							<MarkdownRenderer content={previewContent} />
						</div>
					)}
				</div>
			</div>
		</>
	);
}
