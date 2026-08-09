import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HermesTranscriptMessage } from "../../../shared/hermes";
import {
	type HermesSelectionGeneration,
	HermesSelectionGuard,
} from "../../hermes/hermes-binding-lifecycle";
import { isHermesChatNearBottom, shouldAnchorHermesChat } from "../../hermes/hermes-chat-scroll";
import {
	applyHermesEvent,
	createHermesLiveState,
	hermesOriginActionAvailability,
	hermesReportRequiresExplicitRetry,
	latestReportableHermesMessage,
} from "../../hermes/hermes-view-model";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { HermesApprovalCard, HermesClarificationChoices } from "./HermesInteractionCards";

function TranscriptMessage({ message }: { message: HermesTranscriptMessage }) {
	return (
		<div
			className={`rounded-[8px] border px-3 py-2 ${
				message.role === "user"
					? "ml-10 border-[var(--accent)]/20 bg-[var(--accent)]/5"
					: "mr-10 border-[var(--border-subtle)] bg-[var(--bg-surface)]"
			}`}
		>
			<div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
				{message.toolName ?? message.role}
			</div>
			<div className="whitespace-pre-wrap text-[13px] leading-5 text-[var(--text-secondary)]">
				{message.text || (message.workspaceArtifacts.length > 0 ? "Workspace created" : "")}
			</div>
		</div>
	);
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
	const [manualWorkspaceId, setManualWorkspaceId] = useState("");
	const [manualOriginUrl, setManualOriginUrl] = useState("");
	const [showReportPreview, setShowReportPreview] = useState(false);
	const processedEventSeq = useRef(0);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const followingTranscript = useRef(true);
	const anchoredSelectionKey = useRef<string | null>(null);
	const utils = trpc.useUtils();

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

	useEffect(() => {
		if (!selection || !connections.data) return;
		if (connections.data.some((candidate) => candidate.id === selection.connectionId)) return;
		useTabStore.getState().selectHermesSession(null);
	}, [connections.data, selection]);

	useEffect(() => {
		if (previousSelectionKey.current === selectionKey) return;
		previousSelectionKey.current = selectionKey;
		setCursor(0);
		processedEventSeq.current = 0;
		setLive(createHermesLiveState());
		setComposer("");
		setClarification("");
		setManualWorkspaceId("");
		setManualOriginUrl("");
		setShowReportPreview(false);
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
				next = applyHermesEvent(next, event, sessionId);
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
	}, [connectionId, eventFeed.data, selectionGeneration, selectionGuard, sessionId, utils]);

	const submit = trpc.hermes.submit.useMutation();
	const interrupt = trpc.hermes.interrupt.useMutation();
	const approval = trpc.hermes.respondApproval.useMutation();
	const clarify = trpc.hermes.respondClarification.useMutation();

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
	const reportable = useMemo(
		() => latestReportableHermesMessage(history.data?.messages ?? []),
		[history.data?.messages]
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

	function send(event: FormEvent) {
		event.preventDefault();
		if (!composer.trim() || !sessionId || !connected || live.running) return;
		const generation = selectionGeneration;
		submit.mutate(
			{ connectionId, hermesSessionId: sessionId, text: composer.trim() },
			{
				onSuccess: () => {
					runForSelection(generation, () => {
						setComposer("");
						setLive((current) => ({ ...current, running: true, error: null }));
					});
				},
			}
		);
	}

	useLayoutEffect(() => {
		const transcript = transcriptRef.current;
		if (!transcript || !history.data || history.isLoading) return;
		const initialHistory = anchoredSelectionKey.current !== selectionKey;
		if (shouldAnchorHermesChat({ initialHistory, following: followingTranscript.current })) {
			transcript.scrollTop = transcript.scrollHeight;
			followingTranscript.current = true;
		}
		if (initialHistory) anchoredSelectionKey.current = selectionKey;
	});

	if (!sessionId) {
		return (
			<main className="flex h-full min-w-0 items-center justify-center overflow-hidden">
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
		report.error?.message ??
		live.error;

	return (
		<main className="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--bg-base)]">
			<header className="app-drag flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-medium text-[var(--text-secondary)]">
						{session?.title ?? "New agent session"}
					</div>
					<div className="truncate text-[10px] text-[var(--text-quaternary)]">
						Started in {visibleOrigin?.platform ?? session?.source ?? "unknown"}
						{visibleOriginLabels.length > 0 ? ` · ${visibleOriginLabels.join(" · ")}` : ""}
					</div>
				</div>
				<div className="app-no-drag flex items-center gap-1.5">
					{isSlackSession && originActions.canOpenOrigin && (
						<button
							type="button"
							onClick={() => openOrigin.mutate({ connectionId, hermesSessionId: sessionId })}
							className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
						>
							Open Slack thread
						</button>
					)}
				</div>
			</header>

			{isSlackSession && (
				<div className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-1.5 text-[10px] text-[var(--text-quaternary)]">
					Slack remains live; continue sequentially to avoid overlapping turns.
				</div>
			)}

			{isSlackSession && origin.data && !origin.data.canOpenThread && (
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
					className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2"
				>
					<input
						value={manualOriginUrl}
						onChange={(event) => setManualOriginUrl(event.target.value)}
						placeholder="Optional trusted Slack thread URL"
						className="min-w-0 flex-1 rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[11px] text-[var(--text)]"
					/>
					<button
						type="submit"
						disabled={!manualOriginUrl.trim() || saveOriginLink.isPending}
						className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] disabled:opacity-40"
					>
						Save thread link
					</button>
				</form>
			)}

			{visibleError && (
				<div className="shrink-0 border-b border-[var(--danger)]/20 bg-[var(--danger)]/5 px-4 py-2 text-[11px] text-[var(--danger)]">
					{visibleError}
				</div>
			)}

			<div
				ref={transcriptRef}
				onScroll={(event) => {
					followingTranscript.current = isHermesChatNearBottom(event.currentTarget);
				}}
				className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
			>
				<div className="mx-auto flex max-w-[860px] flex-col gap-3">
					{history.isLoading && (
						<div className="py-8 text-center text-[12px] text-[var(--text-quaternary)]">
							Loading canonical Hermes history…
						</div>
					)}
					{history.data?.messages.map((message) => (
						<TranscriptMessage key={message.id} message={message} />
					))}
					{live.streamingText && (
						<div className="mr-10 rounded-[8px] border border-[var(--accent)]/20 bg-[var(--bg-surface)] px-3 py-2">
							<div className="whitespace-pre-wrap text-[13px] leading-5 text-[var(--text-secondary)]">
								{live.streamingText}
							</div>
						</div>
					)}
					{live.tools.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{live.tools.map((tool) => (
								<span
									key={tool.id}
									className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
								>
									{tool.name} · {tool.status}
								</span>
							))}
						</div>
					)}

					{links.data && links.data.length > 0 && (
						<section className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
							<div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
								Linked workspaces
							</div>
							<div className="flex flex-wrap gap-2">
								{links.data.map((link) => (
									<div
										key={link.id}
										className="flex items-center gap-1 rounded-[6px] border border-[var(--border)] px-2 py-1"
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
											className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)] disabled:text-[var(--danger)]"
										>
											{link.missing
												? `Missing: ${link.workspaceId}`
												: `${link.projectName ?? "Project"} · ${link.branch ?? link.workspaceName}`}
										</button>
										<button
											type="button"
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
											className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--danger)]"
											title="Unlink workspace"
										>
											×
										</button>
									</div>
								))}
							</div>
						</section>
					)}

					<section className="flex items-center gap-2 text-[11px]">
						<select
							value={manualWorkspaceId}
							onChange={(event) => setManualWorkspaceId(event.target.value)}
							className="min-w-0 rounded-[5px] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[var(--text-tertiary)]"
						>
							<option value="">Recovery: link a workspace…</option>
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
							className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[var(--text-tertiary)] disabled:opacity-40"
						>
							Link
						</button>
					</section>
				</div>
			</div>

			<div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
				<div className="mx-auto max-w-[860px]">
					{live.runtimeStatus && (
						<div className="mb-2 text-[10px] text-[var(--text-quaternary)]">
							Runtime: {live.runtimeStatus}
						</div>
					)}
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
							className="mb-2 rounded-[7px] border border-[#ff9f0a]/30 bg-[#ff9f0a]/5 p-2"
						>
							<div className="mb-1 whitespace-pre-wrap break-words text-[11px] text-[var(--text-secondary)]">
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
							<div className="flex gap-2">
								<input
									value={clarification}
									onChange={(event) => setClarification(event.target.value)}
									className="min-w-0 flex-1 rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text)]"
								/>
								<button
									type="submit"
									className="rounded-[5px] bg-[var(--accent)] px-2 py-1 text-[11px] text-white"
								>
									Answer
								</button>
							</div>
						</form>
					)}

					{isSlackSession && originActions.canReportToOrigin && reportable && (
						<div className="mb-2 rounded-[7px] border border-[var(--border-subtle)] p-2 text-[10px] text-[var(--text-quaternary)]">
							{showReportPreview ? (
								<>
									<div className="mb-1 font-medium text-[var(--text-secondary)]">
										Preview Slack update
									</div>
									<div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-[5px] bg-[var(--bg-base)] p-2 text-[11px] text-[var(--text-secondary)]">
										{reportable.text}
									</div>
									<div className="mt-2 flex items-center gap-2">
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
											className="rounded-[5px] bg-[var(--accent)] px-2 py-1 text-white disabled:opacity-40"
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
											className="px-2 py-1"
										>
											Cancel
										</button>
										<span>
											{reportState?.status === "sent"
												? "Sent locally recorded"
												: reportState?.status === "duplicate-suppressed"
													? "Duplicate suppressed locally"
													: reportState?.status === "failed"
														? `Failed${reportState.retryable ? "; explicit retry available" : ""}`
														: reportState?.status === "sending" && reportState.retryable
															? "Previous send was interrupted; explicit retry available"
															: "One selected update; delivery is not globally exactly-once"}
										</span>
									</div>
								</>
							) : (
								<button
									type="button"
									onClick={() => setShowReportPreview(true)}
									className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)]"
								>
									Preview Slack update
								</button>
							)}
						</div>
					)}

					<form onSubmit={send} className="flex items-end gap-2">
						<textarea
							value={composer}
							onChange={(event) => setComposer(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									if (composer.trim()) send(event);
								}
							}}
							placeholder={connected ? "Continue this agent thread…" : "Reconnect to continue…"}
							disabled={!connected || live.running || submit.isPending}
							rows={2}
							className="min-h-[54px] min-w-0 flex-1 resize-none rounded-[8px] border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
						/>
						{live.running ? (
							<button
								type="button"
								onClick={() => interrupt.mutate({ connectionId, hermesSessionId: sessionId })}
								className="rounded-[7px] border border-[var(--danger)]/40 px-3 py-2 text-[12px] text-[var(--danger)]"
							>
								Interrupt
							</button>
						) : (
							<button
								type="submit"
								disabled={!composer.trim() || !connected || submit.isPending}
								className="rounded-[7px] bg-[var(--accent)] px-3 py-2 text-[12px] text-white disabled:opacity-40"
							>
								Send
							</button>
						)}
					</form>
				</div>
			</div>
		</main>
	);
}
