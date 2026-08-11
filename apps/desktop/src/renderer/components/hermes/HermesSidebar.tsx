import {
	type FormEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type HermesSessionSummary,
	type HermesTagDefinition,
	hermesSessionCompositeIdentityKey,
	hermesSessionIdentityKey,
	hermesSessionLineageRootId,
	hermesSessionMatchesId,
} from "../../../shared/hermes";
import {
	HERMES_SESSION_ROW_ESTIMATE_PX,
	type HermesSessionFilter,
	filterHermesSessions,
	groupHermesSessions,
	hermesConnectionFormPolicy,
	hermesSessionVirtualRange,
} from "../../hermes/hermes-view-model";
import { normalizeHermesSessionSelection, useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { HermesSessionRow } from "./HermesSessionRow";
import { OverflowPopover } from "./OverflowPopover";

interface FailedSessionAction {
	kind: "archive" | "unarchive";
	session: HermesSessionSummary;
	message: string;
}

const PERMANENT_DELETE_DISABLED_REASON =
	"Permanent delete is unavailable because stock Hermes cannot atomically verify that a session stayed idle. Archive is the safe cleanup option.";

export function HermesSidebar() {
	const selectedSession = useTabStore((state) => state.selectedHermesSession);
	const selectSession = useTabStore((state) => state.selectHermesSession);
	const forgetSession = useTabStore((state) => state.forgetHermesSession);
	const changeConnection = useTabStore((state) => state.changeHermesConnection);
	const [connectionId, setConnectionId] = useState<string | null>(null);
	const [filter, setFilter] = useState<HermesSessionFilter>("open");
	const [query, setQuery] = useState("");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [label, setLabel] = useState("External Hermes");
	const [baseUrl, setBaseUrl] = useState("");
	const [profileId, setProfileId] = useState("default");
	const [managerId, setManagerId] = useState<string | null>(null);
	const [token, setToken] = useState("");
	const [newTopic, setNewTopic] = useState("");
	const [failedSessionAction, setFailedSessionAction] = useState<FailedSessionAction | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [reconciliationRequired, setReconciliationRequired] = useState(false);
	const autoConnectAttempted = useRef(new Set<string>());
	const newSessionSubmitting = useRef(false);
	const sessionScrollerRef = useRef<HTMLDivElement | null>(null);
	const sessionListRef = useRef<HTMLDivElement | null>(null);
	const [sessionViewport, setSessionViewport] = useState({ scrollTop: 0, height: 600 });
	const utils = trpc.useUtils();

	const connections = trpc.hermes.connections.useQuery();
	const externalManagers = trpc.externalManagers.list.useQuery();
	const activeConnection = connections.data?.find((connection) => connection.id === connectionId);
	const managedConnection = connections.data?.find(
		(connection) => connection.managementMode === "managed"
	);
	const externalConnections = connections.data?.filter(
		(connection) => connection.managementMode === "external"
	);
	const { showTokenInput, canSave } = hermesConnectionFormPolicy({
		baseUrl,
		hasStoredToken:
			activeConnection?.managementMode === "external" ? activeConnection.hasToken : false,
		storedBaseUrl:
			activeConnection?.managementMode === "external" ? activeConnection.baseUrl : null,
		profileId,
		storedProfileId:
			activeConnection?.managementMode === "external" ? activeConnection.profileId : null,
		tokenInput: token,
	});
	const connect = trpc.hermes.connect.useMutation({
		onSuccess: () => {
			void utils.hermes.status.invalidate();
			void utils.hermes.catalog.invalidate();
			void utils.hermes.connections.invalidate();
		},
	});
	const saveConnection = trpc.hermes.saveConnection.useMutation({
		onSuccess: async (saved) => {
			changeConnection(saved.id);
			setConnectionId(saved.id);
			setToken("");
			setShowAdvanced(false);
			await utils.hermes.connections.invalidate();
			connect.mutate({ connectionId: saved.id });
		},
	});

	useEffect(() => {
		if (!connections.data) return;
		const selectedConnectionExists = selectedSession
			? connections.data.some((connection) => connection.id === selectedSession.connectionId)
			: false;
		if (selectedSession && !selectedConnectionExists) changeConnection("");
		const currentConnectionExists = connections.data.some(
			(connection) => connection.id === connectionId
		);
		const nextConnectionId = selectedConnectionExists
			? selectedSession?.connectionId
			: currentConnectionExists
				? connectionId
				: (managedConnection?.id ?? connections.data[0]?.id);
		if (nextConnectionId && nextConnectionId !== connectionId) {
			setConnectionId(nextConnectionId);
		}
	}, [changeConnection, connectionId, connections.data, managedConnection?.id, selectedSession]);

	const status = trpc.hermes.status.useQuery(
		{ connectionId: connectionId ?? "" },
		{ enabled: Boolean(connectionId), refetchInterval: 1_000 }
	);
	const connected = status.data?.status === "connected";
	const connecting =
		connect.isPending ||
		status.data?.status === "connecting" ||
		status.data?.status === "reconnecting";
	const catalog = trpc.hermes.catalog.useQuery(
		{ connectionId: connectionId ?? "" },
		{
			enabled: Boolean(connectionId) && connected,
			refetchInterval: connected ? 5_000 : false,
		}
	);
	const create = trpc.hermes.create.useMutation({
		onSuccess: (binding) => {
			if (!connectionId) return;
			selectSession({
				connectionId,
				profileId: binding.profileId,
				sessionId: binding.durableSessionId,
			});
			setNewTopic("");
			void utils.hermes.catalog.invalidate({ connectionId });
		},
	});
	const setSessionArchived = trpc.hermes.setSessionArchived.useMutation({
		onSuccess: (canonicalCatalog, variables) => {
			setFailedSessionAction(null);
			utils.hermes.catalog.setData({ connectionId: variables.connectionId }, canonicalCatalog);
			void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
		},
		onError: (error, variables) => {
			const session = catalog.data?.sessions.find(
				(item) =>
					item.profileId === variables.profileId &&
					hermesSessionMatchesId(item, variables.hermesSessionId)
			);
			if (!session) return;
			setFailedSessionAction({
				kind: variables.archived ? "archive" : "unarchive",
				session,
				message: error.message,
			});
		},
	});
	function updateSessionMetadata(
		variables: { connectionId: string; profileId: string; hermesSessionId: string },
		metadata: { customTitle: string | null; tags: HermesTagDefinition[]; revision: number }
	) {
		utils.hermes.catalog.setData({ connectionId: variables.connectionId }, (current) =>
			current
				? {
						...current,
						sessions: current.sessions.map((session) =>
							session.profileId === variables.profileId &&
							hermesSessionMatchesId(session, variables.hermesSessionId)
								? {
										...session,
										title: metadata.customTitle ?? session.generatedTitle,
										titleSource: metadata.customTitle === null ? "generated" : "custom",
										tags: metadata.tags,
										metadataRevision: metadata.revision,
									}
								: session
						),
					}
				: current
		);
		void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
	}
	const setSessionTitle = trpc.hermes.setSessionTitle.useMutation({
		onSuccess: (metadata, variables) => updateSessionMetadata(variables, metadata),
		onError: (_error, variables) => {
			void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
		},
	});
	const assignTagDefinition = trpc.hermes.assignTagDefinition.useMutation({
		onSuccess: (metadata, variables) => updateSessionMetadata(variables, metadata),
		onError: (_error, variables) => {
			void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
		},
	});
	const unassignTagDefinition = trpc.hermes.unassignTagDefinition.useMutation({
		onSuccess: (metadata, variables) => updateSessionMetadata(variables, metadata),
		onError: (_error, variables) => {
			void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
		},
	});
	const upsertTagDefinition = trpc.hermes.upsertTagDefinition.useMutation();
	const updateTagDefinition = trpc.hermes.updateTagDefinition.useMutation({
		onSuccess: (_definition, variables) => {
			void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
		},
	});
	const deleteTagDefinition = trpc.hermes.deleteTagDefinition.useMutation({
		onSuccess: (_result, variables) => {
			void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
		},
	});
	const deleteSession = trpc.hermes.deleteSession.useMutation({
		onSuccess: (result, variables) => {
			setFailedSessionAction(null);
			setDeleteError(null);
			setReconciliationRequired(result.reconciliationRequired);
			if (result.catalog) {
				utils.hermes.catalog.setData({ connectionId: variables.connectionId }, result.catalog);
			} else {
				utils.hermes.catalog.setData({ connectionId: variables.connectionId }, (current) =>
					current
						? {
								...current,
								sessions: current.sessions.filter(
									(session) =>
										!hermesSessionMatchesId(session, variables.hermesSessionId) ||
										session.profileId !== variables.profileId
								),
							}
						: current
				);
			}
			forgetSession({
				connectionId: variables.connectionId,
				profileId: variables.profileId,
				sessionId: variables.hermesSessionId,
			});
			void utils.hermes.catalog.invalidate({ connectionId: variables.connectionId });
			void utils.hermes.workspaceLinkIndex.invalidate({ connectionId: variables.connectionId });
		},
		onError: (error) => {
			setDeleteError(error.message);
		},
	});
	const linkIndex = trpc.hermes.workspaceLinkIndex.useQuery(
		{ connectionId: connectionId ?? "" },
		{ enabled: Boolean(connectionId), refetchInterval: 3_000 }
	);

	useEffect(() => {
		const canAutoConnect =
			activeConnection?.managementMode === "managed" || activeConnection?.hasToken === true;
		if (!canAutoConnect || !connectionId || connected || connect.isPending) return;
		if (autoConnectAttempted.current.has(connectionId)) return;
		autoConnectAttempted.current.add(connectionId);
		connect.mutate({ connectionId });
	}, [
		activeConnection?.hasToken,
		activeConnection?.managementMode,
		connect,
		connected,
		connectionId,
	]);

	const linkedBranches = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(linkIndex.data ?? {}).map(([sessionId, entry]) => [
					sessionId,
					[...entry.branches, ...entry.projectNames],
				])
			),
		[linkIndex.data]
	);
	const sessions = useMemo(
		() => filterHermesSessions(catalog.data?.sessions ?? [], filter, query, linkedBranches),
		[catalog.data?.sessions, filter, linkedBranches, query]
	);
	const groupedSessions = useMemo(() => groupHermesSessions(sessions), [sessions]);
	const sessionSections = useMemo(
		() => [
			{ title: "Handovers", rows: groupedSessions.handovers, offset: 0 },
			{
				title: "Sessions",
				rows: groupedSessions.sessions,
				offset: groupedSessions.handovers.length,
			},
		],
		[groupedSessions]
	);
	const sessionVirtualRange = hermesSessionVirtualRange(
		sessions.length,
		sessionViewport.scrollTop,
		sessionViewport.height
	);
	const updateSessionViewport = useCallback(() => {
		const scroller = sessionScrollerRef.current;
		if (!scroller) return;
		const listOffset = sessionListRef.current?.offsetTop ?? 0;
		const next = {
			scrollTop: Math.max(0, scroller.scrollTop - listOffset),
			height: scroller.clientHeight || 600,
		};
		setSessionViewport((current) =>
			current.scrollTop === next.scrollTop && current.height === next.height ? current : next
		);
	}, []);

	useLayoutEffect(() => {
		// A catalog size change can move the list below transient action banners.
		void sessions.length;
		updateSessionViewport();
		const scroller = sessionScrollerRef.current;
		if (!scroller || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(updateSessionViewport);
		observer.observe(scroller);
		return () => observer.disconnect();
	}, [sessions.length, updateSessionViewport]);

	useEffect(() => {
		if (!selectedSession || selectedSession.connectionId !== connectionId || !catalog.data) return;
		const normalized = normalizeHermesSessionSelection(selectedSession, catalog.data.sessions);
		// A stock catalog page is not a deletion authority: compaction and pagination can
		// temporarily omit the selected row. Explicit delete/connection removal owns clearing.
		if (!normalized) return;
		if (
			normalized.profileId !== selectedSession.profileId ||
			normalized.sessionId !== selectedSession.sessionId
		) {
			selectSession(normalized);
		}
	}, [catalog.data, connectionId, selectSession, selectedSession]);

	function submitConnection(event: FormEvent) {
		event.preventDefault();
		saveConnection.mutate({
			id: activeConnection?.managementMode === "external" ? activeConnection.id : undefined,
			label,
			baseUrl,
			profileId,
			managerId,
			...(showTokenInput && token ? { token } : {}),
		});
	}

	function submitNewSession(event: FormEvent) {
		event.preventDefault();
		const topic = newTopic.trim();
		if (!connectionId || !topic || newSessionSubmitting.current) return;
		newSessionSubmitting.current = true;
		create.mutate(
			{
				connectionId,
				topic,
				profileId: activeConnection?.profileId,
			},
			{
				onSettled: () => {
					newSessionSubmitting.current = false;
				},
			}
		);
	}

	function setAdvancedPopoverOpen(open: boolean) {
		if (open) {
			if (activeConnection?.managementMode === "external") {
				setLabel(activeConnection.label);
				setBaseUrl(activeConnection.baseUrl ?? "");
				setProfileId(activeConnection.profileId);
				setManagerId(
					activeConnection.managerBindingMode === "auto" ? null : activeConnection.managerId
				);
			} else {
				setLabel("External Hermes");
				setBaseUrl("");
				setProfileId(activeConnection?.profileId ?? "default");
				setManagerId(null);
			}
		}
		setShowAdvanced(open);
	}

	function mutateSessionArchive(session: HermesSessionSummary, archived: boolean) {
		if (!connectionId) return;
		setFailedSessionAction(null);
		setSessionArchived.mutate({
			connectionId,
			profileId: session.profileId,
			hermesSessionId: hermesSessionLineageRootId(session),
			archived,
		});
	}

	function mutateSessionDelete(session: HermesSessionSummary) {
		if (!connectionId) return;
		setFailedSessionAction(null);
		deleteSession.mutate({
			connectionId,
			profileId: session.profileId,
			hermesSessionId: hermesSessionLineageRootId(session),
			confirmed: true,
		});
	}

	function retryFailedSessionAction() {
		if (!failedSessionAction) return;
		mutateSessionArchive(failedSessionAction.session, failedSessionAction.kind === "archive");
	}

	function refreshAfterCommittedDelete() {
		if (!connectionId) return;
		void utils.hermes.catalog.invalidate({ connectionId }).then(
			() => setReconciliationRequired(false),
			() => undefined
		);
	}

	return (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<div className="flex h-11 min-w-0 shrink-0 items-center gap-2 px-3">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-secondary)]">
						Agent sessions
					</div>
					<div className="flex items-center gap-1 text-[9px] text-[var(--text-quaternary)]">
						<span
							className={`size-1.5 rounded-full ${
								connected
									? "bg-[var(--success)]"
									: connecting
										? "bg-[var(--warning)]"
										: "bg-[var(--text-quaternary)]"
							}`}
						/>
						<span className="truncate">
							{activeConnection?.managementMode === "external"
								? activeConnection.label
								: "Local Hermes"}
						</span>
					</div>
				</div>
				<OverflowPopover
					label="Manage agent connections"
					open={showAdvanced}
					onOpenChange={setAdvancedPopoverOpen}
					panelClassName="flex flex-col gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]"
				>
					<form onSubmit={submitConnection} className="flex min-w-0 flex-col gap-2">
						<div className="text-[11px] font-medium text-[var(--text-secondary)]">
							Connect external Hermes
						</div>
						{externalConnections && externalConnections.length > 0 && (
							<select
								value={activeConnection?.managementMode === "external" ? activeConnection.id : ""}
								onChange={(event) => {
									const selected = externalConnections.find(
										(connection) => connection.id === event.target.value
									);
									if (!selected) {
										setLabel("External Hermes");
										setBaseUrl("");
										setProfileId("default");
										setManagerId(null);
										setConnectionId(managedConnection?.id ?? null);
										return;
									}
									setConnectionId(selected.id);
									setLabel(selected.label);
									setBaseUrl(selected.baseUrl ?? "");
									setProfileId(selected.profileId);
									setManagerId(selected.managerBindingMode === "auto" ? null : selected.managerId);
								}}
								className="min-w-0 max-w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)]"
							>
								<option value="">New external connection…</option>
								{externalConnections.map((connection) => (
									<option key={connection.id} value={connection.id}>
										{connection.label}
									</option>
								))}
							</select>
						)}
						<input
							value={label}
							onChange={(event) => setLabel(event.target.value)}
							placeholder="Label"
							aria-label="Connection label"
							className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
						/>
						<input
							value={baseUrl}
							onChange={(event) => setBaseUrl(event.target.value)}
							placeholder="https://hermes.example.com"
							aria-label="Hermes URL"
							className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
						/>
						<input
							value={profileId}
							onChange={(event) => setProfileId(event.target.value)}
							placeholder="Profile"
							aria-label="Hermes profile"
							className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
						/>
						<select
							value={managerId ?? ""}
							onChange={(event) => setManagerId(event.target.value || null)}
							aria-label="SuperiorSwarm manager"
							className="min-w-0 max-w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)]"
						>
							<option value="">Auto-detect local MCP identity</option>
							{externalManagers.data?.map((manager) => (
								<option key={manager.id} value={manager.id}>
									{manager.name}
								</option>
							))}
						</select>
						{showTokenInput && (
							<input
								type="password"
								value={token}
								onChange={(event) => setToken(event.target.value)}
								placeholder={
									activeConnection?.hasToken ? "Token unchanged" : "Hermes session token"
								}
								autoComplete="off"
								aria-label="Hermes session token"
								className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
							/>
						)}
						<div className="text-[9px] leading-4 text-[var(--text-quaternary)]">
							Stored tokens stay protected and never re-enter renderer state.
						</div>
						{saveConnection.error && (
							<div className="text-[10px] text-[var(--danger)] [overflow-wrap:anywhere]">
								{saveConnection.error.message}
							</div>
						)}
						<div className="flex flex-wrap gap-1.5">
							<button
								type="submit"
								data-popover-close
								disabled={!canSave || saveConnection.isPending}
								className="rounded-[6px] bg-[var(--accent)] px-2.5 py-1.5 text-[10px] text-white disabled:opacity-40"
							>
								Save & connect
							</button>
							{activeConnection?.managementMode === "external" && managedConnection && (
								<button
									type="button"
									data-popover-close
									onClick={() => {
										connect.reset();
										setConnectionId(managedConnection.id);
										changeConnection(managedConnection.id);
										setShowAdvanced(false);
									}}
									className="rounded-[6px] px-2.5 py-1.5 text-[10px] text-[var(--accent)] hover:bg-[var(--bg-overlay)]"
								>
									Use local
								</button>
							)}
							<button
								type="button"
								data-popover-close
								onClick={() => setShowAdvanced(false)}
								className="rounded-[6px] px-2.5 py-1.5 text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]"
							>
								Cancel
							</button>
						</div>
					</form>
				</OverflowPopover>
			</div>

			{!connected ? (
				<div className="min-w-0 px-3 py-5 text-center text-[10px] leading-5 text-[var(--text-quaternary)] [overflow-wrap:anywhere]">
					<div>
						{connect.error?.message ??
							status.data?.error ??
							(activeConnection?.managementMode === "external"
								? "Connect the external Hermes gateway to load sessions."
								: "Local Hermes starts automatically when Agents opens.")}
					</div>
					{!connecting && connectionId && (
						<button
							type="button"
							onClick={() => connect.mutate({ connectionId })}
							className="mt-2 rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--accent)]"
						>
							Retry
						</button>
					)}
				</div>
			) : (
				<>
					<div className="min-w-0 px-2 pb-2">
						<details className="group mb-2 min-w-0 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-base)]/35">
							<summary className="flex h-9 cursor-pointer list-none items-center gap-2 px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/50 [&::-webkit-details-marker]:hidden">
								<span className="text-[16px] leading-none text-[var(--accent)]">+</span>
								New agent session
							</summary>
							<form
								onSubmit={submitNewSession}
								className="flex min-w-0 flex-col gap-1.5 border-t border-[var(--border-subtle)] p-2"
							>
								<textarea
									value={newTopic}
									onChange={(event) => setNewTopic(event.target.value)}
									placeholder="Describe the task for this agent"
									rows={3}
									className="min-w-0 resize-y rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
								/>
								<div className="flex justify-end">
									<button
										type="submit"
										disabled={!connectionId || !newTopic.trim() || create.isPending}
										className="shrink-0 rounded-[6px] bg-[var(--accent)] px-2 py-1 text-[10px] text-white disabled:opacity-40"
									>
										{create.isPending ? "Starting…" : "Start session"}
									</button>
								</div>
							</form>
						</details>
						{create.error && (
							<div className="mb-2 text-[10px] text-[var(--danger)]">{create.error.message}</div>
						)}
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search sessions"
							aria-label="Search agent sessions"
							className="w-full min-w-0 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-2 text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)]"
						/>
						<div className="mt-1.5 flex gap-0.5">
							{(["open", "all", "archived"] as const).map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setFilter(value)}
									className={`rounded-[5px] px-2 py-0.5 text-[9px] capitalize ${
										filter === value
											? "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
											: "text-[var(--text-quaternary)]"
									}`}
								>
									{value}
								</button>
							))}
						</div>
					</div>

					<div
						ref={sessionScrollerRef}
						onScroll={updateSessionViewport}
						className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-2"
					>
						{failedSessionAction && (
							<div
								role="alert"
								className="mx-1 mb-1.5 rounded-[7px] border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2 py-1.5 text-[10px] text-[var(--danger)]"
							>
								<div className="[overflow-wrap:anywhere]">{failedSessionAction.message}</div>
								<button
									type="button"
									onClick={retryFailedSessionAction}
									className="mt-1 rounded-[5px] border border-current px-1.5 py-0.5"
								>
									Retry
								</button>
							</div>
						)}
						{deleteError && (
							<div role="alert" className="mx-1 mb-1.5 text-[10px] text-[var(--danger)]">
								{deleteError}
							</div>
						)}
						{reconciliationRequired && (
							<output className="mx-1 mb-1.5 block text-[10px] text-[var(--warning)]">
								The session was deleted, but the session list still needs reconciliation.
								<button
									type="button"
									onClick={refreshAfterCommittedDelete}
									className="ml-1 underline"
								>
									Refresh session list
								</button>
							</output>
						)}
						{catalog.isLoading && (
							<div className="px-2 py-5 text-center text-[11px] text-[var(--text-quaternary)]">
								Loading agent threads…
							</div>
						)}
						{!catalog.isLoading && sessions.length === 0 && (
							<div className="px-2 py-5 text-center text-[11px] text-[var(--text-quaternary)]">
								No matching agent threads
							</div>
						)}
						<div ref={sessionListRef}>
							{sessionSections.map((section) => {
								if (section.rows.length === 0) return null;
								const visibleStart = Math.min(
									section.rows.length,
									Math.max(0, sessionVirtualRange.start - section.offset)
								);
								const visibleEnd = Math.max(
									visibleStart,
									Math.min(section.rows.length, sessionVirtualRange.end - section.offset)
								);
								return (
									<section key={section.title} className="mb-2">
										<div className="px-2 pb-1 pt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-quaternary)]">
											{section.title}
										</div>
										<div
											style={{
												paddingTop: visibleStart * HERMES_SESSION_ROW_ESTIMATE_PX,
												paddingBottom:
													(section.rows.length - visibleEnd) * HERMES_SESSION_ROW_ESTIMATE_PX,
											}}
										>
											{section.rows.slice(visibleStart, visibleEnd).map((session) => {
												const conversationId = hermesSessionLineageRootId(session);
												const links =
													linkIndex.data?.[
														hermesSessionIdentityKey(session.profileId, conversationId)
													];
												return (
													<HermesSessionRow
														key={hermesSessionCompositeIdentityKey(
															connectionId ?? "",
															session.profileId,
															conversationId
														)}
														session={session}
														selected={
															selectedSession?.connectionId === connectionId &&
															selectedSession.profileId === session.profileId &&
															selectedSession.sessionId === conversationId
														}
														linkedBranch={links?.branches[0] ?? null}
														actionPending={
															setSessionArchived.isPending ||
															deleteSession.isPending ||
															setSessionTitle.isPending ||
															assignTagDefinition.isPending ||
															unassignTagDefinition.isPending ||
															upsertTagDefinition.isPending ||
															updateTagDefinition.isPending ||
															deleteTagDefinition.isPending
														}
														onSelect={() =>
															connectionId &&
															selectSession({
																connectionId,
																profileId: session.profileId,
																sessionId: conversationId,
															})
														}
														onSetArchived={(_profileId, _sessionId, archived) =>
															mutateSessionArchive(session, archived)
														}
														onDelete={() => mutateSessionDelete(session)}
														onRename={async (title, expectedRevision) => {
															if (!connectionId) throw new Error("Connection is unavailable");
															await setSessionTitle.mutateAsync({
																connectionId,
																profileId: session.profileId,
																hermesSessionId: conversationId,
																title,
																expectedRevision,
															});
														}}
														onListTagDefinitions={async (tagQuery) => {
															if (!connectionId) throw new Error("Connection is unavailable");
															return await utils.hermes.tagDefinitions.fetch({
																connectionId,
																profileId: session.profileId,
																hermesSessionId: conversationId,
																query: tagQuery,
															});
														}}
														onCreateTag={async (name, color) => {
															if (!connectionId) throw new Error("Connection is unavailable");
															const result = await upsertTagDefinition.mutateAsync({
																connectionId,
																profileId: session.profileId,
																hermesSessionId: conversationId,
																name,
																color,
															});
															return result.definition;
														}}
														onUpdateTag={async (definitionId, update) => {
															if (!connectionId) throw new Error("Connection is unavailable");
															return await updateTagDefinition.mutateAsync({
																connectionId,
																profileId: session.profileId,
																hermesSessionId: conversationId,
																definitionId,
																...update,
															});
														}}
														onDeleteTag={async (definitionId, expectedRevision) => {
															if (!connectionId) throw new Error("Connection is unavailable");
															await deleteTagDefinition.mutateAsync({
																connectionId,
																profileId: session.profileId,
																hermesSessionId: conversationId,
																definitionId,
																expectedRevision,
															});
														}}
														onAssignTag={async (definitionId) => {
															if (!connectionId) throw new Error("Connection is unavailable");
															await assignTagDefinition.mutateAsync({
																connectionId,
																profileId: session.profileId,
																hermesSessionId: conversationId,
																definitionId,
															});
														}}
														onUnassignTag={async (definitionId) => {
															if (!connectionId) throw new Error("Connection is unavailable");
															await unassignTagDefinition.mutateAsync({
																connectionId,
																profileId: session.profileId,
																hermesSessionId: conversationId,
																definitionId,
															});
														}}
														deleteDisabledReason={PERMANENT_DELETE_DISABLED_REASON}
													/>
												);
											})}
										</div>
									</section>
								);
							})}
						</div>
					</div>
				</>
			)}
		</div>
	);
}
