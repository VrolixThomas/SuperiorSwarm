import { LegacyDiffToolbar } from "./LegacyDiffToolbar";
import type { StepDiffProps, useStepDiff } from "./StepDiff";
import { StepDiffContent } from "./StepDiffContent";
import { toolbarButtonClass } from "./step-diff-model";
export function StepDiffView({
	state,
	workspaceId,
	header,
	sessionKey,
	prCtx,
	readOnly = false,
}: StepDiffProps & { state: ReturnType<typeof useStepDiff> }) {
	const {
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
	} = state;

	return (
		<div data-workspace-id={workspaceId} className="flex h-full min-h-0 flex-col overflow-hidden">
			{header !== undefined ? (
				header
			) : (
				<LegacyDiffToolbar
					currentFilePath={currentFilePath}
					currentFile={currentFile}
					canGoPrevious={canGoPrevious}
					canGoNext={canGoNext}
					sessionKey={sessionKey}
					advanceFile={advanceFile}
					startNewComment={startNewComment}
					readOnly={readOnly}
					editorInstance={editorInstance}
					pendingLine={pendingLine}
					publishedCommentsVisible={publishedCommentsVisible}
					togglePublishedComments={togglePublishedComments}
					publishedThreadCount={publishedThreadCount}
					isGitHubPR={isGitHubPR}
					isViewed={isViewed}
					markFileViewed={markFileViewed}
					prCtx={prCtx}
					diffMode={diffMode}
					setDiffMode={setDiffMode}
					hideEditor={hideEditor}
					isMarkdown={isMarkdown}
					language={language}
					hasResolvedThreads={hasResolvedThreads}
					setCollapsedThreadOverrides={setCollapsedThreadOverrides}
					setCollapseCommand={setCollapseCommand}
					collapseCommand={collapseCommand}
				/>
			)}
			{commentError && (
				<div role="alert" className="px-6 py-2 text-[12px] text-[var(--text-secondary)]">
					{commentError}
				</div>
			)}
			{outdatedThreads.length > 0 && (
				<div className="shrink-0 border-b border-[var(--border-subtle)] px-6 py-2 text-[12px] text-[var(--text-tertiary)]">
					<button
						type="button"
						aria-expanded={showOutdated}
						onClick={() => setShowOutdated(!showOutdated)}
					>
						{outdatedThreads.length} comment{outdatedThreads.length === 1 ? "" : "s"} on an earlier
						version · {showOutdated ? "Hide" : "Show"}
					</button>
					{showOutdated && (
						<div className="max-h-64 overflow-y-auto">
							{outdatedThreads.map((t) => (
								<div key={t.id}>{renderThread(t)}</div>
							))}
						</div>
					)}
				</div>
			)}

			{fallbackThreads.length > 0 && (
				<div
					ref={fallbackThreadsRef}
					className="max-h-[min(38%,320px)] shrink-0 overflow-y-auto border-b border-[var(--border)] bg-[var(--bg-base)] px-3 py-2"
				>
					<div className="mb-2 flex items-center gap-2">
						<span className="text-[11px] font-medium text-[var(--text-tertiary)]">
							{hideEditor ? "Comments for this file" : "Comments without an inline anchor"}
						</span>
						<span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
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

			<StepDiffContent
				filePath={currentFilePath}
				original={originalContent}
				modified={modifiedContent}
				language={language}
				diffMode={diffMode}
				mode={effectiveMarkdownPreviewMode}
				loading={isLoading}
				unavailable={unavailable}
				binary={binary}
				contentMessage={contentMessage}
				onEditorReady={setEditor}
				paneRef={markdownPaneRef}
				onPaneScroll={handleMarkdownPaneScroll}
			/>
		</div>
	);
}
