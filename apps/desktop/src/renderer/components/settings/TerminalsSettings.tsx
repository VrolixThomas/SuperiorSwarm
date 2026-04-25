import { useCallback, useEffect, useMemo, useState } from "react";
import type { DaemonInspectorData } from "../../../shared/types";
import { usePaneStore } from "../../stores/pane-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ErrorBanner, Stat, shortPath } from "./shared";

type SortMode = "by-workspace" | "by-status";

interface SessionRow {
	id: string;
	cwd: string;
	pid: number | null;
	workspaceName: string | null;
	workspaceType: string | null;
	status: "active" | "orphaned" | "ghost" | "db-only";
}

function statusBadge(status: SessionRow["status"]) {
	const styles: Record<string, string> = {
		active: "bg-[var(--success-subtle)] text-[var(--color-success)]",
		orphaned: "bg-[var(--warning-subtle)] text-[var(--color-warning)]",
		ghost: "bg-[var(--danger-subtle)] text-[var(--color-danger)]",
		"db-only": "bg-[var(--purple-subtle)] text-[var(--color-purple)]",
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

export function TerminalsSettings() {
	const [sortMode, setSortMode] = useState<SortMode>("by-workspace");
	const [daemon, setDaemon] = useState<DaemonInspectorData | null>(null);
	const [loading, setLoading] = useState(true);
	const [disposing, setDisposing] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);

	const dbQuery = trpc.terminalSessions.listAll.useQuery(undefined, {
		staleTime: 0,
		refetchOnMount: true,
	});

	const allTabs = useTabStore((s) => s.getAllTabs)();
	const rendererTabIds = useMemo(
		() => new Set(allTabs.filter((t) => t.kind === "terminal").map((t) => t.id)),
		[allTabs]
	);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const data = await window.electron.daemon.listSessions();
			setDaemon(data);
		} catch {
			setDaemon(null);
		}
		setLoading(false);
		dbQuery.refetch();
	}, [dbQuery.refetch]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleDispose = useCallback(
		async (id: string) => {
			setDisposing((s) => new Set(s).add(id));
			setError(null);
			try {
				await window.electron.terminal.dispose(id);
			} catch (err) {
				setError(`Failed to kill session: ${err instanceof Error ? err.message : "unknown error"}`);
			}
			// Remove the terminal tab from the UI if it exists
			const paneStore = usePaneStore.getState();
			const tabs = useTabStore.getState().getAllTabs();
			const tab = tabs.find((t) => t.kind === "terminal" && t.id === id);
			if (tab) {
				const pane = paneStore.findPaneForTab(tab.workspaceId, id);
				if (pane) {
					paneStore.removeTabFromPane(tab.workspaceId, pane.id, id);
				}
			}
			setDisposing((s) => {
				const next = new Set(s);
				next.delete(id);
				return next;
			});
			refresh();
		},
		[refresh]
	);

	const handleKillAllOrphaned = useCallback(async () => {
		if (!daemon) return;
		setError(null);
		const callbackSet = new Set(daemon.callbackIds);
		const orphanIds = daemon.daemonSessions
			.filter((s) => !rendererTabIds.has(s.id) && !callbackSet.has(s.id))
			.map((s) => s.id);
		const results = await Promise.allSettled(
			orphanIds.map((id) => window.electron.terminal.dispose(id))
		);
		const failures = results.filter((r) => r.status === "rejected").length;
		if (failures > 0) {
			setError(`Failed to kill ${failures} of ${orphanIds.length} orphaned sessions`);
		}
		refresh();
	}, [daemon, rendererTabIds, refresh]);

	// Build unified session list
	const daemonSessionMap = new Map(daemon?.daemonSessions.map((s) => [s.id, s]) ?? []);
	const dbSessionMap = new Map(dbQuery.data?.sessions.map((s) => [s.id, s]) ?? []);
	const allIds = new Set([...daemonSessionMap.keys(), ...dbSessionMap.keys(), ...rendererTabIds]);

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
		<div>
			<PageHeading title="Terminals" subtitle="Manage terminal sessions and daemon processes" />

			{/* Summary */}
			<SectionLabel>Overview</SectionLabel>
			<div className="mb-6 flex flex-wrap gap-4 text-[12px]">
				<Stat label="Daemon PTYs" value={daemon?.daemonSessions.length ?? "?"} />
				<Stat
					label="Active"
					value={rows.filter((r) => r.status === "active").length}
					color="var(--color-success)"
				/>
				<Stat label="Orphaned" value={orphanCount} color="var(--color-warning)" />
				<Stat label="DB rows" value={dbQuery.data?.sessions.length ?? "?"} />
			</div>

			{error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

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
							className="rounded-[6px] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.08)] px-2.5 py-1 text-[11px] text-[var(--color-danger)] transition-colors hover:bg-[var(--danger-subtle)]"
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
										<span className="text-[10px] text-[var(--text-quaternary)]">PID {row.pid}</span>
									)}
								</div>
								<div
									className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-quaternary)]"
									title={row.cwd}
								>
									{row.cwd ? shortPath(row.cwd) : row.id}
								</div>
							</div>
							<button
								type="button"
								onClick={() => handleDispose(row.id)}
								disabled={disposing.has(row.id)}
								className="ml-3 shrink-0 rounded-[6px] px-2.5 py-1 text-[11px] text-[var(--text-quaternary)] transition-colors hover:bg-[rgba(255,69,58,0.1)] hover:text-[var(--color-danger)] disabled:opacity-50"
							>
								{disposing.has(row.id) ? "Killing..." : "Kill"}
							</button>
						</div>
					))
				)}
			</div>
		</div>
	);
}
