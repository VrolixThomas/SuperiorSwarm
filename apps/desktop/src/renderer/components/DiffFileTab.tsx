import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reanchorComment } from "../../shared/comment-anchor";
import { type DiffContext, refsForDiffContext } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { DiffEditor } from "./DiffEditor";
import { MarkdownPreviewButton } from "./MarkdownPreviewButton";
import { MarkdownRenderedDiff } from "./MarkdownRenderedDiff";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { type AnchoredComment, InlineCommentLayer } from "./inline-comments/InlineCommentLayer";
import { InlineCommentSendBar } from "./inline-comments/InlineCommentSendBar";

interface DiffFileTabProps {
	diffCtx: DiffContext;
	filePath: string;
	language: string;
	workspaceId?: string;
}

export function DiffFileTab({ diffCtx, filePath, language, workspaceId }: DiffFileTabProps) {
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const markdownPaneRef = useRef<HTMLDivElement>(null);
	const isSyncingScrollRef = useRef(false);
	const splitEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
	const scrollSubRef = useRef<monaco.IDisposable | null>(null);
	const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(
		null
	);

	useEffect(() => {
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			scrollSubRef.current?.dispose();
		};
	}, []);

	const utils = trpc.useUtils();
	const saveMutation = trpc.diff.saveFileContent.useMutation({
		onSuccess: () => {
			utils.diff.getWorkingTreeDiff.invalidate({ repoPath: diffCtx.repoPath });
			utils.diff.getWorkingTreeStatus.invalidate({ repoPath: diffCtx.repoPath });
		},
	});

	const { originalRef, modifiedRef } = refsForDiffContext(diffCtx);

	const originalQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: diffCtx.repoPath, ref: originalRef, filePath },
		{ staleTime: 30_000 }
	);

	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: diffCtx.repoPath, ref: modifiedRef, filePath },
		{ staleTime: diffCtx.type === "working-tree" ? 5_000 : 30_000 }
	);

	function handleModifiedChange(content: string) {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			saveMutation.mutate({ repoPath: diffCtx.repoPath, filePath, content });
		}, 500);
	}

	// Commit-scoped diffs are historical — never editable. PR diffs also stay read-only.
	const isEditable = diffCtx.type === "working-tree" || diffCtx.type === "branch";
	const isLoading = originalQuery.isLoading || modifiedQuery.isLoading;
	const hideEditor = markdownPreviewMode === "rendered" || markdownPreviewMode === "rich-diff";

	const commentingEnabled =
		!!workspaceId && (diffCtx.type === "working-tree" || diffCtx.type === "branch");

	const commentsQuery = trpc.inlineComments.list.useQuery(
		{ workspaceId: workspaceId ?? "" },
		{ enabled: commentingEnabled }
	);

	const fileComments: AnchoredComment[] = useMemo(() => {
		if (!commentingEnabled) return [];
		const modifiedContent = modifiedQuery.data?.content ?? "";
		return (commentsQuery.data ?? [])
			.filter((c) => c.filePath === filePath)
			.map((c) => {
				const anchor = reanchorComment(modifiedContent, c.startLine, c.endLine, c.codeSnapshot);
				return {
					...c,
					displayStartLine: anchor.startLine,
					displayEndLine: anchor.endLine,
					outdated: anchor.outdated,
				};
			});
	}, [commentingEnabled, commentsQuery.data, filePath, modifiedQuery.data?.content]);

	const allAnchoredComments: AnchoredComment[] = useMemo(
		() =>
			(commentsQuery.data ?? []).map((c) => ({
				...c,
				displayStartLine: c.startLine,
				displayEndLine: c.endLine,
				outdated: false,
			})),
		[commentsQuery.data]
	);

	// Send-bar list: substitute in the re-anchored entries for the currently open
	// file (fileComments), so the prompt carries real re-anchored lines and the
	// outdated note for it. Other files keep their stored (unanchored) lines.
	const sendComments: AnchoredComment[] = useMemo(() => {
		const fileCommentsById = new Map(fileComments.map((c) => [c.id, c]));
		return allAnchoredComments.map((c) => fileCommentsById.get(c.id) ?? c);
	}, [allAnchoredComments, fileComments]);

	const createCommentMut = trpc.inlineComments.create.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId: workspaceId ?? "" }),
	});
	const updateCommentMut = trpc.inlineComments.update.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId: workspaceId ?? "" }),
	});
	const deleteCommentMut = trpc.inlineComments.delete.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId: workspaceId ?? "" }),
	});

	const handleCreateComment = useCallback(
		(draft: { startLine: number; endLine: number; body: string }) => {
			if (!commentingEnabled || !workspaceId) return;
			const modifiedContent = modifiedQuery.data?.content ?? "";
			const lines = modifiedContent.split("\n");
			const codeSnapshot = lines.slice(draft.startLine - 1, draft.endLine).join("\n");
			createCommentMut.mutate({
				workspaceId,
				repoPath: diffCtx.repoPath,
				filePath,
				startLine: draft.startLine,
				endLine: draft.endLine,
				codeSnapshot,
				body: draft.body,
			});
		},
		[
			commentingEnabled,
			workspaceId,
			modifiedQuery.data?.content,
			diffCtx.repoPath,
			filePath,
			createCommentMut,
		]
	);

	const handleUpdateComment = useCallback(
		(id: string, body: string) => updateCommentMut.mutate({ id, body }),
		[updateCommentMut.mutate]
	);
	const handleDeleteComment = useCallback(
		(id: string) => deleteCommentMut.mutate({ id }),
		[deleteCommentMut.mutate]
	);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Minimal toolbar */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{filePath}
				</span>
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					disabled={hideEditor}
					className={[
						"rounded px-2 py-0.5 text-[11px] transition-colors",
						hideEditor
							? "text-[var(--text-quaternary)] opacity-40 cursor-not-allowed"
							: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
					].join(" ")}
				>
					{diffMode === "split" ? "Inline" : "Split"}
				</button>
				<MarkdownPreviewButton language={language} showRichDiff />
				{saveMutation.isPending && (
					<span className="text-[11px] text-[var(--text-quaternary)]">Saving…</span>
				)}
			</div>
			{commentingEnabled && workspaceId && (
				<InlineCommentSendBar workspaceId={workspaceId} comments={sendComments} />
			)}

			<div className="flex-1 overflow-hidden">
				{isLoading ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Loading…
					</div>
				) : markdownPreviewMode === "rich-diff" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderedDiff
							original={originalQuery.data?.content ?? ""}
							modified={modifiedQuery.data?.content ?? ""}
						/>
					</div>
				) : markdownPreviewMode === "rendered" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderer content={modifiedQuery.data?.content ?? ""} />
					</div>
				) : markdownPreviewMode === "split" ? (
					<div className="flex h-full overflow-hidden">
						<div className="flex-1 overflow-hidden">
							<DiffEditor
								original={originalQuery.data?.content ?? ""}
								modified={modifiedQuery.data?.content ?? ""}
								language={language}
								renderSideBySide={diffMode === "split"}
								onModifiedChange={isEditable ? handleModifiedChange : undefined}
								onEditorReady={(editor) => {
									splitEditorRef.current = editor;
									setEditorInstance(editor);
									scrollSubRef.current?.dispose();
									if (!editor) {
										scrollSubRef.current = null;
										return;
									}
									const modEditor = editor.getModifiedEditor();
									scrollSubRef.current = modEditor.onDidScrollChange((e) => {
										if (isSyncingScrollRef.current) return;
										const pane = markdownPaneRef.current;
										if (!pane) return;
										const editorScrollable =
											modEditor.getScrollHeight() - modEditor.getLayoutInfo().height;
										const paneScrollable = pane.scrollHeight - pane.clientHeight;
										if (editorScrollable <= 0 || paneScrollable <= 0) return;
										const pct = e.scrollTop / editorScrollable;
										isSyncingScrollRef.current = true;
										pane.scrollTop = pct * paneScrollable;
										requestAnimationFrame(() => {
											isSyncingScrollRef.current = false;
										});
									});
								}}
							/>
						</div>
						<div
							ref={markdownPaneRef}
							className="flex-1 overflow-y-auto border-l border-[var(--border)] p-4"
							onScroll={() => {
								if (isSyncingScrollRef.current) return;
								const modEditor = splitEditorRef.current?.getModifiedEditor();
								const pane = markdownPaneRef.current;
								if (!modEditor || !pane) return;
								const paneScrollable = pane.scrollHeight - pane.clientHeight;
								const editorScrollable =
									modEditor.getScrollHeight() - modEditor.getLayoutInfo().height;
								if (paneScrollable <= 0 || editorScrollable <= 0) return;
								const pct = pane.scrollTop / paneScrollable;
								isSyncingScrollRef.current = true;
								modEditor.setScrollTop(pct * editorScrollable);
								requestAnimationFrame(() => {
									isSyncingScrollRef.current = false;
								});
							}}
						>
							<MarkdownRenderer content={modifiedQuery.data?.content ?? ""} />
						</div>
					</div>
				) : (
					<DiffEditor
						original={originalQuery.data?.content ?? ""}
						modified={modifiedQuery.data?.content ?? ""}
						language={language}
						renderSideBySide={diffMode === "split"}
						onModifiedChange={isEditable ? handleModifiedChange : undefined}
						onEditorReady={setEditorInstance}
					/>
				)}
			</div>
			{commentingEnabled && (
				<InlineCommentLayer
					editor={editorInstance}
					comments={fileComments}
					onCreate={handleCreateComment}
					onUpdate={handleUpdateComment}
					onDelete={handleDeleteComment}
				/>
			)}
		</div>
	);
}
