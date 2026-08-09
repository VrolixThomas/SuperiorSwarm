import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	type HermesSessionFilter,
	filterHermesSessions,
	groupHermesSessions,
	hermesConnectionFormPolicy,
} from "../../hermes/hermes-view-model";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";

function relativeTime(timestamp: number): string {
	if (!timestamp) return "Unknown";
	const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
	const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000));
	if (minutes < 1) return "Now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

function sourceBadge(source: string): string {
	switch (source.toLowerCase()) {
		case "slack":
			return "◫";
		case "telegram":
			return "✈";
		case "desktop":
			return "▣";
		case "tui":
			return ">_";
		case "superiorswarm":
			return "A";
		default:
			return "◇";
	}
}

export function HermesSidebar() {
	const selectedSession = useTabStore((state) => state.selectedHermesSession);
	const selectSession = useTabStore((state) => state.selectHermesSession);
	const changeConnection = useTabStore((state) => state.changeHermesConnection);
	const [connectionId, setConnectionId] = useState<string | null>(null);
	const [filter, setFilter] = useState<HermesSessionFilter>("open");
	const [query, setQuery] = useState("");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [label, setLabel] = useState("External Hermes");
	const [baseUrl, setBaseUrl] = useState("");
	const [profileId, setProfileId] = useState("default");
	const [token, setToken] = useState("");
	const [newTopic, setNewTopic] = useState("");
	const autoConnectAttempted = useRef(new Set<string>());
	const newSessionSubmitting = useRef(false);
	const utils = trpc.useUtils();

	const connections = trpc.hermes.connections.useQuery();
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
			selectSession({ connectionId, sessionId: binding.durableSessionId });
			setNewTopic("");
			void utils.hermes.catalog.invalidate({ connectionId });
		},
	});
	const linkIndex = trpc.hermes.workspaceLinkIndex.useQuery(
		{ connectionId: connectionId ?? "" },
		{ enabled: Boolean(connectionId), refetchInterval: connected ? 3_000 : false }
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
	const sessions = filterHermesSessions(
		catalog.data?.sessions ?? [],
		filter,
		query,
		linkedBranches
	);
	const groupedSessions = groupHermesSessions(sessions);

	function submitConnection(event: FormEvent) {
		event.preventDefault();
		saveConnection.mutate({
			id: activeConnection?.managementMode === "external" ? activeConnection.id : undefined,
			label,
			baseUrl,
			profileId,
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
				<button
					type="button"
					onClick={() => {
						if (activeConnection?.managementMode === "external") {
							setLabel(activeConnection.label);
							setBaseUrl(activeConnection.baseUrl ?? "");
							setProfileId(activeConnection.profileId);
						} else {
							setLabel("External Hermes");
							setBaseUrl("");
							setProfileId(activeConnection?.profileId ?? "default");
						}
						setShowAdvanced(true);
					}}
					className="flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					title="Connect external Hermes"
					aria-label="Advanced connection settings"
				>
					•••
				</button>
			</div>

			{showAdvanced && (
				<form
					onSubmit={submitConnection}
					className="absolute left-2 right-2 top-11 z-30 flex min-w-0 flex-col gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]"
				>
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
									setConnectionId(managedConnection?.id ?? null);
									return;
								}
								setConnectionId(selected.id);
								setLabel(selected.label);
								setBaseUrl(selected.baseUrl ?? "");
								setProfileId(selected.profileId);
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
					{showTokenInput && (
						<input
							type="password"
							value={token}
							onChange={(event) => setToken(event.target.value)}
							placeholder={activeConnection?.hasToken ? "Token unchanged" : "Hermes session token"}
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
							disabled={!canSave || saveConnection.isPending}
							className="rounded-[6px] bg-[var(--accent)] px-2.5 py-1.5 text-[10px] text-white disabled:opacity-40"
						>
							Save & connect
						</button>
						{activeConnection?.managementMode === "external" && managedConnection && (
							<button
								type="button"
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
							onClick={() => setShowAdvanced(false)}
							className="rounded-[6px] px-2.5 py-1.5 text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]"
						>
							Cancel
						</button>
					</div>
				</form>
			)}

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

					<div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-2">
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
						{[
							{ title: "Handovers", rows: groupedSessions.handovers },
							{ title: "Sessions", rows: groupedSessions.sessions },
						].map(
							(section) =>
								section.rows.length > 0 && (
									<section key={section.title} className="mb-2">
										<div className="px-2 pb-1 pt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-quaternary)]">
											{section.title}
										</div>
										{section.rows.map((session) => {
											const links = linkIndex.data?.[session.id];
											return (
												<button
													key={session.id}
													type="button"
													onClick={() =>
														connectionId && selectSession({ connectionId, sessionId: session.id })
													}
													className={`mb-0.5 min-h-[56px] w-full min-w-0 rounded-[8px] border-l-2 px-2.5 py-2 text-left transition-colors motion-reduce:transition-none ${
														selectedSession?.connectionId === connectionId &&
														selectedSession.sessionId === session.id
															? "border-l-[var(--accent)] bg-[var(--bg-elevated)]"
															: session.waitingForUser
																? "border-l-[var(--warning)] hover:bg-[var(--bg-overlay)]"
																: "border-l-transparent hover:bg-[var(--bg-overlay)]"
													}`}
												>
													<div className="flex items-center gap-1.5">
														<span className="text-[10px]" aria-hidden="true">
															{sourceBadge(session.source)}
														</span>
														<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-secondary)]">
															{session.title}
														</span>
														<span className="text-[9px] text-[var(--text-quaternary)]">
															{relativeTime(session.updatedAt)}
														</span>
													</div>
													<div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-quaternary)]">
														{session.waitingForUser ? (
															<span className="shrink-0 text-[var(--warning)]">Needs input</span>
														) : session.running || session.busy ? (
															<span className="shrink-0 text-[var(--success)]">Active</span>
														) : null}
														<span className="truncate">
															{session.preview || session.origin?.displayLabel || session.source}
															{links?.branches[0] ? ` · ${links.branches[0]}` : ""}
														</span>
													</div>
												</button>
											);
										})}
									</section>
								)
						)}
					</div>
				</>
			)}
		</div>
	);
}
