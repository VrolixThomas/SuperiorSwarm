import {
	type FormEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import {
	type HermesSelectionGeneration,
	HermesSelectionGuard,
} from "../../hermes/hermes-binding-lifecycle";
import { isHermesChatNearBottom, shouldAnchorHermesChat } from "../../hermes/hermes-chat-scroll";
import {
	HERMES_CHAT_OVERFLOW_CLASSES,
	applyHermesEvent,
	createHermesLiveState,
	hermesComposerContainsFiles,
	hermesComposerTextareaLayout,
	hermesOriginActionAvailability,
	hermesReportRequiresExplicitRetry,
	latestReportableHermesMessage,
	projectHermesLiveActivity,
	projectHermesLiveCompletions,
	projectHermesTranscript,
	reduceHermesComposerAttachments,
} from "../../hermes/hermes-view-model";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { HermesComposerAttachments } from "./HermesComposerAttachments";
import { HermesApprovalCard, HermesClarificationChoices } from "./HermesInteractionCards";
import { HermesActivityGroup, HermesTranscript } from "./HermesTranscript";

function scrollToLatest(element: HTMLDivElement, smooth: boolean): void {
	element.scrollTo({
		top: element.scrollHeight,
		behavior:
			smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto",
	});
}

export function HermesSessionView() {
	const selection = useTabStore((state) => state.selectedHermesSession);
	const sessionId = selection?.sessionId ?? null;
	const connectionId = selection?.connectionId ?? "";
	const openWorkspaceFromHermes = useTabStore((state) => state.openWorkspaceFromHermes);
	const [composer, setComposer] = useState("");
	const [clarification, setClarification] = useState("");
	const [cursor, setCursor] = useState(0);
	const [live, setLive] = useState(createHermesLiveState);
	const [attachments, dispatchAttachments] = useReducer(reduceHermesComposerAttachments, []);
	const [manualWorkspaceId, setManualWorkspaceId] = useState("");
	const [manualOriginUrl, setManualOriginUrl] = useState("");
	const [showReportPreview, setShowReportPreview] = useState(false);
	const [attachmentLimitError, setAttachmentLimitError] = useState<string | null>(null);
	const [showJumpToLatest, setShowJumpToLatest] = useState(false);
	const processedEventSeq = useRef(0);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	const followingTranscript = useRef(true);
	const anchoredSelectionKey = useRef<string | null>(null);
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const utils = trpc.useUtils();

	const submit = trpc.hermes.submit.useMutation();
	const interrupt = trpc.hermes.interrupt.useMutation();
	const approval = trpc.hermes.respondApproval.useMutation();
	const clarify = trpc.hermes.respondClarification.useMutation();
	const pickAttachments = trpc.hermes.pickAttachments.useMutation({
		onSuccess: (selected) => {
			const existing = new Set(attachmentsRef.current.map((attachment) => attachment.handle));
			const unique = selected.filter((attachment) => !existing.has(attachment.handle));
			const available = Math.max(0, 10 - attachmentsRef.current.length);
			const accepted = unique.slice(0, available);
			const rejected = unique.slice(available);
			if (accepted.length > 0) {
				dispatchAttachments({ type: "add", attachments: accepted });
			}
			for (const attachment of rejected) {
				releaseAttachment.mutate({ handle: attachment.handle });
			}
			setAttachmentLimitError(rejected.length > 0 ? "Attach up to 10 files to one message." : null);
		},
	});
	const releaseAttachment = trpc.hermes.releaseAttachment.useMutation();
	const releaseAttachmentRef = useRef(releaseAttachment.mutate);
	releaseAttachmentRef.current = releaseAttachment.mutate;
	const attachmentRemovalDisabled =
		pickAttachments.isPending ||
		submit.isPending ||
		attachments.some((attachment) => attachment.status === "attaching");

	const selectionKey = `${connectionId}:${sessionId ?? ""}`;
	const previousSelectionKey = useRef(selectionKey);
	const selectionGuardRef = useRef<HermesSelectionGuard | null>(null);
	if (!selectionGuardRef.current) selectionGuardRef.current = new HermesSelectionGuard();
	const selectionGuard = selectionGuardRef.current;
	const selectionGeneration = selectionGuard.select(selectionKey);

	const connections = trpc.hermes.connections.useQuery();
	const status = trpc.hermes.status.useQuery(
		{ connectionId },
		{ enabled: Boolean(connectionId), refetchInterval: 1_000 }
	);
	const connected = status.data?.status === "connected";
	const catalog = trpc.hermes.catalog.useQuery(
		{ connectionId },
		{ enabled: Boolean(connectionId) && connected }
	);
	const session = catalog.data?.sessions.find((candidate) => candidate.id === sessionId);

	useEffect(() => {
		selectionGuard.activate();
		return () => selectionGuard.dispose();
	}, [selectionGuard]);

	useEffect(
		() => () => {
			for (const attachment of attachmentsRef.current) {
				releaseAttachmentRef.current({ handle: attachment.handle });
			}
		},
		[]
	);

	useEffect(() => {
		if (!selection || !connections.data) return;
		if (connections.data.some((candidate) => candidate.id === selection.connectionId)) return;
		useTabStore.getState().selectHermesSession(null);
	}, [connections.data, selection]);

	useEffect(() => {
		if (previousSelectionKey.current === selectionKey) return;
		previousSelectionKey.current = selectionKey;
		for (const attachment of attachmentsRef.current) {
			releaseAttachmentRef.current({ handle: attachment.handle });
		}
		dispatchAttachments({ type: "succeeded" });
		setCursor(0);
		processedEventSeq.current = 0;
		setLive(createHermesLiveState());
		setComposer("");
		setClarification("");
		setManualWorkspaceId("");
		setManualOriginUrl("");
		setShowReportPreview(false);
		setAttachmentLimitError(null);
		setShowJumpToLatest(false);
		followingTranscript.current = true;
		anchoredSelectionKey.current = null;
	}, [selectionKey]);

	const history = trpc.hermes.history.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{
			enabled: Boolean(connectionId && sessionId && connected),
			staleTime: 1_000,
		}
	);
	const canonicalMessages = useMemo(() => history.data?.messages ?? [], [history.data?.messages]);
	const eventFeed = trpc.hermes.events.useQuery(
		{ connectionId, afterSeq: cursor },
		{ enabled: Boolean(connectionId && sessionId && connected), refetchInterval: 400 }
	);

	useEffect(() => {
		const feed = eventFeed.data;
		if (
			!feed ||
			!sessionId ||
			!selectionGuard.isCurrent(selectionGeneration) ||
			feed.nextSeq <= processedEventSeq.current
		) {
			return;
		}
		processedEventSeq.current = feed.nextSeq;
		let refreshHistory = false;
		const relevantEvents = feed.events.flatMap((entry) => {
			const event = entry.event;
			if (event.type === "runtime.history-refresh-required") {
				if (event.durableSessionId === null || event.durableSessionId === sessionId) {
					refreshHistory = true;
					return [event];
				}
				return [];
			}
			return event.durableSessionId === sessionId ? [event] : [];
		});
		setLive((current) => {
			let next = current;
			for (const event of relevantEvents) {
				next = applyHermesEvent(next, event, sessionId, canonicalMessages);
				if (event.type === "message.complete") refreshHistory = true;
			}
			return next;
		});
		setCursor(feed.nextSeq);
		if (refreshHistory) {
			void utils.hermes.history.invalidate({ connectionId, hermesSessionId: sessionId });
			void utils.hermes.catalog.invalidate({ connectionId });
			void utils.hermes.workspaceLinks.invalidate();
		}
	}, [
		canonicalMessages,
		connectionId,
		eventFeed.data,
		selectionGeneration,
		selectionGuard,
		sessionId,
		utils,
	]);

	const links = trpc.hermes.workspaceLinks.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && sessionId), refetchInterval: connected ? 2_000 : false }
	);
	const availableWorkspaces = trpc.hermes.availableWorkspaces.useQuery();
	const linkWorkspace = trpc.hermes.linkWorkspace.useMutation();
	const unlinkWorkspace = trpc.hermes.unlinkWorkspace.useMutation();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const isSlackSession = session?.source.toLowerCase() === "slack";
	const origin = trpc.hermes.origin.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && sessionId && connected) }
	);
	const openOrigin = trpc.hermes.openOrigin.useMutation();
	const saveOriginLink = trpc.hermes.saveOriginLink.useMutation();
	const originActions = hermesOriginActionAvailability(origin.data);
	const reports = trpc.hermes.reports.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && sessionId && isSlackSession && connected) }
	);
	const report = trpc.hermes.reportToOrigin.useMutation();
	const transcriptItems = useMemo(
		() => projectHermesTranscript(canonicalMessages),
		[canonicalMessages]
	);
	const liveCompletions = useMemo(
		() => projectHermesLiveCompletions(canonicalMessages, live.completed),
		[canonicalMessages, live.completed]
	);
	const liveActivity = useMemo(
		() => projectHermesLiveActivity(live, canonicalMessages),
		[live, canonicalMessages]
	);
	const reportable = useMemo(
		() => latestReportableHermesMessage(canonicalMessages),
		[canonicalMessages]
	);
	const reportState = reportable
		? report.data?.connectionId === connectionId &&
			report.data.hermesSessionId === sessionId &&
			report.data.messageId === reportable.id
			? report.data
			: reports.data?.find((candidate) => candidate.messageId === reportable.id)
		: null;
	const visibleOrigin = origin.data ?? session?.origin;
	const visibleOriginLabels = [
		visibleOrigin?.workspaceLabel,
		visibleOrigin?.accountLabel,
		visibleOrigin?.channelLabel,
		visibleOrigin?.chatLabel,
		visibleOrigin?.threadLabel,
		visibleOrigin?.displayLabel,
	].filter(
		(label, index, labels): label is string => Boolean(label) && labels.indexOf(label) === index
	);

	function runForSelection(generation: HermesSelectionGeneration, callback: () => void): void {
		selectionGuard.runIfCurrent(generation, callback);
	}

	function send(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (
			(!composer.trim() && attachments.length === 0) ||
			!sessionId ||
			!connected ||
			live.running ||
			submit.isPending
		) {
			return;
		}
		const generation = selectionGeneration;
		dispatchAttachments({ type: "submitting" });
		submit.mutate(
			{
				connectionId,
				hermesSessionId: sessionId,
				text: composer.trim(),
				attachmentHandles: attachments.map((attachment) => attachment.handle),
			},
			{
				onSuccess: () => {
					runForSelection(generation, () => {
						setComposer("");
						dispatchAttachments({ type: "succeeded" });
						setAttachmentLimitError(null);
						setLive((current) => ({
							...current,
							running: true,
							runtimeStatus: "submitting",
							streamingText: "",
							tools: [],
							error: null,
						}));
					});
				},
				onError: (error) => {
					runForSelection(generation, () => {
						dispatchAttachments({ type: "failed", error: error.message });
					});
				},
			}
		);
	}

	useLayoutEffect(() => {
		const textarea = composerRef.current;
		if (!textarea || textarea.value !== composer) return;
		textarea.style.height = "0px";
		const layout = hermesComposerTextareaLayout(textarea.scrollHeight);
		textarea.style.height = `${layout.height}px`;
		textarea.style.overflowY = layout.overflowY;
	}, [composer]);

	useLayoutEffect(() => {
		const transcript = transcriptRef.current;
		if (!transcript || !history.data || history.isLoading) return;
		const initialHistory = anchoredSelectionKey.current !== selectionKey;
		if (shouldAnchorHermesChat({ initialHistory, following: followingTranscript.current })) {
			transcript.scrollTop = transcript.scrollHeight;
			followingTranscript.current = true;
			setShowJumpToLatest(false);
		}
		if (initialHistory) anchoredSelectionKey.current = selectionKey;
	});

	if (!sessionId) {
		return (
			<main
				className={`flex h-full items-center justify-center ${HERMES_CHAT_OVERFLOW_CLASSES.ancestor}`}
			>
				<div className="max-w-[360px] px-6 text-center">
					<div className="text-[14px] font-medium text-[var(--text-secondary)]">
						Select an agent thread
					</div>
					<div className="mt-1 text-[12px] leading-5 text-[var(--text-quaternary)]">
						Agent threads from local or messaging surfaces appear in the sidebar.
					</div>
				</div>
			</main>
		);
	}

	const visibleError =
		history.error?.message ??
		submit.error?.message ??
		interrupt.error?.message ??
		approval.error?.message ??
		clarify.error?.message ??
		pickAttachments.error?.message ??
		attachmentLimitError ??
		report.error?.message ??
		live.error;

	return (
		<main
			className={`flex h-full flex-col bg-[var(--bg-base)] ${HERMES_CHAT_OVERFLOW_CLASSES.ancestor}`}
		>
			<header className="app-drag relative z-20 flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 sm:px-5">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[14px] font-medium tracking-[-0.01em] text-[var(--text)]">
						{session?.title ?? "New agent session"}
					</div>
					<div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-[var(--text-quaternary)]">
						<span className="shrink-0 capitalize">
							{visibleOrigin?.platform ?? session?.source}
						</span>
						{visibleOriginLabels[0] && (
							<>
								<span aria-hidden="true">·</span>
								<span className="truncate">{visibleOriginLabels[0]}</span>
							</>
						)}
						{links.data && links.data.length > 0 && (
							<>
								<span aria-hidden="true">·</span>
								<span className="shrink-0">
									{links.data.length} workspace{links.data.length === 1 ? "" : "s"}
								</span>
							</>
						)}
						{live.runtimeStatus && (
							<>
								<span aria-hidden="true">·</span>
								<span className="shrink-0 capitalize">{live.runtimeStatus}</span>
							</>
						)}
					</div>
				</div>

				<details className="app-no-drag group relative shrink-0">
					<summary
						aria-label="Session options"
						className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full text-[17px] tracking-[2px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 [&::-webkit-details-marker]:hidden"
					>
						•••
					</summary>
					<div className="absolute right-0 top-10 z-30 max-h-[calc(100vh-88px)] w-[min(360px,calc(100vw-32px))] min-w-0 overflow-x-hidden overflow-y-auto rounded-[14px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]">
						<div className="mb-3 text-[11px] font-medium text-[var(--text-secondary)]">
							Session options
						</div>

						{isSlackSession && (
							<section className="mb-3 min-w-0 border-b border-[var(--border-subtle)] pb-3">
								<div className="mb-1 text-[10px] font-medium text-[var(--text-tertiary)]">
									Origin
								</div>
								<p className="mb-2 text-[10px] leading-4 text-[var(--text-quaternary)]">
									Slack remains live. Continue sequentially to avoid overlapping turns.
								</p>
								{originActions.canOpenOrigin ? (
									<button
										type="button"
										onClick={() => openOrigin.mutate({ connectionId, hermesSessionId: sessionId })}
										className="rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]"
									>
										Open Slack thread
									</button>
								) : (
									<form
										onSubmit={(event) => {
											event.preventDefault();
											if (!manualOriginUrl.trim()) return;
											saveOriginLink.mutate(
												{
													connectionId,
													hermesSessionId: sessionId,
													openUrl: manualOriginUrl.trim(),
												},
												{
													onSuccess: () => {
														setManualOriginUrl("");
														void utils.hermes.origin.invalidate({
															connectionId,
															hermesSessionId: sessionId,
														});
													},
												}
											);
										}}
										className="flex min-w-0 gap-1.5"
									>
										<input
											value={manualOriginUrl}
											onChange={(event) => setManualOriginUrl(event.target.value)}
											placeholder="Trusted Slack thread URL"
											aria-label="Trusted Slack thread URL"
											className="min-w-0 flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[10px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
										/>
										<button
											type="submit"
											disabled={!manualOriginUrl.trim() || saveOriginLink.isPending}
											className="shrink-0 rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] disabled:opacity-40"
										>
											Save
										</button>
									</form>
								)}
							</section>
						)}

						<section className="mb-3 min-w-0 border-b border-[var(--border-subtle)] pb-3">
							<div className="mb-1.5 text-[10px] font-medium text-[var(--text-tertiary)]">
								Linked workspaces
							</div>
							<div className="mb-2 flex min-w-0 flex-col gap-1">
								{links.data?.map((link) => (
									<div
										key={link.id}
										className="flex min-w-0 items-center gap-1 rounded-[6px] bg-[var(--bg-base)]/50 px-2 py-1"
									>
										<button
											type="button"
											disabled={link.missing || !link.worktreePath}
											onClick={() => {
												if (!link.worktreePath) return;
												openWorkspaceFromHermes(link.workspaceId, link.worktreePath, {
													connectionId,
													sessionId,
												});
												const tabs = useTabStore.getState().getTabsByWorkspace(link.workspaceId);
												if (!tabs.some((tab) => tab.kind === "terminal")) {
													const tabId = useTabStore
														.getState()
														.addTerminalTab(
															link.workspaceId,
															link.worktreePath,
															link.branch ?? "Hermes"
														);
													attachTerminal.mutate({
														workspaceId: link.workspaceId,
														terminalId: tabId,
													});
												}
											}}
											className="min-w-0 flex-1 truncate text-left text-[10px] text-[var(--text-secondary)] disabled:text-[var(--danger)]"
										>
											{link.missing
												? `Missing: ${link.workspaceId}`
												: `${link.projectName ?? "Project"} · ${link.branch ?? link.workspaceName}`}
										</button>
										<button
											type="button"
											aria-label="Unlink workspace"
											onClick={() => {
												const generation = selectionGeneration;
												unlinkWorkspace.mutate(
													{
														connectionId,
														hermesSessionId: sessionId,
														workspaceId: link.workspaceId,
													},
													{
														onSuccess: () => {
															runForSelection(generation, () => {
																void utils.hermes.workspaceLinks.invalidate();
																void utils.hermes.workspaceLinkIndex.invalidate();
															});
														},
													}
												);
											}}
											className="flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--danger)]"
										>
											×
										</button>
									</div>
								))}
								{links.data?.length === 0 && (
									<div className="text-[10px] text-[var(--text-quaternary)]">
										No linked workspace
									</div>
								)}
							</div>
							<div className="flex min-w-0 gap-1.5">
								<select
									value={manualWorkspaceId}
									onChange={(event) => setManualWorkspaceId(event.target.value)}
									aria-label="Link a recovery workspace"
									className="w-0 min-w-0 max-w-full flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
								>
									<option value="">Link a recovery workspace…</option>
									{availableWorkspaces.data?.map((workspace) => (
										<option key={workspace.id} value={workspace.id}>
											{workspace.projectName} · {workspace.branch ?? workspace.name}
										</option>
									))}
								</select>
								<button
									type="button"
									disabled={!manualWorkspaceId}
									onClick={() => {
										const generation = selectionGeneration;
										linkWorkspace.mutate(
											{
												connectionId,
												hermesSessionId: sessionId,
												workspaceId: manualWorkspaceId,
												lineageRootId: null,
											},
											{
												onSuccess: () => {
													runForSelection(generation, () => {
														setManualWorkspaceId("");
														void utils.hermes.workspaceLinks.invalidate();
														void utils.hermes.workspaceLinkIndex.invalidate();
													});
												},
											}
										);
									}}
									className="shrink-0 rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] disabled:opacity-40"
								>
									Link
								</button>
							</div>
						</section>

						{isSlackSession && originActions.canReportToOrigin && reportable && (
							<section className="min-w-0">
								<div className="mb-1.5 text-[10px] font-medium text-[var(--text-tertiary)]">
									Report to origin
								</div>
								{showReportPreview ? (
									<div className="min-w-0">
										<div className="max-h-32 min-w-0 overflow-x-hidden overflow-y-auto whitespace-pre-wrap rounded-[6px] bg-[var(--bg-base)] p-2 text-[10px] leading-4 text-[var(--text-secondary)] [overflow-wrap:anywhere]">
											{reportable.text}
										</div>
										<div className="mt-2 flex flex-wrap items-center gap-1.5">
											<button
												type="button"
												disabled={report.isPending || reportState?.status === "sent"}
												onClick={() => {
													const generation = selectionGeneration;
													report.mutate(
														{
															connectionId,
															hermesSessionId: sessionId,
															messageId: reportable.id,
															explicitRetry: hermesReportRequiresExplicitRetry(reportState),
														},
														{
															onSettled: () => {
																runForSelection(generation, () => {
																	void utils.hermes.reports.invalidate();
																});
															},
														}
													);
												}}
												className="rounded-[6px] bg-[var(--accent)] px-2 py-1 text-[10px] text-white disabled:opacity-40"
											>
												{report.isPending
													? "Sending…"
													: hermesReportRequiresExplicitRetry(reportState)
														? "Confirm retry to Slack"
														: "Confirm send to Slack"}
											</button>
											<button
												type="button"
												onClick={() => setShowReportPreview(false)}
												className="px-2 py-1 text-[10px] text-[var(--text-quaternary)]"
											>
												Cancel
											</button>
										</div>
										{reportState && (
											<div className="mt-1 text-[9px] text-[var(--text-quaternary)]">
												Status: {reportState.status}
											</div>
										)}
									</div>
								) : (
									<button
										type="button"
										onClick={() => setShowReportPreview(true)}
										className="rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
									>
										Preview Slack update
									</button>
								)}
							</section>
						)}
					</div>
				</details>
			</header>

			{visibleError && (
				<div className="shrink-0 border-b border-[var(--danger)]/15 bg-[var(--danger-subtle)] px-4 py-1.5 text-[11px] text-[var(--danger)] [overflow-wrap:anywhere]">
					{visibleError}
				</div>
			)}

			<div
				ref={transcriptRef}
				onScroll={(event) => {
					const following = isHermesChatNearBottom(event.currentTarget);
					followingTranscript.current = following;
					setShowJumpToLatest(!following);
				}}
				className={`${HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner} flex-1 px-4 py-6 sm:px-6 sm:py-7 xl:px-8`}
			>
				<div className={`${HERMES_CHAT_OVERFLOW_CLASSES.canvas} pb-6`}>
					{history.isLoading && (
						<div className="py-8 text-center text-[12px] text-[var(--text-quaternary)]">
							Loading canonical Hermes history…
						</div>
					)}
					<HermesTranscript items={transcriptItems} />
					{liveActivity && (
						<div className="mt-7 min-w-0">
							<HermesActivityGroup activity={liveActivity} />
						</div>
					)}
					{liveCompletions.length > 0 && (
						<div className="mt-7 min-w-0">
							<HermesTranscript items={liveCompletions} />
						</div>
					)}
					{live.streamingText.trim() && (
						<div
							className={`mt-7 max-w-[66ch] whitespace-pre-wrap text-[15px] leading-[22px] text-[var(--text-secondary)] ${HERMES_CHAT_OVERFLOW_CLASSES.arbitraryContent}`}
							aria-live="polite"
						>
							{live.streamingText}
						</div>
					)}
				</div>
			</div>

			<div className="relative z-10 min-w-0 shrink-0 bg-gradient-to-t from-[var(--bg-base)] via-[var(--bg-base)] to-transparent px-4 pb-4 pt-2 sm:px-6 sm:pb-5 xl:px-8">
				{showJumpToLatest && (
					<div className="pointer-events-none absolute -top-9 left-0 right-0 flex justify-center">
						<button
							type="button"
							onClick={() => {
								const transcript = transcriptRef.current;
								if (!transcript) return;
								scrollToLatest(transcript, true);
								followingTranscript.current = true;
								setShowJumpToLatest(false);
							}}
							className="pointer-events-auto rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[10px] font-medium text-[var(--text-secondary)] shadow-[var(--shadow-md)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
						>
							Jump to latest ↓
						</button>
					</div>
				)}

				<div className={`${HERMES_CHAT_OVERFLOW_CLASSES.canvas}`}>
					{live.pendingApproval && (
						<HermesApprovalCard
							interaction={live.pendingApproval}
							pending={approval.isPending}
							onChoose={(choice) => {
								const generation = selectionGeneration;
								approval.mutate(
									{
										connectionId,
										hermesSessionId: sessionId,
										requestId: live.pendingApproval?.requestId ?? "",
										choice,
									},
									{
										onSuccess: () => {
											runForSelection(generation, () => {
												setLive((current) => ({ ...current, pendingApproval: null }));
											});
										},
									}
								);
							}}
						/>
					)}

					{live.pendingClarification && (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const generation = selectionGeneration;
								clarify.mutate(
									{
										connectionId,
										hermesSessionId: sessionId,
										requestId: live.pendingClarification?.requestId ?? "",
										answer: clarification,
									},
									{
										onSuccess: () => {
											runForSelection(generation, () => {
												setClarification("");
												setLive((current) => ({
													...current,
													pendingClarification: null,
												}));
											});
										},
									}
								);
							}}
							className="mb-2 min-w-0 rounded-[12px] border border-[var(--warning)]/25 bg-[var(--warning-subtle)] p-3"
						>
							<div className="mb-2 whitespace-pre-wrap text-[11px] leading-4 text-[var(--text-secondary)] [overflow-wrap:anywhere]">
								{live.pendingClarification.prompt}
							</div>
							<HermesClarificationChoices
								choices={live.pendingClarification.choices}
								pending={clarify.isPending}
								onChoose={(answer) => {
									const generation = selectionGeneration;
									clarify.mutate(
										{
											connectionId,
											hermesSessionId: sessionId,
											requestId: live.pendingClarification?.requestId ?? "",
											answer,
										},
										{
											onSuccess: () => {
												runForSelection(generation, () => {
													setClarification("");
													setLive((current) => ({
														...current,
														pendingClarification: null,
													}));
												});
											},
										}
									);
								}}
							/>
							<div className="flex min-w-0 gap-2">
								<input
									value={clarification}
									onChange={(event) => setClarification(event.target.value)}
									aria-label="Clarification answer"
									className="min-w-0 flex-1 rounded-[7px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
								/>
								<button
									type="submit"
									className="shrink-0 rounded-[7px] bg-[var(--accent)] px-3 py-1.5 text-[11px] text-white"
								>
									Answer
								</button>
							</div>
						</form>
					)}

					<form
						onSubmit={send}
						onDragOver={(event) => {
							event.preventDefault();
							if (hermesComposerContainsFiles(event.dataTransfer)) {
								event.dataTransfer.dropEffect = "none";
							}
						}}
						onDrop={(event) => {
							event.preventDefault();
							if (hermesComposerContainsFiles(event.dataTransfer)) {
								setAttachmentLimitError("Use the paperclip to attach files.");
							}
						}}
						className="min-w-0 rounded-[16px] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 shadow-[0_10px_32px_rgba(0,0,0,0.24)] focus-within:border-[var(--border-active)]"
					>
						<HermesComposerAttachments
							attachments={attachments}
							removalDisabled={attachmentRemovalDisabled}
							onRemove={(handle) => {
								if (attachmentRemovalDisabled) return;
								dispatchAttachments({ type: "remove", handle });
								releaseAttachment.mutate({ handle });
								setAttachmentLimitError(null);
							}}
						/>
						<div className={`flex items-end gap-1.5 ${attachments.length > 0 ? "mt-2" : ""}`}>
							<button
								type="button"
								onClick={() => pickAttachments.mutate()}
								disabled={
									!connected || live.running || submit.isPending || pickAttachments.isPending
								}
								aria-label="Attach files"
								title="Attach files"
								className="mb-[11px] flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 disabled:opacity-35"
							>
								<svg
									aria-hidden="true"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.5-8.5" />
								</svg>
							</button>
							<textarea
								ref={composerRef}
								value={composer}
								onChange={(event) => setComposer(event.target.value)}
								onPaste={(event) => {
									if (!hermesComposerContainsFiles(event.clipboardData)) return;
									event.preventDefault();
									setAttachmentLimitError("Use the paperclip to attach files.");
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
										event.preventDefault();
										event.currentTarget.form?.requestSubmit();
									}
								}}
								placeholder={connected ? "Continue this agent thread…" : "Reconnect to continue…"}
								disabled={!connected || live.running || submit.isPending}
								rows={1}
								aria-label="Message"
								className="min-h-14 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[17px] text-[14px] leading-[20px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)] disabled:opacity-50 [overflow-wrap:anywhere]"
							/>
							<button
								type={live.running ? "button" : "submit"}
								onClick={
									live.running
										? () => interrupt.mutate({ connectionId, hermesSessionId: sessionId })
										: undefined
								}
								disabled={
									live.running
										? interrupt.isPending
										: (!composer.trim() && attachments.length === 0) ||
											!connected ||
											submit.isPending
								}
								aria-label={live.running ? "Stop response" : "Send message"}
								title={live.running ? "Stop response" : "Send message"}
								className={`mb-[10px] flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 disabled:opacity-35 ${
									live.running
										? "bg-[var(--danger)] hover:brightness-110"
										: "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
								}`}
							>
								{live.running ? (
									<span className="size-2.5 rounded-[2px] bg-white" aria-hidden="true" />
								) : (
									<svg
										aria-hidden="true"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="m7 11 5-5 5 5" />
										<path d="M12 18V6" />
									</svg>
								)}
							</button>
						</div>
						<div className="flex min-w-0 items-center gap-1.5 px-2 pb-0.5 text-[9px] text-[var(--text-quaternary)]">
							<span className="truncate">
								{isSlackSession ? "Sequential Slack continuation" : "Hermes context preserved"}
							</span>
							{attachments.length > 0 && (
								<span className="ml-auto shrink-0">
									{attachments.length} attachment{attachments.length === 1 ? "" : "s"}
								</span>
							)}
						</div>
					</form>
				</div>
			</div>
		</main>
	);
}
