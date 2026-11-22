import type * as monaco from "monaco-editor";
import type { Dispatch, SetStateAction } from "react";
import type { GitHubPRDetails, PRContext } from "../../../../shared/github-types";
import { MarkdownPreviewButton } from "../../MarkdownPreviewButton";
import { toolbarButtonClass } from "./step-diff-model";
interface Props {
	currentFilePath: string | null;
	currentFile: GitHubPRDetails["files"][number] | undefined;
	canGoPrevious: boolean;
	canGoNext: boolean;
	sessionKey: string;
	advanceFile: (key: string, direction: 1 | -1) => void;
	startNewComment: () => void;
	readOnly: boolean;
	editorInstance: monaco.editor.IStandaloneDiffEditor | null;
	pendingLine: number | null;
	publishedCommentsVisible: boolean;
	togglePublishedComments: () => void;
	publishedThreadCount: number;
	isGitHubPR: boolean;
	isViewed: boolean;
	markFileViewed: {
		isPending: boolean;
		mutate: (input: {
			owner: string;
			repo: string;
			number: number;
			filePath: string;
			viewed: boolean;
		}) => void;
	};
	prCtx: PRContext;
	diffMode: "split" | "inline";
	setDiffMode: (mode: "split" | "inline") => void;
	hideEditor: boolean;
	isMarkdown: boolean;
	language: string;
	hasResolvedThreads: boolean;
	setCollapsedThreadOverrides: Dispatch<SetStateAction<Map<string, boolean>>>;
	setCollapseCommand: Dispatch<SetStateAction<{ defaultCollapsed: boolean; nonce: number }>>;
	collapseCommand: { defaultCollapsed: boolean; nonce: number };
}
export function LegacyDiffToolbar({
	currentFilePath,
	currentFile,
	canGoPrevious,
	canGoNext,
	sessionKey,
	advanceFile,
	startNewComment,
	readOnly,
	editorInstance,
	pendingLine,
	publishedCommentsVisible,
	togglePublishedComments,
	publishedThreadCount,
	isGitHubPR,
	isViewed,
	markFileViewed,
	prCtx,
	diffMode,
	setDiffMode,
	hideEditor,
	isMarkdown,
	language,
	hasResolvedThreads,
	setCollapsedThreadOverrides,
	setCollapseCommand,
	collapseCommand,
}: Props) {
	return (
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
					<span className="text-[11px] text-[var(--text-tertiary)]">Viewed</span>
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
	);
}
