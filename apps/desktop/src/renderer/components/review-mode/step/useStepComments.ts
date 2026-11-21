import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useState } from "react";
import { formatPrIdentifier } from "../../../../shared/pr-identifier";
import type { AskMessage } from "../../../../shared/review-path-types";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { trpc } from "../../../trpc/client";
import { useGutterPlusButton } from "../hooks/useGutterPlusButton";
import { useSelectionActions } from "../hooks/useSelectionActions";
import type { StepDiffProps } from "./StepDiff";
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

type Options = Pick<
	StepDiffProps,
	| "prCtx"
	| "readOnly"
	| "onSelection"
	| "onAsk"
	| "commentRequest"
	| "onCommentRequestHandled"
	| "onComposerOpenChange"
	| "cancelCommentNonce"
> & { validOriginalDiffLines?: Set<number> };
export function useStepComments(
	editorInstance: monaco.editor.IStandaloneDiffEditor | null,
	currentFilePath: string | null,
	validDiffLines: Set<number> | undefined,
	{
		prCtx,
		readOnly = false,
		onSelection,
		onAsk,
		commentRequest,
		onCommentRequestHandled,
		onComposerOpenChange,
		cancelCommentNonce,
		validOriginalDiffLines,
	}: Options
) {
	const utils = trpc.useUtils();
	const intent = useReviewModeStore((s) => s.intent);
	const clearIntent = useReviewModeStore((s) => s.clearIntent);
	const [initialBody, setInitialBody] = useState("");
	const [commentError, setCommentError] = useState("");
	const [pendingSide, setPendingSide] = useState<"LEFT" | "RIGHT">("RIGHT");
	const [pendingLine, setPendingLine] = useState<number | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: read-only transition closes any pending composer
	useEffect(() => {
		setPendingLine((line) => (currentFilePath === null || line !== null ? null : line));
	}, [currentFilePath, readOnly]);

	const ask = useCallback((anchor: AskMessage["anchor"]) => onAsk?.(anchor), [onAsk]);
	const comment = useCallback(
		(anchor: AskMessage["anchor"]) => {
			if (!readOnly && anchor) {
				if (validDiffLines && !validDiffLines.has(anchor.endLine)) {
					setCommentError("Select a line included in the PR diff to comment.");
					return;
				}
				setCommentError("");
				setInitialBody("");
				setPendingSide("RIGHT");
				setPendingLine(anchor.endLine);
			}
		},
		[readOnly, validDiffLines]
	);
	useSelectionActions(onAsk || onSelection ? editorInstance : null, {
		filePath: currentFilePath ?? "",
		onAsk: onAsk ? ask : undefined,
		onSelection,
		onComment: readOnly ? undefined : comment,
		commentLines: validDiffLines,
	});
	useEffect(() => {
		onComposerOpenChange?.(pendingLine !== null);
		return () => onComposerOpenChange?.(false);
	}, [pendingLine, onComposerOpenChange]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new nonce is an explicit cancellation request
	useEffect(() => {
		setPendingLine(null);
		setInitialBody("");
	}, [cancelCommentNonce]);
	useEffect(() => {
		if (!commentRequest || commentRequest.anchor.path !== currentFilePath || !editorInstance)
			return;
		const allowed = commentRequest.anchor.side === "LEFT" ? validOriginalDiffLines : validDiffLines;
		if (!readOnly && (!allowed || allowed.has(commentRequest.anchor.endLine))) {
			setCommentError("");
			setPendingSide(commentRequest.anchor.side);
			setInitialBody(commentRequest.body ?? "");
			setPendingLine(commentRequest.anchor.endLine);
		} else if (!readOnly)
			setCommentError(
				"This answer refers to a line outside the current PR diff. Select a changed line to comment."
			);
		onCommentRequestHandled?.();
	}, [
		commentRequest,
		currentFilePath,
		editorInstance,
		readOnly,
		onCommentRequestHandled,
		validDiffLines,
		validOriginalDiffLines,
	]);

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
			if (readOnly || pendingLine === null || currentFilePath === null) return;
			const allowed = pendingSide === "LEFT" ? validOriginalDiffLines : validDiffLines;
			if (allowed && !allowed.has(pendingLine)) {
				setCommentError("This line is no longer in the current PR diff.");
				return;
			}
			addUserComment.mutate({
				prProvider: prCtx.provider,
				prIdentifier: formatPrIdentifier(prCtx),
				prTitle: prCtx.title,
				sourceBranch: prCtx.sourceBranch,
				targetBranch: prCtx.targetBranch,
				filePath: currentFilePath,
				lineNumber: pendingLine,
				side: pendingSide,
				body,
			});
		},
		[
			addUserComment,
			currentFilePath,
			pendingLine,
			pendingSide,
			prCtx,
			readOnly,
			validDiffLines,
			validOriginalDiffLines,
		]
	);

	const handleCancelNew = useCallback(() => {
		setPendingLine(null);
		setInitialBody("");
	}, []);

	const startNewComment = useCallback(() => {
		if (readOnly) return;
		const modEditor = editorInstance?.getModifiedEditor();
		if (!modEditor) return;
		const line = pickNewCommentLine(modEditor, validDiffLines);
		if (line !== null) {
			setInitialBody("");
			setPendingSide("RIGHT");
			setPendingLine(line);
		}
	}, [editorInstance, readOnly, validDiffLines]);

	const startAtLine = useCallback((line: number) => {
		setInitialBody("");
		setPendingSide("RIGHT");
		setPendingLine(line);
	}, []);
	useGutterPlusButton(readOnly ? null : editorInstance, startAtLine, validDiffLines);

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
		if (line !== null) {
			setInitialBody("");
			setPendingSide("RIGHT");
			setPendingLine(line);
		}
		clearIntent();
	}, [clearIntent, editorInstance, intent, readOnly, validDiffLines]);

	return {
		commentError,
		pendingLine,
		pendingSide,
		initialBody,
		handleSaveNew,
		handleCancelNew,
		startNewComment,
	};
}
