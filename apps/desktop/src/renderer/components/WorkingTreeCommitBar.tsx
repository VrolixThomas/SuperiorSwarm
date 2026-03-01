import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import { trpc } from "../trpc/client";

export function WorkingTreeCommitBar({
	diffCtx,
}: {
	diffCtx: DiffContext & { type: "working-tree" };
}) {
	const [commitMsg, setCommitMsg] = useState("");

	const utils = trpc.useUtils();

	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ staleTime: 5_000 }
	);

	const invalidateAll = () => {
		utils.diff.getWorkingTreeStatus.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getWorkingTreeDiff.invalidate({ repoPath: diffCtx.repoPath });
	};

	const commitMutation = trpc.diff.commit.useMutation({
		onSuccess: () => {
			setCommitMsg("");
			pushMutation.reset();
			invalidateAll();
		},
	});

	const pushMutation = trpc.diff.push.useMutation();

	const stagedCount = statusQuery.data?.stagedFiles?.length ?? 0;
	const branch = statusQuery.data?.branch ?? "";
	const canCommit = stagedCount > 0 && commitMsg.trim().length > 0;

	return (
		<div className="shrink-0 border-b border-[var(--border)]">
			{/* Branch indicator */}
			{branch && (
				<div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1">
					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="shrink-0 text-[var(--text-quaternary)]"
					>
						<path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
					</svg>
					<span className="truncate text-[12px] text-[var(--text-tertiary)]">{branch}</span>
				</div>
			)}
			{/* Commit area */}
			<div className="flex flex-col gap-1.5 px-2 py-2">
				<textarea
					value={commitMsg}
					onChange={(e) => setCommitMsg(e.target.value)}
					placeholder="Commit message"
					rows={3}
					className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
				/>
				<div className="flex gap-1.5">
					<button
						type="button"
						disabled={!canCommit || commitMutation.isPending}
						onClick={() =>
							commitMutation.mutate({
								repoPath: diffCtx.repoPath,
								message: commitMsg.trim(),
							})
						}
						className="flex-1 rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-white transition-opacity disabled:opacity-40"
					>
						{commitMutation.isPending
							? "Committing..."
							: `Commit${stagedCount > 0 ? ` (${stagedCount})` : ""}`}
					</button>
					<button
						type="button"
						disabled={pushMutation.isPending}
						onClick={() => pushMutation.mutate({ repoPath: diffCtx.repoPath })}
						className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-opacity hover:bg-[var(--bg-elevated)] disabled:opacity-40"
					>
						{pushMutation.isPending ? "Pushing..." : "Push \u2191"}
					</button>
				</div>
				{commitMutation.isError && (
					<p className="text-[11px] text-[var(--term-red)]">{commitMutation.error.message}</p>
				)}
				{pushMutation.isError && (
					<p className="text-[11px] text-[var(--term-red)]">{pushMutation.error.message}</p>
				)}
				{pushMutation.isSuccess && (
					<p className="text-[11px] text-[var(--term-green)]">Pushed successfully</p>
				)}
			</div>
		</div>
	);
}
