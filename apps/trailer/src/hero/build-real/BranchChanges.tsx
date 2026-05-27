// Mirrors apps/desktop/src/renderer/components/BranchChanges.tsx. Static (no
// tRPC, no stores) — hardcoded file list, expanded state always on.

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
		.map(([dir, files]) => ({
			dir,
			files: files.sort((a, b) => a.path.localeCompare(b.path)),
		}));
}

export function BranchChanges() {
	const files: DiffFile[] = [
		{
			path: "src/renderer/components/Terminal.tsx",
			status: "modified",
			additions: 46,
			deletions: 8,
		},
		{
			path: "src/renderer/hooks/useAgentTerminalStream.ts",
			status: "modified",
			additions: 31,
			deletions: 6,
		},
		{
			path: "src/renderer/components/solve/SolveSidebar.tsx",
			status: "modified",
			additions: 28,
			deletions: 4,
		},
		{
			path: "src/renderer/main/ai-review/comment-solver-orchestrator.ts",
			status: "modified",
			additions: 64,
			deletions: 13,
		},
		{
			path: "src/renderer/shared/agent-events.ts",
			status: "modified",
			additions: 18,
			deletions: 2,
		},
	];
	const collapsed = false;
	const selectedFilePath: string | null = null;
	const scope: "all" | "working" | "branch" = "all";

	const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
	const groups = groupByDirectory(files);

	return (
		<div className="mx-1.5 mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]">
			{/* Header — prominent stats bar */}
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

			{/* File list with directory grouping */}
			{!collapsed && (
				<div className="border-t border-[var(--border-subtle)]">
					<div className="max-h-[400px] overflow-y-auto px-1 py-1">
						{groups.map((group) => (
							<DirectoryGroup
								key={group.dir}
								group={group}
								selectedFilePath={selectedFilePath}
								scope={scope}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ─── DirectoryGroup ──────────────────────────────────────────────────────────

function DirectoryGroup({
	group,
	selectedFilePath,
	scope,
}: {
	group: FileGroup;
	selectedFilePath: string | null;
	scope: "all" | "working" | "branch";
}) {
	const expanded = true;

	return (
		<div>
			{/* Directory header (skip for root ".") */}
			{group.dir !== "." && (
				<button
					type="button"
					className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
				>
					<span
						className="text-[10px] transition-transform duration-150"
						style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
					>
						▾
					</span>
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
					<span className="ml-auto text-[10px] text-[var(--text-quaternary)]">
						{group.files.length}
					</span>
				</button>
			)}

			{/* Files in this group */}
			{expanded &&
				group.files.map((file) => {
					const fileName = file.path.split("/").pop() ?? file.path;
					const isSelected = file.path === selectedFilePath;
					const isOutOfScope = scope !== "all" && scope !== "branch";

					return (
						<button
							key={file.path}
							type="button"
							aria-current={isSelected ? "true" : undefined}
							className={[
								"flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] transition-colors duration-[120ms] border-l-2",
								group.dir !== "." ? "pl-7" : "",
								isSelected
									? "border-[var(--accent)] bg-[var(--bg-selected)] font-medium text-[var(--text-primary)]"
									: "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
								isOutOfScope ? "opacity-40" : "",
							].join(" ")}
						>
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
						</button>
					);
				})}
		</div>
	);
}
