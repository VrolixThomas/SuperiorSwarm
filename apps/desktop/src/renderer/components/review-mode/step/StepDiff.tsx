import type * as monaco from "monaco-editor";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { detectLanguage } from "../../../../shared/diff-types";
import type { GitHubPRDetails, PRContext, UnifiedThread } from "../../../../shared/github-types";
import type { AskMessage, CodeReference, FocusRange } from "../../../../shared/review-path-types";
import { changesThreadsForFile } from "../../../lib/pr-review-threads";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
import { useTabStore } from "../../../stores/tab-store";
import { trpc } from "../../../trpc/client";
import { useReviewUIStore } from "../ReviewUIContext";
import { useContextDefinition } from "../hooks/useContextDefinition";
import { useFocusDecorations } from "../hooks/useFocusDecorations";
import { useInlineCommentZones } from "../hooks/useInlineCommentZones";
import { useThreadDecorations } from "../hooks/useThreadDecorations";
import type { ThreadCallbacks } from "../thread/ThreadCard";
import { StepDiffView } from "./StepDiffView";
import { stepThreadLayout } from "./step-diff-model";
import { useStepComments } from "./useStepComments";
import { useStepContent } from "./useStepContent";
import { useStepThreadRenderer } from "./useStepThreadRenderer";
import { useStepViewport } from "./useStepViewport";

export interface StepDiffProps {
	forceUnified?: boolean;
	filePath?: string | null;
	header?: ReactNode;
	focus?: FocusRange[];
	renderThread?: (thread: UnifiedThread) => ReactNode;
	onEditorReady?: (editor: monaco.editor.IStandaloneDiffEditor | null) => void;
	onSelection?: (anchor: AskMessage["anchor"] | null) => void;
	onAsk?: (anchor: AskMessage["anchor"]) => void;
	onDefinition?: (ref: CodeReference) => void;
	commentRequest?: { id: string; anchor: NonNullable<AskMessage["anchor"]>; body?: string };
	onCommentRequestHandled?: () => void;
	onComposerOpenChange?: (open: boolean) => void;
	cancelCommentNonce?: number;
	workspaceId: string;
	reviewDraftId?: string;
	prCtx: PRContext;
	details: GitHubPRDetails;
	threads: UnifiedThread[];
	fileOrder: string[];
	sessionKey: string;
	callbacks: ThreadCallbacks;
	readOnly?: boolean;
}

const EMPTY_FOCUS: FocusRange[] = [];

function lineCount(content: string): number {
	return content.split(/\r\n|\r|\n/).length;
}

export function useStepDiff({
	forceUnified = false,
	workspaceId,
	reviewDraftId,
	header,
	prCtx,
	details,
	threads: allThreads,
	filePath,
	focus = EMPTY_FOCUS,
	renderThread: renderThreadOverride,
	onEditorReady,
	onSelection,
	onAsk,
	onDefinition,
	commentRequest,
	onCommentRequestHandled,
	onComposerOpenChange,
	cancelCommentNonce,
	fileOrder,
	sessionKey,
	callbacks,
	readOnly = false,
}: StepDiffProps) {
	const utils = trpc.useUtils();
	const preferredDiffMode = useTabStore((s) => s.diffMode);
	const diffMode = forceUnified ? "inline" : preferredDiffMode;
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
	const publishedCommentsVisible = useReviewUIStore((s) => s.publishedCommentsVisible);
	const togglePublishedComments = useReviewUIStore((s) => s.togglePublishedComments);
	const [editor, setEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);
	const currentFilePath =
		filePath !== undefined ? filePath : (activeFilePath ?? fileOrder[0] ?? null);
	const language = currentFilePath ? detectLanguage(currentFilePath) : "plaintext";
	const isMarkdown = language === "markdown";
	const effectiveMarkdownPreviewMode =
		isMarkdown && header === undefined ? markdownPreviewMode : "off";
	const hideEditor =
		effectiveMarkdownPreviewMode === "rendered" || effectiveMarkdownPreviewMode === "rich-diff";
	const currentFile = details.files.find((file) => file.path === currentFilePath);
	const currentFileIndex = currentFilePath ? fileOrder.indexOf(currentFilePath) : -1;
	const canGoPrevious = currentFileIndex > 0;
	const canGoNext = currentFileIndex >= 0 && currentFileIndex < fileOrder.length - 1;
	const isGitHubPR = prCtx.provider === "github";

	useEffect(() => {
		if (filePath !== undefined || activeFilePath !== null) return;
		const firstPath = fileOrder[0];
		if (firstPath) selectFile(sessionKey, firstPath);
	}, [activeFilePath, filePath, fileOrder, selectFile, sessionKey]);

	const {
		commitSha,
		originalContent,
		modifiedContent,
		isLoading,
		unavailable,
		binary,
		contentMessage,
		validDiffLines,
		validOriginalDiffLines,
	} = useStepContent(workspaceId, prCtx, details, currentFilePath);
	const editorInstance = !hideEditor && !isLoading && !unavailable && !binary ? editor : null;
	useEffect(() => {
		onEditorReady?.(editorInstance);
		return () => onEditorReady?.(null);
	}, [editorInstance, onEditorReady]);
	useFocusDecorations(editorInstance, focus);
	useContextDefinition(
		editorInstance?.getModifiedEditor() ?? null,
		prCtx.repoPath,
		currentFilePath,
		onDefinition
	);
	useContextDefinition(
		editorInstance?.getOriginalEditor() ?? null,
		prCtx.repoPath,
		currentFilePath,
		onDefinition
	);
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
			stepThreadLayout(fileThreads, diffMode, !hideEditor, {
				LEFT: lineCount(originalContent),
				RIGHT: lineCount(modifiedContent),
			}),
		[diffMode, fileThreads, hideEditor, modifiedContent, originalContent]
	);
	const leftInlineThreads = threadLayout.leftInline;
	const rightInlineThreads = threadLayout.rightInline;
	const fallbackThreads = threadLayout.fallback;
	const outdatedThreads = threadLayout.outdated;
	const [showOutdated, setShowOutdated] = useState(false);
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

	const {
		commentError,
		pendingLine,
		pendingSide,
		initialBody,
		handleSaveNew,
		handleCancelNew,
		startNewComment,
	} = useStepComments(editorInstance, currentFilePath, validDiffLines, {
		workspaceId,
		reviewDraftId,
		prCtx,
		commitSha,
		validOriginalDiffLines,
		readOnly,
		onSelection,
		onAsk,
		commentRequest,
		onCommentRequestHandled,
		onComposerOpenChange,
		cancelCommentNonce,
	});
	const { renderThread, collapseCommand, setCollapseCommand, setCollapsedThreadOverrides } =
		useStepThreadRenderer(sessionKey, activeThreadId, callbacks, renderThreadOverride);
	useInlineCommentZones(
		editorInstance,
		"LEFT",
		leftInlineThreads,
		pendingSide === "LEFT" ? pendingLine : null,
		renderThread,
		handleSaveNew,
		handleCancelNew,
		initialBody,
		currentFilePath ?? ""
	);
	useInlineCommentZones(
		editorInstance,
		"RIGHT",
		rightInlineThreads,
		pendingSide === "RIGHT" ? pendingLine : null,
		renderThread,
		handleSaveNew,
		handleCancelNew,
		initialBody,
		currentFilePath ?? ""
	);
	useThreadDecorations(editorInstance, "LEFT", leftInlineThreads, activeThreadId);
	useThreadDecorations(editorInstance, "RIGHT", rightInlineThreads, activeThreadId);
	const { markdownPaneRef, fallbackThreadsRef, handleMarkdownPaneScroll } = useStepViewport(
		editorInstance,
		effectiveMarkdownPreviewMode,
		currentFilePath,
		sessionKey,
		modifiedContent,
		activeThreadOnThisFile,
		fallbackThreads,
		setShowOutdated,
		details.headCommitOid
	);

	return {
		commentError,
		currentFilePath,
		currentFile,
		canGoPrevious,
		canGoNext,
		advanceFile,
		startNewComment,
		editorInstance,
		pendingLine,
		publishedCommentsVisible,
		togglePublishedComments,
		publishedThreadCount,
		isGitHubPR,
		isViewed,
		markFileViewed,
		diffMode,
		setDiffMode,
		hideEditor,
		isMarkdown,
		language,
		hasResolvedThreads,
		setCollapsedThreadOverrides,
		setCollapseCommand,
		collapseCommand,
		outdatedThreads,
		showOutdated,
		setShowOutdated,
		renderThread,
		fallbackThreads,
		fallbackThreadsRef,
		setMarkdownPreviewMode,
		originalContent,
		modifiedContent,
		effectiveMarkdownPreviewMode,
		isLoading,
		unavailable,
		binary,
		contentMessage,
		setEditor,
		markdownPaneRef,
		handleMarkdownPaneScroll,
	};
}

export function StepDiff(props: StepDiffProps) {
	const state = useStepDiff(props);
	return <StepDiffView {...props} state={state} />;
}
