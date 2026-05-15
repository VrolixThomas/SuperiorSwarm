// Branch Changes card + Commits section for the PR right rail.
// Extracted from PRControlRail.tsx's ChangesTab so PROverviewPane can also render
// (or coexist with) the same data via the shared pr-showcase module.

import {
	ACTIVE_FILE_PATH,
	CHANGE_TYPE_DOT,
	COMMENT_COUNT_BY_FILE,
	MOCK_PR,
	VIEWED_FILES,
	basename,
} from "./pr-showcase";

export function PRBranchChangesRail() {
	const files = MOCK_PR.files;
	const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
	const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
	const viewed = VIEWED_FILES.size;
	const baseBranch = MOCK_PR.targetBranch;
	const collapsed = false;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex-1 overflow-y-auto">
				<div className="mx-1.5 mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]">
					<button
						type="button"
						className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
					>
						<span
							className="text-[10px] text-[var(--text-quaternary)] transition-transform duration-150"
							style={{ transform: "rotate(0deg)" }}
						>
							▾
						</span>
						<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
							Branch Changes
						</span>
						<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[10px] text-[var(--text-tertiary)]">
							{files.length} {files.length === 1 ? "file" : "files"}
						</span>
						<div className="flex-1" />
						<span className="text-[11px]">
							<span className="text-[var(--term-green)]">+{totalAdditions}</span>
							<span className="mx-1 text-[var(--text-quaternary)]">/</span>
							<span className="text-[var(--term-red)]">-{totalDeletions}</span>
						</span>
					</button>

					{/* Review progress bar */}
					{!collapsed && files.length > 0 && (
						<div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5">
							<div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
								<div
									className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
									style={{
										width: `${(viewed / files.length) * 100}%`,
									}}
								/>
							</div>
							<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
								{viewed}/{files.length}
							</span>
						</div>
					)}

					{!collapsed && (
						<div className="border-t border-[var(--border-subtle)] py-0.5">
							{files.length === 0 && (
								<div className="px-2 py-2 text-[12px] text-[var(--text-quaternary)]">
									No changes vs <span className="font-medium">{baseBranch}</span>
								</div>
							)}
							{files.map((file) => {
								const filename = basename(file.path);
								const isViewed = VIEWED_FILES.has(file.path);
								const commentCount = COMMENT_COUNT_BY_FILE.get(file.path) ?? 0;
								const isActive = file.path === ACTIVE_FILE_PATH;
								return (
									<div
										key={file.path}
										className={[
											"flex items-center gap-1.5 px-2 py-[3px]",
											isActive ? "border-l-2 border-l-[var(--accent)] bg-[var(--bg-overlay)]" : "",
										].join(" ")}
									>
										<button
											type="button"
											className={[
												"flex h-4 w-4 shrink-0 items-center justify-center text-[11px]",
												isViewed
													? "text-[var(--accent)]"
													: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
											].join(" ")}
											title={isViewed ? "Mark as unviewed" : "Mark as viewed"}
										>
											{isViewed ? "✓" : "○"}
										</button>

										<span
											className={`size-1.5 shrink-0 rounded-full ${CHANGE_TYPE_DOT[file.changeType] ?? "bg-[var(--text-quaternary)]"}`}
										/>

										<button
											type="button"
											className={[
												"min-w-0 flex-1 truncate text-left font-mono text-[11px] transition-colors hover:text-[var(--text-secondary)]",
												isViewed
													? "text-[var(--text-quaternary)] line-through"
													: "text-[var(--text-secondary)]",
											].join(" ")}
											title={file.path}
										>
											{filename}
										</button>

										{commentCount > 0 && (
											<span className="shrink-0 rounded-full bg-[var(--bg-overlay)] px-1.5 text-[10px] font-medium text-[var(--color-warning)]">
												{commentCount}
											</span>
										)}

										<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
											{file.additions > 0 && (
												<span className="text-[var(--term-green)]">+{file.additions}</span>
											)}
											{file.deletions > 0 && (
												<span className="ml-0.5 text-[var(--term-red)]">-{file.deletions}</span>
											)}
										</span>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Commits section */}
				<div className="mt-3 flex flex-col gap-1 pb-4">
					<div className="flex items-center gap-2 px-3 py-1.5">
						<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
							Commits
						</span>
					</div>
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
						No commits ahead of <span className="font-medium">{baseBranch}</span>
					</div>
				</div>
			</div>
		</div>
	);
}
