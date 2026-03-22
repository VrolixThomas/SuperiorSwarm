import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonInspectorData } from "../../shared/types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

type Tab = "terminals" | "worktrees";

interface InspectorState {
	daemon: DaemonInspectorData | null;
	loading: boolean;
	error: string | null;
}

/** Show just the last meaningful part of a path (last 2 segments). */
function shortPath(p: string): string {
	const parts = p.split("/");
	return parts.length > 2 ? parts.slice(-2).join("/") : p;
}

export function DaemonInspector({ onClose }: { onClose: () => void }) {
	const [tab, setTab] = useState<Tab>("terminals");
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

	const worktreeQuery = trpc.terminalSessions.listWorktrees.useQuery(undefined, {
		staleTime: 0,
		refetchOnMount: true,
		enabled: tab === "worktrees",
	});

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

	const daemonSessionIds = new Set(state.daemon?.daemonSessions.map((s) => s.id) ?? []);
	const dbSessionIds = new Set(dbQuery.data?.sessions.map((s) => s.id) ?? []);
	const allIds = new Set([...daemonSessionIds, ...dbSessionIds, ...rendererTabIds]);

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
			<div className="relative flex max-h-[85vh] w-[900px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl">
				{/* Header */}
				<div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<div className="flex items-center gap-3">
						<span className="text-[13px] font-medium text-[var(--text)]">System Inspector</span>
						<div className="flex gap-0.5 rounded-md bg-[var(--bg-base)] p-0.5">
							{(["terminals", "worktrees"] as const).map((t) => (
								<button
									key={t}
									type="button"
									onClick={() => setTab(t)}
									className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
										tab === t
											? "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
											: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
									}`}
								>
									{t}
								</button>
							))}
						</div>
					</div>
					<div className="flex items-center gap-2">
						{tab === "terminals" && (
							<button
								type="button"
								onClick={killOrphaned}
								disabled={killing || state.loading || !state.daemon}
								className="rounded-md px-2 py-1 text-[11px] text-[var(--term-red)] transition-colors hover:bg-[rgba(255,69,58,0.1)] disabled:opacity-50"
							>
								{killing ? "Killing..." : "Kill Orphaned"}
							</button>
						)}
						<button
							type="button"
							onClick={() => {
								refresh();
								if (tab === "worktrees") worktreeQuery.refetch();
							}}
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

				{tab === "terminals" ? (
					<TerminalsTab
						state={state}
						dbQuery={dbQuery.data}
						allIds={allIds}
						rendererTabIds={rendererTabIds}
					/>
				) : (
					<WorktreesTab
						data={worktreeQuery.data}
						loading={worktreeQuery.isLoading}
						onRefresh={() => worktreeQuery.refetch()}
					/>
				)}
			</div>
		</div>
	);
}

// ─── Terminals Tab ───────────────────────────────────────────────────────────

function TerminalsTab({
	state,
	dbQuery,
	allIds,
	rendererTabIds,
}: {
	state: { daemon: DaemonInspectorData | null; error: string | null };
	dbQuery:
		| {
				sessions: Array<{ id: string; workspaceId: string; cwd: string }>;
				workspaceMap: Record<string, { name: string; type: string; prIdentifier: string | null }>;
		  }
		| undefined;
	allIds: Set<string>;
	rendererTabIds: Set<string>;
}) {
	return (
		<>
			{/* Summary bar */}
			<div className="flex shrink-0 gap-4 border-b border-[var(--border-subtle)] px-4 py-2 text-[11px]">
				<KV label="Daemon PTYs" value={state.daemon?.daemonSessions.length ?? "?"} />
				<KV label="liveSessions" value={state.daemon?.liveSessions.length ?? "?"} />
				<KV label="Callbacks" value={state.daemon?.callbackIds.length ?? "?"} />
				<KV label="DB rows" value={dbQuery?.sessions.length ?? "?"} />
				<KV label="Renderer" value={rendererTabIds.size} />
			</div>

			{state.error && (
				<div className="shrink-0 px-4 py-2 text-[12px] text-[var(--term-red)]">{state.error}</div>
			)}

			{/* Session rows */}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{Array.from(allIds)
					.sort()
					.map((id) => {
						const ds = state.daemon?.daemonSessions.find((s) => s.id === id);
						const db = dbQuery?.sessions.find((s) => s.id === id);
						const ws = db?.workspaceId ? dbQuery?.workspaceMap[db.workspaceId] : null;
						const inRenderer = rendererTabIds.has(id);
						const inLive = state.daemon?.liveSessions.includes(id) ?? false;
						const hasCb = state.daemon?.callbackIds.includes(id) ?? false;

						const isOrphaned = !!ds && !inRenderer && !hasCb;
						const isGhost = !ds && inLive;
						const isDbOnly = !!db && !ds && !inRenderer;

						const cwd = ds?.cwd ?? db?.cwd ?? "";

						let badge = "";
						let badgeColor = "";
						if (isOrphaned) {
							badge = "ORPHANED";
							badgeColor = "bg-[var(--term-yellow)] text-black";
						} else if (isGhost) {
							badge = "GHOST";
							badgeColor = "bg-[var(--term-red)] text-white";
						} else if (isDbOnly) {
							badge = "DB ONLY";
							badgeColor = "bg-[var(--term-magenta)] text-white";
						}

						return (
							<div
								key={id}
								className={`border-b border-[var(--border-subtle)] px-4 py-2 ${
									isOrphaned || isGhost ? "bg-[rgba(255,200,0,0.03)]" : ""
								}`}
							>
								<div className="flex items-center gap-2">
									<span className="font-mono text-[11px] text-[var(--text-secondary)]">{id}</span>
									{ds && (
										<span className="text-[10px] text-[var(--text-quaternary)]">PID {ds.pid}</span>
									)}
									{badge && (
										<span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${badgeColor}`}>
											{badge}
										</span>
									)}
								</div>
								{cwd && (
									<div
										className="mt-0.5 font-mono text-[10px] text-[var(--text-quaternary)]"
										title={cwd}
									>
										{cwd}
									</div>
								)}
								<div className="mt-0.5 flex items-center gap-2 text-[10px]">
									{ws && (
										<span className="text-[var(--text-tertiary)]">
											<span
												className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
													ws.type === "review"
														? "bg-[var(--term-magenta)]"
														: "bg-[var(--term-green)]"
												}`}
											/>
											{ws.name}
										</span>
									)}
									{!ws && db?.workspaceId && (
										<span className="text-[var(--term-yellow)]">workspace deleted</span>
									)}
									<span className="text-[var(--text-quaternary)]">
										{[
											ds && "daemon",
											inLive && "live",
											hasCb && "callback",
											db && "db",
											inRenderer && "renderer",
										]
											.filter(Boolean)
											.join(", ")}
									</span>
								</div>
							</div>
						);
					})}
				{allIds.size === 0 && (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						No terminal sessions found
					</div>
				)}
			</div>
		</>
	);
}

// ─── Worktrees Tab ───────────────────────────────────────────────────────────

type WorktreeEntry = {
	path: string;
	branch: string;
	isMain: boolean;
	projectName: string;
	repoPath: string;
	inDb: boolean;
	dbId: string | null;
	workspaceName: string | null;
	workspaceType: string | null;
	existsOnDisk: boolean;
};

function WorktreesTab({
	data,
	loading,
	onRefresh,
}: { data: WorktreeEntry[] | undefined; loading: boolean; onRefresh: () => void }) {
	const removeMutation = trpc.terminalSessions.removeWorktree.useMutation({
		onSuccess: () => onRefresh(),
		onError: (err) => console.error("[removeWorktree]", err.message),
	});
	const pruneMutation = trpc.terminalSessions.pruneWorktrees.useMutation({
		onSuccess: () => onRefresh(),
	});
	const [confirmPath, setConfirmPath] = useState<string | null>(null);

	if (loading) {
		return (
			<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
				Loading worktrees...
			</div>
		);
	}

	const worktrees = data ?? [];

	// Group by project
	const byProject = new Map<string, WorktreeEntry[]>();
	for (const wt of worktrees) {
		const existing = byProject.get(wt.projectName) ?? [];
		existing.push(wt);
		byProject.set(wt.projectName, existing);
	}

	return (
		<>
			<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2 text-[11px]">
				<div className="flex gap-4">
					<KV label="Total" value={worktrees.length} />
					<KV label="On disk" value={worktrees.filter((w) => w.existsOnDisk).length} />
					<KV label="In DB" value={worktrees.filter((w) => w.inDb).length} />
					<KV label="Ghosts" value={worktrees.filter((w) => !w.existsOnDisk).length} />
				</div>
				{worktrees.some((w) => !w.existsOnDisk) && (
					<button
						type="button"
						onClick={() => pruneMutation.mutate()}
						disabled={pruneMutation.isPending}
						className="rounded-md px-2 py-1 text-[11px] text-[var(--term-red)] transition-colors hover:bg-[rgba(255,69,58,0.1)] disabled:opacity-50"
					>
						{pruneMutation.isPending ? "Pruning..." : "Prune Ghosts"}
					</button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{Array.from(byProject.entries()).map(([projectName, entries]) => (
					<div key={projectName}>
						<div className="sticky top-0 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-quaternary)]">
							{projectName}
						</div>
						{entries.map((wt) => {
							const isOrphaned = !wt.workspaceName && !wt.isMain;
							const isStale = !wt.existsOnDisk;

							return (
								<div
									key={wt.path}
									className={`border-b border-[var(--border-subtle)] px-4 py-2 ${
										isStale
											? "bg-[rgba(255,69,58,0.03)]"
											: isOrphaned
												? "bg-[rgba(255,200,0,0.03)]"
												: ""
									}`}
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<span className="font-mono text-[11px] text-[var(--text-secondary)]">
												{shortPath(wt.path)}
											</span>
											{wt.isMain && (
												<span className="rounded bg-[var(--term-blue)] px-1 py-0.5 text-[9px] font-semibold text-white">
													MAIN
												</span>
											)}
											{wt.workspaceType === "review" && (
												<span className="rounded bg-[var(--term-magenta)] px-1 py-0.5 text-[9px] font-semibold text-white">
													REVIEW
												</span>
											)}
											{isStale && (
												<span className="rounded bg-[var(--term-red)] px-1 py-0.5 text-[9px] font-semibold text-white">
													MISSING FROM DISK
												</span>
											)}
											{isOrphaned && (
												<span className="rounded bg-[var(--term-yellow)] px-1 py-0.5 text-[9px] font-semibold text-black">
													NO WORKSPACE
												</span>
											)}
										</div>
										{!wt.isMain && wt.existsOnDisk && (
											<>
												{confirmPath === wt.path ? (
													<div className="flex items-center gap-1">
														<button
															type="button"
															onClick={() => {
																removeMutation.mutate({
																	path: wt.path,
																	repoPath: wt.repoPath,
																});
																setConfirmPath(null);
															}}
															className="rounded px-1.5 py-0.5 text-[10px] text-[var(--term-red)] transition-colors hover:bg-[rgba(255,69,58,0.1)]"
														>
															Confirm
														</button>
														<button
															type="button"
															onClick={() => setConfirmPath(null)}
															className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-elevated)]"
														>
															Cancel
														</button>
													</div>
												) : (
													<button
														type="button"
														onClick={() => setConfirmPath(wt.path)}
														disabled={removeMutation.isPending}
														className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-quaternary)] transition-colors hover:bg-[rgba(255,69,58,0.1)] hover:text-[var(--term-red)] disabled:opacity-50"
													>
														Remove
													</button>
												)}
											</>
										)}
									</div>
									<div
										className="mt-0.5 font-mono text-[10px] text-[var(--text-quaternary)]"
										title={wt.path}
									>
										{wt.path}
									</div>
									<div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
										<span>
											branch: <span className="text-[var(--term-cyan)]">{wt.branch}</span>
										</span>
										{wt.workspaceName && <span>workspace: {wt.workspaceName}</span>}
										<span className="text-[var(--text-quaternary)]">
											{[wt.existsOnDisk && "disk", wt.inDb && "db"].filter(Boolean).join(", ")}
										</span>
									</div>
								</div>
							);
						})}
					</div>
				))}
				{worktrees.length === 0 && (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						No worktrees found
					</div>
				)}
			</div>
		</>
	);
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function KV({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="text-[var(--text-quaternary)]">{label}:</span>
			<span className="font-mono font-medium text-[var(--text-secondary)]">{value}</span>
		</div>
	);
}
