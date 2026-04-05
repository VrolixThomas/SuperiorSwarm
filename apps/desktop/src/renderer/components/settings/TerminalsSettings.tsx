import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonInspectorData } from "../../../shared/types";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { PageHeading, SectionLabel } from "./SectionHeading";

type Tab = "terminals" | "worktrees";
type SortMode = "by-workspace" | "by-status";

interface SessionRow {
	id: string;
	cwd: string;
	pid: number | null;
	workspaceName: string | null;
	workspaceType: string | null;
	status: "active" | "orphaned" | "ghost" | "db-only";
}

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

function shortPath(p: string): string {
	const parts = p.split("/");
	return parts.length > 2 ? parts.slice(-2).join("/") : p;
}

function statusBadge(status: SessionRow["status"]) {
	const styles: Record<string, string> = {
		active: "bg-[rgba(48,209,88,0.15)] text-[#30d158]",
		orphaned: "bg-[rgba(255,214,10,0.15)] text-[#ffd60a]",
		ghost: "bg-[rgba(255,69,58,0.15)] text-[#ff453a]",
		"db-only": "bg-[rgba(191,90,242,0.15)] text-[#bf5af2]",
	};
	const labels: Record<string, string> = {
		active: "Active",
		orphaned: "Orphaned",
		ghost: "Ghost",
		"db-only": "DB Only",
	};
	return (
		<span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
			{labels[status]}
		</span>
	);
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TerminalsSettings() {
	const [tab, setTab] = useState<Tab>("terminals");

	return (
		<div>
			<PageHeading
				title="Terminals"
				subtitle="Manage terminal sessions, daemon processes, and worktrees"
			/>

			{/* Tab switcher */}
			<div className="mb-6 flex gap-0.5 rounded-[8px] bg-[var(--bg-base)] p-0.5 w-fit border border-[var(--border-subtle)]">
				{(["terminals", "worktrees"] as const).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`rounded-[6px] px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
							tab === t
								? "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
								: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
						}`}
					>
						{t}
					</button>
				))}
			</div>

			{tab === "terminals" ? <TerminalsTab /> : <WorktreesTab />}
		</div>
	);
}

// ─── Terminals Tab ──────────────────────────────────────────────────────────

function TerminalsTab() {
	const [sortMode, setSortMode] = useState<SortMode>("by-workspace");
	const [daemon, setDaemon] = useState<DaemonInspectorData | null>(null);
	const [loading, setLoading] = useState(true);
	const [disposing, setDisposing] = useState<Set<string>>(new Set());

	const dbQuery = trpc.terminalSessions.listAll.useQuery(undefined, {
		staleTime: 0,
		refetchOnMount: true,
	});
	const dbRefetchRef = useRef(dbQuery.refetch);
	dbRefetchRef.current = dbQuery.refetch;

	const allTabs = useTabStore((s) => s.getAllTabs)();
	const rendererTabIds = new Set(allTabs.filter((t) => t.kind === "terminal").map((t) => t.id));

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const data = await window.electron.daemon.listSessions();
			setDaemon(data);
		} catch {
			setDaemon(null);
		}
		setLoading(false);
		dbRefetchRef.current();
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleDispose = useCallback(
		async (id: string) => {
			setDisposing((s) => new Set(s).add(id));
			try {
				await window.electron.terminal.dispose(id);
			} catch {
				// best effort
			}
			setDisposing((s) => {
				const next = new Set(s);
				next.delete(id);
				return next;
			});
			refresh();
		},
		[refresh],
	);

	const handleKillAllOrphaned = useCallback(async () => {
		if (!daemon) return;
		const callbackSet = new Set(daemon.callbackIds);
		const orphanIds = daemon.daemonSessions
			.filter((s) => !rendererTabIds.has(s.id) && !callbackSet.has(s.id))
			.map((s) => s.id);
		for (const id of orphanIds) {
			try {
				await window.electron.terminal.dispose(id);
			} catch {}
		}
		refresh();
	}, [daemon, rendererTabIds, refresh]);

	// Build unified session list
	const daemonSessionMap = new Map(daemon?.daemonSessions.map((s) => [s.id, s]) ?? []);
	const dbSessionMap = new Map(dbQuery.data?.sessions.map((s) => [s.id, s]) ?? []);
	const allIds = new Set([
		...daemonSessionMap.keys(),
		...dbSessionMap.keys(),
		...rendererTabIds,
	]);

	const callbackSet = new Set(daemon?.callbackIds ?? []);

	const rows: SessionRow[] = Array.from(allIds).map((id) => {
		const ds = daemonSessionMap.get(id);
		const db = dbSessionMap.get(id);
		const ws = db?.workspaceId ? dbQuery.data?.workspaceMap[db.workspaceId] : null;
		const inRenderer = rendererTabIds.has(id);
		const hasCb = callbackSet.has(id);

		let status: SessionRow["status"] = "active";
		if (ds && !inRenderer && !hasCb) status = "orphaned";
		else if (!ds && (daemon?.liveSessions.includes(id) ?? false)) status = "ghost";
		else if (db && !ds && !inRenderer) status = "db-only";

		return {
			id,
			cwd: ds?.cwd ?? db?.cwd ?? "",
			pid: ds?.pid ?? null,
			workspaceName: ws?.name ?? null,
			workspaceType: ws?.type ?? null,
			status,
		};
	});

	// Sort
	const sorted = [...rows].sort((a, b) => {
		if (sortMode === "by-status") {
			const order = { orphaned: 0, ghost: 1, "db-only": 2, active: 3 };
			const diff = order[a.status] - order[b.status];
			if (diff !== 0) return diff;
		}
		const wa = a.workspaceName ?? "";
		const wb = b.workspaceName ?? "";
		if (wa !== wb) return wa.localeCompare(wb);
		return a.id.localeCompare(b.id);
	});

	const orphanCount = rows.filter((r) => r.status === "orphaned").length;

	return (
		<>
			{/* Summary */}
			<SectionLabel>Overview</SectionLabel>
			<div className="mb-6 flex flex-wrap gap-4 text-[12px]">
				<Stat label="Daemon PTYs" value={daemon?.daemonSessions.length ?? "?"} />
				<Stat
					label="Active"
					value={rows.filter((r) => r.status === "active").length}
					color="#30d158"
				/>
				<Stat label="Orphaned" value={orphanCount} color="#ffd60a" />
				<Stat label="DB rows" value={dbQuery.data?.sessions.length ?? "?"} />
			</div>

			{/* Controls */}
			<div className="mb-4 flex items-center justify-between">
				<SectionLabel>Sessions</SectionLabel>
				<div className="flex items-center gap-2">
					<select
						value={sortMode}
						onChange={(e) => setSortMode(e.target.value as SortMode)}
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] outline-none"
					>
						<option value="by-workspace">By workspace</option>
						<option value="by-status">By status</option>
					</select>
					<button
						type="button"
						onClick={() => refresh()}
						disabled={loading}
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] disabled:opacity-50"
					>
						{loading ? "Loading..." : "Refresh"}
					</button>
					{orphanCount > 0 && (
						<button
							type="button"
							onClick={handleKillAllOrphaned}
							className="rounded-[6px] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.08)] px-2.5 py-1 text-[11px] text-[#ff453a] transition-colors hover:bg-[rgba(255,69,58,0.15)]"
						>
							Kill {orphanCount} orphaned
						</button>
					)}
				</div>
			</div>

			{/* Session list */}
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				{sorted.length === 0 ? (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						No terminal sessions found
					</div>
				) : (
					sorted.map((row, i) => (
						<div
							key={row.id}
							className={`flex items-center justify-between px-4 py-3 ${
								i > 0 ? "border-t border-[var(--border-subtle)]" : ""
							}`}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									{row.workspaceName && (
										<span className="text-[12px] font-medium text-[var(--text-secondary)]">
											{row.workspaceName}
										</span>
									)}
									{statusBadge(row.status)}
									{row.pid && (
										<span className="text-[10px] text-[var(--text-quaternary)]">
											PID {row.pid}
										</span>
									)}
								</div>
								<div
									className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-quaternary)]"
									title={row.cwd}
								>
									{row.cwd ? shortPath(row.cwd) : row.id}
								</div>
							</div>
							{row.status !== "db-only" && (
								<button
									type="button"
									onClick={() => handleDispose(row.id)}
									disabled={disposing.has(row.id)}
									className="ml-3 shrink-0 rounded-[6px] px-2.5 py-1 text-[11px] text-[var(--text-quaternary)] transition-colors hover:bg-[rgba(255,69,58,0.1)] hover:text-[#ff453a] disabled:opacity-50"
								>
									{disposing.has(row.id) ? "Killing..." : "Kill"}
								</button>
							)}
						</div>
					))
				)}
			</div>
		</>
	);
}

// ─── Worktrees Tab ──────────────────────────────────────────────────────────

function WorktreesTab() {
	const worktreeQuery = trpc.terminalSessions.listWorktrees.useQuery(undefined, {
		staleTime: 0,
		refetchOnMount: true,
	});
	const removeMutation = trpc.terminalSessions.removeWorktree.useMutation({
		onSuccess: () => worktreeQuery.refetch(),
		onError: (err) => console.error("[removeWorktree]", err.message),
	});
	const pruneMutation = trpc.terminalSessions.pruneWorktrees.useMutation({
		onSuccess: () => worktreeQuery.refetch(),
	});
	const [confirmPath, setConfirmPath] = useState<string | null>(null);

	const worktrees = worktreeQuery.data ?? [];

	if (worktreeQuery.isLoading) {
		return (
			<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
				Loading worktrees...
			</div>
		);
	}

	// Group by project
	const byProject = new Map<string, WorktreeEntry[]>();
	for (const wt of worktrees) {
		const existing = byProject.get(wt.projectName) ?? [];
		existing.push(wt);
		byProject.set(wt.projectName, existing);
	}

	const ghostCount = worktrees.filter((w) => !w.existsOnDisk).length;

	return (
		<>
			{/* Summary */}
			<SectionLabel>Overview</SectionLabel>
			<div className="mb-6 flex flex-wrap gap-4 text-[12px]">
				<Stat label="Total" value={worktrees.length} />
				<Stat label="On disk" value={worktrees.filter((w) => w.existsOnDisk).length} />
				<Stat label="In DB" value={worktrees.filter((w) => w.inDb).length} />
				<Stat label="Ghosts" value={ghostCount} color={ghostCount > 0 ? "#ff453a" : undefined} />
			</div>

			{/* Controls */}
			<div className="mb-4 flex items-center justify-between">
				<SectionLabel>Worktrees</SectionLabel>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => worktreeQuery.refetch()}
						disabled={worktreeQuery.isRefetching}
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] disabled:opacity-50"
					>
						{worktreeQuery.isRefetching ? "Loading..." : "Refresh"}
					</button>
					{ghostCount > 0 && (
						<button
							type="button"
							onClick={() => pruneMutation.mutate()}
							disabled={pruneMutation.isPending}
							className="rounded-[6px] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.08)] px-2.5 py-1 text-[11px] text-[#ff453a] transition-colors hover:bg-[rgba(255,69,58,0.15)]"
						>
							{pruneMutation.isPending ? "Pruning..." : `Prune ${ghostCount} ghost${ghostCount !== 1 ? "s" : ""}`}
						</button>
					)}
				</div>
			</div>

			{/* Worktree list */}
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				{worktrees.length === 0 ? (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						No worktrees found
					</div>
				) : (
					Array.from(byProject.entries()).map(([projectName, entries]) => (
						<div key={projectName}>
							<div className="border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
								{projectName}
							</div>
							{entries.map((wt) => {
								const isOrphaned = !wt.workspaceName && !wt.isMain;
								const isStale = !wt.existsOnDisk;

								return (
									<div
										key={wt.path}
										className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span className="font-mono text-[11px] text-[var(--text-secondary)]">
													{shortPath(wt.path)}
												</span>
												{wt.isMain && (
													<span className="rounded-full bg-[rgba(10,132,255,0.15)] px-2 py-0.5 text-[9px] font-medium text-[var(--accent)]">
														Main
													</span>
												)}
												{wt.workspaceType === "review" && (
													<span className="rounded-full bg-[rgba(191,90,242,0.15)] px-2 py-0.5 text-[9px] font-medium text-[#bf5af2]">
														Review
													</span>
												)}
												{isStale && (
													<span className="rounded-full bg-[rgba(255,69,58,0.15)] px-2 py-0.5 text-[9px] font-medium text-[#ff453a]">
														Missing from disk
													</span>
												)}
												{isOrphaned && (
													<span className="rounded-full bg-[rgba(255,214,10,0.15)] px-2 py-0.5 text-[9px] font-medium text-[#ffd60a]">
														No workspace
													</span>
												)}
											</div>
											<div className="mt-1 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
												<span>
													branch:{" "}
													<span className="text-[var(--accent)]">{wt.branch}</span>
												</span>
												{wt.workspaceName && <span>workspace: {wt.workspaceName}</span>}
												<span className="text-[var(--text-quaternary)]">
													{[wt.existsOnDisk && "disk", wt.inDb && "db"]
														.filter(Boolean)
														.join(", ")}
												</span>
											</div>
										</div>
										{!wt.isMain && wt.existsOnDisk && (
											<>
												{confirmPath === wt.path ? (
													<div className="ml-3 flex items-center gap-1">
														<button
															type="button"
															onClick={() => {
																removeMutation.mutate({
																	path: wt.path,
																	repoPath: wt.repoPath,
																});
																setConfirmPath(null);
															}}
															className="rounded-[6px] px-2 py-0.5 text-[10px] text-[#ff453a] transition-colors hover:bg-[rgba(255,69,58,0.1)]"
														>
															Confirm
														</button>
														<button
															type="button"
															onClick={() => setConfirmPath(null)}
															className="rounded-[6px] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-elevated)]"
														>
															Cancel
														</button>
													</div>
												) : (
													<button
														type="button"
														onClick={() => setConfirmPath(wt.path)}
														disabled={removeMutation.isPending}
														className="ml-3 shrink-0 rounded-[6px] px-2.5 py-1 text-[11px] text-[var(--text-quaternary)] transition-colors hover:bg-[rgba(255,69,58,0.1)] hover:text-[#ff453a] disabled:opacity-50"
													>
														Remove
													</button>
												)}
											</>
										)}
									</div>
								);
							})}
						</div>
					))
				)}
			</div>
		</>
	);
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function Stat({
	label,
	value,
	color,
}: { label: string; value: number | string; color?: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="text-[var(--text-quaternary)]">{label}:</span>
			<span
				className="font-mono font-medium"
				style={{ color: color ?? "var(--text-secondary)" }}
			>
				{value}
			</span>
		</div>
	);
}
