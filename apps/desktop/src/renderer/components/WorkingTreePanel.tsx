import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import { trpc } from "../trpc/client";
import { FileSection } from "./FileTreeNode";

export function WorkingTreePanel({
	diffCtx,
	workspaceId,
}: {
	diffCtx: DiffContext & { type: "working-tree" };
	workspaceId: string;
}) {
	const [commitMsg, setCommitMsg] = useState("");

	const utils = trpc.useUtils();

	const stagedQuery = trpc.diff.getStagedDiff.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ staleTime: 5_000 }
	);

	const unstagedQuery = trpc.diff.getUnstagedDiff.useQuery(
		{ repoPath: diffCtx.repoPath },
		{ staleTime: 5_000 }
	);

	const invalidateBoth = () => {
		utils.diff.getStagedDiff.invalidate({ repoPath: diffCtx.repoPath });
		utils.diff.getUnstagedDiff.invalidate({ repoPath: diffCtx.repoPath });
	};

	const stageMutation = trpc.diff.stageFiles.useMutation({ onSuccess: invalidateBoth });
	const unstageMutation = trpc.diff.unstageFiles.useMutation({ onSuccess: invalidateBoth });

	const commitMutation = trpc.diff.commit.useMutation({
		onSuccess: () => {
			setCommitMsg("");
			pushMutation.reset();
			invalidateBoth();
		},
	});

	const pushMutation = trpc.diff.push.useMutation();

	const stagedFiles = stagedQuery.data?.files ?? [];
	const unstagedFiles = unstagedQuery.data?.files ?? [];
	const isLoading = stagedQuery.isLoading || unstagedQuery.isLoading;
	const canCommit = stagedFiles.length > 0 && commitMsg.trim().length > 0;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Commit area */}
			<div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--border)] px-2 py-2">
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
							: `Commit${stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ""}`}
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

			{/* File sections */}
			<div className="flex-1 overflow-y-auto px-1 py-1">
				{isLoading && (
					<div className="flex items-center justify-center py-4 text-[12px] text-[var(--text-quaternary)]">
						Loading...
					</div>
				)}
				{!isLoading && (
					<>
						<FileSection
							label="Staged Changes"
							files={stagedFiles}
							diffCtx={diffCtx}
							workspaceId={workspaceId}
							actionButton={{
								icon: "\u2212",
								title: "Unstage file",
								onClick: (path) =>
									unstageMutation.mutate({
										repoPath: diffCtx.repoPath,
										paths: [path],
									}),
							}}
							bulkAction={{
								icon: "\u2212",
								title: "Unstage all",
								onClick: () =>
									unstageMutation.mutate({
										repoPath: diffCtx.repoPath,
										paths: stagedFiles.map((f) => f.path),
									}),
							}}
						/>
						<FileSection
							label="Changes"
							files={unstagedFiles}
							diffCtx={diffCtx}
							workspaceId={workspaceId}
							actionButton={{
								icon: "+",
								title: "Stage file",
								onClick: (path) =>
									stageMutation.mutate({
										repoPath: diffCtx.repoPath,
										paths: [path],
									}),
							}}
							bulkAction={{
								icon: "+",
								title: "Stage all",
								onClick: () =>
									stageMutation.mutate({
										repoPath: diffCtx.repoPath,
										paths: unstagedFiles.map((f) => f.path),
									}),
							}}
						/>
						{stagedFiles.length === 0 && unstagedFiles.length === 0 && (
							<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No changes</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
