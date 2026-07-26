import { keepPreviousData } from "@tanstack/react-query";
import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectLanguage } from "../../../../shared/diff-types";
import type { GitHubPRDetails, PRContext, UnifiedThread } from "../../../../shared/github-types";
import { formatPrIdentifier } from "../../../../shared/pr-identifier";
import { changesThreadsForFile, partitionChangesThreads } from "../../../lib/pr-review-threads";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { useTabStore } from "../../../stores/tab-store";
import { trpc } from "../../../trpc/client";
import { DiffEditor } from "../../DiffEditor";
import { MarkdownPreviewButton } from "../../MarkdownPreviewButton";
import { MarkdownRenderedDiff } from "../../MarkdownRenderedDiff";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { useGutterPlusButton } from "../hooks/useGutterPlusButton";
import { useInlineCommentZones } from "../hooks/useInlineCommentZones";
import { useThreadDecorations } from "../hooks/useThreadDecorations";
import { type ThreadCallbacks, ThreadCard } from "../thread/ThreadCard";

interface ChangesViewProps {
	workspaceId: string;
	prCtx: PRContext;
	details: GitHubPRDetails;
	allThreads: UnifiedThread[];
	fileOrder: string[];
	sessionKey: string;
	callbacks: ThreadCallbacks;
	readOnly?: boolean;
}

interface CollapseCommand {
	defaultCollapsed: boolean;
	nonce: number;
}

function toolbarButtonClass(active = false, disabled = false): string {
	if (disabled) {
		return "rounded px-2 py-0.5 text-[11px] text-[var(--text-quaternary)] opacity-40";
	}

	return [
		"rounded px-2 py-0.5 text-[11px] transition-colors",
		active
			? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-sm)]"
			: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
	].join(" ");
}

function resolvedInlineCollapsed(
	thread: UnifiedThread,
	defaultCollapsed: boolean,
	overrides: Map<string, boolean>
): boolean {
	if (thread.isAIDraft) return false;
	if (!thread.isResolved) return false;
	return overrides.get(thread.id) ?? defaultCollapsed;
}

function lineCount(content: string): number {
	return content.split(/\r\n|\r|\n/).length;
}

function pickNewCommentLine(
	editor: monaco.editor.IStandaloneCodeEditor,
	validDiffLines: Set<number> | undefined
): number | null {
	let line = editor.getPosition()?.lineNumber ?? null;
	if (line && (!validDiffLines || validDiffLines.has(line))) return line;

	line = null;
	for (const range of editor.getVisibleRanges()) {
		for (let candidate = range.startLineNumber; candidate <= range.endLineNumber; candidate++) {
			if (!validDiffLines || validDiffLines.has(candidate)) {
				line = candidate;
				break;
			}
		}
		if (line !== null) break;
	}

	if (line === null) return null;

	editor.focus();
	editor.setPosition({ lineNumber: line, column: 1 });
	return line;
}

export function ChangesView({
	workspaceId,
	prCtx,
	details,
	allThreads,
	fileOrder,
	sessionKey,
	callbacks,
	readOnly = false,
}: ChangesViewProps) {
	const utils = trpc.useUtils();
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const setMarkdownPreviewMode = useTabStore((s) => s.setMarkdownPreviewMode);
	const activeFilePath = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const activeThreadId = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeThreadId ?? null
	);
	const selectFile = usePRReviewSessionStore((s) => s.selectFile);
	const advanceFile = usePRReviewSessionStore((s) => s.advanceFile);
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const setScroll = usePRReviewSessionStore((s) => s.setScroll);
	const getScroll = usePRReviewSessionStore((s) => s.getScroll);
	const intent = useReviewModeStore((s) => s.intent);
	const clearIntent = useReviewModeStore((s) => s.clearIntent);
	const publishedCommentsVisible = useReviewModeStore((s) => s.publishedCommentsVisible);
	const togglePublishedComments = useReviewModeStore((s) => s.togglePublishedComments);
	const [editor, setEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);
	const [pendingLine, setPendingLine] = useState<number | null>(null);
	const [collapseCommand, setCollapseCommand] = useState<CollapseCommand>({
		defaultCollapsed: true,
		nonce: 0,
	});
	const [collapsedThreadOverrides, setCollapsedThreadOverrides] = useState<Map<string, boolean>>(
		() => new Map()
	);
	const markdownPaneRef = useRef<HTMLDivElement>(null);
	const fallbackThreadsRef = useRef<HTMLDivElement>(null);
	const isSyncingScrollRef = useRef(false);
	const currentFilePath = activeFilePath ?? fileOrder[0] ?? null;
	const queryFilePath = currentFilePath ?? "";
	const language = currentFilePath ? detectLanguage(currentFilePath) : "plaintext";
	const isMarkdown = language === "markdown";
	const effectiveMarkdownPreviewMode = isMarkdown ? markdownPreviewMode : "off";
	const hideEditor =
		effectiveMarkdownPreviewMode === "rendered" || effectiveMarkdownPreviewMode === "rich-diff";
	const currentFile = details.files.find((file) => file.path === currentFilePath);
	const currentFileIndex = currentFilePath ? fileOrder.indexOf(currentFilePath) : -1;
	const canGoPrevious = currentFileIndex > 0;
	const canGoNext = currentFileIndex >= 0 && currentFileIndex < fileOrder.length - 1;
	const isGitHubPR = prCtx.provider === "github";

	useEffect(() => {
		if (activeFilePath !== null) return;
		const firstPath = fileOrder[0];
		if (firstPath) selectFile(sessionKey, firstPath);
	}, [activeFilePath, fileOrder, selectFile, sessionKey]);

	useEffect(() => {
		setPendingLine((line) => (currentFilePath === null || line !== null ? null : line));
	}, [currentFilePath]);

	const originalQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: prCtx.repoPath, ref: prCtx.targetBranch, filePath: queryFilePath },
		{ enabled: currentFilePath !== null, staleTime: 60_000, placeholderData: keepPreviousData }
	);
	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: prCtx.repoPath, ref: prCtx.sourceBranch, filePath: queryFilePath },
		{ enabled: currentFilePath !== null, staleTime: 60_000, placeholderData: keepPreviousData }
	);
	const originalContent = originalQuery.data?.content ?? "";
	const modifiedContent = modifiedQuery.data?.content ?? "";
	const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
		{
			repoPath: prCtx.repoPath,
			baseBranch: prCtx.targetBranch,
			headBranch: prCtx.sourceBranch,
		},
		{ staleTime: 60_000 }
	);
	const isLoading =
		currentFilePath !== null &&
		(originalQuery.isPending || modifiedQuery.isPending) &&
		originalQuery.data === undefined &&
		modifiedQuery.data === undefined;
	const swapping = originalQuery.isPlaceholderData || modifiedQuery.isPlaceholderData;
	const editorInstance = !hideEditor && !isLoading && !swapping ? editor : null;

	const validDiffLines = useMemo(() => {
		const fileData = branchDiffQuery.data?.files.find((file) => file.path === currentFilePath);
		if (!fileData) return undefined;
		const lines = new Set<number>();
		for (const hunk of fileData.hunks) {
			for (const diffLine of hunk.lines) {
				if (diffLine.newLineNumber != null) lines.add(diffLine.newLineNumber);
			}
		}
		return lines;
	}, [branchDiffQuery.data, currentFilePath]);

	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ enabled: isGitHubPR, staleTime: 30_000 }
	);
	const isViewed =
		isGitHubPR && currentFilePath !== null
			? (viewedFilesList?.includes(currentFilePath) ?? false)
			: false;
	const markFileViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: (_data, variables) =>
			utils.github.getViewedFiles.invalidate({
				owner: variables.owner,
				repo: variables.repo,
				number: variables.number,
			}),
	});

	const publishedThreadCount = useMemo(
		() =>
			currentFilePath === null
				? 0
				: allThreads.filter(
						(thread) => thread.path === currentFilePath && thread.isAIDraft !== true
					).length,
		[allThreads, currentFilePath]
	);
	const fileThreads = useMemo(
		() => changesThreadsForFile(allThreads, currentFilePath, publishedCommentsVisible),
		[allThreads, currentFilePath, publishedCommentsVisible]
	);
	const threadLayout = useMemo(
		() =>
			partitionChangesThreads(fileThreads, diffMode, !hideEditor, {
				LEFT: lineCount(originalContent),
				RIGHT: lineCount(modifiedContent),
			}),
		[diffMode, fileThreads, hideEditor, modifiedContent, originalContent]
	);
	const leftInlineThreads = threadLayout.leftInline;
	const rightInlineThreads = threadLayout.rightInline;
	const fallbackThreads = threadLayout.fallback;
	const activeThreadOnThisFile = useMemo(
		() =>
			activeThreadId === null
				? null
				: (fileThreads.find((thread) => thread.id === activeThreadId) ?? null),
		[activeThreadId, fileThreads]
	);
	const hasResolvedThreads = useMemo(
		() => fileThreads.some((thread) => !thread.isAIDraft && thread.isResolved),
		[fileThreads]
	);

	const invalidateDrafts = useCallback(() => {
		void utils.aiReview.getReviewDrafts.invalidate();
		void utils.aiReview.getReviewDraft.invalidate();
	}, [utils]);

	const addUserComment = trpc.aiReview.addUserComment.useMutation({
		onSuccess: () => {
			setPendingLine(null);
			invalidateDrafts();
		},
	});

	const handleSaveNew = useCallback(
		(body: string) => {
			if (pendingLine === null || currentFilePath === null) return;
			addUserComment.mutate({
				prProvider: prCtx.provider,
				prIdentifier: formatPrIdentifier(prCtx),
				prTitle: prCtx.title,
				sourceBranch: prCtx.sourceBranch,
				targetBranch: prCtx.targetBranch,
				filePath: currentFilePath,
				lineNumber: pendingLine,
				side: "RIGHT",
				body,
			});
		},
		[addUserComment, currentFilePath, pendingLine, prCtx]
	);

	const handleCancelNew = useCallback(() => {
		setPendingLine(null);
	}, []);

	const startNewComment = useCallback(() => {
		if (readOnly) return;
		const modEditor = editorInstance?.getModifiedEditor();
		if (!modEditor) return;
		const line = pickNewCommentLine(modEditor, validDiffLines);
		if (line !== null) setPendingLine(line);
	}, [editorInstance, readOnly, validDiffLines]);

	const handleInlineCollapsedChange = useCallback(
		(threadId: string, collapsed: boolean) => {
			setCollapsedThreadOverrides((current) => {
				const next = new Map(current);
				if (collapsed === collapseCommand.defaultCollapsed) {
					next.delete(threadId);
				} else {
					next.set(threadId, collapsed);
				}
				return next;
			});
		},
		[collapseCommand.defaultCollapsed]
	);

	const renderThread = useCallback(
		(thread: UnifiedThread) => {
			const defaultCollapsed =
				thread.id === activeThreadId
					? false
					: resolvedInlineCollapsed(
							thread,
							collapseCommand.defaultCollapsed,
							collapsedThreadOverrides
						);

			return (
				<div
					data-review-thread-id={thread.id}
					onPointerDownCapture={() => selectThread(sessionKey, thread.id)}
					onFocusCapture={() => selectThread(sessionKey, thread.id)}
				>
					<ThreadCard
						key={`${thread.id}-${collapseCommand.nonce}`}
						thread={thread}
						variant="inline"
						active={thread.id === activeThreadId}
						callbacks={callbacks}
						defaultCollapsed={defaultCollapsed}
						onCollapsedChange={(collapsed) => handleInlineCollapsedChange(thread.id, collapsed)}
					/>
				</div>
			);
		},
		[
			activeThreadId,
			callbacks,
			collapseCommand.defaultCollapsed,
			collapseCommand.nonce,
			collapsedThreadOverrides,
			handleInlineCollapsedChange,
			selectThread,
			sessionKey,
		]
	);
	useInlineCommentZones(
		editorInstance,
		"LEFT",
		leftInlineThreads,
		null,
		renderThread,
		handleSaveNew,
		handleCancelNew
	);
	useInlineCommentZones(
		editorInstance,
		"RIGHT",
		rightInlineThreads,
		pendingLine,
		renderThread,
		handleSaveNew,
		handleCancelNew
	);
	useThreadDecorations(editorInstance, "LEFT", leftInlineThreads, activeThreadId);
	useThreadDecorations(editorInstance, "RIGHT", rightInlineThreads, activeThreadId);
	useGutterPlusButton(readOnly ? null : editorInstance, setPendingLine, validDiffLines);

	useEffect(() => {
		if (intent?.kind !== "new-comment") return;
		if (readOnly) {
			clearIntent();
			return;
		}
		const modEditor = editorInstance?.getModifiedEditor();
		if (!modEditor) {
			clearIntent();
			return;
		}

		const line = pickNewCommentLine(modEditor, validDiffLines);
		if (line !== null) setPendingLine(line);
		clearIntent();
	}, [clearIntent, editorInstance, intent, readOnly, validDiffLines]);

	useEffect(() => {
		if (!editorInstance || effectiveMarkdownPreviewMode !== "split") return;
		const modEditor = editorInstance.getModifiedEditor();

		const scrollSub = modEditor.onDidScrollChange((event) => {
			if (isSyncingScrollRef.current) return;
			const pane = markdownPaneRef.current;
			if (!pane) return;
			const editorScrollable = modEditor.getScrollHeight() - modEditor.getLayoutInfo().height;
			const paneScrollable = pane.scrollHeight - pane.clientHeight;
			if (editorScrollable <= 0 || paneScrollable <= 0) return;
			const percent = event.scrollTop / editorScrollable;
			isSyncingScrollRef.current = true;
			pane.scrollTop = percent * paneScrollable;
			requestAnimationFrame(() => {
				isSyncingScrollRef.current = false;
			});
		});

		return () => scrollSub.dispose();
	}, [editorInstance, effectiveMarkdownPreviewMode]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: modifiedContent re-runs restore after the model swap resets scrollTop
	useEffect(() => {
		const editor = editorInstance?.getModifiedEditor();
		if (!editor || currentFilePath === null) return;
		const top = getScroll(sessionKey, currentFilePath);
		if (top != null) editor.setScrollTop(top);
		let raf = 0;
		const sub = editor.onDidScrollChange(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				setScroll(sessionKey, currentFilePath, editor.getScrollTop());
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			sub.dispose();
		};
	}, [currentFilePath, editorInstance, getScroll, sessionKey, setScroll, modifiedContent]);

	useEffect(() => {
		if (!activeThreadOnThisFile) return;
		const isFallback = fallbackThreads.some((thread) => thread.id === activeThreadOnThisFile.id);
		if (isFallback) {
			const frame = requestAnimationFrame(() => {
				const container = fallbackThreadsRef.current;
				if (!container) return;
				const target = Array.from(
					container.querySelectorAll<HTMLElement>("[data-review-thread-id]")
				).find((element) => element.dataset["reviewThreadId"] === activeThreadOnThisFile.id);
				target?.scrollIntoView({ block: "nearest" });
			});
			return () => cancelAnimationFrame(frame);
		}

		if (!editorInstance || !activeThreadOnThisFile.line) return;
		const editor =
			activeThreadOnThisFile.diffSide === "LEFT"
				? editorInstance.getOriginalEditor()
				: editorInstance.getModifiedEditor();
		const line = activeThreadOnThisFile.line;
		const ranges = editor.getVisibleRanges();
		const isVisible = ranges.some(
			(range) => line >= range.startLineNumber && line <= range.endLineNumber
		);
		if (!isVisible) editor.revealLineInCenter(line);
	}, [activeThreadOnThisFile, editorInstance, fallbackThreads]);

	const handleMarkdownPaneScroll = useCallback(() => {
		if (isSyncingScrollRef.current) return;
		const modEditor = editorInstance?.getModifiedEditor();
		const pane = markdownPaneRef.current;
		if (!modEditor || !pane) return;
		const paneScrollable = pane.scrollHeight - pane.clientHeight;
		const editorScrollable = modEditor.getScrollHeight() - modEditor.getLayoutInfo().height;
		if (paneScrollable <= 0 || editorScrollable <= 0) return;
		const percent = pane.scrollTop / paneScrollable;
		isSyncingScrollRef.current = true;
		modEditor.setScrollTop(percent * editorScrollable);
		requestAnimationFrame(() => {
			isSyncingScrollRef.current = false;
		});
	}, [editorInstance]);

	return (
		<div data-workspace-id={workspaceId} className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="sticky top-0 z-10 flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<button
					type="button"
					aria-label="Previous file"
					onClick={() => advanceFile(sessionKey, -1)}
					disabled={!canGoPrevious}
					className={toolbarButtonClass(false, !canGoPrevious)}
				>
					&lt;
				</button>
				<button
					type="button"
					aria-label="Next file"
					onClick={() => advanceFile(sessionKey, 1)}
					disabled={!canGoNext}
					className={toolbarButtonClass(false, !canGoNext)}
				>
					&gt;
				</button>

				<span className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--text-secondary)]">
					{currentFilePath ?? "No file selected"}
				</span>

				{currentFile && (
					<span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
						<span className="text-[var(--color-success)]">+{currentFile.additions}</span>
						<span className="text-[var(--color-danger)]">-{currentFile.deletions}</span>
					</span>
				)}

				<button
					type="button"
					onClick={startNewComment}
					disabled={readOnly || !editorInstance || currentFilePath === null}
					className={toolbarButtonClass(
						pendingLine !== null,
						readOnly || !editorInstance || currentFilePath === null
					)}
					title="Add a comment to the selected or first visible changed line"
				>
					Add comment
				</button>

				<button
					type="button"
					aria-pressed={publishedCommentsVisible}
					onClick={togglePublishedComments}
					disabled={publishedThreadCount === 0}
					className={toolbarButtonClass(publishedCommentsVisible, publishedThreadCount === 0)}
					title={
						publishedCommentsVisible
							? "Hide published pull request comments"
							: "Show published pull request comments"
					}
				>
					Comments · {publishedThreadCount}
				</button>

				{isGitHubPR && currentFilePath && (
					<label className="flex shrink-0 cursor-pointer items-center gap-1.5">
						<input
							type="checkbox"
							checked={isViewed}
							disabled={markFileViewed.isPending}
							onChange={(event) =>
								markFileViewed.mutate({
									owner: prCtx.owner,
									repo: prCtx.repo,
									number: prCtx.number,
									filePath: currentFilePath,
									viewed: event.target.checked,
								})
							}
							className="size-3 rounded accent-[var(--accent)]"
						/>
						<span className="text-[11px] text-[var(--text-quaternary)]">Viewed</span>
					</label>
				)}

				<div className="flex shrink-0 items-center rounded bg-[var(--bg-base)] p-0.5">
					<button
						type="button"
						aria-pressed={diffMode === "split"}
						onClick={() => setDiffMode("split")}
						disabled={hideEditor}
						className={toolbarButtonClass(diffMode === "split", hideEditor)}
					>
						Split
					</button>
					<button
						type="button"
						aria-pressed={diffMode === "inline"}
						onClick={() => setDiffMode("inline")}
						disabled={hideEditor}
						className={toolbarButtonClass(diffMode === "inline", hideEditor)}
					>
						Unified
					</button>
				</div>

				{isMarkdown && <MarkdownPreviewButton language={language} showRichDiff />}

				{hasResolvedThreads && (
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={() => {
								setCollapsedThreadOverrides(new Map());
								setCollapseCommand((current) => ({
									defaultCollapsed: true,
									nonce: current.nonce + 1,
								}));
							}}
							className={toolbarButtonClass(collapseCommand.defaultCollapsed)}
						>
							Collapse all
						</button>
						<button
							type="button"
							onClick={() => {
								setCollapsedThreadOverrides(new Map());
								setCollapseCommand((current) => ({
									defaultCollapsed: false,
									nonce: current.nonce + 1,
								}));
							}}
							className={toolbarButtonClass(!collapseCommand.defaultCollapsed)}
						>
							Expand all
						</button>
					</div>
				)}
			</div>

			{fallbackThreads.length > 0 && (
				<div
					ref={fallbackThreadsRef}
					className="max-h-[min(38%,320px)] shrink-0 overflow-y-auto border-b border-[var(--border)] bg-[var(--bg-base)] px-3 py-2"
				>
					<div className="mb-2 flex items-center gap-2">
						<span className="text-[11px] font-medium text-[var(--text-tertiary)]">
							{hideEditor ? "Comments for this file" : "Comments without an inline anchor"}
						</span>
						<span className="text-[11px] tabular-nums text-[var(--text-quaternary)]">
							{fallbackThreads.length}
						</span>
						<div className="flex-1" />
						{hideEditor ? (
							<button
								type="button"
								onClick={() => setMarkdownPreviewMode("off")}
								className={toolbarButtonClass()}
							>
								Show code diff
							</button>
						) : (
							fallbackThreads.some(
								(thread) => thread.diffSide === "LEFT" && thread.line != null
							) && (
								<button
									type="button"
									onClick={() => setDiffMode("split")}
									className={toolbarButtonClass()}
								>
									Show deleted-line comments in split view
								</button>
							)
						)}
					</div>
					<div className="flex flex-col gap-2">
						{fallbackThreads.map((thread) => (
							<div key={thread.id}>{renderThread(thread)}</div>
						))}
					</div>
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-hidden">
				{currentFilePath === null ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-tertiary)]">
						No files changed
					</div>
				) : isLoading ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Loading...
					</div>
				) : effectiveMarkdownPreviewMode === "rich-diff" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderedDiff original={originalContent} modified={modifiedContent} />
					</div>
				) : effectiveMarkdownPreviewMode === "rendered" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderer content={modifiedContent} />
					</div>
				) : effectiveMarkdownPreviewMode === "split" ? (
					<div className="flex h-full overflow-hidden">
						<div className="flex-1 overflow-hidden">
							<DiffEditor
								original={originalContent}
								modified={modifiedContent}
								language={language}
								renderSideBySide={diffMode === "split"}
								readOnly={true}
								onEditorReady={setEditor}
							/>
						</div>
						<div
							ref={markdownPaneRef}
							className="flex-1 overflow-y-auto border-l border-[var(--border)] p-4"
							onScroll={handleMarkdownPaneScroll}
						>
							<MarkdownRenderer content={modifiedContent} />
						</div>
					</div>
				) : (
					<DiffEditor
						original={originalContent}
						modified={modifiedContent}
						language={language}
						renderSideBySide={diffMode === "split"}
						readOnly={true}
						onEditorReady={setEditor}
					/>
				)}
			</div>
		</div>
	);
}
