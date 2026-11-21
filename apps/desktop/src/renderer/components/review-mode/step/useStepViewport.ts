import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import type { UnifiedThread } from "../../../../shared/github-types";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
export function useStepViewport(
	editorInstance: monaco.editor.IStandaloneDiffEditor | null,
	effectiveMarkdownPreviewMode: string,
	currentFilePath: string | null,
	sessionKey: string,
	modifiedContent: string,
	activeThreadOnThisFile: UnifiedThread | null,
	fallbackThreads: UnifiedThread[],
	setShowOutdated: (show: boolean) => void
) {
	const markdownPaneRef = useRef<HTMLDivElement>(null);
	const fallbackThreadsRef = useRef<HTMLDivElement>(null);
	const isSyncingScrollRef = useRef(false);
	const setScroll = usePRReviewSessionStore((s) => s.setScroll);
	const getScroll = usePRReviewSessionStore((s) => s.getScroll);
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
		if (activeThreadOnThisFile.isOutdated) {
			setShowOutdated(true);
			return;
		}
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
	}, [activeThreadOnThisFile, editorInstance, fallbackThreads, setShowOutdated]);

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

	return { markdownPaneRef, fallbackThreadsRef, handleMarkdownPaneScroll };
}
