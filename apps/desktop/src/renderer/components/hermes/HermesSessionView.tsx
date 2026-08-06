import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { HermesTranscriptMessage } from "../../../shared/hermes";
import { applyHermesEvent, createHermesLiveState } from "../../hermes/hermes-view-model";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";

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
	const sessionId = useTabStore((state) => state.selectedHermesSessionId);
	const openWorkspaceFromHermes = useTabStore((state) => state.openWorkspaceFromHermes);
	const [composer, setComposer] = useState("");
	const [clarification, setClarification] = useState("");
	const [cursor, setCursor] = useState(0);
	const [live, setLive] = useState(createHermesLiveState);
	const [manualWorkspaceId, setManualWorkspaceId] = useState("");
	const resumedKey = useRef<string | null>(null);
	const utils = trpc.useUtils();

	const connections = trpc.hermes.connections.useQuery();
	const connection = connections.data?.[0] ?? null;
	const connectionId = connection?.id ?? "";
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
	const release = trpc.hermes.release.useMutation({
		onSuccess: () => {
			resumedKey.current = null;
			resume.reset();
			useTabStore.getState().selectHermesSession(null);
			void utils.hermes.catalog.invalidate();
		},
	});

	useEffect(() => {
		if (previousSelectionKey.current === selectionKey) return;
		previousSelectionKey.current = selectionKey;
		setCursor(0);
		setLive(createHermesLiveState());
		setComposer("");
		setClarification("");
		setManualWorkspaceId("");
		resumedKey.current = null;
	}, [selectionKey]);

	useEffect(() => {
		if (!sessionId || !connectionId || status.data?.status !== "connected") return;
		const key = `${connectionId}:${sessionId}`;
		if (resumedKey.current === key || resume.isPending) return;
		resume.reset();
		resumedKey.current = key;
		resume.mutate(
			{ connectionId, hermesSessionId: sessionId },
			{
				onError: () => {
					resumedKey.current = null;
				},
			}
		);
	}, [connectionId, resume, sessionId, status.data?.status]);

	const resumed = resume.data && sessionId ? resume.data : null;
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
		if (!feed || !resumed) return;
		let refreshHistory = false;
		setLive((current) => {
			let next = current;
			for (const entry of feed.events) {
				if (entry.event.sessionId !== null && entry.event.sessionId !== resumed.runtimeSessionId) {
					continue;
				}
				next = applyHermesEvent(next, entry.event);
				if (
					entry.event.type === "message.complete" ||
					entry.event.type === "runtime.history-refresh-required"
				) {
					refreshHistory = true;
				}
			}
			return next;
		});
		setCursor(feed.nextSeq);
		if (refreshHistory) {
			void utils.hermes.history.invalidate({
				connectionId,
				hermesSessionId: sessionId ?? "",
			});
			void utils.hermes.workspaceLinks.invalidate();
		}
	}, [connectionId, eventFeed.data, resumed, sessionId, utils]);

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

	const reportable = useMemo(() => {
		const completed = live.completed.at(-1);
		if (completed?.turnId && completed.text) return completed;
		const messages = history.data ?? [];
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (
				message?.role === "assistant" &&
				message.turnId &&
				message.text &&
				message.status !== "error"
			) {
				return { turnId: message.turnId, text: message.text };
			}
		}
		return null;
	}, [history.data, live.completed]);
	const reportState = reportable
		? reports.data?.find((candidate) => candidate.turnId === reportable.turnId)
		: null;

	function send(event: FormEvent) {
		event.preventDefault();
		if (!composer.trim() || !sessionId) return;
		submit.mutate({ connectionId, hermesSessionId: sessionId, text: composer.trim() });
	}

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
						Release
					</button>
				</div>
			</header>

			{(resume.error || live.error) && (
				<div className="shrink-0 border-b border-[var(--danger)]/20 bg-[var(--danger)]/5 px-4 py-2 text-[11px] text-[var(--danger)]">
					{resume.error?.message ?? live.error}
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
				<div className="mx-auto flex max-w-[860px] flex-col gap-3">
					{history.isLoading && (
						<div className="py-8 text-center text-[12px] text-[var(--text-quaternary)]">
							Resuming canonical Hermes history…
						</div>
					)}
					{history.data?.map((message) => (
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
												openWorkspaceFromHermes(link.workspaceId, link.worktreePath, sessionId);
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
						<div className="mb-2 rounded-[7px] border border-[#ffd60a]/30 bg-[#ffd60a]/5 p-2">
							<div className="text-[11px] text-[var(--text-secondary)]">
								{live.pendingApproval.prompt}
							</div>
							<div className="mt-2 flex gap-2">
								<button
									type="button"
									onClick={() =>
										approval.mutate({
											connectionId,
											hermesSessionId: sessionId,
											requestId: live.pendingApproval?.requestId ?? "",
											choice: live.pendingApproval?.choices[0] ?? "allow_once",
										})
									}
									className="rounded-[5px] bg-[var(--accent)] px-2 py-1 text-[11px] text-white"
								>
									Allow once
								</button>
								<button
									type="button"
									onClick={() =>
										approval.mutate({
											connectionId,
											hermesSessionId: sessionId,
											requestId: live.pendingApproval?.requestId ?? "",
											choice: "deny",
										})
									}
									className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-tertiary)]"
								>
									Deny
								</button>
							</div>
						</div>
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
							<div className="mb-1 text-[11px] text-[var(--text-secondary)]">
								{live.pendingClarification.prompt}
							</div>
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
										content: reportable.text,
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
