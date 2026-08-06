import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HermesTranscriptMessage } from "../../../shared/hermes";
import {
	HermesBindingLifecycle,
	type HermesRendererBinding,
} from "../../hermes/hermes-binding-lifecycle";
import { isHermesChatNearBottom, shouldAnchorHermesChat } from "../../hermes/hermes-chat-scroll";
import {
	applyHermesEvent,
	createHermesLiveState,
	latestReportableHermesTurnResult,
} from "../../hermes/hermes-view-model";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { HermesApprovalCard, HermesClarificationChoices } from "./HermesInteractionCards";

interface ResumedHermesBinding extends HermesRendererBinding {
	canonicalSessionId: string;
}

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
	const [resumed, setResumed] = useState<ResumedHermesBinding | null>(null);
	const [releaseFailure, setReleaseFailure] = useState<{
		retryable: boolean;
		error: string;
	} | null>(null);
	const resumeRequests = useRef(new Set<string>());
	const processedEventSeq = useRef(0);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const followingTranscript = useRef(true);
	const anchoredSelectionKey = useRef<string | null>(null);
	const utils = trpc.useUtils();

	const connections = trpc.hermes.connections.useQuery();
	const selectionKey = `${connectionId}:${sessionId ?? ""}`;
	const previousSelectionKey = useRef(selectionKey);
	const status = trpc.hermes.status.useQuery(
		{ connectionId },
		{ enabled: Boolean(connectionId), refetchInterval: 1_000 }
	);
	const catalog = trpc.hermes.catalog.useQuery(
		{ connectionId },
		{ enabled: Boolean(connectionId) && status.data?.status === "connected" }
	);
	const session = catalog.data?.sessions.find((candidate) => candidate.id === sessionId);
	const resume = trpc.hermes.resume.useMutation();
	const unbind = trpc.hermes.unbind.useMutation();
	const unbindRef = useRef(unbind.mutate);
	unbindRef.current = unbind.mutate;
	const bindingLifecycleRef = useRef<HermesBindingLifecycle | null>(null);
	if (!bindingLifecycleRef.current) {
		bindingLifecycleRef.current = new HermesBindingLifecycle((binding) => {
			unbindRef.current({
				connectionId: binding.connectionId,
				hermesSessionId: binding.hermesSessionId,
				expectedClaimId: binding.claimId,
			});
		});
	}
	const bindingLifecycle = bindingLifecycleRef.current;
	bindingLifecycle.select(selectionKey);
	const requestResumeRef = useRef<(key: string, connection: string, session: string) => void>(
		() => undefined
	);
	requestResumeRef.current = (key, selectedConnectionId, selectedSessionId) => {
		if (resumeRequests.current.has(key)) return;
		resumeRequests.current.add(key);
		resume.mutate(
			{ connectionId: selectedConnectionId, hermesSessionId: selectedSessionId },
			{
				onSuccess: (result) => {
					const binding: ResumedHermesBinding = {
						connectionId: selectedConnectionId,
						hermesSessionId: selectedSessionId,
						canonicalSessionId: result.canonicalSessionId,
						runtimeSessionId: result.runtimeSessionId,
						claimId: result.claimId,
					};
					if (bindingLifecycle.accept(key, binding)) {
						setResumed(binding);
						setLive((current) => ({ ...current, error: null }));
					}
				},
				onSettled: () => {
					resumeRequests.current.delete(key);
				},
			}
		);
	};
	const release = trpc.hermes.release.useMutation({
		onSuccess: (result) => {
			if (!result.released) {
				setReleaseFailure({
					retryable: result.retryable,
					error: result.error ?? "Hermes could not release this session.",
				});
				setLive((current) => ({
					...current,
					error: result.error ?? "Hermes could not release this session; retry is safe.",
				}));
				return;
			}
			setReleaseFailure(null);
			setResumed(null);
			resume.reset();
			useTabStore.getState().selectHermesSession(null);
			void utils.hermes.catalog.invalidate();
		},
	});

	useEffect(() => {
		bindingLifecycle.activate();
		return () => bindingLifecycle.dispose();
	}, [bindingLifecycle]);

	useEffect(() => {
		if (!selection || !connections.data) return;
		if (connections.data.some((candidate) => candidate.id === selection.connectionId)) return;
		useTabStore.getState().selectHermesSession(null);
	}, [connections.data, selection]);

	useEffect(() => {
		if (previousSelectionKey.current === selectionKey) return;
		previousSelectionKey.current = selectionKey;
		bindingLifecycle.releaseObsolete();
		setCursor(0);
		processedEventSeq.current = 0;
		setLive(createHermesLiveState());
		setComposer("");
		setClarification("");
		setManualWorkspaceId("");
		setResumed(null);
		setReleaseFailure(null);
		followingTranscript.current = true;
		anchoredSelectionKey.current = null;
		resume.reset();
		release.reset();
	}, [bindingLifecycle, release, resume, selectionKey]);

	useEffect(() => {
		if (!sessionId || !connectionId || status.data?.status !== "connected") return;
		const key = `${connectionId}:${sessionId}`;
		const current = bindingLifecycle.current();
		if (current?.connectionId === connectionId && current.hermesSessionId === sessionId) return;
		requestResumeRef.current(key, connectionId, sessionId);
	}, [bindingLifecycle, connectionId, sessionId, status.data?.status]);

	const history = trpc.hermes.history.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && sessionId && resumed), staleTime: 1_000 }
	);
	const eventFeed = trpc.hermes.events.useQuery(
		{ connectionId, afterSeq: cursor },
		{ enabled: Boolean(connectionId && resumed), refetchInterval: 400 }
	);

	useEffect(() => {
		const feed = eventFeed.data;
		if (!feed || !resumed || !sessionId || feed.nextSeq <= processedEventSeq.current) return;
		processedEventSeq.current = feed.nextSeq;
		let refreshHistory = false;
		let retryBinding = false;
		let activeRuntimeSessionId = resumed.runtimeSessionId;
		let reboundBinding: ResumedHermesBinding | null = null;
		const relevantEvents = feed.events.flatMap((entry) => {
			if (entry.event.type === "runtime.history-refresh-required") {
				refreshHistory = true;
				const bindings = entry.event.payload.bindings;
				if (Array.isArray(bindings)) {
					for (const binding of bindings) {
						if (binding.hermesSessionId !== sessionId) continue;
						const { runtimeSessionId, claimId, canonicalSessionId } = binding;
						activeRuntimeSessionId = runtimeSessionId;
						reboundBinding = {
							connectionId,
							hermesSessionId: sessionId,
							canonicalSessionId,
							runtimeSessionId,
							claimId,
						};
					}
				}
				const failedSessionIds = entry.event.payload.failedSessionIds;
				retryBinding = Array.isArray(failedSessionIds) && failedSessionIds.includes(sessionId);
			}
			if (entry.event.sessionId !== null && entry.event.sessionId !== activeRuntimeSessionId) {
				return [];
			}
			return [entry.event];
		});
		setLive((current) => {
			let next = current;
			for (const event of relevantEvents) {
				next = applyHermesEvent(next, event);
				if (event.type === "message.complete") {
					refreshHistory = true;
				}
			}
			return next;
		});
		setCursor(feed.nextSeq);
		if (reboundBinding && bindingLifecycle.accept(selectionKey, reboundBinding)) {
			setResumed(reboundBinding);
		}
		if (refreshHistory) {
			void utils.hermes.history.invalidate({
				connectionId,
				hermesSessionId: sessionId ?? "",
			});
			void utils.hermes.workspaceLinks.invalidate();
			if (retryBinding && sessionId) {
				requestResumeRef.current(`${connectionId}:${sessionId}`, connectionId, sessionId);
			}
		}
	}, [bindingLifecycle, connectionId, eventFeed.data, resumed, selectionKey, sessionId, utils]);

	const submit = trpc.hermes.submit.useMutation({
		onSuccess: () => {
			setComposer("");
			setLive((current) => ({ ...current, running: true, error: null }));
		},
	});
	const interrupt = trpc.hermes.interrupt.useMutation();
	const approval = trpc.hermes.respondApproval.useMutation({
		onSuccess: () => setLive((current) => ({ ...current, pendingApproval: null })),
	});
	const clarify = trpc.hermes.respondClarification.useMutation({
		onSuccess: () => {
			setClarification("");
			setLive((current) => ({ ...current, pendingClarification: null }));
		},
	});

	const links = trpc.hermes.workspaceLinks.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && sessionId), refetchInterval: 2_000 }
	);
	const availableWorkspaces = trpc.hermes.availableWorkspaces.useQuery();
	const linkWorkspace = trpc.hermes.linkWorkspace.useMutation({
		onSuccess: () => {
			setManualWorkspaceId("");
			void utils.hermes.workspaceLinks.invalidate();
			void utils.hermes.workspaceLinkIndex.invalidate();
		},
	});
	const unlinkWorkspace = trpc.hermes.unlinkWorkspace.useMutation({
		onSuccess: () => {
			void utils.hermes.workspaceLinks.invalidate();
			void utils.hermes.workspaceLinkIndex.invalidate();
		},
	});
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const origin = trpc.hermes.origin.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && sessionId && session?.source === "slack" && resumed) }
	);
	const openOrigin = trpc.hermes.openOrigin.useMutation();
	const reports = trpc.hermes.reports.useQuery(
		{ connectionId, hermesSessionId: sessionId ?? "" },
		{ enabled: Boolean(connectionId && sessionId) }
	);
	const report = trpc.hermes.reportToOrigin.useMutation({
		onSettled: () => void utils.hermes.reports.invalidate(),
	});

	const reportable = useMemo(
		() => latestReportableHermesTurnResult(history.data?.turnResults ?? []),
		[history.data?.turnResults]
	);
	const reportState = reportable
		? reports.data?.find((candidate) => candidate.turnId === reportable.turnId)
		: null;

	function send(event: FormEvent) {
		event.preventDefault();
		if (!composer.trim() || !sessionId) return;
		submit.mutate({ connectionId, hermesSessionId: sessionId, text: composer.trim() });
	}

	useLayoutEffect(() => {
		const transcript = transcriptRef.current;
		if (!transcript || !history.data || history.isLoading) return;
		const initialHistory = anchoredSelectionKey.current !== selectionKey;
		if (
			shouldAnchorHermesChat({
				initialHistory,
				following: followingTranscript.current,
			})
		) {
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

	return (
		<main className="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--bg-base)]">
			<header className="app-drag flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-medium text-[var(--text-secondary)]">
						{session?.title ?? "Agent thread"}
					</div>
					<div className="truncate text-[10px] text-[var(--text-quaternary)]">
						{session?.originLabel ?? session?.source ?? sessionId}
					</div>
				</div>
				<div className="app-no-drag flex items-center gap-1.5">
					{origin.data?.canOpen && (
						<button
							type="button"
							onClick={() => openOrigin.mutate({ connectionId, hermesSessionId: sessionId })}
							className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
						>
							Open in Slack
						</button>
					)}
					<button
						type="button"
						onClick={() => release.mutate({ connectionId, hermesSessionId: sessionId })}
						disabled={!resumed || release.isPending}
						className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
					>
						{release.isPending
							? "Releasing…"
							: releaseFailure?.retryable
								? "Retry release"
								: "Release"}
					</button>
				</div>
			</header>

			{(resume.error || release.error || live.error) && (
				<div className="shrink-0 border-b border-[var(--danger)]/20 bg-[var(--danger)]/5 px-4 py-2 text-[11px] text-[var(--danger)]">
					{resume.error?.message ?? release.error?.message ?? live.error}
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
							Resuming canonical Hermes history…
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
											onClick={() =>
												unlinkWorkspace.mutate({
													connectionId,
													hermesSessionId: sessionId,
													workspaceId: link.workspaceId,
												})
											}
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
							onClick={() =>
								linkWorkspace.mutate({
									connectionId,
									hermesSessionId: sessionId,
									workspaceId: manualWorkspaceId,
									lineageRootId: session?.lineageRootId,
								})
							}
							className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[var(--text-tertiary)] disabled:opacity-40"
						>
							Link
						</button>
					</section>
				</div>
			</div>

			<div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
				<div className="mx-auto max-w-[860px]">
					{live.pendingApproval && (
						<HermesApprovalCard
							interaction={live.pendingApproval}
							pending={approval.isPending}
							onChoose={(choice) =>
								approval.mutate({
									connectionId,
									hermesSessionId: sessionId,
									requestId: live.pendingApproval?.requestId ?? "",
									choice,
								})
							}
						/>
					)}

					{live.pendingClarification && (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								clarify.mutate({
									connectionId,
									hermesSessionId: sessionId,
									requestId: live.pendingClarification?.requestId ?? "",
									answer: clarification,
								});
							}}
							className="mb-2 rounded-[7px] border border-[#ff9f0a]/30 bg-[#ff9f0a]/5 p-2"
						>
							<div className="mb-1 whitespace-pre-wrap break-words text-[11px] text-[var(--text-secondary)]">
								{live.pendingClarification.prompt}
							</div>
							<HermesClarificationChoices
								choices={live.pendingClarification.choices}
								pending={clarify.isPending}
								onChoose={(answer) =>
									clarify.mutate({
										connectionId,
										hermesSessionId: sessionId,
										requestId: live.pendingClarification?.requestId ?? "",
										answer,
									})
								}
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

					{session?.source === "slack" && origin.data?.canReport && reportable && (
						<div className="mb-2 flex items-center gap-2 text-[10px] text-[var(--text-quaternary)]">
							<button
								type="button"
								disabled={
									report.isPending ||
									reportState?.status === "sent" ||
									reportState?.status === "duplicate-suppressed" ||
									(reportState?.status === "failed" && !reportState.retryable)
								}
								onClick={() =>
									report.mutate({
										connectionId,
										hermesSessionId: sessionId,
										turnId: reportable.turnId ?? "",
									})
								}
								className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] disabled:opacity-50"
							>
								{report.isPending
									? "Reporting…"
									: reportState?.status === "failed"
										? reportState.retryable
											? "Retry report to Slack"
											: "Report failed"
										: reportState?.status === "sent"
											? "Sent to Slack"
											: reportState?.status === "duplicate-suppressed"
												? "Already sent"
												: "Report result to Slack"}
							</button>
							<span>Hermes resolves the original thread and delivery credentials.</span>
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
							placeholder={
								resumed ? "Continue this agent thread…" : "Claiming and resuming session…"
							}
							disabled={!resumed || status.data?.status !== "connected"}
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
								disabled={!composer.trim() || !resumed || submit.isPending}
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
