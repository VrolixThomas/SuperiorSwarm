import { useMemo, useState } from "react";
import type { SolveCommentInfo, SolveGroupInfo, SolveSessionInfo } from "../../shared/solve-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AIFixesTabProps {
	workspaceId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectLanguage(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "typescriptreact",
		js: "javascript",
		jsx: "javascriptreact",
		py: "python",
		rs: "rust",
		go: "go",
		json: "json",
		md: "markdown",
		css: "css",
		html: "html",
		yaml: "yaml",
		yml: "yaml",
		sql: "sql",
	};
	return map[ext] ?? "plaintext";
}

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

// ── SolvingBanner ─────────────────────────────────────────────────────────────

function SolvingBanner() {
	return (
		<div className="flex items-center gap-2 border-b border-[var(--accent)] bg-[rgba(10,132,255,0.08)] px-3 py-1.5">
			<div
				className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[var(--border-subtle)] border-t-[var(--accent)]"
				style={{ animation: "spin 0.8s linear infinite" }}
			/>
			<span className="text-[10px] text-[var(--accent)]">
				AI is solving comments — check the AI Solver terminal tab
			</span>
			<style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
		</div>
	);
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
		},
	});

	const handleFollowUp = () => {
		// Find existing AI Solver terminal tab for this workspace
		const tabStore = useTabStore.getState();
		const tabs = tabStore.getTabsByWorkspace(workspaceId);
		const solverTab = tabs.find(
			(t) => t.kind === "terminal" && t.title === "AI Solver"
		);

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
	const filePaths = uniqueFilePaths(group.comments);
	const totalComments = group.comments.length;
	const fixedComments = group.comments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const allFixed = fixedComments === totalComments && totalComments > 0;
	const canApprove = group.status === "fixed";

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
							onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); approveGroup.mutate({ groupId: group.id }); } }}
							className="rounded-[4px] bg-[rgba(48,209,88,0.15)] px-2 py-0.5 text-[10px] font-medium text-[#30d158] hover:opacity-80"
						>
							{approveGroup.isPending ? "..." : "Approve"}
						</span>
					)}
					{group.status === "approved" && (
						<span className="rounded-[3px] bg-[rgba(10,132,255,0.15)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[#0a84ff]">
							Approved
						</span>
					)}
					<span
						role="button"
						tabIndex={0}
						onClick={(e) => {
							e.stopPropagation();
							handleFollowUp();
						}}
						onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); handleFollowUp(); } }}
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
						<>
							<span style={{ fontFamily: "var(--font-mono)" }}>{shortHash}</span>
							<span>&middot;</span>
						</>
					)}
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
							<p className="whitespace-pre-wrap text-[11px] leading-[1.5] text-[var(--text-tertiary)]">
								{comment.body}
							</p>
							{/* Draft reply — editable */}
							{comment.reply && editingReply !== comment.reply.id && (
								<div className="mt-2 rounded-[4px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5">
									<div className="flex items-center justify-between">
										<span className="text-[10px] font-medium text-[var(--text-quaternary)]">
											Draft reply:
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
									<p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[var(--text-tertiary)]">
										{comment.reply.body}
									</p>
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
											onClick={() => updateReply.mutate({ replyId: comment.reply!.id, body: editReplyText })}
											disabled={!editReplyText.trim() || updateReply.isPending}
											className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] text-white hover:opacity-80 disabled:opacity-40"
										>
											Save
										</button>
									</div>
								</div>
							)}
							{/* Inline reply input (when no reply exists) — single click to start typing */}
							{!comment.reply && (
								<div className="mt-1.5">
									<textarea
										placeholder="Reply..."
										value={addingReplyTo === comment.id ? newReplyText : ""}
										rows={addingReplyTo === comment.id && newReplyText ? Math.min(Math.max(newReplyText.split("\n").length, 2), 6) : 1}
										onFocus={() => { if (addingReplyTo !== comment.id) { setAddingReplyTo(comment.id); setNewReplyText(""); } }}
										onChange={(e) => { setAddingReplyTo(comment.id); setNewReplyText(e.target.value); }}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !e.shiftKey && newReplyText.trim()) {
												e.preventDefault();
												addReply.mutate({
													commentId: comment.id,
													body: newReplyText.trim(),
												});
												setAddingReplyTo(null);
												setNewReplyText("");
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
	const pushAndPost = trpc.commentSolver.pushAndPost.useMutation();
	const utils = trpc.useUtils();
	const [pushError, setPushError] = useState<string | null>(null);

	const prTitle = meta?.prTitle ?? session.prTitle ?? "Pull Request";
	const prNumber =
		meta?.prIdentifier?.match(/#(\d+)$/)?.[1] ?? session.prIdentifier.match(/#(\d+)$/)?.[1] ?? null;
	const sourceBranch = meta?.sourceBranch ?? session.sourceBranch ?? null;

	// Comment-level stats
	const allComments = session.groups.flatMap((g) => g.comments);
	const totalComments = allComments.length;
	const resolvedComments = allComments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	// Also count groups that are fully approved as resolved
	const approvedGroupComments = session.groups
		.filter((g) => g.status === "approved")
		.flatMap((g) => g.comments).length;
	const resolved = Math.max(resolvedComments, approvedGroupComments);
	const unclearComments = allComments.filter((c) => c.status === "unclear").length;
	const pendingComments = totalComments - resolved - unclearComments;

	// Reply counts
	const allReplies = allComments.filter((c) => c.reply != null);
	const approvedReplies = allReplies.filter((c) => c.reply?.status === "approved").length;
	const draftReplies = allReplies.filter((c) => c.reply?.status === "draft").length;

	// Non-reverted groups
	const nonRevertedGroups = session.groups.filter((g) => g.status !== "reverted");
	const allGroupsApproved =
		nonRevertedGroups.length > 0 && nonRevertedGroups.every((g) => g.status === "approved");
	const hasDraftReplies = allComments.some((c) => c.reply && c.reply.status === "draft");
	const canPush = allGroupsApproved && !hasDraftReplies;

	const handlePush = () => {
		setPushError(null);
		pushAndPost.mutate(
			{ sessionId: session.id },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
					utils.commentSolver.getSolveSession.invalidate({ sessionId: session.id });
				},
				onError: (err) => {
					setPushError(err.message);
				},
			}
		);
	};

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

				{/* Summary */}
				<div className="px-4 pt-2 text-[10px] text-[var(--text-tertiary)]">
					{allReplies.length > 0 && (
						<span>
							{approvedReplies} draft replies ready
							{draftReplies > 0 && ` \u00B7 ${draftReplies} needs your input`}
						</span>
					)}
				</div>

				{/* Buttons */}
				<div className="flex items-center gap-2 px-4 py-2.5">
					<button
						type="button"
						onClick={handlePush}
						disabled={!canPush || pushAndPost.isPending}
						className="flex-1 rounded-[6px] bg-[#34c759] px-4 py-1.5 text-[11px] font-semibold text-black transition-colors hover:bg-[#2db84e] disabled:opacity-40"
					>
						{pushAndPost.isPending ? "Pushing..." : "Push changes & post replies"}
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
