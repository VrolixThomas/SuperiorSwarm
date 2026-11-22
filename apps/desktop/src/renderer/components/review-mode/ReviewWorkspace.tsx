import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitHubPRFile } from "../../../shared/github-types";
import type { CodeReference } from "../../../shared/review-path-types";
import { railItems, selectableRailItems } from "../../lib/review-path-model";
import type { useReviewModeStore } from "../../stores/review-mode-store";
import { trpc } from "../../trpc/client";
import { ReviewReadingPane } from "./ReviewReadingPane";
import {
	ReviewUIProvider,
	reviewUIScopeKey,
	useReviewUIApi,
	useReviewUIStore,
} from "./ReviewUIContext";
import { ReviewWorkflowBar } from "./ReviewWorkflowBar";
import { ReviewWorkspaceTopBar } from "./ReviewWorkspaceTopBar";
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
export interface ReviewWorkspaceProps {
	active: ActiveReview;
	fixture?: boolean;
	tabMode?: boolean;
	isActive?: boolean;
	paneId?: string;
	job?: import("../../../shared/review-agent-job").ReviewAgentJob;
}
export function ReviewWorkspace(props: ReviewWorkspaceProps) {
	const key = reviewUIScopeKey(props.active);
	return (
		<ReviewUIProvider scopeKey={props.tabMode ? key : null} active={props.isActive ?? true}>
			<ReviewWorkspaceContent {...props} />
		</ReviewUIProvider>
	);
}
function ReviewWorkspaceContent({
	active,
	fixture = false,
	tabMode = false,
	isActive = true,
	paneId,
	job,
}: ReviewWorkspaceProps) {
	const ui = useReviewUIApi();
	const { workspaceId, prCtx } = active;
	const data = useReviewWorkspaceData(workspaceId, prCtx, { manageFileOrder: false });
	const {
		source,
		askAgent,
		reviewer,
		attachmentError,
		openTerminal,
		job: connectionJob,
	} = useReviewConnections(workspaceId, prCtx, data.details, fixture);
	const queue = useReviewQueue(prCtx);
	const panel = useReviewUIStore((s) => s.panel);
	const findingsRequest = useReviewUIStore((s) => s.findingsRequest);
	const [findingsMessage, setFindingsMessage] = useState<string>();
	const [readyFindingsRequest, setReadyFindingsRequest] = useState<number>();
	const commentFilter = useReviewUIStore((s) => s.commentFilter);
	const queueOpen = useReviewUIStore((s) => s.queueOpen);
	const askAnchor = useReviewUIStore((s) => s.askAnchor);
	const collapsed = useReviewUIStore((s) => s.navigatorCollapsed);
	const view = useReviewUIStore((s) => s.view);
	const root = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(1512);
	const [mobileNavigator, setMobileNavigator] = useState(false);
	useEffect(() => {
		if (!tabMode || !root.current || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w) setWidth(w);
		});
		observer.observe(root.current);
		return () => observer.disconnect();
	}, [tabMode]);
	const compact = tabMode && width < 960;
	const narrow = tabMode && width < 720;
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
	useEffect(() => {
		const head = data.details?.headCommitOid;
		const previous = ui.getState().observedHeadSha;
		if (head && previous && previous !== head) {
			nav.resetAnchors();
			reveal.current = null;
		}
		if (head && head !== previous) ui.setState({ observedHeadSha: head });
	}, [data.details?.headCommitOid, nav.resetAnchors, ui]);

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
	const beginReading = (mode: "path" | "files") => {
		const ordered = selectableRailItems(railItems(source.path, files, mode));
		const target = ordered.find((item) => item.path === nav.selectedPath) ?? ordered[0];
		nav.changeMode(mode);
		if (target) nav.select(target);
	};
	const currentFindings = useMemo(
		() =>
			data.allThreads.filter(
				(thread) =>
					thread.isAIDraft &&
					!thread.isOutdated &&
					(thread.status === "pending" ||
						thread.status === "user-pending" ||
						thread.status === "approved" ||
						thread.status === "edited")
			),
		[data.allThreads]
	);
	const openFindings = useCallback(() => {
		const target =
			currentFindings.find((thread) => thread.isAIDraft && thread.status === "pending") ??
			currentFindings[0];
		ui.getState().setPanel(null);
		if (target) {
			setFindingsMessage(undefined);
			openThread(target);
		} else {
			ui.getState().setOverviewOpen(true);
			setFindingsMessage("No agent findings for this revision.");
		}
	}, [currentFindings, openThread, ui]);
	useEffect(() => {
		if (!findingsRequest || !isActive) return;
		let current = true;
		ui.getState().setPanel(null);
		setFindingsMessage("Loading agent findings…");
		void (async () => {
			try {
				await utils.aiReview.getReviewDrafts.invalidate(undefined, undefined, {
					throwOnError: true,
				});
				await utils.aiReview.getReviewDraft.invalidate(undefined, undefined, {
					throwOnError: true,
				});
				if (current) setReadyFindingsRequest(findingsRequest.nonce);
			} catch {
				if (current) {
					ui.setState({ findingsRequest: null });
					setFindingsMessage("Could not load agent findings. Refresh the PR and try again.");
				}
			}
		})();
		return () => {
			current = false;
		};
	}, [findingsRequest, isActive, utils, ui]);
	useEffect(() => {
		if (
			!findingsRequest ||
			readyFindingsRequest !== findingsRequest.nonce ||
			!isActive ||
			data.isLoading ||
			data.findingsLoading
		)
			return;
		if (data.findingsError) {
			ui.setState({ findingsRequest: null });
			setFindingsMessage("Could not load agent findings. Refresh the PR and try again.");
			return;
		}
		ui.setState({ findingsRequest: null });
		if (!data.details || findingsRequest.headSha !== data.details.headCommitOid) {
			ui.getState().setPanel(null);
			ui.getState().setOverviewOpen(true);
			setFindingsMessage(
				data.details
					? "These findings belong to an older revision."
					: "PR details are unavailable. Refresh the PR to load its findings."
			);
			return;
		}
		openFindings();
	}, [
		findingsRequest,
		readyFindingsRequest,
		isActive,
		data.isLoading,
		data.findingsLoading,
		data.findingsError,
		data.details,
		ui,
		openFindings,
	]);
	useReviewKeymap({
		enabled: isActive,
		rootRef: tabMode ? root : undefined,
		paneId: tabMode ? paneId : undefined,
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
		if (isActive && !tabMode) root.current?.focus();
	}, [isActive, tabMode]);
	// Existing review links may request the retired Comments view; route them to the panel.
	useEffect(() => {
		if (view === "comments") {
			ui.getState().setPanel("threads");
			ui.getState().setView("changes");
		}
	}, [view, ui]);
	return (
		<div
			ref={root}
			tabIndex={-1}
			data-review-workspace
			className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text)] outline-none"
		>
			{!tabMode && (
				<ReviewWorkspaceTopBar prCtx={prCtx} data={data} queue={queue} onNextPR={nextPR} />
			)}
			{!tabMode && data.details && (
				<ReviewWorkflowBar
					source={source}
					compact={!nav.overviewOpen && !!nav.selected}
					readOnly={!data.isOpen}
					onBrowseFiles={() => beginReading("files")}
					onReadPath={() => beginReading("path")}
					onOpenAgent={openTerminal}
					onOpenFindings={openFindings}
					findingsCount={currentFindings.length}
				/>
			)}
			{findingsMessage && (
				<output className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2 text-[12px] text-[var(--text-secondary)]">
					{findingsMessage}
					<button
						type="button"
						aria-label="Dismiss findings message"
						onClick={() => setFindingsMessage(undefined)}
					>
						×
					</button>
				</output>
			)}
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
			{tabMode && (
				<div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-1.5 text-[12px]">
					{narrow && (
						<button
							type="button"
							aria-expanded={mobileNavigator}
							onClick={() => setMobileNavigator(!mobileNavigator)}
						>
							Files &amp; path
						</button>
					)}
					<button type="button" onClick={() => ui.getState().setOverviewOpen(true)}>
						Path summary
					</button>
					<button type="button" onClick={() => ui.getState().setPanel("threads")}>
						Threads · {data.counts.open}
					</button>
					<button type="button" onClick={() => nav.ask()}>
						Ask agent
					</button>
				</div>
			)}
			<div className="relative flex min-h-0 flex-1 overflow-hidden">
				{data.isLoading ? (
					<div className="w-[288px] shrink-0 bg-[var(--bg-surface)]" />
				) : (
					<ReviewRail
						job={job ?? connectionJob}
						source={source}
						files={files}
						threads={data.allThreads}
						viewed={viewed}
						selectedPath={nav.selectedPath}
						mode={nav.mode}
						onModeChange={nav.changeMode}
						onSelect={(item) => {
							nav.select(item);
							setMobileNavigator(false);
						}}
						collapsed={collapsed || (narrow && !mobileNavigator)}
						compact={compact}
						workspaceDesign={tabMode}
						onBrowseFiles={() => beginReading("files")}
						showViewed={prCtx.provider === "github"}
						showAgentControls={tabMode}
					/>
				)}
				<main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<ReviewReadingPane
						onOpenSession={connectionJob ? openTerminal : undefined}
						tabMode={tabMode}
						compact={compact}
						setupInContent={narrow}
						job={job ?? connectionJob}
						onOpenFindings={openFindings}
						findingsCount={currentFindings.length}
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
							active={isActive}
							compact={narrow}
							mode={panel}
							openCount={data.counts.open}
							onModeChange={(mode) => ui.getState().setPanel(mode)}
							onClose={() => ui.getState().setPanel(null)}
						>
							{panel === "threads" ? (
								<ThreadsTab
									threads={data.allThreads}
									path={source.path}
									currentUser={reviewer?.login ?? undefined}
									currentUserId={reviewer?.id}
									initialFilter={commentFilter === "resolved" ? "resolved" : "open"}
									onOpen={openThread}
									onAsk={(question) => nav.ask(undefined, question)}
								/>
							) : (
								<AskTab
									key={JSON.stringify([
										workspaceId,
										prCtx.provider,
										prCtx.owner,
										prCtx.repo,
										prCtx.number,
										data.details?.headCommitOid,
									])}
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
													ui.getState().setPanel(null);
												}
											: undefined
									}
								/>
							)}
						</SidePanel>
					)}
				</main>
			</div>
			{!tabMode && queueOpen && (
				<AllPRsDrawer
					queue={queue.queue}
					onRefresh={() => void queue.refresh()}
					currentKey={queue.currentKey}
					nextKey={queue.next?.key}
					onClose={() => ui.getState().setQueueOpen(false)}
					onSelect={async (pr) => {
						if (pr.key === queue.currentKey) {
							ui.getState().setQueueOpen(false);
							return;
						}
						if (await queue.openPR(pr)) ui.getState().setQueueOpen(false);
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
									changedFiles: files.length,
									viewed:
										prCtx.provider === "github"
											? {
													viewed: files.filter((file) => viewed.has(file.path)).length,
													total: files.length,
												}
											: undefined,
								},
							],
						])
					}
				/>
			)}
		</div>
	);
}
