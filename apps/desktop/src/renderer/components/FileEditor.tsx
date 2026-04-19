import * as monaco from "monaco-editor";
import { initVimMode } from "monaco-vim";
import { useEffect, useRef, useState } from "react";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";
import { useEditorSettingsStore } from "../stores/editor-settings";
import { useProjectStore } from "../stores/projects";
import { useReviewSessionStore } from "../stores/review-session-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownPreviewButton } from "./MarkdownPreviewButton";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useFileEditorLsp } from "./editor/useFileEditorLsp";

interface FileEditorProps {
	tabId: string;
	/** Pane the editor lives in. Required so we can scope the review-edit Escape handler
	 *  to the single FileEditor that IS the review edit-split; other editors leave Esc alone. */
	paneId?: string;
	repoPath: string;
	filePath: string;
	language: string;
	initialPosition?: { lineNumber: number; column: number };
}

export function FileEditor({
	tabId,
	paneId,
	repoPath,
	filePath,
	language,
	initialPosition,
}: FileEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Capture initialPosition on mount only; subsequent re-renders (e.g. after store clear) do not update it
	const initialPositionRef = useRef(initialPosition);
	const clearInitialPosition = useTabStore((s) => s.clearInitialPosition);
	const utils = trpc.useUtils();
	const vimStatusRef = useRef<HTMLDivElement>(null);
	const vimModeRef = useRef<ReturnType<typeof initVimMode> | null>(null);
	const [editorReady, setEditorReady] = useState(false);
	const [currentModel, setCurrentModel] = useState<monaco.editor.ITextModel | null>(null);
	const vimEnabled = useEditorSettingsStore((s) => s.vimEnabled);
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const [previewContent, setPreviewContent] = useState("");
	const markdownPaneRef = useRef<HTMLDivElement>(null);
	const isSyncingScrollRef = useRef(false);
	const saveMutation = trpc.diff.saveFileContent.useMutation({
		onSuccess: () => {
			utils.diff.getWorkingTreeDiff.invalidate({ repoPath });
			utils.diff.getWorkingTreeStatus.invalidate({ repoPath });
			// Clear overlay so the review diff reads server truth
			const rs = useReviewSessionStore.getState();
			if (rs.activeSession) rs.clearOptimisticContent(filePath);
		},
		onError: () => {
			// Save failed — revert the review diff to server truth
			const rs = useReviewSessionStore.getState();
			if (rs.activeSession) rs.clearOptimisticContent(filePath);
		},
	});
	const {
		message: lspMessage,
		reason: lspReason,
		canTrust,
		trustRepo,
		onContentChanged: onLspContentChanged,
	} = useFileEditorLsp(currentModel, repoPath, language, filePath);
	const utilsForLsp = trpc.useUtils();
	const dismissLanguageMut = trpc.lsp.dismissLanguage.useMutation({
		onSuccess: () => utilsForLsp.lsp.getDismissedLanguages.invalidate(),
	});
	const dismissedQuery = trpc.lsp.getDismissedLanguages.useQuery();
	const isLanguageDismissed =
		lspReason === "missing-binary" && (dismissedQuery.data ?? []).includes(language);
	const openLspSettings = () => {
		const { openSettings, setSettingsCategory } = useProjectStore.getState();
		openSettings();
		setSettingsCategory("lsp");
	};
	// Ref keeps callback identity stable; the file-loading effect must not re-run
	// when useFileEditorLsp returns a new onContentChanged (it churns on each model swap).
	const onLspContentChangedRef = useRef(onLspContentChanged);
	useEffect(() => {
		onLspContentChangedRef.current = onLspContentChanged;
	}, [onLspContentChanged]);

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

		const escDisposable = editor.onKeyDown((e) => {
			if (e.keyCode !== monaco.KeyCode.Escape) return;
			// Only fire close-edit when THIS editor is the review edit-split.
			// Avoids stealing Escape from unrelated file tabs that happen to be open
			// while a review session has an edit-split elsewhere.
			const editSplitPaneId = useReviewSessionStore.getState().activeSession?.editSplitPaneId;
			if (!editSplitPaneId || editSplitPaneId !== paneId) return;
			e.preventDefault();
			e.stopPropagation();
			window.dispatchEvent(new CustomEvent("review:close-edit"));
		});

		return () => {
			escDisposable.dispose();
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
		setCurrentModel(model);
		setPreviewContent(data.content);

		// Use the ref (captured at mount) so re-renders after store clear do not re-navigate
		const position = initialPositionRef.current;
		if (position) {
			editor.setPosition(position);
			editor.revealPositionInCenter(position);
			initialPositionRef.current = undefined; // consume once
		}

		let version = 1;
		const sub = model.onDidChangeContent(() => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			saveTimerRef.current = setTimeout(() => {
				const content = model.getValue();
				// Push optimistic overlay before mutating so ReviewTab's DiffEditor
				// reflects the edit immediately (before the server refetch settles).
				const rs = useReviewSessionStore.getState();
				if (rs.activeSession) rs.pushOptimisticContent(filePath, content);
				saveMutation.mutate({ repoPath, filePath, content });
			}, 500);
			if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
			previewTimerRef.current = setTimeout(() => {
				setPreviewContent(model.getValue());
			}, 300);

			version++;
			onLspContentChangedRef.current(version);
		});

		return () => {
			sub.dispose();
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
			setCurrentModel(null);
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

	// Sync scroll between Monaco and the markdown preview pane in split mode
	useEffect(() => {
		if (markdownPreviewMode !== "split") return;
		const editor = editorRef.current;
		if (!editor) return;

		const scrollSub = editor.onDidScrollChange((e) => {
			if (isSyncingScrollRef.current) return;
			const pane = markdownPaneRef.current;
			if (!pane) return;
			const editorScrollable = editor.getScrollHeight() - editor.getLayoutInfo().height;
			const paneScrollable = pane.scrollHeight - pane.clientHeight;
			if (editorScrollable <= 0 || paneScrollable <= 0) return;
			const pct = e.scrollTop / editorScrollable;
			isSyncingScrollRef.current = true;
			pane.scrollTop = pct * paneScrollable;
			requestAnimationFrame(() => {
				isSyncingScrollRef.current = false;
			});
		});

		return () => scrollSub.dispose();
	}, [editorReady, markdownPreviewMode]);

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
				{lspMessage && !isLanguageDismissed && (
					<div className="flex items-center justify-between gap-2 border-b border-[rgba(255,159,10,0.35)] bg-[rgba(255,159,10,0.12)] px-3 py-2 text-[12px] text-[var(--color-warning)]">
						<span>{lspMessage}</span>
						<div className="flex shrink-0 items-center gap-1.5">
							{canTrust && (
								<button
									type="button"
									onClick={() => void trustRepo()}
									className="rounded-[4px] border border-[var(--color-warning)] px-2 py-0.5 text-[11px] font-medium hover:bg-[rgba(255,159,10,0.2)]"
								>
									Trust this repo
								</button>
							)}
							{lspReason === "missing-binary" && (
								<>
									<button
										type="button"
										onClick={openLspSettings}
										className="rounded-[4px] border border-[var(--color-warning)] px-2 py-0.5 text-[11px] font-medium hover:bg-[rgba(255,159,10,0.2)]"
									>
										Go to settings
									</button>
									<button
										type="button"
										onClick={() => dismissLanguageMut.mutate({ language })}
										className="rounded-[4px] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
									>
										Don't show
									</button>
								</>
							)}
						</div>
					</div>
				)}
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
					{language === "markdown" &&
						(markdownPreviewMode === "split" || markdownPreviewMode === "rendered") && (
							<div
								ref={markdownPaneRef}
								className="flex-1 overflow-y-auto border-l border-[var(--border)] p-4"
								onScroll={() => {
									if (isSyncingScrollRef.current) return;
									const editor = editorRef.current;
									const pane = markdownPaneRef.current;
									if (!editor || !pane) return;
									const paneScrollable = pane.scrollHeight - pane.clientHeight;
									const editorScrollable = editor.getScrollHeight() - editor.getLayoutInfo().height;
									if (paneScrollable <= 0 || editorScrollable <= 0) return;
									const pct = pane.scrollTop / paneScrollable;
									isSyncingScrollRef.current = true;
									editor.setScrollTop(pct * editorScrollable);
									requestAnimationFrame(() => {
										isSyncingScrollRef.current = false;
									});
								}}
							>
								<MarkdownRenderer content={previewContent} />
							</div>
						)}
				</div>
			</div>
		</>
	);
}
