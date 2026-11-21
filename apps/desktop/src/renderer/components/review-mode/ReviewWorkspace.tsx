import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GitHubPRFile } from "../../../shared/github-types";
import type { CodeReference } from "../../../shared/review-path-types";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { trpc } from "../../trpc/client";
import { ReviewReadingPane } from "./ReviewReadingPane";
import { ReviewWorkspaceTopBar } from "./ReviewWorkspaceTopBar";
import { TerminalDrawer } from "./TerminalDrawer";
import { useReadingNavigation } from "./hooks/useReadingNavigation";
import { useReadingThreads } from "./hooks/useReadingThreads";
import { useReviewConnections } from "./hooks/useReviewConnections";
import { useReviewKeymap } from "./hooks/useReviewKeymap";
import { AskTab } from "./panel/AskTab";
import { SidePanel } from "./panel/SidePanel";
import { ThreadsTab } from "./panel/ThreadsTab";
import { AllPRsDrawer } from "./queue/AllPRsDrawer";
import { useReviewQueue } from "./queue/useReviewQueue";
import { ReviewRail } from "./rail/ReviewRail";
import { useReviewWorkspaceData } from "./useReviewWorkspaceData";

export type ActiveReview = NonNullable<ReturnType<typeof useReviewModeStore.getState>["active"]>;
const EMPTY_FILES: GitHubPRFile[] = [];

/** Default review entry point. Fixture mode is available only to explicit test/demo callers. */
export function ReviewWorkspace({
	active,
	fixture = false,
}: { active: ActiveReview; fixture?: boolean }) {
	const { workspaceId, prCtx } = active;
	const data = useReviewWorkspaceData(workspaceId, prCtx, { manageFileOrder: false });
	const { source, askAgent, reviewer, attachmentError } = useReviewConnections(
		workspaceId,
		prCtx,
		data.details,
		fixture
	);
	const queue = useReviewQueue(prCtx);
	const panel = useReviewModeStore((s) => s.panel);
	const queueOpen = useReviewModeStore((s) => s.queueOpen);
	const askAnchor = useReviewModeStore((s) => s.askAnchor);
	const collapsed = useReviewModeStore((s) => s.navigatorCollapsed);
	const view = useReviewModeStore((s) => s.view);
	const terminal = useReviewModeStore((s) => s.terminals[workspaceId]);
	const root = useRef<HTMLDivElement>(null);
	const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const reveal = useRef<CodeReference | null>(null);
	const utils = trpc.useUtils();
	const viewedQuery = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ enabled: prCtx.provider === "github", staleTime: 30_000 }
	);
	const viewed = useMemo(
		() => new Set(prCtx.provider === "github" ? (viewedQuery.data ?? []) : []),
		[viewedQuery.data, prCtx.provider]
	);
	const markViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: () =>
			utils.github.getViewedFiles.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});
	const toggleViewed = useCallback(
		(filePath: string) => {
			if (
				prCtx.provider !== "github" ||
				markViewed.isPending ||
				!data.details?.files.some((file) => file.path === filePath)
			)
				return;
			markViewed.mutate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
				filePath,
				viewed: !viewed.has(filePath),
			});
		},
		[prCtx, markViewed, data.details, viewed]
	);
	const nextPR = useCallback(() => {
		if (queue.next) void queue.openPR(queue.next);
	}, [queue.next, queue.openPR]);
	const previousPR = useCallback(() => {
		if (queue.previous) void queue.openPR(queue.previous);
	}, [queue.previous, queue.openPR]);
	const files = data.details?.files ?? EMPTY_FILES;
	const nav = useReadingNavigation({
		source,
		files,
		filesReady: !!data.details,
		sessionKey: data.sessionKey,
		onClose: data.handleClose,
		onViewed: toggleViewed,
		onNextPR: nextPR,
		onPreviousPR: previousPR,
	});
	const previousHead = useRef(data.details?.headCommitOid);
	useEffect(() => {
		const head = data.details?.headCommitOid;
		if (head && previousHead.current && previousHead.current !== head) {
			nav.resetAnchors();
			reveal.current = null;
		}
		if (head) previousHead.current = head;
	}, [data.details?.headCommitOid, nav.resetAnchors]);
	const onReference = useCallback(
		(ref: CodeReference) => {
			reveal.current = ref;
			if (nav.selectedPath === ref.path) {
				editor.current?.revealLineInCenter(ref.line);
				editor.current?.setPosition({ lineNumber: ref.line, column: 1 });
			}
			nav.openReference(ref);
		},
		[nav.openReference, nav.selectedPath]
	);
	const onCodeEditor = useCallback(
		(next: monaco.editor.IStandaloneCodeEditor | null) => {
			editor.current = next;
			const target = reveal.current;
			if (next && target?.path === nav.selectedPath) {
				next.revealLineInCenter(target.line);
				next.setPosition({ lineNumber: target.line, column: 1 });
				reveal.current = null;
			}
		},
		[nav.selectedPath]
	);
	const onDiffEditor = useCallback(
		(next: monaco.editor.IStandaloneDiffEditor | null) =>
			onCodeEditor(next?.getModifiedEditor() ?? null),
		[onCodeEditor]
	);
	const { openThread, callbacks, renderThread } = useReadingThreads(data, nav, source, onReference);
	useReviewKeymap({
		workspaceId,
		prCtx,
		sessionKey: data.sessionKey,
		view: view === "terminal" ? "terminal" : "changes",
		allThreads: data.allThreads,
		fileOrder: nav.fileOrder,
		callbacks,
		readOnly: !data.isOpen || !nav.selected?.changed,
		layout: "path",
		onAction: (action) => (data.submitOpen ? true : nav.onAction(action)),
		onClose: data.handleClose,
	});
	useEffect(() => {
		root.current?.focus();
	}, []);
	// Existing review links may request the retired Comments view; route them to the panel.
	useEffect(() => {
		if (view === "comments") {
			useReviewModeStore.getState().setPanel("threads");
			useReviewModeStore.getState().setView("changes");
		}
	}, [view]);
	const openTerminal = terminal
		? () => useReviewModeStore.getState().setDrawerOpen(true)
		: undefined;
	return (
		<div
			ref={root}
			tabIndex={-1}
			data-review-workspace
			className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text)] outline-none"
		>
			<ReviewWorkspaceTopBar
				prCtx={prCtx}
				data={data}
				source={source}
				queue={queue}
				onNextPR={nextPR}
				openTerminal={openTerminal}
			/>
			{attachmentError && (
				<div role="alert" className="px-4 py-2 text-[12px] text-[var(--color-danger)]">
					{attachmentError}
				</div>
			)}
			{queue.error && !queueOpen && (
				<div role="alert" className="shrink-0 px-4 py-2 text-[12px] text-[var(--color-danger)]">
					{queue.error}
				</div>
			)}
			{data.details && data.details.state !== "OPEN" && (
				<div className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-2 text-[12px] text-[var(--text-secondary)]">
					This pull request is {data.details.state.toLowerCase()}. Comments and findings are
					read-only.
				</div>
			)}
			<div className="relative flex min-h-0 flex-1 overflow-hidden">
				{data.isLoading ? (
					<div className="w-[288px] shrink-0 bg-[var(--bg-surface)]" />
				) : (
					<ReviewRail
						source={source}
						files={files}
						threads={data.allThreads}
						viewed={viewed}
						selectedPath={nav.selectedPath}
						mode={nav.mode}
						onModeChange={nav.changeMode}
						onSelect={nav.select}
						collapsed={collapsed}
						showViewed={prCtx.provider === "github"}
					/>
				)}
				<main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<ReviewReadingPane
						active={active}
						data={data}
						source={source}
						nav={nav}
						callbacks={callbacks}
						renderThread={renderThread}
						viewed={viewed}
						viewedPending={markViewed.isPending}
						toggleViewed={toggleViewed}
						onReference={onReference}
						onDiffEditor={onDiffEditor}
						onCodeEditor={onCodeEditor}
					/>
					{panel && (
						<SidePanel
							mode={panel}
							openCount={data.counts.open}
							onModeChange={(mode) => useReviewModeStore.getState().setPanel(mode)}
							onClose={() => useReviewModeStore.getState().setPanel(null)}
						>
							{panel === "threads" ? (
								<ThreadsTab
									threads={data.allThreads}
									path={source.path}
									currentUser={reviewer?.login ?? undefined}
									currentUserId={reviewer?.id}
									onOpen={openThread}
									onAsk={(question) => nav.ask(undefined, question)}
								/>
							) : (
								<AskTab
									messages={askAgent.messages}
									anchor={askAnchor}
									available={askAgent.available}
									error={askAgent.error}
									pending={askAgent.status === "pending"}
									questions={askAgent.questions}
									onCancelQuestion={askAgent.cancel}
									initialQuestion={nav.question}
									onSend={askAgent.send}
									onReference={onReference}
									onAddComment={
										data.isOpen
											? (body, anchor) => {
													nav.openReference({
														path: anchor.path,
														line: anchor.endLine,
														description: "Answer comment",
													});
													nav.setCommentRequest({ id: crypto.randomUUID(), anchor, body });
													useReviewModeStore.getState().setPanel(null);
												}
											: undefined
									}
								/>
							)}
						</SidePanel>
					)}
				</main>
			</div>
			<TerminalDrawer />
			{queueOpen && (
				<AllPRsDrawer
					queue={queue.queue}
					currentKey={queue.currentKey}
					nextKey={queue.next?.key}
					onClose={() => useReviewModeStore.getState().setQueueOpen(false)}
					onSelect={async (pr) => {
						if (await queue.openPR(pr)) useReviewModeStore.getState().setQueueOpen(false);
					}}
					openingKey={queue.openingKey}
					error={queue.error}
					isLoading={queue.isLoading}
					factsByKey={
						new Map([
							[
								queue.currentKey,
								{
									pathStatus: source.status,
									viewed: {
										viewed: files.filter((file) => viewed.has(file.path)).length,
										total: files.length,
									},
								},
							],
						])
					}
				/>
			)}
		</div>
	);
}
