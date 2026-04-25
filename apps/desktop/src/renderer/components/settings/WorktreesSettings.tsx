import { useState } from "react";
import { trpc } from "../../trpc/client";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ErrorBanner, Stat, shortPath } from "./shared";

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

export function WorktreesSettings() {
	const worktreeQuery = trpc.terminalSessions.listWorktrees.useQuery(undefined, {
		staleTime: 0,
		refetchOnMount: true,
	});
	const [confirmPath, setConfirmPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const removeMutation = trpc.terminalSessions.removeWorktree.useMutation({
		onSuccess: () => {
			setError(null);
			worktreeQuery.refetch();
		},
		onError: (err) => setError(`Failed to remove worktree: ${err.message}`),
	});
	const pruneMutation = trpc.terminalSessions.pruneWorktrees.useMutation({
		onSuccess: () => {
			setError(null);
			worktreeQuery.refetch();
		},
		onError: (err) => setError(`Failed to prune worktrees: ${err.message}`),
	});

	const worktrees = worktreeQuery.data ?? [];
	const ghostCount = worktrees.filter((w) => !w.existsOnDisk).length;

	// Group by project
	const byProject = new Map<string, WorktreeEntry[]>();
	for (const wt of worktrees) {
		const existing = byProject.get(wt.projectName) ?? [];
		existing.push(wt);
		byProject.set(wt.projectName, existing);
	}

	return (
		<div>
			<PageHeading title="Worktrees" subtitle="Manage git worktrees across projects" />

			{/* Summary */}
			<SectionLabel>Overview</SectionLabel>
			<div className="mb-6 flex flex-wrap gap-4 text-[12px]">
				<Stat label="Total" value={worktrees.length} />
				<Stat label="On disk" value={worktrees.filter((w) => w.existsOnDisk).length} />
				<Stat label="In DB" value={worktrees.filter((w) => w.inDb).length} />
				<Stat label="Ghosts" value={ghostCount} color={ghostCount > 0 ? "#ff453a" : undefined} />
			</div>

			{error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

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
							className="rounded-[6px] border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.08)] px-2.5 py-1 text-[11px] text-[var(--color-danger)] transition-colors hover:bg-[var(--danger-subtle)]"
						>
							{pruneMutation.isPending
								? "Pruning..."
								: `Prune ${ghostCount} ghost${ghostCount !== 1 ? "s" : ""}`}
						</button>
					)}
				</div>
			</div>

			{/* Loading */}
			{worktreeQuery.isLoading ? (
				<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
					Loading worktrees...
				</div>
			) : (
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
														<span className="rounded-full bg-[var(--accent-subtle)] px-2 py-0.5 text-[9px] font-medium text-[var(--accent)]">
															Main
														</span>
													)}
													{wt.workspaceType === "review" && (
														<span className="rounded-full bg-[rgba(191,90,242,0.15)] px-2 py-0.5 text-[9px] font-medium text-[#bf5af2]">
															Review
														</span>
													)}
													{isStale && (
														<span className="rounded-full bg-[var(--danger-subtle)] px-2 py-0.5 text-[9px] font-medium text-[var(--color-danger)]">
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
														branch: <span className="text-[var(--accent)]">{wt.branch}</span>
													</span>
													{wt.workspaceName && <span>workspace: {wt.workspaceName}</span>}
													<span className="text-[var(--text-quaternary)]">
														{[wt.existsOnDisk && "disk", wt.inDb && "db"]
															.filter(Boolean)
															.join(", ")}
													</span>
												</div>
											</div>
											{!wt.isMain &&
												wt.existsOnDisk &&
												(confirmPath === wt.path ? (
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
															className="rounded-[6px] px-2 py-0.5 text-[10px] text-[var(--color-danger)] transition-colors hover:bg-[rgba(255,69,58,0.1)]"
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
														className="ml-3 shrink-0 rounded-[6px] px-2.5 py-1 text-[11px] text-[var(--text-quaternary)] transition-colors hover:bg-[rgba(255,69,58,0.1)] hover:text-[var(--color-danger)] disabled:opacity-50"
													>
														Remove
													</button>
												))}
										</div>
									);
								})}
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
}
