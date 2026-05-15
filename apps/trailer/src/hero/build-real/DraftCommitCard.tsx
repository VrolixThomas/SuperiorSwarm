// Mirrors apps/desktop/src/renderer/components/DraftCommitCard.tsx. Static
// (no tRPC, no stores, no shortcuts) — renders the "with changes" branch only.

interface DiffFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed" | "binary";
	additions: number;
	deletions: number;
}

const STATUS_DOT_COLORS: Record<DiffFile["status"], string> = {
	added: "bg-[var(--term-green)]",
	modified: "bg-[var(--term-yellow)]",
	deleted: "bg-[var(--term-red)]",
	renamed: "bg-[var(--accent)]",
	binary: "bg-[var(--text-quaternary)]",
};

interface FileGroup {
	dir: string;
	files: DiffFile[];
}

function groupByDirectory(files: DiffFile[]): FileGroup[] {
	const groups: Record<string, DiffFile[]> = {};
	for (const file of files) {
		const parts = file.path.split("/");
		const dir = parts.length > 1 ? (parts[0] ?? ".") : ".";
		if (!groups[dir]) groups[dir] = [];
		groups[dir]?.push(file);
	}
	return Object.entries(groups)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([dir, files]) => ({ dir, files: files.sort((a, b) => a.path.localeCompare(b.path)) }));
}

export function DraftCommitCard() {
	const stagedFiles: DiffFile[] = [
		{
			path: "src/renderer/hooks/useAgentTerminalStream.ts",
			status: "modified",
			additions: 7,
			deletions: 2,
		},
		{
			path: "src/renderer/components/Terminal.tsx",
			status: "modified",
			additions: 12,
			deletions: 0,
		},
	];
	const unstagedFiles: DiffFile[] = [];
	const allFiles: DiffFile[] = [...stagedFiles, ...unstagedFiles];
	const stagedPaths = new Set(stagedFiles.map((f) => f.path));
	const groups = groupByDirectory(allFiles);
	const selectedFilePath: string | null = null;
	const scope: "all" | "working" | "branch" = "all";
	const allStaged = true;

	return (
		<div className="mx-1.5 mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-active)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]">
			{/* Card header */}
			<div className="flex items-center gap-2 px-3 py-1.5">
				<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
					Working Changes
				</span>
				<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[10px] text-[var(--text-tertiary)]">
					{allFiles.length}
				</span>
				<div className="flex-1" />
				<button
					type="button"
					className="text-[11px] text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:text-[var(--text-secondary)]"
				>
					{allStaged ? "Unstage All" : "Stage All"}
				</button>
			</div>

			{/* File list with directory grouping */}
			<div className="max-h-[280px] overflow-y-auto px-1 pb-1">
				{groups.map((group) => {
					const groupAllStaged = group.files.every((f) => stagedPaths.has(f.path));
					const groupSomeStaged = group.files.some((f) => stagedPaths.has(f.path));

					return (
						<div key={group.dir}>
							{/* Directory header (skip for root ".") */}
							{group.dir !== "." && (
								<button
									type="button"
									className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
								>
									<Checkbox
										checked={groupAllStaged}
										indeterminate={!groupAllStaged && groupSomeStaged}
									/>
									<svg
										aria-hidden="true"
										width="10"
										height="10"
										viewBox="0 0 16 16"
										fill="currentColor"
										className="shrink-0 text-[var(--text-quaternary)]"
									>
										<path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z" />
									</svg>
									<span className="truncate">{group.dir}/</span>
								</button>
							)}

							{/* Files in this group */}
							{group.files.map((file) => {
								const fileName = file.path.split("/").pop() ?? file.path;
								const isStaged = stagedPaths.has(file.path);

								const isSelected = file.path === selectedFilePath;
								const isDimmed = scope !== "all" && scope !== "working";

								return (
									<div
										key={file.path}
										className={[
											"group flex w-full cursor-pointer items-center gap-1.5 rounded border-l-2 px-2 py-0.5 text-left text-[12px] transition-all duration-[120ms]",
											group.dir !== "." ? "pl-6" : "",
											isDimmed ? "opacity-40" : "",
											isSelected
												? "border-[var(--accent)] bg-[var(--bg-selected)] font-medium text-[var(--text-primary)]"
												: "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
										].join(" ")}
									>
										<div>
											<Checkbox checked={isStaged} />
										</div>
										<span
											className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT_COLORS[file.status]}`}
										/>
										<span className="min-w-0 flex-1 truncate">{fileName}</span>
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
					);
				})}
			</div>

			{/* Commit footer */}
			<div className="border-t border-[var(--border-subtle)] px-2 py-2">
				<textarea
					defaultValue=""
					placeholder="Commit message..."
					rows={1}
					className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
				/>
				<div className="mt-1.5 flex gap-1.5">
					<button
						type="button"
						className="flex-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-[var(--accent-foreground)] transition-opacity disabled:opacity-40"
					>
						{`Commit${stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ""}`}
					</button>
					<button
						type="button"
						className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-opacity hover:bg-[var(--bg-overlay)] disabled:opacity-40"
					>
						Push ↑
					</button>
				</div>
			</div>
		</div>
	);
}

// ─── Checkbox sub-component ──────────────────────────────────────────────────

function Checkbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
	return (
		<div
			className={[
				"flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-all duration-[120ms]",
				checked
					? "border-[var(--accent)] bg-[var(--accent)]"
					: indeterminate
						? "border-[var(--accent)] bg-[var(--accent)]/50"
						: "border-[var(--border-active)] bg-transparent",
			].join(" ")}
		>
			{checked && (
				<svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" fill="none">
					<path
						d="M1.5 4L3 5.5L6.5 2"
						stroke="white"
						strokeWidth="1.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			)}
			{!checked && indeterminate && <div className="h-[1.5px] w-2 rounded-full bg-white" />}
		</div>
	);
}
