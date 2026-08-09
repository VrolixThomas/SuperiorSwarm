import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	type HermesSessionFilter,
	buildHermesTicketChoices,
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
	const [newTicketChoice, setNewTicketChoice] = useState("");
	const [newWorkspaceId, setNewWorkspaceId] = useState("");
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
	const availableWorkspaces = trpc.hermes.availableWorkspaces.useQuery();
	const cachedTickets = trpc.tickets.getCachedTickets.useQuery();
	const linkedTickets = trpc.tickets.getLinkedTickets.useQuery();
	const ticketChoices = useMemo(
		() =>
			buildHermesTicketChoices(cachedTickets.data, linkedTickets.data, availableWorkspaces.data),
		[availableWorkspaces.data, cachedTickets.data, linkedTickets.data]
	);
	const create = trpc.hermes.create.useMutation({
		onSuccess: (binding) => {
			if (!connectionId) return;
			selectSession({ connectionId, sessionId: binding.durableSessionId });
			setNewTopic("");
			setNewTicketChoice("");
			setNewWorkspaceId("");
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
		const workspace = availableWorkspaces.data?.find(
			(candidate) => candidate.id === newWorkspaceId
		);
		newSessionSubmitting.current = true;
		create.mutate(
			{
				connectionId,
				topic,
				profileId: activeConnection?.profileId,
				...(workspace?.cwd ? { cwd: workspace.cwd } : {}),
			},
			{
				onSettled: () => {
					newSessionSubmitting.current = false;
				},
			}
		);
	}

	if (showAdvanced) {
		return (
			<form onSubmit={submitConnection} className="flex min-h-0 flex-1 flex-col gap-2 p-3">
				<div className="text-[12px] font-medium text-[var(--text-secondary)]">
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
						className="rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)]"
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
					className="rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
				/>
				<input
					value={baseUrl}
					onChange={(event) => setBaseUrl(event.target.value)}
					placeholder="https://hermes.example.com"
					className="rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
				/>
				<input
					value={profileId}
					onChange={(event) => setProfileId(event.target.value)}
					placeholder="Profile"
					className="rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
				/>
				{showTokenInput && (
					<input
						type="password"
						value={token}
						onChange={(event) => setToken(event.target.value)}
						placeholder={activeConnection?.hasToken ? "Token unchanged" : "Hermes session token"}
						autoComplete="off"
						className="rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
					/>
				)}
				<div className="text-[10px] leading-4 text-[var(--text-quaternary)]">
					Advanced external connections require an explicit secure URL and token. Stored tokens stay
					protected and never re-enter renderer state.
				</div>
				{saveConnection.error && (
					<div className="text-[11px] text-[var(--danger)]">{saveConnection.error.message}</div>
				)}
				<div className="flex gap-2">
					<button
						type="submit"
						disabled={!canSave || saveConnection.isPending}
						className="rounded-[5px] bg-[var(--accent)] px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
					>
						Save & connect
					</button>
					<button
						type="button"
						onClick={() => setShowAdvanced(false)}
						className="rounded-[5px] px-2.5 py-1.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
					>
						Cancel
					</button>
				</div>
			</form>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-1.5 px-2 pt-2">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[11px] font-medium text-[var(--text-secondary)]">
						{activeConnection?.managementMode === "external"
							? activeConnection.label
							: "Local Hermes"}
					</div>
					<div className="truncate text-[9px] text-[var(--text-quaternary)]">
						{activeConnection?.managementMode === "external" ? "External" : "Automatic"} ·{" "}
						{activeConnection?.profileId ?? "default"}
					</div>
				</div>
				{activeConnection?.managementMode === "external" && managedConnection && (
					<button
						type="button"
						onClick={() => {
							connect.reset();
							setConnectionId(managedConnection.id);
							changeConnection(managedConnection.id);
						}}
						className="rounded-[5px] px-2 py-1 text-[10px] text-[var(--accent)] hover:bg-[var(--bg-elevated)]"
					>
						Use local
					</button>
				)}
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
					className="rounded-[5px] px-2 py-1 text-[11px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)]"
					title="Connect external Hermes"
				>
					Advanced
				</button>
			</div>

			<div className="flex items-center gap-1.5 px-2 py-2">
				<span
					className={`size-2 rounded-full ${
						connected ? "bg-[#30d158]" : connecting ? "bg-[#ffd60a]" : "bg-[var(--text-quaternary)]"
					}`}
				/>
				<span className="flex-1 text-[10px] text-[var(--text-quaternary)]">
					{connecting ? "connecting" : (status.data?.status ?? "disconnected")}
				</span>
				{!connected && !connecting && connectionId && (
					<button
						type="button"
						onClick={() => connect.mutate({ connectionId })}
						className="text-[10px] text-[var(--accent)] hover:underline"
					>
						Retry
					</button>
				)}
			</div>

			{!connected ? (
				<div className="px-3 py-6 text-center text-[11px] leading-5 text-[var(--text-quaternary)]">
					{connect.error?.message ??
						status.data?.error ??
						(activeConnection?.managementMode === "external"
							? "Connect the external Hermes gateway to load sessions."
							: "Local Hermes starts automatically when Agents opens.")}
				</div>
			) : (
				<>
					<div className="px-2 pb-2">
						<form onSubmit={submitNewSession} className="mb-2 flex flex-col gap-1.5">
							<div className="text-[10px] font-medium text-[var(--text-tertiary)]">New session</div>
							<textarea
								value={newTopic}
								onChange={(event) => setNewTopic(event.target.value)}
								placeholder="What should this agent work on? Ticket ID, title, or a full prompt"
								rows={3}
								className="w-full resize-y rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
							/>
							{ticketChoices.length > 0 && (
								<select
									value={newTicketChoice}
									onChange={(event) => {
										const value = event.target.value;
										setNewTicketChoice(value);
										const choice = ticketChoices.find((candidate) => candidate.value === value);
										if (!choice) return;
										setNewTopic(choice.topic);
										setNewWorkspaceId(choice.workspaceId);
									}}
									className="min-w-0 rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
								>
									<option value="">Optional linked ticket…</option>
									{ticketChoices.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							)}
							<div className="flex gap-1.5">
								<select
									value={newWorkspaceId}
									onChange={(event) => setNewWorkspaceId(event.target.value)}
									className="min-w-0 flex-1 rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
								>
									<option value="">No workspace</option>
									{availableWorkspaces.data?.map((workspace) => (
										<option key={workspace.id} value={workspace.id}>
											{workspace.projectName} · {workspace.branch ?? workspace.name}
										</option>
									))}
								</select>
								<button
									type="submit"
									disabled={!connectionId || !newTopic.trim() || create.isPending}
									className="rounded-[5px] bg-[var(--accent)] px-2 py-1 text-[10px] text-white disabled:opacity-40"
								>
									{create.isPending ? "Starting…" : "Start session"}
								</button>
							</div>
						</form>
						{create.error && (
							<div className="mb-2 text-[10px] text-[var(--danger)]">{create.error.message}</div>
						)}
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search sessions, source, repo, branch"
							className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
						/>
						<div className="mt-1.5 flex gap-1">
							{(["open", "all", "archived"] as const).map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setFilter(value)}
									className={`rounded-[4px] px-2 py-0.5 text-[10px] capitalize ${
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

					<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
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
										<div className="px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
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
													className={`mb-1 w-full rounded-[6px] px-2 py-2 text-left transition-colors ${
														selectedSession?.connectionId === connectionId &&
														selectedSession.sessionId === session.id
															? "bg-[var(--bg-elevated)]"
															: "hover:bg-[var(--bg-overlay)]"
													}`}
												>
													<div className="flex items-center gap-1.5">
														<span className="text-[10px]" aria-hidden="true">
															{sourceBadge(session.source)}
														</span>
														<span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
															{session.title}
														</span>
														<span className="text-[9px] text-[var(--text-quaternary)]">
															{relativeTime(session.updatedAt)}
														</span>
													</div>
													<div className="mt-1 flex items-center gap-1 text-[9px] text-[var(--text-quaternary)]">
														{session.running && <span className="text-[#30d158]">running</span>}
														{session.busy && <span className="text-[#ffd60a]">busy</span>}
														{session.waitingForUser && (
															<span className="text-[#ff9f0a]">needs input</span>
														)}
														<span className="truncate">
															{session.origin?.displayLabel ?? session.source} · {session.profileId}
														</span>
														{links && (
															<span>
																{links.count} workspace{links.count === 1 ? "" : "s"}
															</span>
														)}
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
