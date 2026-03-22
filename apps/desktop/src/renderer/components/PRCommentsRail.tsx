import { useMemo, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type { PRContext } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

type AuthorTab = "comments" | "resolved" | "changes";

// ── Tab header (segmented control) ──────────────────────────────────────────

function AuthorTabHeader({
	tab,
	onSetTab,
	commentCount,
}: {
	tab: AuthorTab;
	onSetTab: (t: AuthorTab) => void;
	commentCount: number;
}) {
	const tabs: { key: AuthorTab; label: string; badge?: number }[] = [
		{ key: "comments", label: "Comments", badge: commentCount > 0 ? commentCount : undefined },
		{ key: "resolved", label: "Resolved" },
		{ key: "changes", label: "Changes" },
	];

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
			<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				{tabs.map((t) => (
					<button
						key={t.key}
						type="button"
						onClick={() => onSetTab(t.key)}
						className={[
							"flex items-center gap-1 rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
							tab === t.key
								? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
								: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
						].join(" ")}
					>
						{t.label}
						{t.badge != null && (
							<span className="rounded-full bg-[var(--bg-overlay)] px-1 text-[9px] text-[var(--text-tertiary)]">
								{t.badge}
							</span>
						)}
					</button>
				))}
			</div>
		</div>
	);
}

// ── Comments tab ────────────────────────────────────────────────────────────

function CommentsTab({ prCtx }: { prCtx: PRContext }) {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);

	const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;

	const commentsQuery = trpc.resolution.fetchComments.useQuery(
		{ provider: prCtx.provider, prIdentifier },
		{ staleTime: 30_000 }
	);

	const startResolution = trpc.resolution.startResolution.useMutation();

	const comments = commentsQuery.data ?? [];
	const unresolvedCount = comments.length;

	const handleResolveWithAI = () => {
		if (!activeWorkspaceId) return;
		startResolution.mutate({
			workspaceId: activeWorkspaceId,
			worktreePath: activeWorkspaceCwd,
			prProvider: prCtx.provider,
			prIdentifier,
			prTitle: prCtx.title,
			prNumber: prCtx.number,
			sourceBranch: prCtx.sourceBranch,
			targetBranch: prCtx.targetBranch,
		});
	};

	if (commentsQuery.isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				Loading comments...
			</div>
		);
	}

	if (comments.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
				<span className="text-[12px] text-[var(--text-quaternary)]">
					No unresolved review comments
				</span>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex-1 overflow-y-auto px-1.5 py-2">
				{comments.map((comment) => (
					<div
						key={comment.platformCommentId}
						className="mb-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]"
						style={{ borderLeft: "3px solid var(--term-red)" }}
					>
						<div className="px-3 py-2">
							{/* Header: author + status badge */}
							<div className="flex items-center gap-2">
								<span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-secondary)]">
									{comment.author}
								</span>
								<span
									className="shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-medium"
									style={{
										color: "var(--term-red)",
										border: "1px solid rgba(255,69,58,0.25)",
									}}
								>
									unresolved
								</span>
							</div>

							{/* File:line reference */}
							{comment.filePath && (
								<div className="mt-1 truncate font-mono text-[10px] text-[var(--text-quaternary)]">
									{comment.filePath}
									{comment.lineNumber != null ? `:${comment.lineNumber}` : ""}
								</div>
							)}

							{/* Comment body */}
							<div className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
								{comment.body.length > 200 ? `${comment.body.slice(0, 200)}...` : comment.body}
							</div>
						</div>
					</div>
				))}
			</div>

			{/* Sticky bottom bar */}
			<div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-3 py-2">
				<span className="min-w-0 flex-1 text-[11px] text-[var(--text-tertiary)]">
					{unresolvedCount} comment{unresolvedCount !== 1 ? "s" : ""} can be resolved
				</span>
				<button
					type="button"
					onClick={handleResolveWithAI}
					disabled={startResolution.isPending}
					className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:opacity-50"
				>
					{startResolution.isPending ? "Starting..." : "Resolve with AI"}
				</button>
			</div>
		</div>
	);
}

// ── Resolved tab ────────────────────────────────────────────────────────────

function ResolvedTab({ prCtx }: { prCtx: PRContext }) {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);

	const sessionQuery = trpc.resolution.getSession.useQuery(
		{ workspaceId: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId, refetchInterval: 3_000 }
	);

	const revertGroupMut = trpc.resolution.revertGroup.useMutation({
		onSuccess: () => sessionQuery.refetch(),
	});

	const pushChangesMut = trpc.resolution.pushChanges.useMutation({
		onSuccess: () => sessionQuery.refetch(),
	});

	const session = sessionQuery.data;

	if (sessionQuery.isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				Loading session...
			</div>
		);
	}

	if (!session) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
				<span className="text-[12px] text-[var(--text-quaternary)]">No resolution session yet</span>
				<span className="text-[10px] text-[var(--text-quaternary)]">
					Start by resolving comments from the Comments tab
				</span>
			</div>
		);
	}

	const groups = session.groups.filter((g) => g.status === "applied");
	const allComments = session.comments;
	const resolvedComments = allComments.filter((c) => c.status === "resolved");
	const skippedComments = allComments.filter((c) => c.status === "skipped");
	const totalActionable = resolvedComments.length + skippedComments.length;
	const totalComments = allComments.length;

	const handleViewDiff = (groupId: string) => {
		if (!activeWorkspaceId) return;
		// Find any files associated with this group's resolved comments
		const groupComments = allComments.filter((c) => c.groupId === groupId && c.filePath);
		const firstFile = groupComments[0];
		if (firstFile?.filePath) {
			openPRReviewFile(
				activeWorkspaceId,
				prCtx,
				firstFile.filePath,
				detectLanguage(firstFile.filePath)
			);
		}
	};

	const handleRevertGroup = (groupId: string) => {
		revertGroupMut.mutate({ groupId, worktreePath: activeWorkspaceCwd });
	};

	const handlePushChanges = () => {
		if (!session || groups.length === 0) return;
		const lastGroup = groups[groups.length - 1];
		if (!lastGroup) return;
		pushChangesMut.mutate({
			sessionId: session.id,
			groupId: lastGroup.id,
			worktreePath: activeWorkspaceCwd,
			replyBody: "Resolved review comments with AI assistance.",
		});
	};

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex-1 overflow-y-auto px-1.5 py-2">
				{/* Commit groups */}
				{groups.map((group) => {
					const groupResolvedComments = resolvedComments.filter((c) => c.groupId === group.id);
					const shortSha = group.commitSha.slice(0, 7);

					return (
						<div
							key={group.id}
							className="mb-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]"
						>
							<div className="px-3 py-2">
								{/* Commit header */}
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-secondary)]">
										{group.commitMessage}
									</span>
									<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">
										{shortSha}
									</span>
								</div>

								{/* Action buttons */}
								<div className="mt-1.5 flex items-center gap-2">
									<button
										type="button"
										onClick={() => handleViewDiff(group.id)}
										className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
									>
										View Diff
									</button>
									<button
										type="button"
										onClick={() => handleRevertGroup(group.id)}
										disabled={revertGroupMut.isPending}
										className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-medium text-[var(--term-red)] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)] disabled:opacity-50"
									>
										Revert
									</button>
								</div>
							</div>

							{/* Resolved comments under this group */}
							{groupResolvedComments.length > 0 && (
								<div className="border-t border-[var(--border-subtle)]">
									{groupResolvedComments.map((comment) => (
										<div key={comment.id} className="flex items-start gap-1.5 px-3 py-1.5">
											<span className="mt-0.5 shrink-0 text-[10px] text-[var(--term-green)]">
												&#10003;
											</span>
											<div className="min-w-0 flex-1">
												<span className="text-[10px] font-medium text-[var(--text-tertiary)]">
													{comment.author}
												</span>
												{comment.filePath && (
													<span className="ml-1 font-mono text-[9px] text-[var(--text-quaternary)]">
														{comment.filePath}
													</span>
												)}
												<div className="mt-0.5 truncate text-[10px] text-[var(--text-quaternary)]">
													{comment.body.length > 80
														? `${comment.body.slice(0, 80)}...`
														: comment.body}
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					);
				})}

				{/* Skipped section */}
				{skippedComments.length > 0 && (
					<>
						<div className="mt-3 mb-1.5 px-1 text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
							Skipped
						</div>
						{skippedComments.map((comment) => (
							<div
								key={comment.id}
								className="mb-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]"
								style={{ borderLeft: "3px solid var(--text-quaternary)" }}
							>
								<div className="px-3 py-2">
									<div className="flex items-center gap-2">
										<span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-tertiary)]">
											{comment.author}
										</span>
										{comment.filePath && (
											<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">
												{comment.filePath}
											</span>
										)}
									</div>
									<div className="mt-1 text-[10px] text-[var(--text-quaternary)]">
										{comment.body.length > 100 ? `${comment.body.slice(0, 100)}...` : comment.body}
									</div>
									{comment.skipReason && (
										<div className="mt-1 text-[10px] italic text-[var(--text-quaternary)]">
											Skip reason: {comment.skipReason}
										</div>
									)}
									<button
										type="button"
										className="mt-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
									>
										Ask AI about this
									</button>
								</div>
							</div>
						))}
					</>
				)}

				{/* Empty state when session exists but no groups yet */}
				{groups.length === 0 && skippedComments.length === 0 && (
					<div className="flex flex-col items-center justify-center px-4 py-8 text-center">
						<span className="text-[12px] text-[var(--text-quaternary)]">
							{session.status === "running"
								? "AI is resolving comments..."
								: "No resolved comments yet"}
						</span>
					</div>
				)}
			</div>

			{/* Sticky bottom bar */}
			<div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-3 py-2">
				{/* Progress indicator */}
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<div className="h-1 w-16 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
						<div
							className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
							style={{
								width: totalComments > 0 ? `${(totalActionable / totalComments) * 100}%` : "0%",
							}}
						/>
					</div>
					<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
						{totalActionable}/{totalComments}
					</span>
				</div>
				<button
					type="button"
					onClick={handlePushChanges}
					disabled={pushChangesMut.isPending || groups.length === 0}
					className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:opacity-50"
				>
					{pushChangesMut.isPending ? "Pushing..." : "Push Changes"}
				</button>
			</div>
		</div>
	);
}

// ── Changes tab ─────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
	modified: "bg-[var(--term-yellow)]",
	added: "bg-[var(--term-green)]",
	deleted: "bg-[var(--term-red)]",
};

function ChangesTab({ prCtx }: { prCtx: PRContext }) {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);

	const sessionQuery = trpc.resolution.getSession.useQuery(
		{ workspaceId: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId, refetchInterval: 3_000 }
	);

	const session = sessionQuery.data;

	// Derive file list from resolved comments in applied groups
	const files = useMemo(() => {
		if (!session) return [];
		const appliedGroupIds = new Set(
			session.groups.filter((g) => g.status === "applied").map((g) => g.id)
		);
		const fileSet = new Map<string, string>();
		for (const comment of session.comments) {
			if (
				comment.status === "resolved" &&
				comment.groupId &&
				appliedGroupIds.has(comment.groupId) &&
				comment.filePath
			) {
				fileSet.set(comment.filePath, "modified");
			}
		}
		return Array.from(fileSet.entries()).map(([path, status]) => ({ path, status }));
	}, [session]);

	if (!session) {
		return (
			<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No resolution session
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No files changed yet
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex-1 overflow-y-auto py-1">
				{files.map((file) => {
					const filename = file.path.split("/").pop() ?? file.path;
					const dotClass = STATUS_DOT[file.status] ?? "bg-[var(--text-quaternary)]";

					return (
						<button
							key={file.path}
							type="button"
							onClick={() => {
								if (!activeWorkspaceId) return;
								openPRReviewFile(activeWorkspaceId, prCtx, file.path, detectLanguage(file.path));
							}}
							className="flex w-full items-center gap-1.5 px-3 py-[3px] text-left transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
						>
							<span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
							<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">
								{filename}
							</span>
							<span className="shrink-0 text-[10px] capitalize text-[var(--text-quaternary)]">
								{file.status}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ── Main component ──────────────────────────────────────────────────────────

export function PRCommentsRail({ prCtx }: { prCtx: PRContext }) {
	const [tab, setTab] = useState<AuthorTab>("comments");

	const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;

	const commentsQuery = trpc.resolution.fetchComments.useQuery(
		{ provider: prCtx.provider, prIdentifier },
		{ staleTime: 30_000 }
	);
	const commentCount = commentsQuery.data?.length ?? 0;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<AuthorTabHeader tab={tab} onSetTab={setTab} commentCount={commentCount} />
			<div className="flex flex-1 flex-col overflow-hidden">
				{tab === "comments" && <CommentsTab prCtx={prCtx} />}
				{tab === "resolved" && <ResolvedTab prCtx={prCtx} />}
				{tab === "changes" && <ChangesTab prCtx={prCtx} />}
			</div>
		</div>
	);
}
