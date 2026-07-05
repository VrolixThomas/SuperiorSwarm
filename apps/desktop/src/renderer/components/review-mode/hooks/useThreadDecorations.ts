import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import type { GitHubReviewThread, UnifiedThread } from "../../../../shared/github-types";

function baseGutterClass(t: UnifiedThread): string {
	if (t.isAIDraft) return "pr-thread-ai-draft-gutter";
	return (t as GitHubReviewThread).isResolved
		? "pr-thread-resolved-gutter"
		: "pr-thread-unresolved-gutter";
}

function baseLineClass(t: UnifiedThread): string | undefined {
	if (t.isAIDraft) return "pr-thread-ai-draft-line";
	return (t as GitHubReviewThread).isResolved ? undefined : "pr-thread-unresolved-line";
}

function hasLine(t: UnifiedThread): t is UnifiedThread & { line: number } {
	return t.line != null;
}

/**
 * Two collections: a stable base set rebuilt only when threads change, plus a
 * single-decoration overlay tracking the active thread. Splitting prevents an
 * O(threads) rebuild whenever the active thread changes (sidebar/card click).
 */
export function useThreadDecorations(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	threads: UnifiedThread[],
	activeThreadId: string | null
): void {
	const baseRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const activeRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

	useEffect(() => {
		if (!editor) return;
		const modEditor = editor.getModifiedEditor();
		const decorations: monaco.editor.IModelDeltaDecoration[] = threads.filter(hasLine).map((t) => ({
			range: new monaco.Range(t.line, 1, t.line, 1),
			options: {
				isWholeLine: true,
				linesDecorationsClassName: baseGutterClass(t),
				className: baseLineClass(t),
			},
		}));
		baseRef.current = modEditor.createDecorationsCollection(decorations);
		return () => baseRef.current?.clear();
	}, [editor, threads]);

	useEffect(() => {
		if (!editor) return;
		const modEditor = editor.getModifiedEditor();
		activeRef.current?.clear();
		const active = threads.find((t) => t.id === activeThreadId);
		if (!active?.line) return;
		// Skip overlay for resolved GitHub threads — keep them visually muted.
		if (!active.isAIDraft && (active as GitHubReviewThread).isResolved) return;
		activeRef.current = modEditor.createDecorationsCollection([
			{
				range: new monaco.Range(active.line, 1, active.line, 1),
				options: {
					isWholeLine: true,
					linesDecorationsClassName: "pr-thread-active-gutter",
					className: "pr-thread-active-line",
				},
			},
		]);
		return () => activeRef.current?.clear();
	}, [editor, threads, activeThreadId]);
}
