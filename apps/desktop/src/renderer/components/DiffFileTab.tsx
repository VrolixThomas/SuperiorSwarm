import { useEffect, useRef } from "react";
import type { DiffContext } from "../stores/diff";
import { useDiffStore } from "../stores/diff";
import { trpc } from "../trpc/client";
import { DiffEditor } from "./DiffEditor";

interface DiffFileTabProps {
	diffCtx: DiffContext;
	filePath: string;
	language: string;
}

function refsForContext(ctx: DiffContext): { originalRef: string; modifiedRef: string } {
	if (ctx.type === "branch") {
		return { originalRef: ctx.baseBranch, modifiedRef: ctx.headBranch };
	}
	if (ctx.type === "pr") {
		return { originalRef: ctx.targetBranch, modifiedRef: ctx.sourceBranch };
	}
	// working-tree: HEAD (committed) vs current file on disk (empty ref = working tree)
	return { originalRef: "HEAD", modifiedRef: "" };
}

export function DiffFileTab({ diffCtx, filePath, language }: DiffFileTabProps) {
	const { diffMode, setDiffMode } = useDiffStore();
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		};
	}, []);

	const saveMutation = trpc.diff.saveFileContent.useMutation();

	const { originalRef, modifiedRef } = refsForContext(diffCtx);

	const originalQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: diffCtx.repoPath, ref: originalRef, filePath },
		{ staleTime: 30_000 },
	);

	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: diffCtx.repoPath, ref: modifiedRef, filePath },
		{ staleTime: diffCtx.type === "working-tree" ? 5_000 : 30_000 },
	);

	function handleModifiedChange(content: string) {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			saveMutation.mutate({ repoPath: diffCtx.repoPath, filePath, content });
		}, 500);
	}

	const isEditable = diffCtx.type === "working-tree" || diffCtx.type === "branch";
	const isLoading = originalQuery.isLoading || modifiedQuery.isLoading;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Minimal toolbar */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{filePath}
				</span>
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					{diffMode === "split" ? "Inline" : "Split"}
				</button>
				{saveMutation.isPending && (
					<span className="text-[11px] text-[var(--text-quaternary)]">Saving…</span>
				)}
			</div>

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
						onModifiedChange={isEditable ? handleModifiedChange : undefined}
					/>
				)}
			</div>
		</div>
	);
}
