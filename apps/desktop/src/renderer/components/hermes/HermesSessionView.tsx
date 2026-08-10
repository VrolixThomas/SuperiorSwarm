import {
	type ClipboardEvent,
	type FormEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import {
	HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES,
	type HermesAttachmentMetadata,
	hermesSessionCompositeIdentityKey,
} from "../../../shared/hermes";
import {
	fileObjectsFromHermesTransfer,
	hermesChatPasteAction,
} from "../../hermes/hermes-attachment-transfer";
import {
	type HermesSelectionGeneration,
	HermesSelectionGuard,
	settleHermesSelectionAttachments,
} from "../../hermes/hermes-binding-lifecycle";
import { isHermesChatNearBottom, shouldAnchorHermesChat } from "../../hermes/hermes-chat-scroll";
import {
	HERMES_CHAT_LAYOUT_CLASSES,
	HERMES_CHAT_OVERFLOW_CLASSES,
	type HermesOptimisticUserTurn,
	applyHermesActiveTurnSnapshot,
	applyHermesEvent,
	createHermesLiveState,
	createHermesOptimisticUserTurn,
	deriveHermesCanonicalTimeline,
	hermesComposerContainsFiles,
	hermesComposerEnterAction,
	hermesComposerInteractionPolicy,
	hermesComposerTextareaLayout,
	hermesComposerTransferAction,
	hermesOriginActionAvailability,
	hermesOriginReturnLabel,
	hermesRendererAttachmentSelectionError,
	hermesReportRequiresExplicitRetry,
	latestReportableHermesMessage,
	projectHermesLiveActivity,
	projectHermesLiveCompletions,
	projectHermesOptimisticUserTurns,
	projectHermesQueuedFollowUps,
	projectHermesTranscript,
	reconcileHermesOptimisticUserTurns,
	reduceHermesComposerAttachments,
	settleHermesOptimisticUserTurn,
} from "../../hermes/hermes-view-model";
import { normalizeHermesSessionSelection, useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { HermesComposerAttachments } from "./HermesComposerAttachments";
import { HermesApprovalCard, HermesClarificationChoices } from "./HermesInteractionCards";
import { HermesMarkdown } from "./HermesMarkdown";
import { HermesActivityGroup, HermesTranscript } from "./HermesTranscript";
import {
	HermesSessionTabStrip,
	HermesWorktreesPane,
	openHermesLinkedWorktree,
	resolveHermesWorkspaceSessionId,
} from "./HermesWorktreesPane";
import { OverflowPopover } from "./OverflowPopover";

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
	const profileId = selection?.profileId ?? null;
	const connectionId = selection?.connectionId ?? "";
	const openWorkspaceFromHermes = useTabStore((state) => state.openWorkspaceFromHermes);
	const activePane = useTabStore((state) => state.hermesSessionPane);
	const setActivePane = useTabStore((state) => state.setHermesSessionPane);
	const [composer, setComposer] = useState("");
	const [optimisticUserTurns, setOptimisticUserTurns] = useState<HermesOptimisticUserTurn[]>([]);
	const [clarification, setClarification] = useState("");
	const [cursor, setCursor] = useState(0);
	const [eventStreamSelectionKey, setEventStreamSelectionKey] = useState<string | null>(null);
	const [live, setLive] = useState(createHermesLiveState);
	const [attachments, dispatchAttachments] = useReducer(reduceHermesComposerAttachments, []);
	const [recoveryWorktreeId, setRecoveryWorktreeId] = useState("");
	const [manualOriginUrl, setManualOriginUrl] = useState("");
	const [showReportPreview, setShowReportPreview] = useState(false);
	const [attachmentLimitError, setAttachmentLimitError] = useState<string | null>(null);
	const [attachmentReadPending, setAttachmentReadPending] = useState(false);
	const [showJumpToLatest, setShowJumpToLatest] = useState(false);
	const [sessionOptionsOpen, setSessionOptionsOpen] = useState(false);
	const processedEventSeq = useRef(0);
	const resumeAttemptKey = useRef<string | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	const optimisticTurnSequence = useRef(0);
	const followingTranscript = useRef(true);
	const anchoredSelectionKey = useRef<string | null>(null);
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const utils = trpc.useUtils();

	const submit = trpc.hermes.submit.useMutation();
	const resume = trpc.hermes.resume.useMutation();
	const interrupt = trpc.hermes.interrupt.useMutation();
	const approval = trpc.hermes.respondApproval.useMutation();
	const clarify = trpc.hermes.respondClarification.useMutation();
	const pickAttachments = trpc.hermes.pickAttachments.useMutation();
	const releaseAttachment = trpc.hermes.releaseAttachment.useMutation();
	const releaseAttachmentRef = useRef(releaseAttachment.mutate);
	releaseAttachmentRef.current = releaseAttachment.mutate;
	const selectionKey = hermesSessionCompositeIdentityKey(
		connectionId,
		profileId ?? "",
		sessionId ?? ""
	);
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
	const composerPolicy = hermesComposerInteractionPolicy({
		connected,
		running: live.running,
		submitPending: submit.isPending,
		attachmentPickerPending: pickAttachments.isPending || attachmentReadPending,
		attachmentAttaching: attachments.some((attachment) => attachment.status === "attaching"),
		hasPayload: Boolean(composer.trim() || attachments.length > 0),
	});
	const catalog = trpc.hermes.catalog.useQuery(
		{ connectionId },
		{ enabled: Boolean(connectionId) && connected }
	);
	const session = catalog.data?.sessions.find(
		(candidate) =>
			candidate.id === sessionId && (profileId === null || candidate.profileId === profileId)
	);

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
		if (!selection) return;
		if (
			connections.data &&
			!connections.data.some((candidate) => candidate.id === selection.connectionId)
		) {
			useTabStore.getState().selectHermesSession(null);
			return;
		}
		if (!catalog.data) return;
		const normalized = normalizeHermesSessionSelection(selection, catalog.data.sessions);
		if (!normalized) {
			useTabStore.getState().selectHermesSession(null);
			return;
		}
		if (normalized.profileId !== selection.profileId) {
			useTabStore.getState().selectHermesSession(normalized);
		}
	}, [catalog.data, connections.data, selection]);

	useEffect(() => {
		if (previousSelectionKey.current === selectionKey) return;
		previousSelectionKey.current = selectionKey;
		for (const attachment of attachmentsRef.current) {
			releaseAttachmentRef.current({ handle: attachment.handle });
		}
		dispatchAttachments({ type: "succeeded" });
		setCursor(0);
		setEventStreamSelectionKey(null);
		resumeAttemptKey.current = null;
		processedEventSeq.current = 0;
		setLive(createHermesLiveState());
		setComposer("");
		setOptimisticUserTurns([]);
		setClarification("");
		setRecoveryWorktreeId("");
		setManualOriginUrl("");
		setShowReportPreview(false);
		setSessionOptionsOpen(false);
		setAttachmentLimitError(null);
		setAttachmentReadPending(false);
		setShowJumpToLatest(false);
		followingTranscript.current = true;
		anchoredSelectionKey.current = null;
	}, [selectionKey]);

	useEffect(() => {
		if (!connectionId || !profileId || !sessionId || !connected) {
			if (!connected) {
				resumeAttemptKey.current = null;
				setEventStreamSelectionKey(null);
			}
			return;
		}
		if (resumeAttemptKey.current === selectionKey) return;
		resumeAttemptKey.current = selectionKey;
		const generation = selectionGeneration;
		resume.mutate(
			{ connectionId, profileId, hermesSessionId: sessionId },
			{
				onSuccess: ({ activeTurnSnapshot }) => {
					runForSelection(generation, () => {
						processedEventSeq.current = activeTurnSnapshot.eventSeq;
						setCursor(activeTurnSnapshot.eventSeq);
						setLive((current) => applyHermesActiveTurnSnapshot(current, activeTurnSnapshot));
						setEventStreamSelectionKey(selectionKey);
					});
				},
				onError: () => {
					runForSelection(generation, () => {
						setEventStreamSelectionKey(null);
					});
				},
			}
		);
	}, [connected, connectionId, profileId, resume, selectionGeneration, selectionKey, sessionId]);

	const history = trpc.hermes.history.useQuery(
		{ connectionId, profileId: profileId ?? undefined, hermesSessionId: sessionId ?? "" },
		{
			enabled: Boolean(connectionId && profileId && sessionId && connected),
			staleTime: 1_000,
		}
	);
	const followUps = trpc.hermes.followUps.useQuery(
		{ connectionId, profileId: profileId ?? undefined, hermesSessionId: sessionId ?? "" },
		{
			enabled: Boolean(connectionId && profileId && sessionId),
			refetchInterval: 750,
		}
	);
	const retryFollowUp = trpc.hermes.retryFollowUp.useMutation({
		onSettled: () => void followUps.refetch(),
	});
	const cancelFollowUp = trpc.hermes.cancelFollowUp.useMutation({
		onSettled: () => void followUps.refetch(),
	});
	const workspaceSessionId = resolveHermesWorkspaceSessionId(sessionId, history.data);
	const physicalMessages = useMemo(() => history.data?.messages ?? [], [history.data?.messages]);
	const canonicalMessages = useMemo(
		() => deriveHermesCanonicalTimeline(physicalMessages),
		[physicalMessages]
	);
	const eventFeed = trpc.hermes.events.useQuery(
		{ connectionId, afterSeq: cursor },
		{
			enabled: Boolean(
				connectionId && sessionId && connected && eventStreamSelectionKey === selectionKey
			),
			refetchInterval: 400,
		}
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
				if (event.durableSessionId === null) {
					refreshHistory = true;
					return [];
				}
				if (event.profileId === profileId && event.durableSessionId === sessionId) {
					refreshHistory = true;
					return [event];
				}
				return [];
			}
			return event.profileId === profileId && event.durableSessionId === sessionId ? [event] : [];
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
			void utils.hermes.history.invalidate({
				connectionId,
				profileId: profileId ?? undefined,
				hermesSessionId: sessionId,
			});
			void utils.hermes.catalog.invalidate({ connectionId });
			void utils.hermes.workspaceLinks.invalidate();
		}
	}, [
		canonicalMessages,
		connectionId,
		eventFeed.data,
		profileId,
		selectionGeneration,
		selectionGuard,
		sessionId,
		utils,
	]);

	const links = trpc.hermes.workspaceLinks.useQuery(
		{ connectionId, profileId: profileId ?? undefined, hermesSessionId: workspaceSessionId },
		{ enabled: Boolean(connectionId && sessionId), refetchInterval: 2_000 }
	);
	const availableWorkspaces = trpc.hermes.availableWorkspaces.useQuery();
	const linkWorkspace = trpc.hermes.linkWorkspace.useMutation();
	const unlinkWorkspace = trpc.hermes.unlinkWorkspace.useMutation();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const isSlackSession = session?.source.toLowerCase() === "slack";
	const origin = trpc.hermes.origin.useQuery(
		{ connectionId, profileId: profileId ?? undefined, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && profileId && sessionId && connected) }
	);
	const openOrigin = trpc.hermes.openOrigin.useMutation();
	const saveOriginLink = trpc.hermes.saveOriginLink.useMutation();
	const originActions = hermesOriginActionAvailability(origin.data);
	const reports = trpc.hermes.reports.useQuery(
		{ connectionId, profileId: profileId ?? undefined, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && profileId && sessionId && isSlackSession && connected) }
	);
	const report = trpc.hermes.reportToOrigin.useMutation();
	const transcriptItems = useMemo(
		() => projectHermesTranscript(canonicalMessages),
		[canonicalMessages]
	);
	const optimisticUserItems = useMemo(
		() => projectHermesOptimisticUserTurns(canonicalMessages, optimisticUserTurns),
		[canonicalMessages, optimisticUserTurns]
	);
	const queuedUserItems = useMemo(
		() => projectHermesQueuedFollowUps(canonicalMessages, followUps.data ?? live.queuedFollowUps),
		[canonicalMessages, followUps.data, live.queuedFollowUps]
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
	const originReturnLabel = hermesOriginReturnLabel(visibleOrigin);
	const hasOriginAction = Boolean(
		visibleOrigin &&
			session?.source !== "superiorswarm" &&
			((originActions.canOpenOrigin && originReturnLabel) || isSlackSession)
	);
	const hasReportAction = Boolean(isSlackSession && originActions.canReportToOrigin && reportable);
	const hasSessionOptions = hasOriginAction || hasReportAction;
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

	useEffect(() => {
		if (!hasSessionOptions && sessionOptionsOpen) setSessionOptionsOpen(false);
	}, [hasSessionOptions, sessionOptionsOpen]);

	function runForSelection(generation: HermesSelectionGeneration, callback: () => void): void {
		selectionGuard.runIfCurrent(generation, callback);
	}

	function send(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (
			(!composer.trim() && attachments.length === 0) ||
			!sessionId ||
			!profileId ||
			composerPolicy.sendDisabled
		) {
			return;
		}
		const generation = selectionGeneration;
		const optimisticTurn = createHermesOptimisticUserTurn({
			id: `${selectionKey}:${++optimisticTurnSequence.current}`,
			text: composer,
			attachments,
			canonicalMessages,
		});
		setOptimisticUserTurns((current) => [...current, optimisticTurn]);
		dispatchAttachments({ type: "submitting" });
		submit.mutate(
			{
				connectionId,
				profileId: profileId ?? undefined,
				hermesSessionId: sessionId,
				text: composer.trim(),
				attachmentHandles: attachments.map((attachment) => attachment.handle),
			},
			{
				onSuccess: (result) => {
					runForSelection(generation, () => {
						setOptimisticUserTurns((current) =>
							settleHermesOptimisticUserTurn(
								current,
								optimisticTurn.id,
								result.disposition === "queued" ? "failed" : "accepted"
							)
						);
						setComposer("");
						dispatchAttachments({ type: "succeeded" });
						setAttachmentLimitError(null);
						if (result.disposition === "submitted") {
							setLive((current) => ({
								...current,
								running: true,
								runtimeStatus: "submitting",
								streamingText: "",
								tools: [],
								error: null,
							}));
						} else {
							utils.hermes.followUps.setData(
								{
									connectionId,
									profileId: profileId ?? undefined,
									hermesSessionId: sessionId,
								},
								(current) => {
									const existing = current?.findIndex(
										(followUp) => followUp.id === result.followUp.id
									);
									if (existing === undefined || existing < 0)
										return [...(current ?? []), result.followUp];
									return current?.map((followUp, index) =>
										index === existing ? result.followUp : followUp
									);
								}
							);
						}
						void followUps.refetch();
					});
				},
				onError: (error) => {
					runForSelection(generation, () => {
						setOptimisticUserTurns((current) =>
							settleHermesOptimisticUserTurn(current, optimisticTurn.id, "failed")
						);
						dispatchAttachments({ type: "failed", error: error.message });
					});
				},
			}
		);
	}

	async function stageTransferredFiles(files: File[]): Promise<void> {
		if (files.length === 0) return;
		const generation = selectionGeneration;
		const error = hermesRendererAttachmentSelectionError(files, attachmentsRef.current.length);
		if (error) {
			setAttachmentLimitError(error);
			return;
		}
		setAttachmentReadPending(true);
		let uploadId: string | null = null;
		try {
			const started = await window.electron.hermesAttachments.begin(
				files.map((file) => ({ name: file.name, size: file.size, mimeType: file.type }))
			);
			uploadId = started.uploadId;
			if (!selectionGuard.isCurrent(generation)) return;
			for (const [index, file] of files.entries()) {
				const fileId = started.files[index]?.fileId;
				if (!fileId) throw new Error("Attachment upload handle is unavailable");
				let offset = 0;
				while (offset < file.size) {
					const end = Math.min(offset + HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES, file.size);
					const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
					if (!selectionGuard.isCurrent(generation)) return;
					if (bytes.byteLength !== end - offset)
						throw new Error(`“${file.name}” changed while reading`);
					await window.electron.hermesAttachments.append({
						uploadId,
						fileId,
						offset,
						bytes,
					});
					if (!selectionGuard.isCurrent(generation)) return;
					offset = end;
				}
			}
			if (!selectionGuard.isCurrent(generation)) return;
			const selected = await window.electron.hermesAttachments.finish(uploadId);
			uploadId = null;
			acceptRegisteredAttachments(selected, generation);
		} catch (reason) {
			runForSelection(generation, () => {
				setAttachmentLimitError(
					reason instanceof Error ? reason.message : "Could not read the selected files."
				);
			});
		} finally {
			if (uploadId) void window.electron.hermesAttachments.cancel(uploadId).catch(() => undefined);
			runForSelection(generation, () => setAttachmentReadPending(false));
		}
	}

	function acceptRegisteredAttachments(
		selected: HermesAttachmentMetadata[],
		generation: HermesSelectionGeneration
	): void {
		settleHermesSelectionAttachments(selectionGuard, generation, selected, {
			accept: acceptCurrentRegisteredAttachments,
			release: (attachment) => releaseAttachmentRef.current({ handle: attachment.handle }),
		});
	}

	function acceptCurrentRegisteredAttachments(selected: HermesAttachmentMetadata[]): void {
		const existing = new Set(attachmentsRef.current.map((attachment) => attachment.handle));
		const unique = selected.filter((attachment) => !existing.has(attachment.handle));
		const available = Math.max(0, 10 - attachmentsRef.current.length);
		const accepted = unique.slice(0, available);
		const rejected = unique.slice(available);
		if (accepted.length > 0) dispatchAttachments({ type: "add", attachments: accepted });
		for (const attachment of rejected) {
			releaseAttachmentRef.current({ handle: attachment.handle });
		}
		setAttachmentLimitError(rejected.length > 0 ? "Attach up to 10 files to one message." : null);
	}

	function handlePickAttachments(): void {
		const generation = selectionGeneration;
		pickAttachments.mutate(undefined, {
			onSuccess: (selected) => acceptRegisteredAttachments(selected, generation),
		});
	}

	function handleChatPaste(event: ClipboardEvent<HTMLElement>): void {
		if (
			hermesChatPasteAction({
				activePane,
				boundary: event.currentTarget,
				target: event.target,
				composer: composerRef.current,
				transfer: event.clipboardData,
			}) === "native"
		) {
			return;
		}
		event.preventDefault();
		void stageTransferredFiles(fileObjectsFromHermesTransfer(event.clipboardData));
	}

	useEffect(() => {
		setOptimisticUserTurns((current) =>
			reconcileHermesOptimisticUserTurns(canonicalMessages, current)
		);
	}, [canonicalMessages]);

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
		if (activePane !== "chat" || !transcript || !history.data || history.isLoading) return;
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
						Sessions created here or explicitly admitted through SuperiorSwarm appear in the
						sidebar.
					</div>
				</div>
			</main>
		);
	}

	const visibleError =
		history.error?.message ??
		resume.error?.message ??
		submit.error?.message ??
		interrupt.error?.message ??
		approval.error?.message ??
		clarify.error?.message ??
		pickAttachments.error?.message ??
		attachmentLimitError ??
		followUps.error?.message ??
		retryFollowUp.error?.message ??
		cancelFollowUp.error?.message ??
		openOrigin.error?.message ??
		report.error?.message ??
		live.error;

	return (
		<main
			onPaste={handleChatPaste}
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
									{links.data.length} worktree{links.data.length === 1 ? "" : "s"}
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
				<HermesSessionTabStrip
					activePane={activePane}
					worktreeCount={links.data?.length ?? 0}
					onSelect={setActivePane}
				/>

				{hasSessionOptions && (
					<OverflowPopover
						label="Actions for selected agent session"
						open={sessionOptionsOpen}
						onOpenChange={setSessionOptionsOpen}
						panelClassName="rounded-[14px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]"
					>
						<div className="mb-3 text-[11px] font-medium text-[var(--text-secondary)]">
							Session options
						</div>

						{visibleOrigin && session?.source !== "superiorswarm" && (
							<section className="mb-3 min-w-0 border-b border-[var(--border-subtle)] pb-3">
								<div className="mb-1 text-[10px] font-medium text-[var(--text-tertiary)]">
									Origin
								</div>
								<p className="mb-2 text-[10px] leading-4 text-[var(--text-quaternary)]">
									{isSlackSession ? (
										<>Slack remains live. Continue sequentially to avoid overlapping turns.</>
									) : (
										<>
											From {visibleOrigin.displayLabel ?? visibleOrigin.platform}. Continue
											sequentially to avoid overlapping turns at the source.
										</>
									)}
								</p>
								{originActions.canOpenOrigin && originReturnLabel ? (
									<button
										type="button"
										data-popover-close
										onClick={() =>
											openOrigin.mutate({
												connectionId,
												profileId: profileId ?? undefined,
												hermesSessionId: sessionId,
											})
										}
										className="rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]"
									>
										{originReturnLabel}
									</button>
								) : isSlackSession ? (
									<form
										onSubmit={(event) => {
											event.preventDefault();
											if (!manualOriginUrl.trim()) return;
											saveOriginLink.mutate(
												{
													connectionId,
													profileId: profileId ?? undefined,
													hermesSessionId: sessionId,
													openUrl: manualOriginUrl.trim(),
												},
												{
													onSuccess: () => {
														setManualOriginUrl("");
														void utils.hermes.origin.invalidate({
															connectionId,
															profileId: profileId ?? undefined,
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
											data-popover-close
											disabled={!manualOriginUrl.trim() || saveOriginLink.isPending}
											className="shrink-0 rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] disabled:opacity-40"
										>
											Save
										</button>
									</form>
								) : (
									<div className="text-[10px] leading-4 text-[var(--text-quaternary)]">
										No direct return link is available for this source.
									</div>
								)}
							</section>
						)}

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
												data-popover-close
												disabled={report.isPending || reportState?.status === "sent"}
												onClick={() => {
													const generation = selectionGeneration;
													report.mutate(
														{
															connectionId,
															profileId: profileId ?? undefined,
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
					</OverflowPopover>
				)}
			</header>

			{visibleError && activePane === "chat" && (
				<div className="shrink-0 border-b border-[var(--danger)]/15 bg-[var(--danger-subtle)] px-4 py-1.5 text-[11px] text-[var(--danger)] [overflow-wrap:anywhere]">
					{visibleError}
				</div>
			)}

			<div
				id="hermes-chat-panel"
				role="tabpanel"
				aria-labelledby="hermes-chat-tab"
				hidden={activePane !== "chat"}
				ref={transcriptRef}
				onScroll={(event) => {
					const following = isHermesChatNearBottom(event.currentTarget);
					followingTranscript.current = following;
					setShowJumpToLatest(!following);
				}}
				className={`${activePane !== "chat" ? "hidden" : ""} ${HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner} ${HERMES_CHAT_LAYOUT_CLASSES.gutter} flex-1 py-6 sm:py-7`}
			>
				<div
					className={`${HERMES_CHAT_LAYOUT_CLASSES.frame} pb-6`}
					data-hermes-alignment-frame="transcript"
				>
					{history.isLoading && (
						<div className="py-8 text-center text-[12px] text-[var(--text-quaternary)]">
							Loading canonical Hermes history…
						</div>
					)}
					<HermesTranscript
						items={[...transcriptItems, ...optimisticUserItems, ...queuedUserItems]}
						onRetryFollowUp={(followUpId) =>
							retryFollowUp.mutate({
								connectionId,
								profileId: profileId ?? undefined,
								hermesSessionId: sessionId,
								followUpId,
							})
						}
						onCancelFollowUp={(followUpId) =>
							cancelFollowUp.mutate({
								connectionId,
								profileId: profileId ?? undefined,
								hermesSessionId: sessionId,
								followUpId,
							})
						}
					/>
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
							className={`${HERMES_CHAT_LAYOUT_CLASSES.assistantColumn} mt-7 text-[15px] leading-[22px] text-[var(--text-secondary)] ${HERMES_CHAT_OVERFLOW_CLASSES.arbitraryContent}`}
							data-hermes-align="frame-start"
							aria-live="polite"
						>
							<HermesMarkdown content={live.streamingText} />
						</div>
					)}
				</div>
			</div>

			<div
				hidden={activePane !== "chat"}
				className={`${activePane !== "chat" ? "hidden" : ""} relative z-10 min-w-0 shrink-0 bg-gradient-to-t from-[var(--bg-base)] via-[var(--bg-base)] to-transparent pb-4 pt-2 sm:pb-5 ${HERMES_CHAT_LAYOUT_CLASSES.gutter}`}
			>
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

				<div
					className={HERMES_CHAT_LAYOUT_CLASSES.composerColumn}
					data-hermes-alignment-frame="composer"
				>
					{live.pendingApproval && (
						<HermesApprovalCard
							interaction={live.pendingApproval}
							pending={approval.isPending}
							onChoose={(choice) => {
								const generation = selectionGeneration;
								approval.mutate(
									{
										connectionId,
										profileId: profileId ?? undefined,
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
										profileId: profileId ?? undefined,
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
											profileId: profileId ?? undefined,
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
								event.dataTransfer.dropEffect = "copy";
							}
						}}
						onDrop={(event) => {
							if (hermesComposerTransferAction(event.dataTransfer) === "native") return;
							event.preventDefault();
							void stageTransferredFiles(fileObjectsFromHermesTransfer(event.dataTransfer));
						}}
						className="min-w-0 rounded-[16px] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 shadow-[0_10px_32px_rgba(0,0,0,0.24)] focus-within:border-[var(--border-active)]"
					>
						<HermesComposerAttachments
							attachments={attachments}
							removalDisabled={composerPolicy.attachmentMutationDisabled}
							onRemove={(handle) => {
								if (composerPolicy.attachmentMutationDisabled) return;
								dispatchAttachments({ type: "remove", handle });
								releaseAttachment.mutate({ handle });
								setAttachmentLimitError(null);
							}}
						/>
						<div className={`flex items-end gap-1.5 ${attachments.length > 0 ? "mt-2" : ""}`}>
							<button
								type="button"
								onClick={handlePickAttachments}
								disabled={composerPolicy.attachmentMutationDisabled}
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
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									const action = hermesComposerEnterAction({
										connected,
										running: live.running,
										submitPending: submit.isPending,
										shiftKey: event.shiftKey,
										isComposing: event.nativeEvent.isComposing,
									});
									if (action === "native") return;
									event.preventDefault();
									if (action === "submit") event.currentTarget.form?.requestSubmit();
								}}
								placeholder={
									connected ? "Continue this agent thread…" : "Queue while reconnecting…"
								}
								disabled={composerPolicy.textareaDisabled}
								rows={1}
								aria-label="Message"
								className="min-h-14 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[17px] text-[14px] leading-[20px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)] disabled:opacity-50 [overflow-wrap:anywhere]"
							/>
							{live.running && (
								<button
									type="button"
									onClick={() =>
										interrupt.mutate({
											connectionId,
											profileId: profileId ?? undefined,
											hermesSessionId: sessionId,
										})
									}
									disabled={interrupt.isPending}
									aria-label="Stop response"
									title="Stop response"
									className="mb-[10px] flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--danger)] text-white hover:brightness-110 disabled:opacity-35"
								>
									<span className="size-2.5 rounded-[2px] bg-white" aria-hidden="true" />
								</button>
							)}
							<button
								type="submit"
								disabled={composerPolicy.sendDisabled}
								aria-label={live.running ? "Queue follow-up" : "Send message"}
								title={live.running ? "Queue follow-up" : "Send message"}
								className="mb-[10px] flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-35"
							>
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

			<HermesWorktreesPane
				links={links.data ?? []}
				availableWorktrees={availableWorkspaces.data ?? []}
				recoveryWorktreeId={recoveryWorktreeId}
				recoveryPending={linkWorkspace.isPending || unlinkWorkspace.isPending}
				hidden={activePane !== "worktrees"}
				onOpen={(link) => {
					openHermesLinkedWorktree(
						link,
						{ connectionId, profileId: profileId ?? undefined, sessionId },
						{
							openWorkspaceFromHermes,
							getTabsByWorkspace: (workspaceId) =>
								useTabStore.getState().getTabsByWorkspace(workspaceId),
							addTerminalTab: (workspaceId, worktreePath, branch) =>
								useTabStore.getState().addTerminalTab(workspaceId, worktreePath, branch),
							attachTerminal: (workspaceId, terminalId) =>
								attachTerminal.mutate({ workspaceId, terminalId }),
						}
					);
				}}
				onRecoveryChange={setRecoveryWorktreeId}
				onRecoveryLink={() => {
					if (!recoveryWorktreeId) return;
					const generation = selectionGeneration;
					linkWorkspace.mutate(
						{
							connectionId,
							profileId: profileId ?? undefined,
							hermesSessionId: workspaceSessionId,
							workspaceId: recoveryWorktreeId,
							lineageRootId: null,
						},
						{
							onSuccess: () => {
								runForSelection(generation, () => {
									setRecoveryWorktreeId("");
									void utils.hermes.workspaceLinks.invalidate();
									void utils.hermes.workspaceLinkIndex.invalidate();
								});
							},
						}
					);
				}}
				onRecoveryUnlink={(link) => {
					const generation = selectionGeneration;
					unlinkWorkspace.mutate(
						{
							connectionId,
							profileId: profileId ?? undefined,
							hermesSessionId: workspaceSessionId,
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
			/>
		</main>
	);
}
