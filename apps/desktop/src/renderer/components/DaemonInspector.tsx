import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonInspectorData } from "../../shared/types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface InspectorState {
	daemon: DaemonInspectorData | null;
	loading: boolean;
	error: string | null;
}

export function DaemonInspector({ onClose }: { onClose: () => void }) {
	const [state, setState] = useState<InspectorState>({
		daemon: null,
		loading: true,
		error: null,
	});

	const dbQuery = trpc.terminalSessions.listAll.useQuery(undefined, {
		staleTime: 0,
		refetchOnMount: true,
	});
	const dbRefetchRef = useRef(dbQuery.refetch);
	dbRefetchRef.current = dbQuery.refetch;

	const allTabs = useTabStore((s) => s.getAllTabs)();
	const terminalTabs = allTabs.filter((t) => t.kind === "terminal");
	const rendererTabIds = new Set(terminalTabs.map((t) => t.id));

	const refresh = useCallback(async () => {
		setState((s) => ({ ...s, loading: true, error: null }));
		try {
			const data = await window.electron.daemon.listSessions();
			setState({ daemon: data, loading: false, error: null });
		} catch (err) {
			setState({
				daemon: null,
				loading: false,
				error: err instanceof Error ? err.message : "Failed to query daemon",
			});
		}
		dbRefetchRef.current();
	}, []);

	const [killing, setKilling] = useState(false);
	const rendererTabIdsRef = useRef(rendererTabIds);
	rendererTabIdsRef.current = rendererTabIds;

	const killOrphaned = useCallback(async () => {
		if (!state.daemon) return;
		setKilling(true);
		const callbackSet = new Set(state.daemon.callbackIds);
		const currentRendererIds = rendererTabIdsRef.current;
		const orphanIds = state.daemon.daemonSessions
			.filter((s) => !currentRendererIds.has(s.id) && !callbackSet.has(s.id))
			.map((s) => s.id);
		for (const id of orphanIds) {
			try {
				await window.electron.terminal.dispose(id);
			} catch {
				// best effort
			}
		}
		setKilling(false);
		refresh();
	}, [state.daemon, refresh]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const daemonSessionIds = new Set(
		state.daemon?.daemonSessions.map((s) => s.id) ?? [],
	);
	const dbSessionIds = new Set(dbQuery.data?.sessions.map((s) => s.id) ?? []);
	const allIds = new Set([...daemonSessionIds, ...dbSessionIds, ...rendererTabIds]);

	// Close on Escape
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="relative max-h-[80vh] w-[700px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<div className="flex items-center gap-2">
						<span className="text-[13px] font-medium text-[var(--text)]">
							Daemon Inspector
						</span>
						{state.daemon && (
							<span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">
								{state.daemon.daemonSessions.length} PTY
								{state.daemon.daemonSessions.length !== 1 ? "s" : ""}
							</span>
						)}
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={killOrphaned}
							disabled={killing || state.loading || !state.daemon}
							className="rounded-md px-2 py-1 text-[11px] text-[var(--term-red)] transition-colors hover:bg-[rgba(255,69,58,0.1)] disabled:opacity-50"
						>
							{killing ? "Killing..." : "Kill Orphaned"}
						</button>
						<button
							type="button"
							onClick={refresh}
							disabled={state.loading}
							className="rounded-md px-2 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] disabled:opacity-50"
						>
							{state.loading ? "Loading..." : "Refresh"}
						</button>
						<button
							type="button"
							onClick={onClose}
							className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
						>
							<svg width="10" height="10" viewBox="0 0 9 9" fill="none">
								<path
									d="M2 2l5 5M7 2l-5 5"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
								/>
							</svg>
						</button>
					</div>
				</div>

				{/* Summary bar */}
				<div className="flex gap-4 border-b border-[var(--border-subtle)] px-4 py-2 text-[11px]">
					<SummaryItem
						label="Daemon PTYs"
						value={state.daemon?.daemonSessions.length ?? "?"}
					/>
					<SummaryItem
						label="Client liveSessions"
						value={state.daemon?.liveSessions.length ?? "?"}
					/>
					<SummaryItem
						label="Callbacks"
						value={state.daemon?.callbackIds.length ?? "?"}
					/>
					<SummaryItem label="DB rows" value={dbQuery.data?.sessions.length ?? "?"} />
					<SummaryItem label="Renderer tabs" value={terminalTabs.length} />
				</div>

				{/* Error */}
				{state.error && (
					<div className="px-4 py-2 text-[12px] text-[var(--term-red)]">
						{state.error}
					</div>
				)}

				{/* Session list */}
				<div className="max-h-[60vh] overflow-y-auto">
					<table className="w-full text-[11px]">
						<thead>
							<tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-quaternary)]">
								<th className="px-4 py-1.5 font-medium">ID</th>
								<th className="px-2 py-1.5 font-medium">PID</th>
								<th className="px-2 py-1.5 font-medium">CWD</th>
								<th className="px-2 py-1.5 font-medium">Workspace</th>
								<th className="px-2 py-1.5 font-medium">State</th>
							</tr>
						</thead>
						<tbody>
							{Array.from(allIds)
								.sort()
								.map((id) => {
									const daemonSession = state.daemon?.daemonSessions.find(
										(s) => s.id === id,
									);
									const dbSession = dbQuery.data?.sessions.find(
										(s) => s.id === id,
									);
									const wsInfo = dbSession?.workspaceId
										? dbQuery.data?.workspaceMap[dbSession.workspaceId]
										: null;
									const inRenderer = rendererTabIds.has(id);
									const inLive =
										state.daemon?.liveSessions.includes(id) ?? false;
									const hasCallback =
										state.daemon?.callbackIds.includes(id) ?? false;

									const flags: string[] = [];
									if (daemonSession) flags.push("daemon");
									if (inLive) flags.push("live");
									if (hasCallback) flags.push("callback");
									if (dbSession) flags.push("db");
									if (inRenderer) flags.push("renderer");

									// Detect problems
									const isOrphaned =
										daemonSession && !inRenderer && !hasCallback;
									const isGhost = !daemonSession && inLive;
									const isDbOnly = dbSession && !daemonSession && !inRenderer;

									let statusColor = "text-[var(--text-tertiary)]";
									let statusLabel = flags.join(", ");
									if (isOrphaned) {
										statusColor = "text-[var(--term-yellow)]";
										statusLabel = "ORPHANED — " + statusLabel;
									} else if (isGhost) {
										statusColor = "text-[var(--term-red)]";
										statusLabel = "GHOST (in liveSessions, not in daemon) — " + statusLabel;
									} else if (isDbOnly) {
										statusColor = "text-[var(--term-magenta)]";
										statusLabel = "DB ONLY — " + statusLabel;
									}

									const cwd =
										daemonSession?.cwd ?? dbSession?.cwd ?? "—";
									const shortCwd = cwd.length > 40
										? "..." + cwd.slice(-37)
										: cwd;

									return (
										<tr
											key={id}
											className={`border-b border-[var(--border-subtle)] ${
												isOrphaned || isGhost
													? "bg-[rgba(255,200,0,0.04)]"
													: ""
											}`}
										>
											<td className="px-4 py-1.5 font-mono text-[var(--text-secondary)]">
												{id.length > 20 ? id.slice(0, 10) + "..." + id.slice(-6) : id}
											</td>
											<td className="px-2 py-1.5 font-mono text-[var(--text-tertiary)]">
												{daemonSession?.pid ?? "—"}
											</td>
											<td
												className="max-w-[180px] truncate px-2 py-1.5 font-mono text-[var(--text-tertiary)]"
												title={cwd}
											>
												{shortCwd}
											</td>
											<td className="max-w-[140px] truncate px-2 py-1.5 text-[var(--text-tertiary)]">
												{wsInfo ? (
													<span title={wsInfo.name}>
														<span
															className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
																wsInfo.type === "review"
																	? "bg-[var(--term-magenta)]"
																	: "bg-[var(--term-green)]"
															}`}
														/>
														{wsInfo.name}
													</span>
												) : dbSession?.workspaceId ? (
													<span className="text-[var(--term-yellow)]" title={dbSession.workspaceId}>
														{dbSession.workspaceId.slice(0, 12)}... (deleted?)
													</span>
												) : (
													"—"
												)}
											</td>
											<td className={`px-2 py-1.5 ${statusColor}`}>
												{statusLabel}
											</td>
										</tr>
									);
								})}
							{allIds.size === 0 && (
								<tr>
									<td
										colSpan={5}
										className="px-4 py-6 text-center text-[var(--text-quaternary)]"
									>
										No terminal sessions found
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function SummaryItem({
	label,
	value,
}: { label: string; value: number | string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="text-[var(--text-quaternary)]">{label}:</span>
			<span className="font-mono font-medium text-[var(--text-secondary)]">
				{value}
			</span>
		</div>
	);
}
