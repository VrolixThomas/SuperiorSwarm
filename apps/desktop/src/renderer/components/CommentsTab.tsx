import { useEffect, useMemo, useRef, useState } from "react";
import type { SolveCommentInfo, SolveGroupInfo, SolveSessionInfo } from "../../shared/solve-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { SolveActionBar } from "./SolveActionBar";

// ── Props ─────────────────────────────────────────────────────────────────────

interface CommentsTabProps {
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

/** Deduplicate file paths from a group's comments, preserving order. */
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

const GROUP_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	fixed: { bg: "#2d5a2d", text: "#6fdb6f", label: "Fixed" },
	approved: { bg: "rgba(10,132,255,0.15)", text: "#0a84ff", label: "Approved" },
	reverted: { bg: "rgba(220,50,50,0.15)", text: "#ff6b6b", label: "Reverted" },
	pending: { bg: "var(--bg-overlay)", text: "var(--text-tertiary)", label: "Pending" },
};

const COMMENT_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	open: { bg: "var(--bg-overlay)", text: "var(--text-tertiary)", label: "Open" },
	fixed: { bg: "#2d5a2d", text: "#6fdb6f", label: "Fixed" },
	unclear: { bg: "#8a6d2b", text: "#ffd54f", label: "Unclear" },
	wont_fix: { bg: "rgba(220,50,50,0.15)", text: "#ff6b6b", label: "Won't Fix" },
};

// ── PR Header ─────────────────────────────────────────────────────────────────

function PRHeader({
	title,
	prNumber,
	sourceBranch,
	statusText,
	statusColor,
	onDismiss,
	isDismissing,
}: {
	title: string;
	prNumber: string | null;
	sourceBranch: string | null;
	statusText?: string;
	statusColor?: string;
	onDismiss?: () => void;
	isDismissing?: boolean;
}) {
	return (
		<div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
			<div className="flex items-center gap-2">
				<h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
					{title}
				</h1>
				{onDismiss && (
					<button
						type="button"
						onClick={onDismiss}
						disabled={isDismissing}
						className="shrink-0 text-[10px] text-[var(--text-quaternary)] hover:text-[#ff6b6b] transition-colors disabled:opacity-50"
					>
						{isDismissing ? "Dismissing..." : "Dismiss"}
					</button>
				)}
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
				{prNumber && <span className="text-[var(--text-tertiary)]">#{prNumber}</span>}
				{sourceBranch && (
					<>
						<span className="text-[var(--text-quaternary)]">&middot;</span>
						<span
							className="text-[var(--text-quaternary)]"
							style={{ fontFamily: "var(--font-mono)" }}
						>
							{sourceBranch}
						</span>
					</>
				)}
				{statusText && (
					<>
						<span className="text-[var(--text-quaternary)]">&middot;</span>
						<span style={{ color: statusColor }}>{statusText}</span>
					</>
				)}
			</div>
		</div>
	);
}

// ── State 1: Unsolved ─────────────────────────────────────────────────────────

function UnsolvedState({ workspaceId }: { workspaceId: string }) {
	const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
	const [replyingTo, setReplyingTo] = useState<string | null>(null);
	const [replyText, setReplyText] = useState("");
	const commentsQuery = trpc.commentSolver.getWorkspaceComments.useQuery(
		{ workspaceId },
		{ staleTime: 10_000 }
	);
	const triggerSolve = trpc.commentSolver.triggerSolve.useMutation();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const utils = trpc.useUtils();

	const meta = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const comments = commentsQuery.data ?? [];

	const toggleSkip = (platformId: string) => {
		setSkippedIds((prev) => {
			const next = new Set(prev);
			if (next.has(platformId)) {
				next.delete(platformId);
			} else {
				next.add(platformId);
			}
			return next;
		});
	};

	const includedCount = comments.length - skippedIds.size;

	const handleSolve = () => {
		triggerSolve.mutate(
			{
				workspaceId,
				excludeCommentIds: [...skippedIds],
			},
			{
				onSuccess: (launchInfo) => {
					utils.commentSolver.getSolveSessions.invalidate({ workspaceId });

					const tabStore = useTabStore.getState();
					const tabId = tabStore.addTerminalTab(
						launchInfo.workspaceId,
						launchInfo.worktreePath,
						"AI Solver"
					);
					attachTerminal.mutate({
						workspaceId: launchInfo.workspaceId,
						terminalId: tabId,
					});

					setTimeout(() => {
						window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\r`);
					}, 1000);
				},
			}
		);
	};

	const prTitle = meta?.prTitle ?? "Pull Request";
	const prNumber = meta?.prIdentifier?.match(/#(\d+)$/)?.[1] ?? null;
	const sourceBranch = meta?.sourceBranch ?? null;

	// Error state
	if (commentsQuery.isError) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader title={prTitle} prNumber={prNumber} sourceBranch={sourceBranch} />
				<div className="flex flex-1 flex-col items-center justify-center gap-3">
					<div className="max-w-[280px] text-center text-[11px] text-[#ff453a]">
						{commentsQuery.error.message}
					</div>
					<button
						type="button"
						onClick={() => commentsQuery.refetch()}
						className="rounded-[6px] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] transition-colors"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	// Loading state
	if (commentsQuery.isLoading) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader title={prTitle} prNumber={prNumber} sourceBranch={sourceBranch} />
				<div className="flex flex-1 flex-col items-center justify-center gap-3">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-3 animate-pulse rounded bg-[var(--bg-elevated)]"
							style={{ width: `${180 - i * 30}px` }}
						/>
					))}
					<div className="mt-2 text-[11px] text-[var(--text-quaternary)]">Loading comments...</div>
				</div>
			</div>
		);
	}

	// Empty state
	if (comments.length === 0) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader title={prTitle} prNumber={prNumber} sourceBranch={sourceBranch} />
				<div className="flex flex-1 items-center justify-center">
					<span className="text-[12px] text-[var(--text-quaternary)]">No comments on this PR</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			<PRHeader title={prTitle} prNumber={prNumber} sourceBranch={sourceBranch} />

			{/* Comment cards */}
			<div className="flex-1 overflow-y-auto px-3 py-2">
				<div className="flex flex-col gap-1.5">
					{comments.map((comment) => {
						const isSkipped = skippedIds.has(comment.platformId);
						const filename = comment.filePath ? comment.filePath.split("/").pop() : null;

						return (
							<div
								key={comment.platformId}
								className={[
									"w-full rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-opacity duration-150",
									isSkipped ? "opacity-40" : "",
								].join(" ")}
							>
								{/* Card header */}
								<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
									<span className="text-[10px] font-medium text-[var(--text-secondary)]">
										{comment.author}
									</span>
									{comment.filePath && (
										<button
											type="button"
											onClick={() => {
												const cwd = useTabStore.getState().activeWorkspaceCwd;
												if (!cwd) return;
												const lang = detectLanguage(comment.filePath ?? "");
												useTabStore.getState().openFile(
													workspaceId,
													cwd,
													comment.filePath ?? "",
													lang,
													comment.lineNumber != null
														? { lineNumber: comment.lineNumber, column: 1 }
														: undefined
												);
											}}
											className="font-mono text-[10px] text-[var(--accent)] hover:underline"
											title={comment.filePath}
										>
											{filename}
											{comment.lineNumber != null && `:${comment.lineNumber}`}
										</button>
									)}
									<div className="flex-1" />
									{isSkipped && (
										<span className="rounded-[3px] bg-[var(--bg-overlay)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
											Skipped
										</span>
									)}
								</div>
								{/* Card body */}
								<div className="px-3 py-2 text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap">
									{comment.body}
								</div>
								{/* Reply textarea */}
								{replyingTo === comment.platformId && (
									<div className="px-3 py-2 border-t border-[var(--border-subtle)]">
										<textarea
											value={replyText}
											onChange={(e) => setReplyText(e.target.value)}
											placeholder="Write a reply..."
											className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
											rows={3}
										/>
										<div className="flex justify-end gap-1.5 mt-1.5">
											<button
												type="button"
												onClick={() => { setReplyingTo(null); setReplyText(""); }}
												className="rounded-[4px] px-2.5 py-1 text-[10px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] transition-colors"
											>
												Cancel
											</button>
											<button
												type="button"
												onClick={() => {
													// Post reply - for now just close the textarea
													// The actual posting will be done when we implement the pushAndPost flow
													setReplyingTo(null);
													setReplyText("");
												}}
												disabled={!replyText.trim()}
												className="rounded-[4px] bg-[var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
											>
												Post Reply
											</button>
										</div>
									</div>
								)}
								{/* Card actions */}
								<div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--border-subtle)]">
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											// Toggle reply textarea visibility
											setReplyingTo(replyingTo === comment.platformId ? null : comment.platformId);
										}}
										className="rounded-[4px] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] transition-colors"
									>
										Reply
									</button>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											// TODO: resolve via GitHub/Bitbucket API - for now this is a placeholder
										}}
										className="rounded-[4px] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] transition-colors"
									>
										Resolve
									</button>
									<div className="flex-1" />
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											toggleSkip(comment.platformId);
										}}
										className={[
											"rounded-[4px] px-2 py-0.5 text-[10px] font-medium transition-colors",
											isSkipped
												? "bg-[var(--bg-overlay)] text-[var(--text-secondary)]"
												: "text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-tertiary)]",
										].join(" ")}
									>
										{isSkipped ? "Include" : "Skip"}
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Solve button */}
			<div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5">
				{triggerSolve.isError && (
					<div className="mb-2 text-[10px] text-[#ff453a]">{triggerSolve.error.message}</div>
				)}
				<button
					type="button"
					onClick={handleSolve}
					disabled={triggerSolve.isPending || includedCount === 0}
					className="w-full rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					{triggerSolve.isPending
						? "Starting..."
						: `Solve Comments with AI (${includedCount} of ${comments.length})`}
				</button>
			</div>
		</div>
	);
}

// ── State 2: In Progress ──────────────────────────────────────────────────────

function InProgressState({
	session,
	workspaceId,
}: {
	session: { id: string; status: string };
	workspaceId: string;
}) {
	const meta = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const prTitle = meta?.prTitle ?? "Pull Request";
	const prNumber = meta?.prIdentifier?.match(/#(\d+)$/)?.[1] ?? null;
	const sourceBranch = meta?.sourceBranch ?? null;

	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			<PRHeader
				title={prTitle}
				prNumber={prNumber}
				sourceBranch={sourceBranch}
				statusText="solving..."
				statusColor="#ffd54f"
			/>

			<div className="flex flex-1 flex-col items-center justify-center gap-4">
				{/* Spinner */}
				<div
					className="h-8 w-8 rounded-full border-2 border-[var(--border-subtle)] border-t-[var(--accent)]"
					style={{ animation: "spin 0.8s linear infinite" }}
				/>
				<div className="text-[12px] text-[var(--text-secondary)]">
					AI is analyzing and fixing comments...
				</div>
				<div className="text-[10px] text-[var(--text-quaternary)]">
					Watch progress in the AI Solver terminal tab
				</div>
			</div>

			{/* CSS keyframe for spinner */}
			<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
		</div>
	);
}

// ── State 3: Solved ───────────────────────────────────────────────────────────

function ReplyEditor({
	comment,
	sessionId,
}: {
	comment: SolveCommentInfo;
	sessionId: string;
}) {
	const reply = comment.reply;
	const [editBody, setEditBody] = useState(reply?.body ?? "");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const utils = trpc.useUtils();

	useEffect(() => {
		setEditBody(reply?.body ?? "");
	}, [reply?.body]);

	const invalidateSession = () => {
		utils.commentSolver.getSolveSession.invalidate({ sessionId });
	};

	const updateReply = trpc.commentSolver.updateReply.useMutation({
		onSuccess: invalidateSession,
	});

	const deleteReply = trpc.commentSolver.deleteReply.useMutation({
		onSuccess: invalidateSession,
	});

	if (!reply) return null;

	const isDraft = reply.status === "draft";
	const isApproved = reply.status === "approved";

	return (
		<div className="mt-2 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
				<span className="text-[10px] font-medium text-[var(--text-tertiary)]">Draft Reply</span>
				<div className="flex-1" />
				{isApproved && (
					<span className="rounded-[3px] bg-[rgba(10,132,255,0.15)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[#0a84ff]">
						Approved
					</span>
				)}
			</div>

			<div className="p-2">
				<textarea
					ref={textareaRef}
					value={editBody}
					onChange={(e) => setEditBody(e.target.value)}
					rows={3}
					disabled={isApproved}
					className={[
						"w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]",
						isApproved ? "opacity-60" : "",
					].join(" ")}
				/>
			</div>

			{isDraft && (
				<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
					<button
						type="button"
						onClick={() => {
							updateReply.mutate({
								replyId: reply.id,
								body: editBody,
								status: "approved",
							});
						}}
						disabled={updateReply.isPending}
						className="rounded-[4px] px-2.5 py-0.5 text-[10px] font-medium bg-[rgba(48,209,88,0.15)] text-[#30d158] hover:opacity-80 disabled:opacity-50"
					>
						{updateReply.isPending ? "Saving..." : "Approve Reply"}
					</button>
					<button
						type="button"
						onClick={() => {
							deleteReply.mutate({ replyId: reply.id });
						}}
						disabled={deleteReply.isPending}
						className="rounded-[4px] px-2.5 py-0.5 text-[10px] bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:opacity-80 disabled:opacity-50"
					>
						Delete Reply
					</button>
				</div>
			)}
		</div>
	);
}

function SolvedGroupCard({
	group,
	sessionId,
	workspaceId,
}: {
	group: SolveGroupInfo;
	sessionId: string;
	workspaceId: string;
}) {
	const statusStyle = GROUP_STATUS_STYLES[group.status] ?? GROUP_STATUS_STYLES.pending;
	const shortHash = group.commitHash ? group.commitHash.slice(0, 7) : null;
	const hasUnclear = group.comments.some((c) => c.status === "unclear");
	const filePaths = uniqueFilePaths(group.comments);
	const repoPath = useTabStore((s) => s.activeWorkspaceCwd);

	// Determine active file from currently open tab
	const activeTabId = useTabStore((s) => s.getActiveTabId());
	const allTabs = useTabStore((s) => s.getVisibleTabs());
	const activeTab = useMemo(
		() => allTabs.find((t) => t.id === activeTabId) ?? null,
		[allTabs, activeTabId]
	);
	const activeFilePath = useMemo(() => {
		if (!activeTab) return null;
		if (activeTab.kind === "comment-fix-file" && activeTab.groupId === group.id) {
			return activeTab.filePath;
		}
		return null;
	}, [activeTab, group.id]);

	const revertGroup = trpc.commentSolver.revertGroup.useMutation();
	const approveGroup = trpc.commentSolver.approveGroup.useMutation();
	const utils = trpc.useUtils();

	const canRevert = group.status === "fixed" || group.status === "approved";

	const handleRevert = () => {
		revertGroup.mutate(
			{ groupId: group.id },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSession.invalidate({ sessionId });
				},
			}
		);
	};

	const handleApprove = () => {
		approveGroup.mutate(
			{ groupId: group.id },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSession.invalidate({ sessionId });
				},
			}
		);
	};

	const handleFileClick = (filePath: string) => {
		if (!group.commitHash) return;
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
		<div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
			{/* Group header */}
			<div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
				<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
					{group.label}
				</span>
				{hasUnclear && (
					<span className="text-[11px] text-[#ffd54f]" title="Has unclear comments">
						&#9888;
					</span>
				)}
				<span
					className="shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
					style={{
						backgroundColor: statusStyle.bg,
						color: statusStyle.text,
					}}
				>
					{statusStyle.label}
				</span>
				{shortHash && (
					<span
						className="text-[10px] text-[var(--text-quaternary)]"
						style={{ fontFamily: "var(--font-mono)" }}
					>
						{shortHash}
					</span>
				)}
			</div>

			{/* File list */}
			{filePaths.length > 0 && (
				<div className="border-b border-[var(--border-subtle)]">
					{filePaths.map((fp) => {
						const fileComments = group.comments.filter((c) => c.filePath === fp);
						const filename = fp.split("/").pop() ?? fp;
						const isActive = activeFilePath === fp;

						return (
							<button
								key={fp}
								type="button"
								onClick={() => handleFileClick(fp)}
								className={[
									"flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100",
									isActive
										? "border-l-2 border-l-[var(--accent)] bg-[rgba(10,132,255,0.08)]"
										: "border-l-2 border-l-transparent hover:bg-[var(--bg-elevated)]",
								].join(" ")}
							>
								<span className="text-[10px] text-[var(--text-quaternary)]">&#128196;</span>
								<span
									className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]"
									style={{ fontFamily: "var(--font-mono)" }}
									title={fp}
								>
									{filename}
								</span>
								<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
									{fileComments.length}
								</span>
							</button>
						);
					})}
				</div>
			)}

			{/* Comments nested under file context */}
			<div className="flex flex-col gap-0 divide-y divide-[var(--border-subtle)]">
				{group.comments.map((comment) => {
					const commentStatus = COMMENT_STATUS_STYLES[comment.status] ?? COMMENT_STATUS_STYLES.open;
					const isAddressed = comment.status === "fixed" || comment.status === "wont_fix";
					const needsClarification = comment.status === "unclear";

					return (
						<div key={comment.id} className="px-3 py-2">
							{/* Comment author + status */}
							<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
								<span className="font-medium text-[var(--text-secondary)]">{comment.author}</span>
								<span className="flex-1" />
								{isAddressed && (
									<span className="flex items-center gap-0.5 text-[#6fdb6f]">
										<span>&#10003;</span>
										<span>Addressed by AI</span>
									</span>
								)}
								{needsClarification && (
									<span className="flex items-center gap-0.5 text-[#ffd54f]">
										<span>&#9888;</span>
										<span>Needs clarification</span>
									</span>
								)}
								<span
									className="shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
									style={{
										backgroundColor: commentStatus.bg,
										color: commentStatus.text,
									}}
								>
									{commentStatus.label}
								</span>
							</div>
							{/* Comment body */}
							<p className="text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap">
								{comment.body}
							</p>
							{/* Reply editor for unclear comments */}
							{comment.reply && <ReplyEditor comment={comment} sessionId={sessionId} />}
						</div>
					);
				})}
			</div>

			{/* Group actions */}
			{(group.status === "fixed" || group.status === "approved") && (
				<div className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
					{group.status === "fixed" && (
						<button
							type="button"
							onClick={handleApprove}
							disabled={approveGroup.isPending}
							className="rounded-[4px] px-2.5 py-0.5 text-[10px] font-medium bg-[rgba(48,209,88,0.15)] text-[#30d158] hover:opacity-80 disabled:opacity-50"
						>
							{approveGroup.isPending ? "Approving..." : "Approve"}
						</button>
					)}
					{canRevert && (
						<button
							type="button"
							onClick={handleRevert}
							disabled={revertGroup.isPending}
							className="rounded-[4px] px-2.5 py-0.5 text-[10px] font-medium bg-[rgba(220,50,50,0.1)] text-[#ff6b6b] hover:opacity-80 disabled:opacity-50"
						>
							{revertGroup.isPending ? "Reverting..." : "Revert"}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function SolvedState({
	session,
	workspaceId,
}: {
	session: SolveSessionInfo;
	workspaceId: string;
}) {
	const meta = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const dismissSolve = trpc.commentSolver.dismissSolve.useMutation();
	const utils = trpc.useUtils();

	const prTitle = meta?.prTitle ?? session.prTitle ?? "Pull Request";
	const prNumber =
		meta?.prIdentifier?.match(/#(\d+)$/)?.[1] ?? session.prIdentifier.match(/#(\d+)$/)?.[1] ?? null;
	const sourceBranch = meta?.sourceBranch ?? session.sourceBranch ?? null;

	const totalComments = session.groups.reduce((sum, g) => sum + g.comments.length, 0);

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

	const handlePushSuccess = () => {
		utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
		utils.commentSolver.getSolveSession.invalidate({ sessionId: session.id });
	};

	// Failed session error state
	if (session.status === "failed") {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader
					title={prTitle}
					prNumber={prNumber}
					sourceBranch={sourceBranch}
					statusText="Failed"
					statusColor="#ff6b6b"
					onDismiss={handleDismiss}
					isDismissing={dismissSolve.isPending}
				/>
				<div className="flex flex-1 flex-col items-center justify-center gap-3">
					<div className="text-[12px] text-[#ff453a]">Solve session failed</div>
					<button
						type="button"
						onClick={handleDismiss}
						disabled={dismissSolve.isPending}
						className="rounded-[6px] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] transition-colors disabled:opacity-50"
					>
						{dismissSolve.isPending ? "Dismissing..." : "Retry"}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[var(--bg-base)]">
			<PRHeader
				title={prTitle}
				prNumber={prNumber}
				sourceBranch={sourceBranch}
				statusText={`${totalComments} comment${totalComments !== 1 ? "s" : ""}`}
				statusColor="var(--text-quaternary)"
				onDismiss={handleDismiss}
				isDismissing={dismissSolve.isPending}
			/>

			{/* Scrollable list of groups */}
			<div className="flex-1 overflow-y-auto px-3 py-2">
				{session.groups.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<span className="text-[12px] text-[var(--text-quaternary)]">No fix groups created</span>
					</div>
				) : (
					<div className="flex flex-col gap-2.5">
						{session.groups.map((group) => (
							<SolvedGroupCard
								key={group.id}
								group={group}
								sessionId={session.id}
								workspaceId={workspaceId}
							/>
						))}
					</div>
				)}
			</div>

			{/* Bottom action bar */}
			<SolveActionBar
				sessionId={session.id}
				groups={session.groups}
				onPushSuccess={handlePushSuccess}
			/>
		</div>
	);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CommentsTab({ workspaceId }: CommentsTabProps) {
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

	// State 1: No active session
	if (!latestSession) {
		if (sessionsQuery.isLoading) {
			return (
				<div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-base)]">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-3 animate-pulse rounded bg-[var(--bg-elevated)]"
							style={{ width: `${180 - i * 30}px` }}
						/>
					))}
					<div className="mt-2 text-[11px] text-[var(--text-quaternary)]">Loading sessions...</div>
				</div>
			);
		}
		return <UnsolvedState workspaceId={workspaceId} />;
	}

	// State 2: In progress (queued or in_progress)
	if (latestSession.status === "queued" || latestSession.status === "in_progress") {
		return <InProgressState session={latestSession} workspaceId={workspaceId} />;
	}

	// Session exists but still loading full data
	if (!fullSession) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-base)]">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="h-3 animate-pulse rounded bg-[var(--bg-elevated)]"
						style={{ width: `${180 - i * 30}px` }}
					/>
				))}
				<div className="mt-2 text-[11px] text-[var(--text-quaternary)]">Loading session...</div>
			</div>
		);
	}

	// State 3: Solved (ready/submitted/failed)
	return <SolvedState session={fullSession} workspaceId={workspaceId} />;
}
