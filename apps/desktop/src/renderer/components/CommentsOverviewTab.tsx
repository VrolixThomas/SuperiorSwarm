import { useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

// ── Props ─────────────────────────────────────────────────────────────────────

interface CommentsOverviewTabProps {
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
		go: "go",
		json: "json",
		css: "css",
		html: "html",
	};
	return map[ext] ?? "plaintext";
}

// ── PR Header ─────────────────────────────────────────────────────────────────

function PRHeader({
	title,
	prNumber,
	sourceBranch,
	commentCount,
}: {
	title: string;
	prNumber: string | null;
	sourceBranch: string | null;
	commentCount: number;
}) {
	return (
		<div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
			<div className="flex items-center gap-2">
				<h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
					{title}
				</h1>
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
				{commentCount > 0 && (
					<>
						<span className="text-[var(--text-quaternary)]">&middot;</span>
						<span className="text-[var(--text-quaternary)]">
							{commentCount} comment{commentCount !== 1 ? "s" : ""}
						</span>
					</>
				)}
			</div>
		</div>
	);
}

// ── Solving Banner ────────────────────────────────────────────────────────────

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

// ── Main Component ────────────────────────────────────────────────────────────

export function CommentsOverviewTab({ workspaceId }: CommentsOverviewTabProps) {
	const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
	const [replyingTo, setReplyingTo] = useState<string | null>(null);
	const [replyText, setReplyText] = useState("");

	const commentsQuery = trpc.commentSolver.getWorkspaceComments.useQuery(
		{ workspaceId },
		{ staleTime: 10_000 }
	);
	const sessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
		{ workspaceId },
		{ staleTime: 5_000 }
	);
	const triggerSolve = trpc.commentSolver.triggerSolve.useMutation();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const utils = trpc.useUtils();

	const meta = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const comments = commentsQuery.data ?? [];

	const prTitle = meta?.prTitle ?? "Pull Request";
	const prNumber = meta?.prIdentifier?.match(/#(\d+)$/)?.[1] ?? null;
	const sourceBranch = meta?.sourceBranch ?? null;

	// Check if a solve session is in progress
	const sessions = sessionsQuery.data ?? [];
	const isSessionInProgress = sessions.some((s) => s.status === "queued" || s.status === "running");

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

	// ── Error state ───────────────────────────────────────────────────────

	if (commentsQuery.isError) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader
					title={prTitle}
					prNumber={prNumber}
					sourceBranch={sourceBranch}
					commentCount={0}
				/>
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

	// ── Loading state ─────────────────────────────────────────────────────

	if (commentsQuery.isLoading) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader
					title={prTitle}
					prNumber={prNumber}
					sourceBranch={sourceBranch}
					commentCount={0}
				/>
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

	// ── Empty state ───────────────────────────────────────────────────────

	if (comments.length === 0) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader
					title={prTitle}
					prNumber={prNumber}
					sourceBranch={sourceBranch}
					commentCount={0}
				/>
				<div className="flex flex-1 items-center justify-center">
					<span className="text-[12px] text-[var(--text-quaternary)]">No comments on this PR</span>
				</div>
			</div>
		);
	}

	// ── Main render ───────────────────────────────────────────────────────

	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			<PRHeader
				title={prTitle}
				prNumber={prNumber}
				sourceBranch={sourceBranch}
				commentCount={comments.length}
			/>

			{isSessionInProgress && <SolvingBanner />}

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
														? {
																lineNumber: comment.lineNumber,
																column: 1,
															}
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
									<div className="border-t border-[var(--border-subtle)] px-3 py-2">
										<textarea
											value={replyText}
											onChange={(e) => setReplyText(e.target.value)}
											placeholder="Write a reply..."
											className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
											rows={3}
										/>
										<div className="mt-1.5 flex justify-end gap-1.5">
											<button
												type="button"
												onClick={() => {
													setReplyingTo(null);
													setReplyText("");
												}}
												className="rounded-[4px] px-2.5 py-1 text-[10px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] transition-colors"
											>
												Cancel
											</button>
											<button
												type="button"
												onClick={() => {
													// Post reply placeholder — actual posting via pushAndPost flow
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
								<div className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											if (replyingTo === comment.platformId) {
												setReplyingTo(null);
												setReplyText("");
											} else {
												setReplyingTo(comment.platformId);
												setReplyText("");
											}
										}}
										className="rounded-[4px] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] transition-colors"
									>
										Reply
									</button>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											// TODO: resolve via GitHub/Bitbucket API
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
					disabled={triggerSolve.isPending || includedCount === 0 || isSessionInProgress}
					className="w-full rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					{triggerSolve.isPending
						? "Starting..."
						: `Solve with AI (${includedCount} comment${includedCount !== 1 ? "s" : ""})`}
				</button>
			</div>
		</div>
	);
}
