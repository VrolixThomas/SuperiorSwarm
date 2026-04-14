import { useState } from "react";
import type { DiffContext, DiffFile } from "../../shared/diff-types";
import { detectLanguage } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

// ─── Status dot colors (shared with DraftCommitCard) ─────────────────────────

const STATUS_DOT_COLORS: Record<DiffFile["status"], string> = {
	added: "bg-[var(--term-green)]",
	modified: "bg-[var(--term-yellow)]",
	deleted: "bg-[var(--term-red)]",
	renamed: "bg-[var(--accent)]",
	binary: "bg-[var(--text-quaternary)]",
};

// ─── CommitCard ──────────────────────────────────────────────────────────────

function CommitCard({
	commit,
	diffCtx,
	workspaceId,
}: {
	commit: {
		hash: string;
		shortHash: string;
		message: string;
		time: string;
		additions: number;
		deletions: number;
		files: DiffFile[];
	};
	diffCtx: DiffContext;
	workspaceId: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const openDiffFile = useTabStore((s) => s.openDiffFile);

	return (
		<div className="mx-1.5 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
			{/* Collapsed header — always visible */}
			<button
				type="button"
				onClick={() => setExpanded((e) => !e)}
				className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
			>
				<div className="flex w-full items-center gap-2">
					<span
						className="shrink-0 text-[11px] text-[var(--text-quaternary)]"
						style={{ fontFamily: "var(--font-mono)" }}
					>
						{commit.shortHash}
					</span>
					<span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
						{commit.message}
					</span>
					<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">{commit.time}</span>
				</div>
				<div className="flex w-full items-center gap-2">
					<span className="text-[11px]">
						{commit.additions > 0 && (
							<span className="text-[var(--term-green)]">+{commit.additions}</span>
						)}
						{commit.deletions > 0 && (
							<span className="ml-1 text-[var(--term-red)]">-{commit.deletions}</span>
						)}
					</span>
					<span className="text-[11px] text-[var(--text-quaternary)]">
						· {commit.files.length} file{commit.files.length !== 1 ? "s" : ""}
					</span>
					<div className="flex-1" />
					<span
						className="text-[10px] text-[var(--text-quaternary)] transition-transform duration-150"
						style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
					>
						▾
					</span>
				</div>
			</button>

			{/* Expanded file list */}
			{expanded && (
				<div className="border-t border-[var(--border-subtle)] px-1 py-1">
					{commit.files.map((file) => {
						const fileName = file.path.split("/").pop() ?? file.path;
						return (
							<button
								key={file.path}
								type="button"
								onClick={() =>
									openDiffFile(
										workspaceId,
										{ type: "commit", repoPath: diffCtx.repoPath, commitHash: commit.hash },
										file.path,
										detectLanguage(file.path),
									)
								}
								className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
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
			)}
		</div>
	);
}

// ─── CommittedStack ──────────────────────────────────────────────────────────

export function CommittedStack({
	repoPath,
	baseBranch,
	diffCtx,
	workspaceId,
}: {
	repoPath: string;
	baseBranch: string;
	diffCtx: DiffContext;
	workspaceId: string;
}) {
	const commitsQuery = trpc.diff.getCommitsAhead.useQuery(
		{ repoPath, baseBranch },
		{ staleTime: 30_000 }
	);

	const commits = commitsQuery.data ?? [];

	return (
		<div className="flex flex-col gap-1 pb-4">
			{/* Section header */}
			<div className="flex items-center gap-2 px-3 py-1.5">
				<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
					Commits
				</span>
				{commits.length > 0 && (
					<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[10px] text-[var(--text-tertiary)]">
						{commits.length}
					</span>
				)}
			</div>

			{/* Commit cards */}
			{commitsQuery.isLoading && (
				<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">Loading...</div>
			)}
			{!commitsQuery.isLoading && commits.length === 0 && (
				<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
					No commits ahead of <span className="font-medium">{baseBranch}</span>
				</div>
			)}
			{commits.map((commit) => (
				<CommitCard key={commit.hash} commit={commit} diffCtx={diffCtx} workspaceId={workspaceId} />
			))}
		</div>
	);
}
