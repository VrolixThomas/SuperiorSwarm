import { useMemo, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type { SolveCommentInfo, SolveGroupInfo, SolveSessionInfo } from "../../shared/solve-types";
import { formatRelativeTime } from "../../shared/tickets";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SolvingBanner } from "./SolvingBanner";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AIFixesTabProps {
	workspaceId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueFilePaths(comments: SolveCommentInfo[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const c of comments) {
		if (!seen.has(c.filePath)) {
			seen.add(c.filePath);
			result.push(c.filePath);
		}
	}
	return result;
}

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressSummary({
	resolved,
	pending,
	unclear,
}: {
	resolved: number;
	pending: number;
	unclear: number;
}) {
	return (
		<div className="flex items-center gap-3 text-[10px]">
			{resolved > 0 && (
				<span className="flex items-center gap-1">
					<span className="inline-block h-[5px] w-[5px] rounded-full bg-[#34c759]" />
					<span className="text-[var(--text-secondary)]">{resolved} resolved</span>
				</span>
			)}
			{pending > 0 && (
				<span className="flex items-center gap-1">
					<span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--text-quaternary)]" />
					<span className="text-[var(--text-secondary)]">{pending} pending</span>
				</span>
			)}
			{unclear > 0 && (
				<span className="flex items-center gap-1">
					<span className="inline-block h-[5px] w-[5px] rounded-full bg-[#ff453a]" />
					<span className="text-[var(--text-secondary)]">{unclear} unclear</span>
				</span>
			)}
		</div>
	);
}

// ── CommitGroupCard ───────────────────────────────────────────────────────────

function CommitGroupCard({
	group,
	sessionId,
	workspaceId,
	defaultExpanded,
}: {
	group: SolveGroupInfo;
	sessionId: string;
	workspaceId: string;
	defaultExpanded: boolean;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const [activeFile, setActiveFile] = useState<string | null>(null);
	const [editingReply, setEditingReply] = useState<string | null>(null);
	const [editReplyText, setEditReplyText] = useState("");
	const [addingReplyTo, setAddingReplyTo] = useState<string | null>(null);
	const [newReplyText, setNewReplyText] = useState("");
	const repoPath = useTabStore((s) => s.activeWorkspaceCwd);
	const utils = trpc.useUtils();

	const approveGroup = trpc.commentSolver.approveGroup.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate({ sessionId });
		},
	});

	const updateReply = trpc.commentSolver.updateReply.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate({ sessionId });
			setEditingReply(null);
		},
	});

	const deleteReply = trpc.commentSolver.deleteReply.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate({ sessionId });
		},
	});

	const addReply = trpc.commentSolver.addReply.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate({ sessionId });
			setAddingReplyTo(null);
			setNewReplyText("");
		},
	});

	const approveReply = trpc.commentSolver.approveReply.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate({ sessionId });
		},
	});

	const revokeGroup = trpc.commentSolver.revokeGroup.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate({ sessionId });
		},
	});

	// Holds reply bodies for in-flight discards so Undo can restore them.
	// Keyed by comment ID. Cleared when user navigates away (component unmounts).
	const [discardedBodies, setDiscardedBodies] = useState<Map<string, string>>(new Map());

	const handleFollowUp = () => {
		// Find existing AI Solver terminal tab for this workspace
		const tabStore = useTabStore.getState();
		const tabs = tabStore.getTabsByWorkspace(workspaceId);
		const solverTab = tabs.find((t) => t.kind === "terminal" && t.title === "AI Solver");

		if (solverTab) {
			// Switch to the existing terminal
			tabStore.setActiveTab(solverTab.id);
		} else {
			// Create new terminal and resume the conversation
			const cwd = repoPath;
			const tabId = tabStore.addTerminalTab(workspaceId, cwd, "AI Solver");
			window.electron.terminal.create(tabId, cwd).then(() => {
				// Use --continue to resume the last Claude conversation in this directory
				window.electron.terminal.write(tabId, "claude --continue\n");
			});
		}
	};

	const shortHash = group.commitHash ? group.commitHash.slice(0, 7) : null;
	const filePaths = uniqueFilePaths(group.comments).filter(Boolean);
	const totalComments = group.comments.length;
	const fixedComments = group.comments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const allFixed = fixedComments === totalComments && totalComments > 0;
	const hasUnclearDraftReplies = group.comments.some(
		(c) => c.status === "unclear" && (c.reply === null || c.reply.status === "draft")
	);
	const canApprove = group.status === "fixed" && !hasUnclearDraftReplies;
	const canRevoke = group.status === "approved";

	// Badge color: green when all resolved, accent when partial, gray when pending
	const badgeBg = allFixed
		? "rgba(52,199,89,0.15)"
		: fixedComments > 0
			? "rgba(10,132,255,0.15)"
			: "var(--bg-overlay)";
	const badgeText = allFixed ? "#34c759" : fixedComments > 0 ? "#0a84ff" : "var(--text-tertiary)";

	const handleFileClick = (filePath: string) => {
		if (!group.commitHash) return;
		setActiveFile(filePath);
		useTabStore
			.getState()
			.openCommentFixFile(
				workspaceId,
				group.id,
				filePath,
				group.commitHash,
				repoPath,
				detectLanguage(filePath)
			);
	};

	return (
		<div className="overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			{/* Header — two rows: label row + actions row */}
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="w-full px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)]"
			>
				{/* Row 1: chevron + label + badge */}
				<div className="flex items-start gap-1.5">
					<span className="mt-0.5 shrink-0 text-[10px] text-[var(--text-quaternary)]">
						{expanded ? "\u25BE" : "\u25B8"}
					</span>
					<span className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-[var(--text-secondary)]">
						{group.label}
					</span>
					<span
						className="mt-0.5 shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-semibold"
						style={{ backgroundColor: badgeBg, color: badgeText }}
					>
						{fixedComments} / {totalComments}
					</span>
				</div>
				{/* Row 2: actions */}
				<div className="mt-1 flex items-center gap-2 pl-4">
					{canApprove && (
						<span
							role="button"
							tabIndex={0}
							onClick={(e) => {
								e.stopPropagation();
								approveGroup.mutate({ groupId: group.id });
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.stopPropagation();
									approveGroup.mutate({ groupId: group.id });
								}
							}}
							className="rounded-[4px] bg-[rgba(48,209,88,0.15)] px-2 py-0.5 text-[10px] font-medium text-[#30d158] hover:opacity-80"
						>
							{approveGroup.isPending ? "..." : "Approve"}
						</span>
					)}
					{group.status === "fixed" && !canApprove && (
						<span
							className="rounded-[4px] bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-quaternary)] cursor-not-allowed"
							title="Resolve unclear replies first"
						>
							Approve
						</span>
					)}
					{canRevoke && (
						<span
							role="button"
							tabIndex={0}
							onClick={(e) => {
								e.stopPropagation();
								revokeGroup.mutate({ groupId: group.id });
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.stopPropagation();
									revokeGroup.mutate({ groupId: group.id });
								}
							}}
							className="rounded-[4px] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
						>
							{revokeGroup.isPending ? "..." : "Revoke"}
						</span>
					)}
					<span
						role="button"
						tabIndex={0}
						onClick={(e) => {
							e.stopPropagation();
							handleFollowUp();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.stopPropagation();
								handleFollowUp();
							}
						}}
						className="rounded-[4px] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
					>
						Follow up
					</span>
				</div>
			</button>

			{/* Sub-header: commit hash + file names */}
			<div className="border-t border-[var(--border-subtle)] px-3 py-1.5">
				<div className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
					{shortHash && (
						<span style={{ fontFamily: "var(--font-mono)" }}>{shortHash}</span>
					)}
					{shortHash && filePaths.length > 0 && <span>&middot;</span>}
					{filePaths.map((fp, i) => {
						const filename = fp.split("/").pop() ?? fp;
						return (
							<span key={fp} className="flex items-center gap-1">
								{i > 0 && <span>,</span>}
								<button
									type="button"
									onClick={() => handleFileClick(fp)}
									className={[
										"hover:underline",
										activeFile === fp ? "text-[var(--accent)]" : "text-[var(--text-quaternary)]",
									].join(" ")}
									style={{ fontFamily: "var(--font-mono)" }}
									title={fp}
								>
									{filename}
								</button>
							</span>
						);
					})}
				</div>
			</div>

			{/* Expanded content: comments */}
			{expanded && (
				<div className="flex flex-col gap-0 divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
					{group.comments.map((comment) => {
						const commentFilename = comment.filePath ? comment.filePath.split("/").pop() : null;
						return (
							<div key={comment.id} className="px-3 py-2">
								{/* Comment author + file:line */}
								<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
									<span className="font-bold text-[var(--text-secondary)]">{comment.author}</span>
									{commentFilename && (
										<button
											type="button"
											onClick={() => handleFileClick(comment.filePath)}
											className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:underline"
											style={{ fontFamily: "var(--font-mono)" }}
											title={comment.filePath}
										>
											{commentFilename}
											{comment.lineNumber != null && `:${comment.lineNumber}`}
										</button>
									)}
								</div>
								{/* Comment body — full text, no truncation */}
								<MarkdownRenderer content={comment.body} />
								{/* Draft reply — editable */}
								{comment.reply && editingReply !== comment.reply.id && (
									<div
										className={[
											"mt-2 rounded-[4px] border px-2.5 py-1.5 transition-colors",
											comment.reply.status === "approved"
												? "border-[rgba(48,209,88,0.2)] bg-[rgba(48,209,88,0.05)]"
												: "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)]",
										].join(" ")}
									>
										<div className="flex items-center justify-between">
											<span className="text-[10px] font-medium text-[var(--text-quaternary)]">
												{comment.reply.status === "approved" ? "✓ Reply approved" : "Draft reply:"}
											</span>
											<div className="flex gap-1">
												<button
													type="button"
													onClick={() => {
														setEditingReply(comment.reply!.id);
														setEditReplyText(comment.reply!.body);
													}}
													className="text-[9px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
												>
													Edit
												</button>
												<button
													type="button"
													onClick={() => deleteReply.mutate({ replyId: comment.reply!.id })}
													className="text-[9px] text-[#ff453a] hover:opacity-80"
												>
													Delete
												</button>
											</div>
										</div>
										<MarkdownRenderer content={comment.reply.body} />

										{/* Sign-off strip — only for unclear comments with draft replies */}
										{comment.status === "unclear" && comment.reply.status === "draft" && (
											<div className="mt-2 flex items-center gap-2 border-t border-[rgba(255,255,255,0.05)] pt-2">
												<span className="flex-1 text-[10px] text-[var(--text-quaternary)]">
													Post this reply?
												</span>
												<button
													type="button"
													disabled={deleteReply.isPending}
													onClick={() => {
														const body = comment.reply!.body;
														const commentId = comment.id;
														setDiscardedBodies((prev) => {
															const next = new Map(prev);
															next.set(commentId, body);
															return next;
														});
														deleteReply.mutate({ replyId: comment.reply!.id });
													}}
													className="rounded-[4px] border border-[rgba(255,255,255,0.1)] px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] disabled:opacity-40"
												>
													Discard
												</button>
												<button
													type="button"
													disabled={approveReply.isPending}
													onClick={() => approveReply.mutate({ replyId: comment.reply!.id })}
													className="rounded-[4px] border border-[rgba(48,209,88,0.2)] bg-[rgba(48,209,88,0.12)] px-2 py-0.5 text-[10px] font-medium text-[#30d158] hover:bg-[rgba(48,209,88,0.2)] disabled:opacity-40"
												>
													{approveReply.isPending ? "..." : "✓ Approve"}
												</button>
											</div>
										)}
									</div>
								)}

								{/* Discarded reply — show undo affordance */}
								{!comment.reply && discardedBodies.has(comment.id) && (
									<div className="mt-2 flex items-center justify-between rounded-[4px] border border-[rgba(255,255,255,0.04)] px-2.5 py-1.5">
										<span className="text-[10px] italic text-[var(--text-quaternary)]">
											Reply discarded — nothing will be posted
										</span>
										<button
											type="button"
											onClick={() => {
												const body = discardedBodies.get(comment.id)!;
												setDiscardedBodies((prev) => {
													const next = new Map(prev);
													next.delete(comment.id);
													return next;
												});
												addReply.mutate({ commentId: comment.id, body, draft: true });
											}}
											className="text-[9px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
										>
											Undo
										</button>
									</div>
								)}
								{/* Editing reply */}
								{comment.reply && editingReply === comment.reply.id && (
									<div className="mt-2 rounded-[4px] border border-[var(--accent)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5">
										<span className="text-[10px] font-medium text-[var(--text-quaternary)]">
											Edit reply:
										</span>
										<textarea
											value={editReplyText}
											onChange={(e) => setEditReplyText(e.target.value)}
											className="mt-1 w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
											rows={3}
										/>
										<div className="mt-1 flex justify-end gap-1.5">
											<button
												type="button"
												onClick={() => setEditingReply(null)}
												className="rounded-[4px] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]"
											>
												Cancel
											</button>
											<button
												type="button"
												onClick={() =>
													updateReply.mutate({ replyId: comment.reply!.id, body: editReplyText })
												}
												disabled={!editReplyText.trim() || updateReply.isPending}
												className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] text-white hover:opacity-80 disabled:opacity-40"
											>
												Save
											</button>
										</div>
									</div>
								)}
								{/* Inline reply input (when no reply exists) — single click to start typing */}
								{!comment.reply && !discardedBodies.has(comment.id) && (
									<div className="mt-1.5">
										<textarea
											placeholder="Reply..."
											value={addingReplyTo === comment.id ? newReplyText : ""}
											rows={
												addingReplyTo === comment.id && newReplyText
													? Math.min(Math.max(newReplyText.split("\n").length, 2), 6)
													: 1
											}
											onFocus={() => {
												if (addingReplyTo !== comment.id) {
													setAddingReplyTo(comment.id);
													setNewReplyText("");
												}
											}}
											onChange={(e) => {
												setAddingReplyTo(comment.id);
												setNewReplyText(e.target.value);
											}}
											onKeyDown={(e) => {
												if (e.key === "Enter" && !e.shiftKey && newReplyText.trim()) {
													e.preventDefault();
													addReply.mutate({
														commentId: comment.id,
														body: newReplyText.trim(),
													});
												}
												if (e.key === "Escape") {
													setAddingReplyTo(null);
													setNewReplyText("");
													(e.target as HTMLTextAreaElement).blur();
												}
											}}
											className={[
												"w-full resize-none rounded-[4px] text-[11px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] transition-all focus:outline-none",
												addingReplyTo === comment.id
													? "border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5"
													: "border border-transparent bg-transparent px-0 py-0.5",
											].join(" ")}
										/>
										{addingReplyTo === comment.id && newReplyText && (
											<div className="mt-0.5 text-[9px] text-[var(--text-quaternary)]">
												Enter to save · Shift+Enter for new line · Esc to cancel
											</div>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ── Active State ──────────────────────────────────────────────────────────────

function ActiveState({
	session,
	workspaceId,
}: {
	session: SolveSessionInfo;
	workspaceId: string;
}) {
	const meta = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const dismissSolve = trpc.commentSolver.dismissSolve.useMutation();
	const utils = trpc.useUtils();
	const [pushError, setPushError] = useState<string | null>(null);
	const pushAndPost = trpc.commentSolver.pushAndPost.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate({ sessionId: session.id });
			utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
		},
		onError: (err) => setPushError(err.message),
	});

	const prTitle = meta?.prTitle ?? session.prTitle ?? "Pull Request";
	const prNumber =
		meta?.prIdentifier?.match(/#(\d+)$/)?.[1] ?? session.prIdentifier.match(/#(\d+)$/)?.[1] ?? null;
	const sourceBranch = meta?.sourceBranch ?? session.sourceBranch ?? null;

	// Comment-level stats
	const allComments = session.groups.flatMap((g) => g.comments);
	const totalComments = allComments.length;
	const resolved = allComments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const unclearComments = allComments.filter((c) => c.status === "unclear").length;
	const pendingComments = totalComments - resolved - unclearComments;

	const nonRevertedGroups = session.groups.filter((g) => g.status !== "reverted");
	const approvedGroupCount = nonRevertedGroups.filter((g) => g.status === "approved").length;
	const totalGroupCount = nonRevertedGroups.length;
	const allGroupsApproved = approvedGroupCount === totalGroupCount && totalGroupCount > 0;

	const unclearDraftCount = allComments.filter(
		(c) => c.status === "unclear" && c.reply?.status === "draft"
	).length;

	const approvedReplyCount = allComments.filter((c) => c.reply?.status === "approved").length;

	const unapprovedGroupCount = totalGroupCount - approvedGroupCount;

	const handleDismiss = () => {
		dismissSolve.mutate(
			{ sessionId: session.id },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
				},
			}
		);
	};

	return (
		<div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[var(--bg-base)]">
			{/* PR Header */}
			<div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
				{/* Top row: label + branch */}
				<div className="flex items-center justify-between">
					<span className="text-[10px] uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
						{prNumber ? `Pull Request #${prNumber}` : "Pull Request"}
					</span>
					{sourceBranch && (
						<span
							className="text-[10px] text-[var(--text-quaternary)]"
							style={{ fontFamily: "var(--font-mono)" }}
						>
							{sourceBranch}
						</span>
					)}
				</div>
				{/* PR title */}
				<h1 className="mt-1 text-[14px] font-semibold text-[var(--text)]">{prTitle}</h1>
				{/* Subtle status summary */}
				<div className="mt-1.5">
					<ProgressSummary
						resolved={resolved}
						pending={pendingComments}
						unclear={unclearComments}
					/>
				</div>
			</div>

			{/* Open Solve Review tab link */}
			<div className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-1.5">
				<button
					type="button"
					onClick={() => useTabStore.getState().addSolveReviewTab(workspaceId, session.id)}
					className="text-[11px] text-[var(--accent)] hover:opacity-80 transition-opacity"
				>
					&#8599; Open Solve Review tab
				</button>
			</div>

			{/* Commit Groups section */}
			<div className="flex-1 overflow-y-auto px-3 py-2">
				<div className="mb-2 text-[10px] uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
					{session.groups.length} Commit Group{session.groups.length !== 1 ? "s" : ""}
				</div>

				{session.groups.length === 0 ? (
					<div className="flex h-32 items-center justify-center">
						<span className="text-[12px] text-[var(--text-quaternary)]">No commit groups</span>
					</div>
				) : (
					<div className="flex flex-col gap-2.5">
						{session.groups.map((group, i) => (
							<CommitGroupCard
								key={group.id}
								group={group}
								sessionId={session.id}
								workspaceId={workspaceId}
								defaultExpanded={i === 0}
							/>
						))}
					</div>
				)}
			</div>

			{/* Bottom bar */}
			<div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
				{/* Error feedback */}
				{pushError && (
					<div className="border-b border-[var(--border-subtle)] bg-[rgba(255,69,58,0.1)] px-4 py-1.5 text-[10px] text-[#ff453a]">
						{pushError}
					</div>
				)}

				{/* Progress bar */}
				{totalGroupCount > 0 && (
					<div className="flex items-center gap-2 px-4 pt-2.5">
						<div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
							<div
								className="h-full rounded-full transition-all duration-300"
								style={{
									width: `${(approvedGroupCount / totalGroupCount) * 100}%`,
									background: allGroupsApproved ? "#34c759" : "#0a84ff",
								}}
							/>
						</div>
						<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
							{approvedGroupCount} of {totalGroupCount} approved
						</span>
					</div>
				)}

				{/* Status line */}
				<div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 text-[10px]">
					{allGroupsApproved ? (
						<>
							<span className="font-medium text-[#34c759]">✓ All groups approved</span>
							{approvedReplyCount > 0 && (
								<>
									<span className="text-[var(--text-quaternary)]">·</span>
									<span className="text-[var(--text-tertiary)]">
										{approvedReplyCount} {approvedReplyCount === 1 ? "reply" : "replies"} will be
										posted
									</span>
								</>
							)}
						</>
					) : (
						<>
							{unclearDraftCount > 0 && (
								<span className="rounded-[3px] bg-[rgba(255,159,10,0.12)] px-1.5 py-px font-medium text-[#ff9f0a]">
									⚠ {unclearDraftCount} unclear {unclearDraftCount === 1 ? "reply" : "replies"} need
									sign-off
								</span>
							)}
							{unapprovedGroupCount > 0 && (
								<>
									{unclearDraftCount > 0 && (
										<span className="text-[var(--text-quaternary)]">·</span>
									)}
									<span className="text-[var(--text-tertiary)]">
										{unapprovedGroupCount} {unapprovedGroupCount === 1 ? "group" : "groups"} not yet
										approved
									</span>
								</>
							)}
						</>
					)}
				</div>

				{/* Action buttons */}
				<div className="flex items-center gap-2 px-4 pb-2.5">
					<button
						type="button"
						disabled={!allGroupsApproved || pushAndPost.isPending}
						onClick={() => pushAndPost.mutate({ sessionId: session.id })}
						className="w-full rounded-[8px] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{pushAndPost.isPending
							? "Pushing…"
							: `Push changes & post replies${allGroupsApproved && approvedGroupCount > 0 ? ` (${approvedGroupCount}/${totalGroupCount})` : ""}`}
					</button>
					<button
						type="button"
						onClick={handleDismiss}
						disabled={dismissSolve.isPending}
						className="rounded-[6px] border border-[var(--border)] bg-transparent px-4 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-overlay)] disabled:opacity-50"
					>
						{dismissSolve.isPending ? "Reverting..." : "Revert all"}
					</button>
				</div>
			</div>
		</div>
	);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AIFixesTab({ workspaceId }: AIFixesTabProps) {
	const utils = trpc.useUtils();

	// Get all non-dismissed sessions for this workspace
	const sessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
		{ workspaceId },
		{ staleTime: 5_000 }
	);

	// Find the latest non-dismissed session
	const latestSession = useMemo(() => {
		const sessions = sessionsQuery.data ?? [];
		if (sessions.length === 0) return null;
		const sorted = [...sessions].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
		return sorted[0] ?? null;
	}, [sessionsQuery.data]);

	// Fetch full session data if we have one
	const sessionQuery = trpc.commentSolver.getSolveSession.useQuery(
		{ sessionId: latestSession?.id ?? "" },
		{
			enabled: !!latestSession?.id,
			staleTime: 5_000,
			refetchInterval:
				latestSession?.status === "in_progress" || latestSession?.status === "queued"
					? 3_000
					: false,
		}
	);

	const resetSession = trpc.commentSolver.resetFailedSession.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate();
			utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
		},
	});
	const keepSession = trpc.commentSolver.keepFailedSession.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate();
			utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
		},
	});

	const fullSession = sessionQuery.data ?? null;
	const isSolving = latestSession?.status === "queued" || latestSession?.status === "in_progress";

	// Active state: session is "ready" with full data
	if (fullSession && fullSession.status === "ready") {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				{isSolving && <SolvingBanner />}
				<ActiveState session={fullSession} workspaceId={workspaceId} />
			</div>
		);
	}

	// Failed state: session stopped unexpectedly
	if (fullSession && fullSession.status === "failed") {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<div className="flex flex-1 flex-col items-center justify-center px-4">
					<div className="flex w-full max-w-sm flex-col gap-4 rounded-[10px] border border-[var(--border-destructive,#ff3b30)] bg-[var(--bg-surface)] p-4">
						<div className="flex flex-col gap-1">
							<span className="text-[13px] font-medium text-[var(--text)]">
								The solver stopped unexpectedly
							</span>
							{fullSession.lastActivityAt && (
								<span className="text-[12px] text-[var(--text-tertiary)]">
									Last activity:{" "}
									{formatRelativeTime(new Date(fullSession.lastActivityAt).toISOString())}
								</span>
							)}
						</div>

						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => resetSession.mutate({ sessionId: fullSession.id })}
								disabled={resetSession.isPending || keepSession.isPending}
								className="flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
							>
								{resetSession.isPending ? "Reverting…" : "Reset & try again"}
							</button>
							<button
								type="button"
								onClick={() => keepSession.mutate({ sessionId: fullSession.id })}
								disabled={resetSession.isPending || keepSession.isPending}
								className="flex-1 rounded-[6px] bg-[var(--accent)] px-3 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{keepSession.isPending ? "Saving…" : "Keep partial changes"}
							</button>
						</div>

						{(resetSession.error ?? keepSession.error) && (
							<span className="text-[12px] text-[var(--text-destructive)]">
								{(resetSession.error ?? keepSession.error)?.message}
							</span>
						)}
					</div>
				</div>
			</div>
		);
	}

	// Empty state (with optional solving banner)
	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			{isSolving && <SolvingBanner />}
			<div className="flex flex-1 flex-col items-center justify-center gap-2">
				<span className="text-[13px] text-[var(--text-secondary)]">No AI fixes pending</span>
				<span className="text-[11px] text-[var(--text-quaternary)]">
					Use the Comments tab to trigger AI solving
				</span>
			</div>
		</div>
	);
}
