import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { DiffEditor } from "./DiffEditor";

interface CommentFixFileTabProps {
	repoPath: string;
	filePath: string;
	commitHash: string;
	language: string;
}

export function CommentFixFileTab({
	repoPath,
	filePath,
	commitHash,
	language,
}: CommentFixFileTabProps) {
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);

	const originalQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: `${commitHash}~1`, filePath },
		{ staleTime: 60_000 }
	);

	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: commitHash, filePath },
		{ staleTime: 60_000 }
	);

	const isLoading = originalQuery.isLoading || modifiedQuery.isLoading;
	const shortHash = commitHash.slice(0, 7);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Header bar */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{filePath}
				</span>
				<span className="font-mono text-[11px] text-[var(--text-quaternary)]">{shortHash}</span>
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					{diffMode === "split" ? "Inline" : "Split"}
				</button>
			</div>

			{/* Diff editor */}
			<div className="flex-1 overflow-hidden">
				{isLoading ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Loading…
					</div>
				) : (
					<DiffEditor
						original={originalQuery.data?.content ?? ""}
						modified={modifiedQuery.data?.content ?? ""}
						language={language}
						renderSideBySide={diffMode === "split"}
					/>
				)}
			</div>
		</div>
	);
}
