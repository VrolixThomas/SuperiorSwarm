import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { reanchorComment } from "../../../shared/comment-anchor";
import { detectLanguage } from "../../../shared/diff-types";
import type { ReviewScope, ScopedDiffFile } from "../../../shared/review-types";
import { useRepoSubscription } from "../../hooks/useRepoSubscription";
import { buildWorkingFileList } from "../../lib/working-files";
import { useReviewSessionStore } from "../../stores/review-session-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { DiffEditor } from "../DiffEditor";
import { MarkdownPreviewButton } from "../MarkdownPreviewButton";
import { MarkdownRenderedDiff } from "../MarkdownRenderedDiff";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { type AnchoredComment, InlineCommentLayer } from "../inline-comments/InlineCommentLayer";
import { InlineCommentSendBar } from "../inline-comments/InlineCommentSendBar";
import { ReviewFilterTabs } from "./ReviewFilterTabs";
import { ReviewHintBar } from "./ReviewHintBar";
import { ReviewProgressBar } from "./ReviewProgressBar";

// Branch-scope sort matches sidebar groupByDirectory: top-level dir, then path.
function topLevelDir(path: string): string {
	const parts = path.split("/");
	return parts.length > 1 ? (parts[0] ?? ".") : ".";
}
const BY_SIDEBAR_ORDER = (a: ScopedDiffFile, b: ScopedDiffFile) => {
	const groupCmp = topLevelDir(a.path).localeCompare(topLevelDir(b.path));
	if (groupCmp !== 0) return groupCmp;
	return a.path.localeCompare(b.path);
};

export function ReviewTab({
	workspaceId,
	repoPath,
	baseBranch,
}: {
	workspaceId: string;
	repoPath: string;
	baseBranch: string;
}) {
	const session = useReviewSessionStore((s) => s.activeSession);
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(
		null
	);

	useRepoSubscription(repoPath);

	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath },
		{ staleTime: 30_000, refetchOnWindowFocus: true }
	);
	const currentBranch = statusQuery.data?.branch ?? "";

	const branchQuery = trpc.diff.getBranchDiff.useQuery(
		{ repoPath, baseBranch, headBranch: currentBranch },
		{ enabled: !!currentBranch, staleTime: 30_000 }
	);

	// Working list mirrors the sidebar (DraftCommitCard) exactly: same data source
	// (`getWorkingTreeStatus` — includes synthesized untracked files), same dedupe,
	// same sort. Without this parity, j/k navigation skips files that are visible
	// in the sidebar (untracked) or stops on duplicates.
	const allFiles: ScopedDiffFile[] = useMemo(() => {
		const status = statusQuery.data;
		const w: ScopedDiffFile[] = status
			? buildWorkingFileList(status).map((f) => ({ ...f, scope: "working" }))
			: [];
		const b = (branchQuery.data?.files ?? [])
			.map((f): ScopedDiffFile => ({ ...f, scope: "branch" }))
			.sort(BY_SIDEBAR_ORDER);
		return [...w, ...b];
	}, [statusQuery.data, branchQuery.data]);

	const scope = session?.scope ?? "all";
	const scopedFiles = useMemo(
		() => (scope === "all" ? allFiles : allFiles.filter((f) => f.scope === scope)),
		[allFiles, scope]
	);

	const workingCount = useMemo(
		() => allFiles.filter((f) => f.scope === "working").length,
		[allFiles]
	);
	const branchCount = useMemo(
		() => allFiles.filter((f) => f.scope === "branch").length,
		[allFiles]
	);

	const viewedQuery = trpc.review.getViewed.useQuery({ workspaceId }, { refetchInterval: 10_000 });
	const viewedMap = useMemo(() => {
		const m = new Map<string, string>();
		for (const row of viewedQuery.data ?? []) m.set(row.filePath, row.contentHash);
		return m;
	}, [viewedQuery.data]);

	const reviewedInScope = useMemo(
		() => scopedFiles.filter((f) => viewedMap.has(f.path)).length,
		[scopedFiles, viewedMap]
	);

	const selectedFile: ScopedDiffFile | null = useMemo(
		() => scopedFiles.find((f) => f.path === session?.selectedFilePath) ?? null,
		[scopedFiles, session?.selectedFilePath]
	);

	useEffect(() => {
		useReviewSessionStore.getState().setFileSnapshot(allFiles, scopedFiles);
	}, [allFiles, scopedFiles]);

	// Auto-select invariant: see review-session-store for loop-safety.
	const selectedFilePath = session?.selectedFilePath ?? null;
	useEffect(() => {
		if (!session) return;
		if (selectedFilePath && scopedFiles.some((f) => f.path === selectedFilePath)) return;
		const first = scopedFiles[0]?.path ?? null;
		if (first !== selectedFilePath) {
			useReviewSessionStore.getState().selectFile(first);
		}
	}, [session, selectedFilePath, scopedFiles]);

	const originalRef = selectedFile?.scope === "branch" ? baseBranch : "HEAD";
	const contentQ = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: originalRef, filePath: selectedFile?.path ?? "" },
		{ enabled: !!selectedFile }
	);
	const modifiedQ = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: "", filePath: selectedFile?.path ?? "" },
		{ enabled: !!selectedFile }
	);

	const overlay = useReviewSessionStore((s) =>
		selectedFile ? s.activeSession?.editOverlay.get(selectedFile.path) : undefined
	);
	const modifiedContent = overlay ?? modifiedQ.data?.content ?? "";

	const utils = trpc.useUtils();
	const setViewedMut = trpc.review.setViewed.useMutation({
		onSuccess: () => utils.review.getViewed.invalidate({ workspaceId }),
	});
	const unsetViewedMut = trpc.review.unsetViewed.useMutation({
		onSuccess: () => utils.review.getViewed.invalidate({ workspaceId }),
	});

	const commentsQuery = trpc.inlineComments.list.useQuery({ workspaceId });

	const fileComments: AnchoredComment[] = useMemo(() => {
		if (!selectedFile) return [];
		return (commentsQuery.data ?? [])
			.filter((c) => c.filePath === selectedFile.path)
			.map((c) => {
				const anchor = reanchorComment(modifiedContent, c.startLine, c.endLine, c.codeSnapshot);
				return {
					...c,
					displayStartLine: anchor.startLine,
					displayEndLine: anchor.endLine,
					outdated: anchor.outdated,
				};
			});
	}, [commentsQuery.data, selectedFile, modifiedContent]);

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
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId }),
	});
	const updateCommentMut = trpc.inlineComments.update.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId }),
	});
	const deleteCommentMut = trpc.inlineComments.delete.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId }),
	});

	const handleCreateComment = useCallback(
		(draft: { startLine: number; endLine: number; body: string }) => {
			if (!selectedFile) return;
			const lines = modifiedContent.split("\n");
			const codeSnapshot = lines.slice(draft.startLine - 1, draft.endLine).join("\n");
			createCommentMut.mutate({
				workspaceId,
				repoPath,
				filePath: selectedFile.path,
				startLine: draft.startLine,
				endLine: draft.endLine,
				codeSnapshot,
				body: draft.body,
			});
		},
		[selectedFile, modifiedContent, workspaceId, repoPath, createCommentMut]
	);

	const handleUpdateComment = useCallback(
		(id: string, body: string) => updateCommentMut.mutate({ id, body }),
		[updateCommentMut.mutate]
	);
	const handleDeleteComment = useCallback(
		(id: string) => deleteCommentMut.mutate({ id }),
		[deleteCommentMut.mutate]
	);

	useEffect(() => {
		async function handleToggleViewed() {
			if (!selectedFile) return;
			const path = selectedFile.path;
			const modified = modifiedQ.data?.content ?? "";
			const { sha256Hex } = await import("../../lib/content-hash");
			const hash = await sha256Hex(modified);
			const stored = viewedMap.get(path);
			if (stored === hash) {
				unsetViewedMut.mutate({ workspaceId, filePath: path });
			} else {
				setViewedMut.mutate({ workspaceId, filePath: path, contentHash: hash });
			}
		}

		async function handleMarkViewed() {
			// Idempotent: used when advancing j/k to auto-mark the current file as viewed.
			if (!selectedFile) return;
			const path = selectedFile.path;
			const modified = modifiedQ.data?.content ?? "";
			const { sha256Hex } = await import("../../lib/content-hash");
			const hash = await sha256Hex(modified);
			if (viewedMap.get(path) === hash) return; // already viewed at this hash
			setViewedMut.mutate({ workspaceId, filePath: path, contentHash: hash });
		}

		function handleOpenEdit() {
			if (!selectedFile) return;
			useTabStore.getState().openEditFileSplitForReview({
				workspaceId,
				repoPath,
				filePath: selectedFile.path,
			});
		}

		function handleCloseEdit() {
			useTabStore.getState().closeEditFileSplitForReview(workspaceId);
		}

		window.addEventListener("review:toggle-viewed", handleToggleViewed);
		window.addEventListener("review:mark-viewed", handleMarkViewed);
		window.addEventListener("review:open-edit", handleOpenEdit);
		window.addEventListener("review:close-edit", handleCloseEdit);
		return () => {
			window.removeEventListener("review:toggle-viewed", handleToggleViewed);
			window.removeEventListener("review:mark-viewed", handleMarkViewed);
			window.removeEventListener("review:open-edit", handleOpenEdit);
			window.removeEventListener("review:close-edit", handleCloseEdit);
		};
	}, [
		selectedFile,
		modifiedQ.data,
		viewedMap,
		workspaceId,
		repoPath,
		setViewedMut,
		unsetViewedMut,
	]);

	function handleScopeChange(next: ReviewScope) {
		const filtered = next === "all" ? allFiles : allFiles.filter((f) => f.scope === next);
		useReviewSessionStore.getState().setScope(next, filtered);
	}

	const language = selectedFile ? detectLanguage(selectedFile.path) : "plaintext";
	const hideEditor = markdownPreviewMode === "rendered" || markdownPreviewMode === "rich-diff";

	const header = (
		<div className="flex flex-col" data-review-tab>
			<ReviewFilterTabs
				scope={scope}
				allCount={allFiles.length}
				workingCount={workingCount}
				branchCount={branchCount}
				onScopeChange={handleScopeChange}
			/>
			<InlineCommentSendBar workspaceId={workspaceId} comments={sendComments} />
			<div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1">
				<ReviewProgressBar reviewed={reviewedInScope} total={scopedFiles.length} />
				<MarkdownPreviewButton language={language} showRichDiff />
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					disabled={hideEditor}
					className={[
						"shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-0.5 text-[10px] transition-colors duration-[120ms]",
						hideEditor
							? "cursor-not-allowed text-[var(--text-quaternary)] opacity-40"
							: "text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]",
					].join(" ")}
					title={`Switch to ${diffMode === "split" ? "unified" : "split"} view`}
				>
					{diffMode === "split" ? "Split" : "Unified"}
				</button>
			</div>
			{selectedFile && (
				<div className="flex h-6 shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
					<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
						{selectedFile.path}
					</span>
				</div>
			)}
		</div>
	);

	if (allFiles.length === 0) {
		return (
			<div className="flex h-full flex-col" data-review-tab>
				{header}
				<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
					No working or branch changes
				</div>
				<ReviewHintBar />
			</div>
		);
	}
	if (scopedFiles.length === 0) {
		return (
			<div className="flex h-full flex-col" data-review-tab>
				{header}
				<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
					No {scope} changes
				</div>
				<ReviewHintBar />
			</div>
		);
	}
	if (!selectedFile) {
		return (
			<div className="flex h-full flex-col" data-review-tab>
				{header}
				<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
					No file selected
				</div>
				<ReviewHintBar />
			</div>
		);
	}

	const original = contentQ.data?.content ?? "";

	return (
		<div className="flex h-full flex-col" data-review-tab>
			{header}
			<div className="min-h-0 flex-1 overflow-hidden">
				{markdownPreviewMode === "rich-diff" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderedDiff original={original} modified={modifiedContent} />
					</div>
				) : markdownPreviewMode === "rendered" ? (
					<div className="h-full overflow-y-auto p-4">
						<MarkdownRenderer content={modifiedContent} />
					</div>
				) : markdownPreviewMode === "split" && language === "markdown" ? (
					<div className="flex h-full overflow-hidden">
						<div className="flex-1 overflow-hidden">
							<DiffEditor
								original={original}
								modified={modifiedContent}
								language={language}
								renderSideBySide={diffMode === "split"}
								readOnly={true}
								onEditorReady={setEditorInstance}
							/>
						</div>
						<div className="flex-1 overflow-y-auto border-l border-[var(--border)] p-4">
							<MarkdownRenderer content={modifiedContent} />
						</div>
					</div>
				) : (
					<DiffEditor
						original={original}
						modified={modifiedContent}
						language={language}
						renderSideBySide={diffMode === "split"}
						readOnly={true}
						onEditorReady={setEditorInstance}
					/>
				)}
			</div>
			<InlineCommentLayer
				editor={editorInstance}
				comments={fileComments}
				onCreate={handleCreateComment}
				onUpdate={handleUpdateComment}
				onDelete={handleDeleteComment}
			/>
			<ReviewHintBar />
		</div>
	);
}
