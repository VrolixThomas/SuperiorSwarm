import type * as monaco from "monaco-editor";
import type { ReactNode } from "react";
import type { UnifiedThread } from "../../../shared/github-types";
import type { CodeReference, ContextFileStep } from "../../../shared/review-path-types";
import { matchesReviewFilter } from "../../lib/pr-review-threads";
import { openThreadInChanges } from "../../lib/review-mode-nav";
import { numberSteps, stepForPath, stepLabel } from "../../lib/review-path-model";
import type { ReviewPathSource } from "../../lib/review-path-source";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { HintBar } from "./HintBar";
import type { ActiveReview } from "./ReviewWorkspace";
import { TerminalTab } from "./TerminalDrawer";
import type { useReadingNavigation } from "./hooks/useReadingNavigation";
import { ContextFileView } from "./step/ContextFileView";
import { StepDiff } from "./step/StepDiff";
import { StepHeader } from "./step/StepHeader";
import type { ThreadCallbacks } from "./thread/ThreadCard";
import type { useReviewWorkspaceData } from "./useReviewWorkspaceData";
import { OverviewView } from "./views/OverviewView";

interface ReadingPaneProps {
	active: ActiveReview;
	data: ReturnType<typeof useReviewWorkspaceData>;
	nav: ReturnType<typeof useReadingNavigation>;
	source: ReviewPathSource;
	callbacks: ThreadCallbacks;
	renderThread: (thread: UnifiedThread) => ReactNode;
	viewed: ReadonlySet<string>;
	viewedPending: boolean;
	toggleViewed: (path: string) => void;
	onReference: (ref: CodeReference) => void;
	onDiffEditor: (editor: monaco.editor.IStandaloneDiffEditor | null) => void;
	onCodeEditor: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
}
export function ReviewReadingPane({
	active,
	data,
	nav,
	source,
	callbacks,
	renderThread,
	viewed,
	viewedPending,
	toggleViewed,
	onReference,
	onDiffEditor,
	onCodeEditor,
}: ReadingPaneProps) {
	const view = useReviewModeStore((s) => s.view);
	const { selected } = nav;
	const path = source.path;
	const index = nav.items.findIndex((item) => item.path === nav.selectedPath);
	const previous = index > 0 ? () => nav.advance(-1) : undefined;
	const next = index < nav.items.length - 1 ? () => nav.advance(1) : undefined;
	const step = selected ? stepForPath(path, selected.path) : undefined;
	const file = data.details?.files.find((file) => file.path === selected?.path);
	const context: ContextFileStep | undefined =
		selected && !selected.changed
			? selected.step?.kind === "context" && selected.step.path === selected.path
				? selected.step
				: {
						id: selected.id,
						kind: "context",
						path: selected.path,
						note:
							selected.kind === "test" ? "Unchanged test for this step" : "Not changed in this PR",
						focus: [],
						addedBy: "user",
					}
			: undefined;
	const numbers = path ? numberSteps(path) : new Map<string, number>();
	const contextNumbers = new Map(
		path?.entries.flatMap((entry) =>
			entry.steps
				.filter((step) => step.kind === "changed")
				.map((step) => [step.path, numbers.get(step.id) ?? 0] as const)
		) ?? []
	);
	const addContext = (filePath: string) => {
		const entry =
			path?.entries.find((entry) => entry.steps.some((step) => step.id === selected?.stepId)) ??
			path?.entries[0];
		const after = entry?.steps.find((step) => step.id === selected?.stepId) ?? entry?.steps.at(-1);
		if (entry && after) source.addContextStep(entry.id, after.id, filePath);
	};
	return (
		<>
			<div className="min-h-0 flex-1 overflow-hidden">
				{view === "terminal" ? (
					<TerminalTab />
				) : data.isLoading ? (
					<div className="p-6 text-[13px] text-[var(--text-tertiary)]">Loading review…</div>
				) : !data.details ? (
					<div role="alert" className="p-6 text-[13px] text-[var(--text-secondary)]">
						Pull request details are unavailable. Reopen the PR to retry.
					</div>
				) : nav.overviewOpen || !selected ? (
					<div className="h-full overflow-y-auto">
						<OverviewView
							prCtx={active.prCtx}
							details={data.details}
							aiDraft={data.aiDraft}
							counts={data.counts}
							onJumpToComments={(filter) => {
								const store = useReviewModeStore.getState();
								if (filter === "pending" || filter === "accepted" || filter === "declined") {
									const thread = data.allThreads.find(
										(thread) =>
											thread.isAIDraft && !thread.isOutdated && matchesReviewFilter(thread, filter)
									);
									if (thread) {
										openThreadInChanges(active.workspaceId, active.prCtx, thread.path, thread.id);
										store.setPanel(null);
										return;
									}
								}
								store.setCommentFilter(filter);
								store.setPanel("threads");
							}}
							onReadFiles={() => nav.advance(1)}
						/>
					</div>
				) : context ? (
					<ContextFileView
						prCtx={active.prCtx}
						step={context}
						workspaceId={active.workspaceId}
						baseRef={data.details.baseCommitOid}
						headRef={data.details.headCommitOid}
						onPrevious={previous}
						onNext={next}
						onRemove={
							step?.kind === "context"
								? () => {
										source.removeContextStep(step.id);
										nav.advance(1);
									}
								: undefined
						}
						onAddToPath={path && !step ? addContext : undefined}
						onOpenReference={onReference}
						stepNumbers={contextNumbers}
						onEditorReady={onCodeEditor}
					/>
				) : (
					<StepDiff
						workspaceId={active.workspaceId}
						reviewDraftId={
							data.aiDraft?.commitSha === data.details.headCommitOid &&
							["ready", "queued", "in_progress"].includes(data.aiDraft.status)
								? data.aiDraft.id
								: undefined
						}
						prCtx={active.prCtx}
						details={data.details}
						threads={data.allThreads}
						fileOrder={nav.fileOrder}
						sessionKey={data.sessionKey}
						callbacks={callbacks}
						filePath={selected.path}
						readOnly={!data.isOpen}
						focus={step?.focus}
						renderThread={renderThread}
						onSelection={nav.setSelection}
						onAsk={(anchor) => nav.ask(anchor)}
						onDefinition={onReference}
						onEditorReady={onDiffEditor}
						commentRequest={nav.commentRequest}
						onCommentRequestHandled={() => nav.setCommentRequest(undefined)}
						onComposerOpenChange={nav.setComposerOpen}
						cancelCommentNonce={nav.cancelCommentNonce}
						header={
							<StepHeader
								filePath={selected.path}
								label={stepLabel(path, selected, nav.mode)}
								additions={file?.additions}
								deletions={file?.deletions}
								viewed={viewed.has(selected.path)}
								viewedPending={viewedPending}
								onViewedChange={
									active.prCtx.provider === "github" ? () => toggleViewed(selected.path) : undefined
								}
								onPrevious={previous}
								onNext={next}
								note={step?.note}
								alsoIn={step?.alsoIn?.map(
									(id) => path?.entries.find((entry) => entry.id === id)?.title ?? id
								)}
								detail={step?.detail}
								tests={step?.kind === "changed" ? step.tests : undefined}
								onOpenFile={(path) => onReference({ path, line: 1, description: "Tested by" })}
							/>
						}
					/>
				)}
			</div>
			<HintBar
				context={!!context}
				hasThreads={data.allThreads.some((thread) => thread.path === selected?.path)}
				showViewed={active.prCtx.provider === "github" && !!selected?.changed}
			/>
		</>
	);
}
