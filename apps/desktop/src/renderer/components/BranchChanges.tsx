import { useMemo, useState } from "react";
import type { DiffFile } from "../../shared/diff-types";
import { useReviewSessionStore } from "../stores/review-session-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

// ─── Status dot colors ───────────────────────────────────────────────────────

const STATUS_DOT_COLORS: Record<DiffFile["status"], string> = {
	added: "bg-[var(--term-green)]",
	modified: "bg-[var(--term-yellow)]",
	deleted: "bg-[var(--term-red)]",
	renamed: "bg-[var(--accent)]",
	binary: "bg-[var(--text-quaternary)]",
};

// ─── Directory grouping ──────────────────────────────────────────────────────

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

// ─── BranchChanges ───────────────────────────────────────────────────────────

export function BranchChanges({
	repoPath,
	baseBranch,
	currentBranch,
	workspaceId,
}: {
	repoPath: string;
	baseBranch: string;
	currentBranch: string;
	workspaceId: string;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const openReviewTab = useTabStore((s) => s.openReviewTab);
	const selectedFilePath = useReviewSessionStore((s) => s.activeSession?.selectedFilePath ?? null);
	const scope = useReviewSessionStore((s) => s.activeSession?.scope ?? "all");

	const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
		{ repoPath, baseBranch, headBranch: currentBranch },
		{ refetchInterval: 2_000 }
	);

	const files = branchDiffQuery.data?.files ?? [];
	const stats = branchDiffQuery.data?.stats;

	const totalAdditions = useMemo(() => files.reduce((sum, f) => sum + f.additions, 0), [files]);
	const totalDeletions = useMemo(() => files.reduce((sum, f) => sum + f.deletions, 0), [files]);
	const groups = useMemo(() => groupByDirectory(files), [files]);

	if (branchDiffQuery.isLoading) {
		return (
			<div className="mx-1.5 mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
				<span className="text-[12px] text-[var(--text-quaternary)]">Loading branch changes...</span>
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="mx-1.5 mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
				<span className="text-[12px] text-[var(--text-quaternary)]">
					No changes vs <span className="font-medium">{baseBranch}</span>
				</span>
			</div>
		);
	}

	return (
		<div className="mx-1.5 mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]">
			{/* Header — prominent stats bar */}
			<button
				type="button"
				onClick={() => setCollapsed((c) => !c)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
			>
				<span
					className="text-[10px] text-[var(--text-quaternary)] transition-transform duration-150"
					style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
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
								onFileClick={(file) =>
									openReviewTab({
										workspaceId,
										repoPath,
										baseBranch,
										scope: "branch",
										filePath: file.path,
									})
								}
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
	onFileClick,
	selectedFilePath,
	scope,
}: {
	group: FileGroup;
	onFileClick: (file: DiffFile) => void;
	selectedFilePath: string | null;
	scope: "all" | "working" | "branch";
}) {
	const [expanded, setExpanded] = useState(true);

	return (
		<div>
			{/* Directory header (skip for root ".") */}
			{group.dir !== "." && (
				<button
					type="button"
					onClick={() => setExpanded((e) => !e)}
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
							onClick={() => onFileClick(file)}
							className={[
								"flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] transition-colors duration-[120ms]",
								group.dir !== "." ? "pl-7" : "",
								isSelected
									? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
									: "text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
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
